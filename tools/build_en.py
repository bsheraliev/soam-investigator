"""Builds the English skeleton of data/taxonomy.json from the QRG text (verbatim EN)."""
import json, re, sys, os, fitz

SP = os.path.dirname(os.path.abspath(__file__))
PDF = r"C:/Users/user/Claude/Projects/soam-investigator/docs/SOAM_QRG_V3.pdf"
doc = fitz.open(PDF)


def clean(t):
    t = t.replace("\u00ad", "").replace("\u2019", "'").replace("\u2018", "'")
    t = t.replace("\u201c", '"').replace("\u201d", '"')
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"\s+([,.;:)])", r"\1", t)
    t = re.sub(r"\(\s+", "(", t)
    return t


def page_lines(pdf_page):
    """text lines of a PDF page (1-based), without running header and page number."""
    txt = doc[pdf_page - 1].get_text("text", sort=True)
    out = []
    for ln in txt.split("\n"):
        s = ln.strip()
        if not s or s.startswith("SOAM Quick Reference Guide") or re.fullmatch(r"\d{1,2}", s):
            continue
        out.append(s)
    return out


def E(id_, en, code=None, **extra):
    d = {"id": id_}
    if code is not None:
        d["code"] = code
    d["en"] = clean(en)
    d["ru"] = ""
    d["tj"] = ""
    d["tj_status"] = "todo"
    d.update(extra)
    return d


def bullets(lines, bullet_re=r"^[•\u2022\uf0b7]\s*|^o\s+"):
    """join wrapped lines into bullet items; sub-bullets 'o' are folded into text with ' / '"""
    items, cur = [], None
    for ln in lines:
        if re.match(r"^[•\u2022\uf0b7�]\s*", ln):
            if cur is not None:
                items.append(cur)
            cur = re.sub(r"^[•\u2022\uf0b7�]\s*", "", ln)
        elif cur is not None:
            cur += " " + ln
        else:
            cur = ln
    if cur is not None:
        items.append(cur)
    return [clean(i) for i in items if clean(i)]


# ---------------------------------------------------------------- severity (printed p.7 = PDF 9)
sev_txt = clean(" ".join(page_lines(9)))
SEV_ORDER = ["A", "B", "C", "E", "D"]
severity = []
for i, code in enumerate(SEV_ORDER):
    nxt = SEV_ORDER[i + 1] if i + 1 < len(SEV_ORDER) else None
    m = re.search(rf"{code}:\s*(.*?)(?=\s{nxt}:\s|\s*It is highly desirable|$)", sev_txt) if nxt else \
        re.search(rf"{code}:\s*(.*?)(?=\s*It is highly desirable|$)", sev_txt)
    txt = m.group(1).strip()
    txt = re.sub(r"\s*;?\s*(and)?\s*$", "", txt)
    if code == "D":
        txt = "Not determined – insufficient information available to determine the risk involved"
    severity.append(E(f"severity.{code}", txt.rstrip(";. "), code=code, qrg_page=7))

# ---------------------------------------------------------------- OSF (printed p.28-41)
OSF_PAGES = {"TR": 32, "WM": 33, "AC": 34, "CO": 35, "OC": 36, "CG": 37, "PP": 38, "MM": 39, "EI": 40, "RM": 41,
             "CM": 42, "EE": 43}
osf = []
for code, pg in OSF_PAGES.items():
    ls = page_lines(pg)
    head = ls[0]
    name = re.sub(r"\s*\(%s\)\s*$" % code, "", head).strip()
    i_issues = next(i for i, l in enumerate(ls) if re.search(r"issues to be considered", l, re.I))
    i_cons = next(i for i, l in enumerate(ls) if re.match(r"Consequences of", l))
    definition = clean(" ".join(ls[1:i_issues]))
    issues = bullets(ls[i_issues + 1:i_cons])
    cons = bullets(ls[i_cons + 1:])
    osf.append({
        "id": f"osf.{code}", "code": code, "en": clean(name), "ru": "", "tj": "", "tj_status": "todo",
        "qrg_page": pg - 2,
        "definition": E(f"osf.{code}.def", definition),
        "issues": [E(f"osf.{code}.issue.{k:02d}", t) for k, t in enumerate(issues, 1)],
        "consequences": [E(f"osf.{code}.cons.{k:02d}", t) for k, t in enumerate(cons, 1)],
    })

# ---------------------------------------------------------------- contextual conditions (printed 23-27)
CC_CATS = [
    ("workplace", "Workplace conditions", 26, None),
    ("climate", "Organisational climate", 27, None),
    ("attitudes", "Attitudes and personality factors", 28, "top"),
    ("limitations", "Human performance limitations", 29, None),
    ("physio", "Physiological and emotional factors", 28, "bottom"),
]


def cc_examples(pdf_page, part):
    pg = doc[pdf_page - 1]
    items = []
    for b in pg.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            t = "".join(s["text"] for s in l["spans"]).strip()
            if not t:
                continue
            x, y = l["bbox"][0], l["bbox"][1]
            if y < 100 or y > 420:
                continue
            if part == "top" and y >= 235:
                continue
            if part == "bottom" and y < 235:
                continue
            if re.fullmatch(r"[A-Z ]{8,}", t):
                continue
            items.append((x, y, t))
    header_ys = [y for x, y, t in items if t == "Factors"]
    items = [(x, y, t) for x, y, t in items if not (
        t in ("Error", "Common", "Non-compliance", "Factors", "Error / Mitigation")
        and any(-1 <= hy - y <= 10 for hy in header_ys))]
    cols ={"error": [], "common": [], "non_compliance": []}
    for x, y, t in items:
        k = "error" if x < 90 else ("common" if x < 160 else "non_compliance")
        cols[k].append((y, t))
    res = {}
    for k, v in cols.items():
        v.sort()
        groups, prev = [], None
        for y, t in v:
            if prev is not None and 6 <= y - prev <= 10.5 and groups:
                groups[-1] += " " + t
            else:
                groups.append(t)
            prev = y
        res[k] = [clean(g) for g in groups]
    return res


cc = []
for cid, name, pg, part in CC_CATS:
    ex = cc_examples(pg, part)
    flat = []
    for kind in ("error", "common", "non_compliance"):
        for k, t in enumerate(ex[kind], 1):
            flat.append(E(f"cc.{cid}.{kind}.{k:02d}", t, kind=kind))
    cc.append({"id": f"cc.{cid}", "code": cid, "en": name, "ru": "", "tj": "", "tj_status": "todo",
               "qrg_page": pg - 2, "examples": flat})

# ---------------------------------------------------------------- barriers (printed 42-44)
BAR = [("awareness", "Awareness"), ("restriction", "Restriction"), ("detection", "Detection"),
       ("control_recovery", "Control & Recovery"), ("protection_containment", "Protection & Containment"),
       ("escape_rescue", "Escape & Rescue")]
btxt = page_lines(45) + page_lines(46)
barriers = []
idx = []
for bid, name in BAR:
    pos = next(i for i, l in enumerate(btxt) if l.rstrip(":").replace("  ", " ") == name or l.startswith(name + ":"))
    idx.append(pos)
for n, (bid, name) in enumerate(BAR):
    seg = btxt[idx[n] + 1: idx[n + 1] if n + 1 < len(BAR) else None]
    if n + 1 == len(BAR):
        cut = next((i for i, l in enumerate(seg) if l.startswith("Protection & Containment and")), len(seg))
        seg = seg[:cut]
    j = next((i for i, l in enumerate(seg) if re.match(r"^e\.?g[.,]?:?", l) or re.search(r"\beg:\s*$", l)), None)
    if j is None:
        j = next(i for i, l in enumerate(seg) if "eg:" in l or l.endswith("eg:"))
    pre = seg[:j + 1]
    defn = clean(" ".join(pre)).rstrip()
    defn = re.sub(r",?\s*eg:?$", "", defn).strip().rstrip(",").replace("pre- conditions", "pre-conditions")
    exs = [re.sub(r"\s*BARRIER TYPES \(cont\.\)$", "", x) for x in bullets(seg[j + 1:])]
    barriers.append({"id": f"barrier.{bid}", "code": bid, "en": name, "ru": "", "tj": "", "tj_status": "todo",
                     "qrg_page": 43 if n < 3 else 44,
                     "definition": E(f"barrier.{bid}.def", defn),
                     "examples": [E(f"barrier.{bid}.ex.{k:02d}", t) for k, t in enumerate(exs, 1)]})

# ---------------------------------------------------------------- check questions / contribution test
def grab(pdf_page, start_re, end_re=None):
    t = clean(" ".join(page_lines(pdf_page)))
    m = re.search(start_re, t)
    s = t[m.end():]
    if end_re:
        e = re.search(end_re, s)
        s = s[:e.start()] if e else s
    return s.strip()


def q_only(text):
    return text[: text.index("?") + 1]


_q1 = grab(23, r"Check Question 1: Human Involvement")
check_q = [
    E("check.1", q_only(_q1), code="1", element="HI", qrg_page=21,
      note=E("check.1.note", _q1[_q1.index("NB:") + 3: _q1.index(" 8 The terms")].strip(), qrg_page=21)),
    E("check.2", q_only(grab(25, r"Check Question 2: Contextual Conditions")), code="2", element="CC", qrg_page=23),
    E("check.3", q_only(grab(31, r"Check Question 3: Organisational & System Factors")), code="3", element="OSF",
      qrg_page=29),
    E("check.4", q_only(grab(44, r"Check Question 4: Barriers")), code="4", element="BAR", qrg_page=42),
]
contribution_test = E("test.contribution", q_only(grab(22, r"Contribution Test:")), code="contribution", qrg_page=20)

# ---------------------------------------------------------------- safety actions / SMARTER / QA
sa_text = page_lines(53) + page_lines(54)
i0 = next(i for i, l in enumerate(sa_text) if l.startswith("Safety Actions should"))
i1 = next(i for i, l in enumerate(sa_text) if l.startswith("SMARTER"))
checklist = bullets(sa_text[i0 + 1:i1])
SMARTER = [("S", "Specific"), ("M", "Measurable"), ("A", "Accountable"), ("R1", "Reasonable"), ("T", "Timely"),
           ("E", "Effective"), ("R2", "Reviewed")]
qa_lines = page_lines(55)
qi = next(i for i, l in enumerate(qa_lines) if "checklist to ensure" in l or "following steps" in l)
qa_items, cur = [], None
for l in qa_lines[qi + 1:]:
    if re.match(r"^[q\uf071�]\s", l) or l.startswith("q "):
        if cur:
            qa_items.append(cur)
        cur = l[2:]
    elif cur is not None:
        cur += " " + l
if cur:
    qa_items.append(cur)

# rule: each Absent/Failed barrier and each OSF must be addressed (QRG p.50)
coverage_rule = E("sa.rule.coverage",
                  "Each Absent or Failed Barrier and each Organisational or System Factor must be addressed by at "
                  "least one safety action, unless already adequately covered by a separate safety action.",
                  qrg_page=50)

safety_actions = {
    "coverage_rule": coverage_rule,
    "checklist": [E(f"sa.check.{k:02d}", t, qrg_page=51) for k, t in enumerate(checklist, 1)],
    "smarter": [E(f"smarter.{c}", n, code=c, qrg_page=52) for c, n in SMARTER],
}
qa = [E(f"qa.{k:02d}", t, qrg_page=53) for k, t in enumerate(qa_items, 1)]

out = {
    "severity": severity, "contribution_test": contribution_test, "check_questions": check_q,
    "contextual_conditions": cc, "osf": osf, "barriers": barriers, "safety_actions": safety_actions,
    "qa_checklist": qa,
}
json.dump(out, open(os.path.join(SP, "tax_en_auto.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("severity", len(severity), "osf", len(osf), "cc", [len(c["examples"]) for c in cc],
      "barriers", [len(b["examples"]) for b in barriers], "checklist", len(checklist), "qa", len(qa))
