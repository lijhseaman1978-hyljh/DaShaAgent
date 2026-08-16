---
name: maritime-inquiry
description: Answer maritime/nautical questions about ship operations, procedures, compliance, certificates, and regulations by searching the user's own knowledge bases FIRST. Covers priority ordering of sources, password-protected PDF handling, and ship-specific document research workflow.
category: research
---

# Maritime Inquiry — Ship-Specific Knowledge Retrieval

## Trigger Conditions

Use this skill when the user asks about:
- Ship operations, procedures, or equipment (e.g. SSAS testing, BWMS operation, cargo handling)
- Compliance requirements (e.g. ISM, ISPS, MLC, MARPOL)
- Certificate validity, testing cycles, inspection intervals
- Company-specific SMS/SSP/SOP procedures
- Any question where the answer could be in the user's own ship documents
- **SIRE 2.0 inspection observations** — filling Comment sections (Immediate Cause, Root Cause, Corrective Action, Preventative Action) for deficiency reports
- **SIRE rectification reports** — generating .docx reports to respond to OCIMF SIRE inspection findings

## CRITICAL RULE: Priority Order of Sources

When answering ship-specific questions, search sources in THIS ORDER:

1. **User's own management documents FIRST** — SSP, SMS (BUILT FOUND SMS), SOPEP, BWMP, MSMP, SEEMP (path: `~/.dasha/knowledge/MANUAL/` or `~/.dasha/knowledge/BUILT_FOUND_SMS/`)
2. **Ship certificates and audit reports** — NO.A knowledge base (`~/.dasha/knowledge/NO.A/`)
3. **Industry guides and reference materials** — ISGOTT, SOLAS, VIQ, VPQ from 船长CODE资料 (`~/.dasha/knowledge/船长CODE资料/`)
4. **General maritime knowledge** — 船舶知识库 (`~/.dasha/knowledge/船舶知识库/`)
5. **Industry standards / general practice** — only as supplement AFTER exhausting above

**Never give an answer based on industry standards alone when the user's own SSP/SMS documents may specify a different requirement.** The SSP always overrides general practice.

## Workflow

### Step 1: Identify which documents are relevant
- Equipment/procedure questions → MANUAL folder (SEEMP, BWMP, MSMP, SOPEP, ERS, SSP)
- Compliance/ISM questions → BUILT FOUND SMS (SQM-01~04, SQP-01~23, SQI-600 series)
- Certificate/audit questions → NO.A (A.1~A.10 categories)
- Safety/operational questions → 船长CODE资料 (SOLAS, ISGOTT, VIQ, Chemical SIR)

### Step 2: Search the relevant knowledge base
```python
search_files(pattern='SSAS', target='content', path='~/.dasha/knowledge/MANUAL/')
```

### Step 3: For password-protected PDFs
The user may provide a password. Use pymupdf:
```python
import fitz
doc = fitz.open(path)
doc.authenticate('password')
text = ''
for page in doc:
    text += page.get_text()
```
Save extracted text as `.txt` alongside the PDF for future searchability.

### Step 4: Cross-reference
If the user's SSP/SMS specifies something different from industry standards, **cite the SSP/SMS as the authoritative source** and note the difference.

## Known Knowledge Bases

| Path | Content | Format |
|------|---------|--------|
| `~/.dasha/knowledge/MANUAL/` | EXAMPLE_VESSEL ship manuals: SEEMP, BWMP, MLC, MSMP, SSP, SOPEP, ERS | 88 files, ~4MB extracted text |
| `~/.dasha/knowledge/BUILT_FOUND_SMS/` | BUILT FOUND SMS Ver1.0: SMM-A~15, SQP-01~23, SQI-600 series | 2.9MB txt + 17MB PDF |
| `~/.dasha/knowledge/NO.A/` | 84 ship certificates with categories A.1~A.10 | 578KB extracted text |
| `~/.dasha/knowledge/船长CODE资料/` | SOLAS, ISGOTT, VIQ, VPQ, Chemical SIR, training PPTs | 765MB, 77 files |
| `~/.dasha/knowledge/船舶知识库/` | General maritime knowledge: 670 files | 121MB |
| `~/.dasha/knowledge/HVPQ/` | HVPQ6 report for EXAMPLE_VESSEL (EN+CN) | 4 files |
| `~/.dasha/knowledge/微信文章/` | Saved WeChat maritime articles | Text files |
| `~/.dasha/knowledge/SIRE 2.0/` | SIRE 2.0 Question Library | Parsed Excel |

## Pitfalls

- **Don't assume industry standard is correct.** The SSP may have stricter requirements (e.g. SSAS testing: SSP says monthly, not quarterly).
## Pitfalls

- **Don't assume industry standard is correct.** The SSP may have stricter requirements (e.g. SSAS testing: SSP says monthly, not quarterly).
- **Password-protected PDFs** must be decrypted before text extraction; the plain text won't work with `doc.get_text()` before `authenticate()`.
- **Some PDFs are scanned images** — pymupdf returns 0 chars. Use OCR (Tesseract) for those, following `~/.dasha/memory/offline-office/15-ocr.md`.
- **Old .xls files** can't be read by openpyxl; use xlrd if needed.
- **Session search is broken** — save all critical findings to memory.
- **Must search ALL knowledge bases** when a question is broad, not just one folder.
- **SIRE deficiency root cause: document EXISTS vs DOCUMENT AVAILABLE.** When a SIRE inspector cites "no inventory/register/record," first verify the document exists but is misplaced (common with CSM-03 cyber asset register) before assuming it doesn't exist. The deficiency may be about accessibility, not creation. Ask the captain: "Is it on board but filed somewhere else?"
- **SIRE rectification report: always cross-reference SMS procedure.** When writing Corrective/Preventative Actions for SIRE deficiencies, always cite specific SMS document numbers (e.g. SQI-613 Section 3.2, CSM-01 to CSM-06, SQI-109A, SQI-110A). The inspector expects the response to show the SMS gap, not generic advice.
- **SMS record form check before creating new forms.** When user asks for a record/template (toolbox talk, drill record, etc.), always search the SMS first: grep "toolbox" or "toolbox.*record" in BUILT_FOUND_SMS_FULL.txt, check R-S-XXXX series (R-S-001 to R-S-007), check CSM-XXXX series, check SQP-XX/SQM-XX sections. The SMS only mentions "toolbox meeting" twice (SQI-124 LOTO, SQM-07 Tanker Operation) — no dedicated Toolbox Talk Record form exists. Similarly, monthly safety meeting minutes exist (SQP-06) but no R-S form number is assigned. If no SMS form exists, create a standalone template and note "No SMS record form available — standalone template generated."

## Reference Files

- **[sts-compatibility-assessment.md](references/sts-compatibility-assessment.md)** — STS compatibility assessment methodology.
- **[sire-observation-filling.md](references/sire-observation-filling.md)** — SIRE 2.0 Observation report Comment section filling guide.
- **[hvpq-photo-checklist.md](references/hvpq-photo-checklist.md)** — HVPQ Photo Upload 5-step verification checklist (Code 11.1.19 compliance).
- **[q88-extraction-tips.md](references/q88-extraction-tips.md)** — Q88 document extraction: Unicode NBSP filename handling, table iteration, field mapping for STS assessment.
- **[sire-observation-rectification.md](references/sire-observation-rectification.md)** — ⭐ SIRE 2.0 observation analysis and rectification report generation: filling Immediate Cause / Root Cause / Corrective Action / Preventative Action for each deficiency, with SMS cross-references, code-specific templates, and SIRE rejection patterns.
- **[sire-observation-filling.md](references/sire-observation-filling.md)** — Step-by-step guide to writing Comment sections for SIRE 2.0 deficiency reports: Immediate Cause / Root Cause / Corrective Action / Preventative Action formula, common codes table, SMS cross-references, and pitfalls.

## SSAS Testing — Quick Reference (Learned from EXAMPLE_VESSEL SSP)

- Frequency: **Monthly** (每月一次) — SSP Section 7.1.2
- Responsible: Radio Officer (or 2nd Officer if no RO)
- Record: "船上保安设备的保养和测试记录" (shipboard security equipment test and maintenance record)
- SSAS model: FELCOM 15
- Activation points: Bridge (驾驶台) + Master's Office (船长办公室)
- Activation: press button 30s → report sent repeatedly
- Test mode: must be in SSAS Manager Mode to test without sending real alert
- False alarm: immediately notify CSO
