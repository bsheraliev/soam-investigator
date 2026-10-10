import sys, json, fitz

def rect_of(p): return fitz.Rect(p["rect"])

def extract(src, pno):
    doc = fitz.open(src); page = doc[pno-1]
    H = page.rect.height
    dr = page.get_drawings()
    boxes = []   # closed shapes (rounded rects)
    conns = []   # connector polylines
    for p in dr:
        kinds = "".join(i[0] for i in p["items"])
        col, fill, dash = p.get("color"), p.get("fill"), p.get("dashes")
        r = rect_of(p)
        if set(kinds) == {"l"} and len(kinds) <= 4 and col and col[0] > 0.5 and col[1] < 0.1 and not fill:
            pts = []
            for it in p["items"]:
                pts += [fitz.Point(it[1]), fitz.Point(it[2])]
            conns.append({"pts": pts, "dotted": bool(dash and dash.strip() not in ("[] 0",))})
        elif (kinds.startswith("c") or kinds == "re" or set(kinds) == {"l"}) and r.width < 200 and r.height < 200:
            boxes.append({"rect": r, "fill": fill, "color": col, "dash": dash})
    # merge boxes with same rect (stroke path + fill path)
    merged = []
    for b in boxes:
        if b["rect"].width < 10 or b["rect"].height < 10: continue
        for m in merged:
            if abs(m["rect"].x0-b["rect"].x0)<1.2 and abs(m["rect"].y0-b["rect"].y0)<1.2 and abs(m["rect"].x1-b["rect"].x1)<1.2 and abs(m["rect"].y1-b["rect"].y1)<1.2:
                if b["fill"] and not m["fill"]: m["fill"] = b["fill"]
                if b["color"] and not m["color"]: m["color"] = b["color"]
                if b["dash"] and b["dash"].strip() not in ("[] 0",): m["dash"] = b["dash"]
                break
        else:
            merged.append(dict(b))
    # text lines
    lines = []
    for blk in page.get_text("dict")["blocks"]:
        for ln in blk.get("lines", []):
            t = "".join(s["text"] for s in ln["spans"]).strip()
            if not t: continue
            bb = fitz.Rect(ln["bbox"])
            if any(x["text"] == t and abs(x["bbox"].x0-bb.x0) < 4 and abs(x["bbox"].y0-bb.y0) < 4 for x in lines): continue
            lines.append({"text": t, "bbox": bb, "dir": ln["dir"]})
    for b in merged:
        b["lines"] = []
    for ln in lines:
        c = fitz.Point((ln["bbox"].x0+ln["bbox"].x1)/2, (ln["bbox"].y0+ln["bbox"].y1)/2)
        cands = [b for b in merged if b["rect"].contains(c)]
        if cands:
            b = min(cands, key=lambda b: b["rect"].get_area())
            b["lines"].append(ln)
    out = []
    for i, b in enumerate(merged):
        ls = sorted(b["lines"], key=lambda l: l["bbox"].x0)  # rotated ccw: first line at left
        text = " ".join(l["text"] for l in ls)
        out.append({"i": i, "rect": [round(v,1) for v in b["rect"]], "text": text,
                    "fill": [round(v,2) for v in b["fill"]] if b["fill"] else None,
                    "dashed": bool(b["dash"] and b["dash"].strip() not in ("[] 0",))})
    # connectors union-find by touching
    def seg_pts(c): return list(zip(c["pts"][0::2], c["pts"][1::2]))
    def touch(a, b, tol=1.0):
        for p in a["pts"]:
            for q1, q2 in zip(b["pts"][0::2], b["pts"][1::2]):
                # distance point-segment
                v = q2 - q1; L2 = v.x*v.x + v.y*v.y
                t = 0 if L2 == 0 else max(0, min(1, ((p.x-q1.x)*v.x + (p.y-q1.y)*v.y)/L2))
                proj = fitz.Point(q1.x + t*v.x, q1.y + t*v.y)
                if abs(proj.x-p.x) < tol and abs(proj.y-p.y) < tol: return True
        return False
    n = len(conns); par = list(range(n))
    def f(x):
        while par[x] != x: par[x] = par[par[x]]; x = par[x]
        return x
    for i in range(n):
        for j in range(i+1, n):
            if touch(conns[i], conns[j]) or touch(conns[j], conns[i]):
                par[f(i)] = f(j)
    comps = {}
    for i in range(n): comps.setdefault(f(i), []).append(i)
    result = []
    for k, idxs in comps.items():
        touched = set(); dotted = any(conns[i]["dotted"] for i in idxs)
        for i in idxs:
            for p in conns[i]["pts"]:
                for b in out:
                    r = fitz.Rect(b["rect"]); r.x0-=1.5; r.y0-=1.5; r.x1+=1.5; r.y1+=1.5
                    if r.contains(p): touched.add(b["i"])
        result.append({"boxes": sorted(touched), "dotted": dotted})
    return {"page": pno, "H": H, "boxes": out, "components": result}

if __name__ == "__main__":
    res = extract(sys.argv[1], int(sys.argv[2]))
    json.dump(res, open(sys.argv[3], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("boxes", len(res["boxes"]), "components", len(res["components"]))
