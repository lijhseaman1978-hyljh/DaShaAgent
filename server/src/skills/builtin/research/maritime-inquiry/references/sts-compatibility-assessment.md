# STS (Ship-to-Ship) Compatibility Assessment

When a charterer asks whether your vessel can conduct STS operations with another ship, follow this methodology to analyze suitability.

## Data Sources Needed

1. **YOUR vessel's data** — HVPQ (in knowledge base), Q88, or Vessel Details. Key specs: LOA, Beam, DWT, Draft, Manifold info, IGS/COW status.
2. **Other vessel's data** — Q88 (primary), STS plan, certificates, crew matrix. Usually provided by the charterer.
3. **SSP/Company SMS** — May have STS-specific procedure requirements.

## Assessment Criteria

### 1. Size Ratio (OCIMF Guideline)

- The larger vessel should be no more than **5x** the DWT of the smaller vessel.
- Calculate: `Max DWT / Min DWT`
- Ratio ≤ 5: Acceptable
- Ratio > 5: Additional risk assessment required

### 2. Vessel Type Compatibility

- Both must be compatible cargo types (Crude/Crude, Product/Product, or compatible chemical grades)
- Both must be double hull (for oil tankers)
- Both must have IGS (inert gas system) operational — **mandatory** for oil STS
- Both should have COW (crude oil washing) if handling crude

### 3. Manifold Height Compatibility

The critical physical constraint for STS:

- Check manifold height above waterline for BOTH vessels in their OPERATING condition (usually the smaller ship in ballast, the larger in laden or ballast depending on operation)
- Height difference should be manageable with standard STS hoses (typical droop: 9-12m)
- If the larger vessel is also in ballast, height difference may be more pronounced
- **Estimate:** Manifold height ~ Depth + (~1.5m deck to manifold center) - Draft

### 4. Manifold Configuration

- Number and size of manifold connections per side should be compatible
- Standard hose sizes (typically 12"/300mm or 16"/400mm)
- Reducer availability should cover the other vessel's hose sizes
- Material compatibility (Stainless Steel vs Carbon Steel — check cargo specs)

### 5. STS Equipment & Experience

- Does the other vessel have a **ship-specific STS plan**? (Q88 Section 11)
- Date/place of last STS operation (recent experience is positive)
- Does the other vessel comply with OCIMF/ICS STS Transfer Guide?
- Crane outreach — can the crane reach the other vessel's deck for hose handling?
- Mooring arrangement compatibility (bollard SWL, fairlead sizes)

### 6. Certificate & Compliance Check

- All statutory certificates valid (IOPP, IAPP, ISSC, SMC, MLC, etc.)
- P&I insurance adequate (typical: $1B pollution cover)
- No open conditions of class
- Last PSC inspection: zero or minimal deficiencies
- Recent SIRE/CDI inspection history

### 7. Crew Compatibility

- Common working language
- STS experience among officers
- English proficiency (for communication during STS)
- Manning adequacy for STS operation

## 8. Sanctions / Denial List Screening — CRITICAL

The captain **must** be informed of sanctions status before confirming STS suitability. Perform this check after all technical criteria pass, and report findings before drafting the response letter.

### Vessel & Entity Names to Screen

1. **Vessel name** (current and any previous names — check Q88 Section 1.3)
2. **IMO number**
3. **Registered owner** (Q88 Section 1.10)
4. **Technical operator** (Q88 Section 1.11)
5. **Commercial operator** (Q88 Section 1.12)
6. **Disponent owner** (Q88 Section 1.13, if listed)

### Databases to Search

| Database | URL | Notes |
|----------|-----|-------|
| US OFAC SDN List | https://sanctionssearch.ofac.treas.gov/ | Search by name, IMO, and entity. Use exact name and fuzzy-type matches. Set type filter as needed. |
| UK Sanctions List | https://search-uk-sanctions-list.service.gov.uk/ | Covers all UK designations since OFSI list closed 28 Jan 2026. Use fuzzy search toggle for misspellings. |

### Search Methodology (Step-by-Step)

1. **Vessel current name** on OFAC first (Type: All, then try Vessel filter)
2. **IMO number** on OFAC
3. **Registered owner name** on OFAC
4. **Previous vessel name(s)** on OFAC (be aware of false positives — "Integrity" matched an unrelated Chinese cyber entity on OFAC CYBER2)
5. **Repeat all searches** on UK Sanctions List
6. **EU Sanctions Map** (https://sanctionsmap.eu/) — interactive map, harder to automate; check for any applicable regime that could touch the vessel or its trading pattern

### Interpreting Results

- **0 matches = clean** — report as "not found on major sanctions lists"
- **Exact matches (same name + IMO or entity name)** — HIT, report immediately as a sanctions match
- **Fuzzy matches** — common on UK Sanctions List. "OCEAN AUTUMN", "OCEAN EMBRACE" matched YONGAN OCEAN only on the keyword "OCEAN". These are NOT hits unless the identifier (IMO, address, full name) matches. Be explicit about this in your report.

### Other Red Flags to Note (Not Sanctions, But Worth Flagging)

- **P&I Club not in the International Group** — This is a soft flag, not a hard block. Standard IG clubs: West of England, UK P&I, Steamship, Gard, Skuld, London, North of England, Britannia, American, Japan. Non-IG clubs (e.g. Sun Re Ltd in Nevis) are unusual but not prohibitive — note it for the captain's awareness.
- **Frequent name changes** — vessel renamed "Integrity" (MAY 2021) → "YONGAN OCEAN". Recent renaming without clear reason can be suspicious.
- **Recent flag change** — check Q88 flag/port of registry.

## Quick Reference Table

| Factor | Good Signal | Red Flag |
|--------|-------------|----------|
| DWT Ratio | ≤ 5:1 | > 5:1 |
| IGS | Both operational | Either not fitted or not working |
| STS Plan | Has ship-specific plan | No plan |
| Last STS | Within 6 months | Never done STS |
| PSC Deficiencies | Zero | Major deficiencies |
| Open Class Conditions | None | Any |
| Crew Language | Mutual | No common language |
| All Certificates | Valid | Any expired |

## Example: EXAMPLE_VESSEL vs YONGAN OCEAN (Session 2026-05-24)

- EXAMPLE_VESSEL: 151,174 DWT (Suezmax), LOA 277.30m, Beam 48.00m
- YONGAN OCEAN: 46,803 DWT, LOA 183.22m, Beam 32.24m
- Ratio: 3.23:1 — Acceptable
- Both: Double hull, IGS/COW, Panama flag, KR class
- YONGAN: Has STS plan, last STS 30 APR 2026 Port Klang, all officers have STS experience
- Manifold height diff in ballast: ~4m — manageable
- Result: SUITABLE for STS
