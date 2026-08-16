# SIRE 2.0 Observation Rectification Report Generation

## When to Use

When the user has a SIRE 2.0 inspection observation report (.docx or table) and needs to fill in the Comment section for each deficiency with:
- Immediate Cause
- Root Cause
- Corrective Action
- Preventative Action

## Workflow

### Step 1: Extract the Document Content

Read the .docx observation report using python-docx. Extract:
- Deficiency number and Code (e.g., "Deficiency 01 — Code 11.1.19")
- Observation Text (the "Description" field)
- Any existing content in Comment/Rectification Photo fields

```python
from docx import Document
doc = Document(path)
for table in doc.tables:
    for row in table.rows:
        cells = [cell.text.strip() for cell in row.cells]
```

### Step 2: Cross-reference with Knowledge Bases

For EACH deficiency code, search relevant sources:

| Code | Primary Reference | Secondary |
|------|------------------|-----------|
| 11.1.x (Media/Photo) | VIQ Q1.14, HVPQ requirements | OCIMF HVPQ photo guidelines |
| 7.5.x (Cyber Security) | SMS SQI-613 (Cyber security management), CSM-01~06 | ISM Code Annex para 4.1 |
| 3.2.x (Competence/Training) | SMS SQI-109A/B (Mooring/Anchoring Audit), VIQ | OCIMF TMSA 3rd Ed |
| 2.8.x (HVPQ/Data Accuracy) | VIQ Q1.14, Chemical SIR Q14 | OCIMF HVPQ Software Guide |
| 8.x (Cargo/Operations) | ISGOTT, SMS SQI-200 series | OCIMF SIRE Q&A |
| 4.x (Pollution Prevention) | SMS SOPEP, MARPOL Annexes | ICS Oil Pollution Prevention |
| 5.x (Deck/Maintenance) | SMS SQI-400 series, Class records | ICS General Cargo Guidance |
| 6.x (Engine/Machinery) | SMS SQI-500 series, PMS records | ICS Engine Guidance |

### Step 3: Analyze Each Deficiency

For each deficiency, fill the 4 categories using this structure:

#### Immediate Cause (直接原因)
- What DIRECTLY caused the observation? (1-2 sentences, specific to this vessel/situation)
- Reference the exact evidence from the inspection report
- Example: "The officer uploading HVPQ photos selected a photo from the port side instead of the starboard side."

#### Root Cause (根本原因)
- WHY did the immediate cause happen? (3-5 bullet points)
- Must trace back to: procedure, training, supervision, documentation, culture
- Reference specific SMS section numbers when available
- Example: "No pre-upload verification checklist exists for HVPQ photo submissions."

#### Corrective Action (纠正措施)
- WHAT HAS ALREADY BEEN DONE to fix this specific deficiency
- Must be concrete, verifiable actions
- Use numbered list, past tense
- Example: "Immediately uploaded the correct starboard-side photograph to HVPQ."

#### Preventative Action (预防措施)
- WHAT WILL BE DONE to prevent recurrence
- Must include: system/process change, training, monitoring, KPI
- Use numbered list, future tense
- Should address root cause at the SYSTEM level, not just the individual level
- Example: "Implement a pre-upload photo verification checklist..."

### Step 4: Generate the Word Document

Use python-docx to create the rectification report with proper formatting.

## Key Principles

1. **SMS-first approach**: Always reference the company's actual SMS procedures (SQM-01~08, SQI-xxx) when citing root causes
2. **Be specific**: Generic "training" answers are rejected by inspectors. Specificity matters.
3. **Root cause must go deep**: Don't stop at "officer forgot" — ask WHY the system allowed forgetting
4. **Preventative actions must be systemic**: Not just "train the crew" but "update the procedure/add checklist/make it a KPI"
5. **Cross-reference all codes**: A Code 7.5.1 observation likely also touches Code 4.1.x (ISM implementation)
6. **Reference the SMS documents**: SQI-613 (Cyber), SQI-109A (Mooring Audit), SQI-110A (Anchoring Audit), SQI-612 (Equipment File)

## Common SIRE Codes & Expected Content

### Code 7.5.x — Cyber Security
- SMS Reference: SQI-613 (Instructions For Cyber Security Management)
- Forms: CSM-01 (Equipment Assessment), CSM-02 (IP Registration), CSM-03 (Network Assets), CSM-04 (Monthly Checklist)
- Common deficiencies: No IT/OT asset register, no risk assessment, no incident response procedure
- Root cause angle: SMS procedure exists but not implemented, or procedure exists but crew unaware
- Preventative: Include in quarterly audit, add to changeover checklist, KPI tracking

### Code 11.1.19 — Media/Photo
- SMS Reference: HVPQ update procedure
- Common: Wrong photo, outdated photo, missing photo
- Root cause: No dual-verification process (ship uploads → superintendent approves)
- Preventative: Checklist, shore approval step, annual review

### Code 3.2.7 — Competence/Training/Experience
- SMS Reference: SQI-109A (Mooring Audit Procedure), SQI-110A (Anchoring Audit)
- Common: Assessor qualifications not documented, training records incomplete
- Root cause: Template missing qualification fields, no pre-audit checklist item
- Preventative: Revise template, fleet circular, mandatory self-check

### Code 2.8.1 — HVPQ Accuracy
- SMS Reference: SMS general provisions + class survey procedures
- Common: Outdated fields, incorrect dates, wrong particulars
- Root cause: No survey-to-HVPQ update pipeline, no quarterly review
- Preventative: Checklist linked to survey completion, quarterly self-review, pre-inspection check

## Pitfalls

- **Don't write generic answers**: "Crew training needed" is always rejected. Be specific about WHAT training, BY WHOM, WHEN, and HOW it's VERIFIED.
- **Don't blame individuals**: Root causes should point to SYSTEM failures (missing checklist, unclear procedure, inadequate supervision), not "officer negligence."
- **Don't skip SMS references**: The inspector checks against the company SMS. If the SMS says something, your answer must align with it.
- **Don't assume one fix solves everything**: At minimum, each deficiency needs 3-4 preventative actions covering procedure, training, monitoring, and verification.
- **HVPQ photo requirements**: Each photo in HVPQ has an annotation note specifying EXACTLY what must be visible. The officer uploading must cross-check against this note.
- **Cyber security is ISM**: Cyber risks are managed under ISM Code — they're not just IT issues, they're safety management issues. Reference SQI-613, not generic IT policies.
