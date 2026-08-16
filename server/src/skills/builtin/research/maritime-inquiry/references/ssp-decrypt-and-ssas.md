# SSP PDF Decryption & SSAS Testing Reference

## SSP File Details (EXAMPLE_VESSEL, IMO EXAMPLE_IMO)

- File: `SSP_EXAMPLE_VESSEL(EXAMPLE_IMO)_HDOA038725.pdf` (142 pages, 288KB extracted text)
- Password: `EXAMPLE_IMOssp`
- Company: BUILT FOUND SHIPMANAGEMENT CO., LTD.
- Contains Chinese + English bilingual text

## Decryption Code

```python
import fitz
doc = fitz.open('path/to/SSP_EXAMPLE_VESSEL...pdf')
doc.authenticate('EXAMPLE_IMOssp')  # returns 2 if success, 0/1 if failed
for page in doc:
    text = page.get_text()
doc.close()
```

## SSAS Testing Requirements (from SSP Section 7.1.2)

| Item | Detail |
|------|--------|
| Frequency | **Monthly** (每月) |
| Responsible | Radio Officer / 2nd Officer |
| Record | Shipboard security equipment test and maintenance record |
| CSO coordination | Coordinate for routine transmission test (SSP 7.2.4) |

## SSAS Equipment Details

- Model: **FELCOM 15**
- Two activation points: Bridge + Master's Office (locations not disclosed to unauthorized parties)
- Activation: Press button → 30s delay → covert alert transmits repeatedly
- No onboard alarm or indication when activated (covert system)
- Test mode: Must use SSAS Manager Mode to avoid sending real alert
- False alarm: Immediately notify CSO

## SSP Structure (142 pages)

- Page 1-2: Cover + Revision Record
- Page 3-5: Table of Contents
- Section 7 (pages 71+): SSAS specifics
  - 7.1 Features and configuration
  - 7.2 Responsibilities (Master, SSO, C/E, Deck Officers)
  - 7.3 Operating procedures and test instructions
- Various sections covering: access control, restricted areas, cargo security, MARSEC levels, port interface, drills
