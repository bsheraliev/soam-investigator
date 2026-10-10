import json, os
SP = os.path.dirname(os.path.abspath(__file__))
d = json.load(open(os.path.join(SP, "tax_en_auto.json"), encoding="utf-8"))

def E(id_, en, code=None, **kw):
    e = {"id": id_}
    if code is not None: e["code"] = code
    e.update({"en": en, "ru": "", "tj": "", "tj_status": "todo"}); e.update(kw); return e

def grp(eid, n, title, items, page):
    return {**E(f"{eid}.g{n:02d}", title), "qrg_page": page,
            "items": [E(f"{eid}.g{n:02d}.i{k:02d}", t) for k, t in enumerate(items, 1)]}

S = {**E("shelo.S", "Software", code="S", qrg_page=12),
     "description": E("shelo.S.def", "Documentation, including SOPs, checklists, manuals, charts, NOTAMs, etc."),
     "interface": E("shelo.S.if", "Person-system interface (Software)"),
     "groups": [
        grp("shelo.S", 1, "What were the characteristics of the procedures (eg., SOPs, NOTAMS, Emergency Procedures) used by people involved in the occurrence, for example:",
            ["Availability", "Suitability", "Supervisory requirements of work instructions / SOPs",
             "Quality / readability / clarity of documentation", "Use / usability"], 13),
        grp("shelo.S", 2, "What other documents or processes were relevant to people involved in the occurrence (eg., diagrams, maps, charts, checklists, rules, regulations)?", [], 13)]}
H = {**E("shelo.H", "Hardware", code="H", qrg_page=12),
     "description": E("shelo.H.def", "ATM equipment, displays, menus, controls, switches, workspace layout etc."),
     "interface": E("shelo.H.if", "Human-machine interface (Hardware)"),
     "groups": [
        grp("shelo.H", 1, "What were the characteristics of the equipment provided to people in the workplace, for example:",
            ["Serviceability", "Functionality", "Usability", "Familiarity", "Availability",
             "Design, eg., display quality: colours, illumination, clarity and complexity of data, signal strength, mode identification, potential for confusion, etc.",
             "Reliability, eg., of transmission / alerting systems",
             "Interaction with equipment and its effect on workload and skill maintenance, eg., navigational aids, flight information display, communications equipment etc."], 13)]}
Ev = {**E("shelo.E", "Environment", code="E", qrg_page=12),
      "description": E("shelo.E.def", "Workplace conditions, noise, lighting, temperature, or other factors that affect workers."),
      "interface": E("shelo.E.if", "Person-environment interface"),
      "groups": [
        grp("shelo.E", 1, "Which features of the work environment may have impacted on the performance of people involved in the occurrence? For example:",
            ["Temperature / humidity", "Quality of illumination", "Spaciousness",
             "Workspace design / layout / usability", "Noise or distraction from equipment / other people",
             "Task design and workload"], 14)]}
L = {**E("shelo.L", "Liveware", code="L", qrg_page=12),
     "description": E("shelo.L.def", "The human elements (people)."),
     "interface": E("shelo.L.if", "Person-person interface"),
     "groups": [
        grp("shelo.L", 1, "Physical factors", ["Physical characteristics (eg., height, weight, age)", "Sensory limitations (eg., vision, hearing)"], 15),
        grp("shelo.L", 2, "Physiological factors", ["Fatigue (eg., acute, chronic, task induced)", "Lifestyle factors, health, nutrition, stressful events"], 15),
        grp("shelo.L", 3, "Psychological factors", ["Information processing (eg., perception, memory, situational awareness, decision making)",
             "Focus of attention (eg., distraction, monotony, task fixation, boredom, inattention)",
             "Recent experience (eg., at this location, in this position, on this task / with similar traffic loads, etc.)",
             "Motivation / attitude / psychological wellbeing, etc."], 15),
        grp("shelo.L", 4, "Psychosocial factors", ["Lifestyle issues (eg., change in personal or family circumstances, financial pressures, domestic stress)"], 15),
        grp("shelo.L", 5, "Person-person interface: Oral communications", ["Phraseology", "Misinterpretation", "Language / dialect", "Read-back / hear-back", "Message content / clarity / rate of speech"], 15),
        grp("shelo.L", 6, "Person-person interface: Team interactions", ["Supervision", "Relationships", "Morale, team composition (eg., in/experience)"], 15),
        grp("shelo.L", 7, "Person-person interface: Management", ["Relations with staff", "Resource allocation", "Organisational change processes", "Career path or progression", "Industrial conflicts / labour relations"], 15)]}
O = {**E("shelo.O", "Organisation", code="O", qrg_page=12),
     "description": E("shelo.O.def", "Organisational decisions / actions that impact on the conditions under which people perform their work."),
     "interface": None,
     "groups": [
        grp("shelo.O", 1, "Training", ["Design", "Delivery mode", "Standardisation", "Effectiveness"], 14),
        grp("shelo.O", 2, "Workforce Management", ["Staff selection", "Staffing levels", "Work rosters", "Tasking and workload", "Fatigue Management"], 14),
        grp("shelo.O", 3, "Risk Management", ["Hazard identification", "Risk assessments", "Control measures", "Effectiveness"], 14),
        grp("shelo.O", 4, "Accountability", ["Management commitment to safety", "Responsibility for safety"], 14),
        grp("shelo.O", 5, "Communication", ["Information dissemination", "Standardised processes", "Feedback systems"], 14),
        grp("shelo.O", 6, "Organisational Culture and Safety Culture", ["Status of the SMS (Safety Management System)", "Reporting processes",
             "Organisational response to hazard reports / safety occurrence reports etc.", "Change management", "Safety climate", "Just Culture issues"], 14)]}
d["shelo"] = [S, H, Ev, L, O]

# SOAM elements (for UI labels)
def el(code, en, page): return E(f"element.{code}", en, code=code, qrg_page=page)
d["soam_elements"] = [el("HI", "Human Involvement", 21), el("CC", "Contextual Conditions", 23),
                      el("OSF", "Organisational & System Factors", 28), el("BAR", "Absent or Failed Barriers", 42)]
d["barrier_states"] = [E("barrier_state.absent", "Absent: not in place, but might have prevented the occurrence if it had been", code="absent", qrg_page=42),
                       E("barrier_state.failed", "Failed: in place but did not work as intended to prevent the occurrence or reduce its consequences", code="failed", qrg_page=42),
                       E("barrier_state.worked", "Worked: successful or partially successful barrier, human or technological", code="worked", qrg_page=42)]

# strings to translate
strings = {}
def walk(o):
    if isinstance(o, dict):
        if "id" in o and "en" in o and o.get("en"):
            strings[o["id"]] = o["en"]
        for v in o.values(): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk(d)
json.dump(d, open(os.path.join(SP, "tax_en.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(strings, open(os.path.join(SP, "tr_in.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("strings", len(strings), "words", sum(len(v.split()) for v in strings.values()))
