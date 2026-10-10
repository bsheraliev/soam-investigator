"""Строит data/cases/*.json из снятых с PDF схем (chartNN.json): узлы → факты+классификации, линии → связи."""
import json, os, re, sys

SP = os.path.dirname(os.path.abspath(__file__))
OUT = r"C:/Users/user/Claude/Projects/soam-investigator/data/cases"
OSF_CODES = {"TR", "WM", "AC", "CO", "OC", "CG", "PP", "MM", "EI", "RM", "CM", "EE"}
LEVELS = ["other", "OSF", "CC", "HI", "BAR", "outcome"]
HEADERS = {"OTHER SYSTEM FACTORS": "other", "ORGANISATIONAL FACTORS": "OSF", "CONTEXTUAL CONDITIONS": "CC",
           "HUMAN INVOLVEMENT": "HI", "ABSENT OR FAILED BARRIERS": "BAR"}

CASES = [
    {"file": "bac111-1990", "page": 49, "qrg_page": 47, "id": "case-bac111-1990",
     "title": {"en": "BAC 1-11 Explosive Decompression, June 1990", "ru": "BAC 1-11 — взрывная разгерметизация, июнь 1990"},
     "date": "1990-06", "place": "United Kingdom", "type": "accident", "outcome_label": "ACCIDENT"},
    {"file": "bangkok-1999", "page": 50, "qrg_page": 48, "id": "case-bangkok-1999",
     "title": {"en": "Boeing 747-438 Runway Excursion, Bangkok, Thailand, September 1999",
               "ru": "Boeing 747-438 — выкатывание за пределы ВПП, Бангкок, Таиланд, сентябрь 1999"},
     "date": "1999-09", "place": "Bangkok, Thailand", "type": "accident", "outcome_label": "ACCIDENT"},
    {"file": "hamilton-2015", "page": 51, "qrg_page": 49, "id": "case-hamilton-2015",
     "title": {"en": "Loss of Separation at Hamilton, NZ, December 2015",
               "ru": "Нарушение интервалов эшелонирования, Гамильтон, Новая Зеландия, декабрь 2015"},
     "date": "2015-12", "place": "Hamilton, New Zealand", "type": "incident", "outcome_label": "INCIDENT"},
]


def clean(t):
    t = t.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    t = t.replace("\ufffd", "").replace("\uf0b7", "").replace("\u2022", "")
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"\s+([,.;:)])", r"\1", t)
    # остатки двойной отрисовки текста в PDF: «was was», «for for»
    return re.sub(r"\b(\w+) \1\b", r"\1", t)


def parse_codes(text):
    m = re.match(r"^((?:[A-Z]{2}\s*/\s*)*[A-Z]{2})\b\s*(?:\([^)]*\))?\s*", text)
    if not m:
        return [], text
    codes = [c.strip() for c in m.group(1).split("/")]
    if not all(c in OSF_CODES for c in codes):
        return [], text
    return codes, text[m.end():].strip()


def build(case):
    ch = json.load(open(os.path.join(SP, f"chart{case['page']}.json"), encoding="utf-8"))
    boxes = {b["i"]: b for b in ch["boxes"]}
    headers, nodes, outcome = {}, {}, None
    for b in ch["boxes"]:
        f = b["fill"] or []
        txt = clean(b["text"])
        if f == [1.0, 1.0, 0.4] and txt in HEADERS:
            headers[HEADERS[txt]] = b["rect"]
        elif f == [1.0, 0.8, 0.4]:
            outcome = b
    if outcome is None:
        raise SystemExit("нет блока исхода на стр. %s" % case["page"])
    headers["outcome"] = outcome["rect"]
    for b in ch["boxes"]:
        f = b["fill"] or []
        if b["i"] == outcome["i"] or f in ([1.0, 1.0, 0.4], [0.0, 0.25, 0.5], [0.65, 0.0, 0.13]):
            continue
        yc = (b["rect"][1] + b["rect"][3]) / 2
        lvl = next((k for k, r in headers.items() if r[1] - 4 <= yc <= r[3] + 4), None)
        if lvl is None:
            print("  ! узел без колонки:", b["i"], b["text"][:60]); continue
        nodes[b["i"]] = {"level": lvl, "x": b["rect"][0], "text": clean(b["text"]), "dashed": b["dashed"]}
    # порядок внутри колонки — сверху вниз (по x на повёрнутой странице)
    ordered = sorted(nodes.items(), key=lambda kv: (LEVELS.index(kv[1]["level"]), kv[1]["x"]))
    occ_id = case["id"]
    facts, classes, id_of = [], [], {}
    counters = {}
    for i, n in ordered:
        lvl = n["level"]
        counters[lvl] = counters.get(lvl, 0) + 1
        k = counters[lvl]
        text = n["text"]
        codes = []
        if lvl in ("OSF", "other"):
            codes, text = parse_codes(text)
            if not codes:
                print("  ! OSF без кода:", text[:60])
        fid = f"{occ_id}:f-{lvl.lower()}-{k:02d}"
        cid = f"{occ_id}:c-{lvl.lower()}-{k:02d}"
        id_of[i] = cid
        facts.append({"id": fid, "occurrenceId": occ_id, "text": text, "shelo": None,
                      "source": f"SOAM QRG V3, p.{case['qrg_page']}", "attachments": [], "contributes": True})
        c = {"id": cid, "factId": fid, "occurrenceId": occ_id, "element": "OSF" if lvl == "other" else lvl,
             "order": k, "confirmed": True}  # классификация выполнена авторами QRG
        if lvl in ("OSF", "other"):
            c["osfCodes"] = codes
            c["otherSystem"] = (lvl == "other") or n["dashed"] or codes == ["EE"]
        if lvl == "BAR":
            c["barrierState"] = None  # QRG-схема не различает absent/failed — TODO: сверить с первоисточником
            c["otherSystem"] = n["dashed"]
        classes.append(c)
    links, seen = [], set()
    for comp in ch["components"]:
        members = [i for i in comp["boxes"] if i in nodes or i == outcome["i"]]
        by_level = {}
        for i in members:
            lvl = "outcome" if i == outcome["i"] else nodes[i]["level"]
            by_level.setdefault(lvl, []).append(i)
        present = [l for l in LEVELS if l in by_level]
        for a, b in zip(present, present[1:]):
            for i in by_level[a]:
                for j in by_level[b]:
                    src = id_of[i]
                    dst = occ_id if j == outcome["i"] else id_of[j]
                    if (src, dst) in seen:
                        continue
                    seen.add((src, dst))
                    links.append({"id": f"{occ_id}:l-{len(links) + 1:03d}", "occurrenceId": occ_id,
                                  "fromId": src, "toId": dst, "style": "dotted" if comp["dotted"] else "solid"})
    outcome_items = [clean(x) for x in re.split(r"[•\ufffd\uf0b7]", outcome["text"]) if clean(x)]
    bundle = {
        "schema": 1,
        "source": {"title": "EUROCONTROL SOAM Quick Reference Guide V3 (April 2023)", "qrg_page": case["qrg_page"],
                   "note": "Test case reproduced from the published SOAM chart; text verbatim (EN). "
                           "Place/date beyond the chart title: TODO: сверить с первоисточником."},
        "occurrence": {
            "id": occ_id, "title": case["title"], "date": case["date"], "place": case["place"],
            "type": case["type"], "severity": None, "investigate": True, "status": "analysis",
            "outcome": outcome_items, "isTestCase": True,
        },
        "facts": facts, "events": [], "classifications": classes, "links": links, "actions": [], "qa": None,
    }
    os.makedirs(OUT, exist_ok=True)
    json.dump(bundle, open(os.path.join(OUT, case["file"] + ".json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    lv = {l: sum(1 for c in classes if (c["element"] == l) or (l == "other" and c.get("otherSystem") and c["element"] == "OSF")) for l in LEVELS[:-1]}
    print(case["file"], "facts", len(facts), "links", len(links), lv)
    return {"file": case["file"] + ".json", "id": occ_id, "title": case["title"], "qrg_page": case["qrg_page"],
            "type": case["type"], "facts": len(facts), "links": len(links)}


idx = [build(c) for c in CASES]
json.dump({"cases": idx}, open(os.path.join(OUT, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
