# Q88 Document Extraction — Tips & Pitfalls

Q88 files (the standard oil tanker questionnaire) often come from charterers as .docx files. Extracting data from them has several pitfalls documented below.

## Pitfall 1: Unicode NBSP in Filenames

Q88 filenames from Chinese Windows environments often contain Unicode non-breaking spaces (U+00A0 or `\xa0`). Example:
`1. 2026.05.21 Q88\xa0WDT46083 V6 YONGAN OCEAN .docx`

**python-docx** fails to open these files directly from the command line because the NBSP character doesn't match the literal space typed:

```python
# This FAILS — PackageNotFoundError
doc = docx.Document('1. 2026.05.21 Q88 WDT46083 V6 YONGAN OCEAN .docx')
```

**Fix:** Copy the file to a clean name using Python's shutil with glob:

```python
import os, glob, shutil
files = glob.glob('1. *Q88*')
if files:
    f = files[0]  # verify repr(f) to confirm the NBSP
    shutil.copy2(f, 'yongan_q88.docx')
```

Or use Python directly to detect the NBSP:
```python
print(repr(f))  # '1. 2026.05.21 Q88\\xa0WDT46083 V6 YONGAN OCEAN .docx'
```

Then open the clean copy:
```python
doc = docx.Document('yongan_q88.docx')
```

## Pitfall 2: Q88 Has Tables, Not Paragraphs

Q88 is almost entirely table-based. Don't search paragraphs — iterate `doc.tables`:

```python
for ti, table in enumerate(doc.tables):
    for ri, row in enumerate(table.rows):
        cells = [c.text.strip() for c in row.cells]
        print(f'T{ti}R{ri}: {" | ".join(cells)}')
```

## Pitfall 3: Merged Cells Repeat Content

Q88 tables often have merged cells where the same content repeats in multiple columns. Use `set()` or `seen` tracking to deduplicate while scanning:

```python
seen = set()
...
line = ' | '.join(cells)
if line not in seen:
    seen.add(line)
    print(line)
```

## Pitfall 4: Fields to Always Extract (for STS assessment)

| Q88 Section | Field | Purpose |
|-------------|-------|---------|
| 1.2 | Vessel name + IMO | Identity |
| 1.3 | Previous names | Renaming history (screening) |
| 1.5-1.6 | Flag, Call sign, MMSI | Identity, screening |
| 1.10 | Registered owner | Sanctions screening |
| 1.11 | Technical operator | Sanctions screening |
| 1.12 | Commercial operator | Sanctions screening |
| 1.14-1.15 | P&I Club + coverage | Insurance adequacy |
| 1.18 | Classification society | Class status |
| 1.20-1.20a | Open conditions of class | Vessel condition |
| 2.x | Dimensions (LOA, Beam, Depth, DWT, Draft) | Size ratio |
| 3.x | Cargo capacity, pump rates | Operational match |
| 5.x | Manifold details | Physical compatibility |
| 11.x | STS experience, STS plan | Experience check |
