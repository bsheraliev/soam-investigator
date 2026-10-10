import json, os, sys
SP = os.path.dirname(os.path.abspath(__file__))
src = json.load(open(os.path.join(SP, "tr_in.json"), encoding="utf-8"))
ru = {}
for i in range(1, 5):
    part = json.load(open(os.path.join(SP, f"tr_out_{i}.json"), encoding="utf-8"))
    ru.update(part)
missing = [k for k in src if k not in ru or not str(ru[k]).strip()]
extra = [k for k in ru if k not in src]
untranslated = [k for k in src if k in ru and ru[k].strip() == src[k].strip() and len(src[k]) > 3 and any(c.isalpha() for c in src[k]) and not src[k].isupper()]
print("src", len(src), "ru", len(ru), "missing", missing, "extra", extra)
print("untranslated-looking", untranslated)
tax = json.load(open(os.path.join(SP, "tax_en.json"), encoding="utf-8"))
def walk(o):
    if isinstance(o, dict):
        if "id" in o and "en" in o and o["id"] in ru:
            o["ru"] = ru[o["id"]].strip()
        for v in o.values(): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk(tax)
out = {
 "meta": {
  "source": "EUROCONTROL. Systemic Occurrence Analysis Methodology (SOAM) Quick Reference Guide, Version 3.0, April 2023. © EUROCONTROL 2023.",
  "source_note": "English text ('en') is reproduced verbatim from the QRG for non-commercial use. 'qrg_page' is the printed page number.",
  "version": "0.1.0",
  "languages": ["ru", "tj", "en"],
  "ru_status": "machine-translated, needs review",
  "tj_status": "todo"
 }
}
order = ["soam_elements", "severity", "shelo", "contribution_test", "check_questions", "contextual_conditions",
         "osf", "barriers", "barrier_states", "safety_actions", "qa_checklist"]
for k in order: out[k] = tax[k]
dst = r"C:/Users/user/Claude/Projects/soam-investigator/data/taxonomy.json"
os.makedirs(os.path.dirname(dst), exist_ok=True)
json.dump(out, open(dst, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("written", dst, os.path.getsize(dst))
