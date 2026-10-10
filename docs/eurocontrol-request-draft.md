# Черновик письма в EUROCONTROL — запрос разрешения на использование SOAM QRG

Статус: **черновик в1 (2026-10-10), не отправлять без решения владельца.**
Зачем: QRG © EUROCONTROL разрешён для некоммерческого использования без изменения текста. Перед первым коммерческим предложением (предприятия, АГА других государств) нужно письменное разрешение на использование таксономии и формулировок SOAM в продукте.

Перед отправкой владелец заполняет: `[ORGANISATION]`, `[NAME, POSITION]`, `[CONTACT]`, и решает, оставлять ли абзац о коммерческом использовании (вариант A — только некоммерческое для АГА РТ; вариант B — коммерческий выход).

Куда: контакт по публикациям / безопасности EUROCONTROL — `TODO: сверить актуальный адрес` (на обложке QRG указаны контакты; альтернатива — форма обратной связи на eurocontrol.int).

---

**Subject:** Request for permission to use the SOAM Quick Reference Guide (V3, 2023) in a software tool

Dear Sir or Madam,

I am writing on behalf of [ORGANISATION] ([Civil Aviation Agency under the Government of the Republic of Tajikistan / company name]) to request permission to use material from the *Systemic Occurrence Analysis Methodology (SOAM) Quick Reference Guide, Version 3.0, April 2023* in a software tool for safety occurrence investigation.

**What the tool is.** "SOAM Investigator" is an offline-capable web application that guides an investigator through the SOAM process step by step: occurrence registration and severity, data collection using the SHEL/O model, timeline, the contribution test and the four check questions, classification into Human Involvement, Contextual Conditions, Organisational and System Factors and Barriers, the SOAM Chart, safety actions, the quality-assurance checklist and the final report. The tool enforces the methodology's requirements (for example, that every absent or failed barrier and every organisational factor is addressed by at least one safety action, and that a report is produced only after the QA checklist is completed). All investigation data is stored locally on the user's device.

**What we use from the QRG.** The tool reproduces, verbatim and without modification, the SOAM taxonomy and guidance text from the QRG: the five categories of Contextual Conditions with examples, the twelve Organisational and System Factor codes with their definitions, issues and consequences, the six barrier types, the contribution test and check questions, the safety-action checklist and SMARTER criteria, the QA checklist and the SOAM Element Review Chart. Each item is accompanied by translations into Russian and Tajik prepared by us. The source is cited on every screen where the material appears and on a dedicated "About the methodology" page, and the three worked examples (BAC 1-11 1990, Bangkok 1999, Hamilton 2015) are used as demonstration cases. The QRG itself is not redistributed with the tool.

**Intended use.** At present the tool is used non-commercially by the [investigation department of ORGANISATION] for internal investigations and training.

[Вариант B — оставить только при решении о коммерческом выходе:]
We would also like to offer the tool to other aviation organisations (air navigation service providers, airports, operators and civil aviation authorities), including on a paid basis. We therefore kindly ask whether EUROCONTROL would grant permission for such use of the SOAM material, and under which conditions (attribution, licence fee, restrictions on modification, review of translations, or any other terms you consider appropriate).

We confirm that:
- the English text of the QRG is reproduced without alteration;
- EUROCONTROL is credited as the source and copyright holder on every page where the material appears;
- translations are clearly marked as ours and will be corrected on request;
- the tool does not claim to be endorsed by EUROCONTROL unless such endorsement is given.

We would be grateful for your guidance on the appropriate terms and are ready to provide a demonstration of the tool or any further information.

Yours faithfully,

[NAME, POSITION]
[ORGANISATION]
[CONTACT: e-mail, phone]

---

## Открытые вопросы перед отправкой
- Заказчик и формат (вариант A или B) — решение владельца; от этого зависит текст.
- Актуальный адрес EUROCONTROL для запросов о публикациях — `TODO: сверить`.
- Приложить ли ссылку на публичный репозиторий (bsheraliev/soam-investigator) — он открыт, но лицензии в нём нет (см. `docs/backlog.md`, «Коммерциализация»).
