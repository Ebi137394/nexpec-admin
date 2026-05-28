# Phase 0A — Mobile → Kebab Canonical Mapping

_Generated for your review. Edit the **Target** column where you disagree, then reply with "approved" (or "approved with the following changes: …") and I'll execute Phase 0B._

## Legend

- **AUTO** — exact snake→kebab match; target slug already exists in `apps/web/src/lib/data/specialtyTaxonomy.ts`. Zero judgment.
- **ALIAS** — mobile generic discipline folded into a specific existing web slug. Default picked is the most common variant; substitute another web slug if you want a different mapping.
- **NEW** — no web equivalent exists. A new kebab slug will be added to the canonical taxonomy. Mobile's `description` + `synonyms` carry over.

## Counts

- AUTO:   **22**
- ALIAS:  **6**
- NEW:    **30**
- TOTAL:  **58** mobile disciplines

New canonical slugs being introduced (30): `asme-b31`, `asme-section-viii`, `bgas-cswip-coating`, `confined-space-entry`, `corrosion-engineering`, `ex-atex-iecex-inspection`, `gas-turbine-inspection`, `hse-management`, `instrumentation-control`, `iso-9001-auditor`, `iso-14001-auditor`, `iso-45001-auditor`, `lifting-gear-cranes`, `lng-cryogenic`, `metallurgy-materials-engineering`, `nuclear-inspection`, `oil-gas-downstream-experience`, `oil-gas-midstream-experience`, `oil-gas-upstream-experience`, `osha-authorised-person`, `pigging-ili`, `power-generation-conventional`, `qaqc-management`, `rotating-equipment-inspection`, `subsea-inspection`, `tank-foundation-bunds`, `valves-actuators`, `vibration-analysis`, `wind-renewables`, `rope-access-irata-sprat`.

---

## `welding_materials` group

| Mobile slug | Mobile name | Kind | Target (kebab) | Note |
|---|---|---|---|---|
| `welding_inspection_cwi` | Welding Inspection (CWI) | AUTO | `aws-cwi` | AWS CWI is the canonical CWI cert |
| `welding_inspection_cswip` | Welding Inspection (CSWIP) | ALIAS | `cswip-3-1` | Generic CSWIP → 3.1 (most common); 3.2 + 3.2.2 underwater exist separately on web |
| `metallurgy` | Metallurgy & Materials Engineering | **NEW** → `metallurgy-materials-engineering` | | No web equivalent — adding as a distinct discipline |
| `corrosion_engineering` | Corrosion Engineering | **NEW** → `corrosion-engineering` | | Web has NACE certs but no general corrosion-engineering discipline |

## `ndt` group

| Mobile slug | Mobile name | Kind | Target (kebab) | Note |
|---|---|---|---|---|
| `ndt_ultrasonic` | NDT — Ultrasonic (UT) | AUTO | `ndt-ut` | |
| `ndt_radiography` | NDT — Radiography (RT) | AUTO | `ndt-rt` | |
| `ndt_magnetic_particle` | NDT — Magnetic Particle (MT) | AUTO | `ndt-mt` | |
| `ndt_liquid_penetrant` | NDT — Liquid Penetrant (PT) | AUTO | `ndt-pt` | |
| `ndt_eddy_current` | NDT — Eddy Current (ET) | AUTO | `ndt-et` | |
| `ndt_visual` | NDT — Visual (VT) | AUTO | `ndt-vt` | |
| `ndt_phased_array` | NDT — Phased Array (PAUT) | AUTO | `ndt-paut` | |
| `ndt_thickness_uts` | NDT — Ultrasonic Thickness | ALIAS | `ndt-ut` | UT thickness folds into the parent UT slug |

## `pressure_equipment` group

| Mobile slug | Mobile name | Kind | Target (kebab) | Note |
|---|---|---|---|---|
| `pressure_vessel_api510` | API 510 — Pressure Vessels | AUTO | `api-510` | |
| `api_570_piping` | API 570 — Piping | AUTO | `api-570` | |
| `api_653_storage_tanks` | API 653 — Aboveground Storage Tanks | AUTO | `api-653` | |
| `api_580_rbi` | API 580 / 581 — Risk-Based Inspection | AUTO | `api-580` | Web has both api-580 and api-581 separately; 580 is methodology, 581 is the implementation |
| `asme_section_viii` | ASME Section VIII (Pressure Vessels) | **NEW** → `asme-section-viii` | | Web has ASME Section IX (welding qual) but not VIII (vessel design code) |
| `asme_b31_piping` | ASME B31 — Piping Codes | **NEW** → `asme-b31` | | Web has API 570 but no ASME B31 series |
| `heat_exchanger` | Heat Exchanger Inspection | AUTO | `heat-exchanger-inspection` | Added in chemical_process group last commit |

## `coatings_corrosion` group

| Mobile slug | Mobile name | Kind | Target (kebab) | Note |
|---|---|---|---|---|
| `coating_inspection_nace` | Coating Inspection (NACE / AMPP CIP) | ALIAS | `nace-cip-2` | Generic NACE CIP → Level 2 (most common); L1 + L3 exist separately on web |
| `coating_inspection_bgas` | Coating Inspection (BGAS-CSWIP) | **NEW** → `bgas-cswip-coating` | | BGAS-CSWIP coating cert — no web equivalent |
| `cathodic_protection` | Cathodic Protection | ALIAS | `nace-cp-2` | Generic CP → NACE CP2 Technician; CP1/3/4 exist separately on web |

## `rotating_mechanical` group

| Mobile slug | Mobile name | Kind | Target (kebab) | Note |
|---|---|---|---|---|
| `rotating_equipment` | Rotating Equipment Inspection | **NEW** → `rotating-equipment-inspection` | | Web group "Mechanical & rotating" exists but no generic rotating-equipment slug |
| `gas_turbine_inspection` | Gas Turbine Inspection | **NEW** → `gas-turbine-inspection` | | |
| `vibration_analysis` | Vibration Analysis | **NEW** → `vibration-analysis` | | Common predictive-maintenance discipline |
| `lifting_cranes` | Lifting Gear & Cranes | **NEW** → `lifting-gear-cranes` | | Web has "Lifting & rigging" group but no specific crane-inspection slug |
| `valves_actuators` | Valves & Actuators | **NEW** → `valves-actuators` | | |

## `electrical_instrumentation` group

| Mobile slug | Mobile name | Kind | Target (kebab) | Note |
|---|---|---|---|---|
| `electrical_inspection` | Electrical Inspection (general) | AUTO | `electrical-inspection` | |
| `instrumentation_control` | Instrumentation & Control | **NEW** → `instrumentation-control` | | I&C — no direct web slug |
| `plc_scada` | PLC / SCADA / DCS | AUTO | `plc-scada` | |
| `thermography` | Thermography (Infrared) | ALIAS | `ndt-irt` | IR thermography = NDT IRT; same physical technique |
| `ex_inspection_atex_iecex` | Ex / ATEX / IECEx Inspection | **NEW** → `ex-atex-iecex-inspection` | | Hazardous-area electrical equipment inspection |

## `civil_structural` group

| Mobile slug | Mobile name | Kind | Target (kebab) | Note |
|---|---|---|---|---|
| `concrete_inspection` | Concrete Inspection | AUTO | `concrete-inspection` | |
| `structural_steel` | Structural Steel Inspection | AUTO | `structural-steel` | |
| `bridge_inspection` | Bridge Inspection | AUTO | `bridge-inspection` | |
| `tank_inspection_civil` | Tank Foundation / Bunds | **NEW** → `tank-foundation-bunds` | | Civil-side tank work (foundation, bunds) — distinct from API 653 tank shell |

## `safety_access` group

| Mobile slug | Mobile name | Kind | Target (kebab) | Note |
|---|---|---|---|---|
| `rope_access_irata` | Rope Access (IRATA / SPRAT) | **NEW** → `rope-access-irata-sprat` | | IRATA / SPRAT certified rope access |
| `confined_space` | Confined Space Entry | **NEW** → `confined-space-entry` | | |
| `osha_authority` | OSHA / Authorised Person | **NEW** → `osha-authorised-person` | | |
| `hse_management` | HSE Management | **NEW** → `hse-management` | | |

## `qaqc_audit` group

| Mobile slug | Mobile name | Kind | Target (kebab) | Note |
|---|---|---|---|---|
| `iso_9001_audit` | ISO 9001 Auditing | **NEW** → `iso-9001-auditor` | | |
| `iso_45001_audit` | ISO 45001 Auditing | **NEW** → `iso-45001-auditor` | | |
| `iso_14001_audit` | ISO 14001 Auditing | **NEW** → `iso-14001-auditor` | | |
| `qaqc_management` | QA/QC Management | **NEW** → `qaqc-management` | | |

## `subsea_pipeline` group

| Mobile slug | Mobile name | Kind | Target (kebab) | Note |
|---|---|---|---|---|
| `pipeline_integrity` | Pipeline Integrity | AUTO | `pipeline-integrity` | |
| `subsea_inspection` | Subsea Inspection | **NEW** → `subsea-inspection` | | Web has marine-offshore group but no subsea-specific slug |
| `pigging_ili` | Pigging & In-Line Inspection | **NEW** → `pigging-ili` | | In-line inspection / smart pigging |

## `energy_specific` group

| Mobile slug | Mobile name | Kind | Target (kebab) | Note |
|---|---|---|---|---|
| `oil_gas_upstream` | Oil & Gas — Upstream | **NEW** → `oil-gas-upstream-experience` | | Web has "Oil & gas — upstream" as a GROUP (containing other slugs) but no slug at the discipline level |
| `oil_gas_midstream` | Oil & Gas — Midstream | **NEW** → `oil-gas-midstream-experience` | | |
| `oil_gas_downstream` | Oil & Gas — Downstream (Refinery) | **NEW** → `oil-gas-downstream-experience` | | |
| `lng_cryogenic` | LNG & Cryogenic | **NEW** → `lng-cryogenic` | | |
| `power_generation` | Power Generation (Conventional) | **NEW** → `power-generation-conventional` | | |
| `wind_renewables` | Wind & Renewables | **NEW** → `wind-renewables` | | |
| `nuclear_inspection` | Nuclear Inspection | **NEW** → `nuclear-inspection` | | ASME III, N-stamp work |

## `chemical_process` group (just shipped — already kebab-aligned)

| Mobile slug | Mobile name | Kind | Target (kebab) | Note |
|---|---|---|---|---|
| `process_safety_management` | Process Safety Management (PSM) | AUTO | `psm` | Just shipped under chemical_process group |
| `mechanical_integrity_program` | Mechanical Integrity (MI) | AUTO | `mechanical-integrity` | Just shipped |
| `process_hazard_analysis` | Process Hazard Analysis (PHA / HAZOP) | AUTO | `pha-hazop` | Just shipped |
| `pressure_relief_inspection` | Pressure Relief Device Inspection | AUTO | `pressure-relief-devices` | Just shipped |
| `heat_exchanger_inspection` | Heat Exchanger Inspection | AUTO | `heat-exchanger-inspection` | Just shipped |
| `ldar_leak_detection` | LDAR (Leak Detection & Repair) | AUTO | `ldar` | Just shipped |

---

## How to approve

1. **Skim each table** with the question: _"if an inspector with this mobile slug got remapped to the proposed kebab target, is that the right specialty?"_
2. **Flag any row you want changed**. Just tell me e.g. _"row `welding_inspection_cswip` — alias to `cswip-3-2` instead, our market uses Senior CWI more"_, or _"drop the `hse_management` row, we don't track that as a discipline"_.
3. **Reply with "approved"** (or "approved with the following changes: …") and I'll execute Phase 0B:
   - Create `packages/shared-core/src/data/specialtyTaxonomy.ts` with the 277 existing kebab slugs + the 30 NEW canonical slugs above
   - Refactor `apps/web/src/lib/data/specialtyTaxonomy.ts` to re-export from shared-core (no slug changes visible to the web app)
   - Refactor `src/data/specialties.ts` to re-export from shared-core, with every mobile slug literal in the file rewritten to its kebab target above
   - Write the SQL backfill migration that rewrites `jobs.specialty_slugs` and `profiles.specialty_slugs` to replace each snake slug with its kebab equivalent
   - Audit and rewrite any other code file that hardcodes a mobile snake slug literal

## What this DOESN'T do

- Doesn't decide which groups belong to which inspection_domain (that's Phase 1-5, one domain at a time).
- Doesn't seed any scope templates (also Phase 1-5).
- Doesn't flip any `is_launched` toggle.
- Doesn't change web slugs at all — every kebab slug currently in use stays exactly as it is. The 30 new canonical slugs are pure additions to the inventory.
