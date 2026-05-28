// ════════════════════════════════════════════════════════════════════════════
//  packages/shared-core/src/data/specialtyTaxonomy.ts
//
//  CANONICAL specialty taxonomy. Single source of truth for both surfaces:
//    • apps/web/src/lib/data/specialtyTaxonomy.ts  → re-exports from here
//    • src/data/specialties.ts                     → re-exports from here
//
//  History: web and mobile previously maintained divergent taxonomies
//  (kebab-case vs snake_case slugs, ~277 vs ~69 entries, zero overlap).
//  This file unifies them on kebab-case with the richer per-discipline
//  metadata (label + optional description + optional synonyms) mobile had.
//  Migration 20260622120000_unify_specialty_slugs_kebab.sql backfills
//  jobs.specialty_slugs and profiles.specialty_slugs in place.
//
//  RULES
//  ─────
//    • Slugs are NEVER renamed. They are written into jobs.specialty_slugs
//      and profiles.specialty_slugs and a rename strands existing rows.
//    • Labels may be revised freely (display-only).
//    • Adding a new discipline: append to DISCIPLINES with a unique kebab
//      slug, then add the slug to the appropriate group's disciplineSlugs.
//    • Adding a new group: append to GROUPS with title + ordered
//      disciplineSlugs. Update the GroupTitle union below.
// ════════════════════════════════════════════════════════════════════════════

export interface Specialty {
  /** Stable identifier. Lowercase kebab-case. NEVER mutate after release. */
  readonly slug: string;
  /** Display label shown in pickers, badges, and free-text contexts. */
  readonly label: string;
  /** Title of the group this discipline belongs to. */
  readonly group: GroupTitle;
  /** Optional one-line description for tooltips and pickers. */
  readonly description?: string;
  /** Optional search synonyms (industry abbreviations, alt spellings). */
  readonly synonyms?: readonly string[];
}

export interface SpecialtyGroup {
  /** Human-readable title. Stored verbatim in inspection_domains.default_specialty_groups. */
  readonly title: GroupTitle;
  /** Ordered list of discipline slugs in this group. */
  readonly disciplineSlugs: readonly string[];
}

/** Every supported group title. Update when adding a new group. */
export type GroupTitle =
  | "NDT methods"
  | "API standards"
  | "Welding & joining"
  | "Coatings & corrosion"
  | "Pressure equipment & boilers"
  | "Piping & pipelines"
  | "Storage tanks"
  | "Mechanical & rotating"
  | "Electrical & instrumentation"
  | "Civil & structural"
  | "Oil & gas — upstream"
  | "Oil & gas — downstream / process"
  | "Power & renewables"
  | "Marine & offshore"
  | "Lifting & rigging"
  | "Aerospace & defense"
  | "Quality, safety & systems"
  | "Special domains"
  | "Chemical & process";

// ─────────────────────────────────────────────────────────────────────
//  DISCIPLINES — every kebab specialty slug. Ordered by group, then by
//  the original web display order. Mobile-originating disciplines are
//  enriched with descriptions + synonyms.
// ─────────────────────────────────────────────────────────────────────

export const DISCIPLINES: readonly Specialty[] = [
  // ── NDT methods ────────────────────────────────────────────
  {
    slug: "ndt-ut",
    label: "Ultrasonic Testing (UT)",
    group: "NDT methods",
    description: "Conventional + phased-array UT, TOFD.",
    synonyms: ["ut", "ultrasonic", "phased array", "paut", "tofd"],
  },
  { slug: "ndt-paut", label: "Phased Array UT (PAUT)", group: "NDT methods" },
  { slug: "ndt-tofd", label: "Time-of-Flight Diffraction (TOFD)", group: "NDT methods" },
  {
    slug: "ndt-rt",
    label: "Radiographic Testing (RT)",
    group: "NDT methods",
    description: "Film + digital radiography, CR/DR.",
    synonyms: ["rt", "radiography", "x-ray", "gamma", "cr", "dr"],
  },
  { slug: "ndt-dr", label: "Digital Radiography (DR / CR)", group: "NDT methods" },
  { slug: "ndt-ct", label: "Computed Tomography (CT)", group: "NDT methods" },
  {
    slug: "ndt-mt",
    label: "Magnetic Particle Testing (MT)",
    group: "NDT methods",
    description: "Wet/dry fluorescent + visible magnetic particle inspection.",
    synonyms: ["mt", "mpi", "magnetic particle"],
  },
  {
    slug: "ndt-pt",
    label: "Liquid Penetrant Testing (PT)",
    group: "NDT methods",
    description: "Visible + fluorescent dye penetrant inspection.",
    synonyms: ["pt", "dpi", "dye penetrant", "liquid penetrant"],
  },
  {
    slug: "ndt-vt",
    label: "Visual Testing (VT)",
    group: "NDT methods",
    description: "ASNT/SNT-TC-1A Level II visual inspection.",
    synonyms: ["vt", "visual inspection"],
  },
  {
    slug: "ndt-et",
    label: "Eddy Current Testing (ET)",
    group: "NDT methods",
    description: "Eddy current array, tube inspection.",
    synonyms: ["et", "eddy current", "eca", "tube inspection"],
  },
  { slug: "ndt-rfet", label: "Remote Field ET (RFET)", group: "NDT methods" },
  { slug: "ndt-nrft", label: "Near-Field Testing (NFT)", group: "NDT methods" },
  {
    slug: "ndt-irt",
    label: "Infrared Thermography (IRT)",
    group: "NDT methods",
    description: "IR thermal surveys on electrical + mechanical equipment.",
    synonyms: ["thermography", "ir", "infrared", "thermal imaging"],
  },
  { slug: "ndt-lt", label: "Leak Testing (LT)", group: "NDT methods" },
  { slug: "ndt-ae", label: "Acoustic Emission (AE)", group: "NDT methods" },
  { slug: "ndt-guided-wave", label: "Guided Wave UT", group: "NDT methods" },
  { slug: "ndt-iris", label: "IRIS Tube Inspection", group: "NDT methods" },
  { slug: "ndt-mfl", label: "Magnetic Flux Leakage (MFL)", group: "NDT methods" },
  { slug: "ndt-ecpit", label: "EC Pit Sizing", group: "NDT methods" },
  { slug: "ndt-hardness", label: "In-situ Hardness Testing", group: "NDT methods" },
  { slug: "ndt-pmi", label: "Positive Material ID (PMI / XRF)", group: "NDT methods" },
  { slug: "ndt-ferrite", label: "Ferrite Content Testing", group: "NDT methods" },
  { slug: "ndt-borescope", label: "Borescope / Videoscope", group: "NDT methods" },
  { slug: "ndt-replication", label: "Metallographic Replication", group: "NDT methods" },

  // ── API standards ────────────────────────────────────────────
  { slug: "api-510", label: "API 510 (Pressure Vessels)", group: "API standards" },
  {
    slug: "api-570",
    label: "API 570 (Piping)",
    group: "API standards",
    description: "In-service inspection of process piping circuits.",
    synonyms: ["api 570", "piping inspector", "process piping"],
  },
  {
    slug: "api-653",
    label: "API 653 (Above-Ground Storage Tanks)",
    group: "API standards",
    description: "Tank inspection, repair, alteration, reconstruction.",
    synonyms: ["api 653", "ast", "storage tank", "tank inspector"],
  },
  { slug: "api-1169", label: "API 1169 (Pipeline Construction)", group: "API standards" },
  { slug: "api-577", label: "API 577 (Welding Inspection)", group: "API standards" },
  {
    slug: "api-580",
    label: "API 580 (Risk-Based Inspection)",
    group: "API standards",
    description: "Quantitative + qualitative RBI program design and review.",
    synonyms: ["api 580", "api 581", "rbi", "risk based inspection"],
  },
  { slug: "api-581", label: "API 581 (RBI Methodology)", group: "API standards" },
  { slug: "api-936", label: "API 936 (Refractory)", group: "API standards" },
  { slug: "api-571", label: "API 571 (Damage Mechanisms)", group: "API standards" },
  { slug: "api-574", label: "API 574 (Piping Inspection Practices)", group: "API standards" },
  { slug: "api-575", label: "API 575 (Atmospheric Storage Tanks)", group: "API standards" },
  { slug: "api-576", label: "API 576 (Pressure-Relieving Devices)", group: "API standards" },
  { slug: "api-578", label: "API 578 (PMI for Existing Alloy Piping)", group: "API standards" },
  { slug: "api-579", label: "API 579 / FFS-1 (Fitness-for-Service)", group: "API standards" },
  { slug: "api-510-rsp", label: "API SIRE (Source Inspector RSP)", group: "API standards" },
  { slug: "api-source-fixed", label: "API SIFE (Fixed Equipment)", group: "API standards" },
  { slug: "api-source-electrical", label: "API SIRE (Electrical)", group: "API standards" },
  { slug: "api-source-rotating", label: "API SIRE (Rotating)", group: "API standards" },
  { slug: "api-source-coatings", label: "API QUSE (Coatings)", group: "API standards" },
  { slug: "api-icp-tank", label: "API ICP — Tank Auditor", group: "API standards" },
  { slug: "api-icp-aboveground", label: "API ICP — Above-Ground Storage", group: "API standards" },

  // ── Welding & joining ────────────────────────────────────────────
  {
    slug: "aws-cwi",
    label: "AWS CWI (Certified Welding Inspector)",
    group: "Welding & joining",
    description: "Visual + procedure-based weld inspection per AWS D1.1 / D1.5.",
    synonyms: ["cwi", "aws cwi", "weld inspector", "aws d1.1"],
  },
  { slug: "aws-scwi", label: "AWS SCWI (Senior CWI)", group: "Welding & joining" },
  { slug: "aws-cawi", label: "AWS CAWI (Associate CWI)", group: "Welding & joining" },
  { slug: "aws-cwe", label: "AWS CWE (Welding Educator)", group: "Welding & joining" },
  { slug: "aws-cwsupervisor", label: "AWS CWS (Welding Supervisor)", group: "Welding & joining" },
  {
    slug: "cswip-3-1",
    label: "CSWIP 3.1 Welding Inspector",
    group: "Welding & joining",
    description: "CSWIP 3.1 / 3.2 welding inspection competence.",
    synonyms: ["cswip", "cswip 3.1", "cswip 3.2"],
  },
  { slug: "cswip-3-2", label: "CSWIP 3.2 Senior Welding Inspector", group: "Welding & joining" },
  { slug: "cswip-3-2-2", label: "CSWIP 3.2.2 Underwater", group: "Welding & joining" },
  { slug: "iwe", label: "IWE (International Welding Engineer)", group: "Welding & joining" },
  { slug: "iws", label: "IWS (International Welding Specialist)", group: "Welding & joining" },
  { slug: "iwt", label: "IWT (International Welding Technologist)", group: "Welding & joining" },
  { slug: "asme-section-ix", label: "ASME Section IX (Welding Qual.)", group: "Welding & joining" },
  { slug: "wps-pqr", label: "WPS / PQR Review", group: "Welding & joining" },
  { slug: "welder-qualification", label: "Welder / Operator Qualification", group: "Welding & joining" },
  { slug: "orbital-welding", label: "Orbital Welding", group: "Welding & joining" },
  { slug: "tig-gtaw", label: "TIG / GTAW", group: "Welding & joining" },
  { slug: "mig-gmaw", label: "MIG / GMAW", group: "Welding & joining" },
  { slug: "smaw", label: "SMAW / Stick", group: "Welding & joining" },
  { slug: "fcaw", label: "FCAW / Flux-cored", group: "Welding & joining" },
  { slug: "saw", label: "SAW / Submerged Arc", group: "Welding & joining" },
  { slug: "brazing", label: "Brazing & Soldering", group: "Welding & joining" },
  {
    slug: "metallurgy-materials-engineering",
    label: "Metallurgy & Materials Engineering",
    group: "Welding & joining",
    description: "Failure analysis, material selection, hardness/PMI testing.",
    synonyms: ["materials", "pmi", "positive material id", "hardness testing"],
  },

  // ── Coatings & corrosion ────────────────────────────────────────────
  { slug: "nace-cip-1", label: "NACE / AMPP CIP Level 1", group: "Coatings & corrosion" },
  {
    slug: "nace-cip-2",
    label: "NACE / AMPP CIP Level 2",
    group: "Coatings & corrosion",
    description: "NACE CIP 1/2/3 / AMPP coatings inspection.",
    synonyms: ["nace", "ampp", "cip", "coating inspector"],
  },
  { slug: "nace-cip-3", label: "NACE / AMPP CIP Level 3", group: "Coatings & corrosion" },
  { slug: "nace-pcs-1", label: "NACE Protective Coating Specialist 1", group: "Coatings & corrosion" },
  { slug: "nace-pcs-2", label: "NACE Protective Coating Specialist 2", group: "Coatings & corrosion" },
  { slug: "nace-cp-1", label: "NACE CP Tester / CP1", group: "Coatings & corrosion" },
  {
    slug: "nace-cp-2",
    label: "NACE CP Technician / CP2",
    group: "Coatings & corrosion",
    description: "CP design, install, monitoring (NACE CP).",
    synonyms: ["cp", "cathodic protection", "nace cp"],
  },
  { slug: "nace-cp-3", label: "NACE CP Technologist / CP3", group: "Coatings & corrosion" },
  { slug: "nace-cp-4", label: "NACE CP Specialist / CP4", group: "Coatings & corrosion" },
  { slug: "sspc-pci", label: "SSPC PCI (Painting Inspector)", group: "Coatings & corrosion" },
  { slug: "sspc-bci", label: "SSPC BCI (Bridge Coating)", group: "Coatings & corrosion" },
  { slug: "sspc-cas", label: "SSPC C12 / C7 Coating Application", group: "Coatings & corrosion" },
  { slug: "icorr-coatings", label: "ICorr Coatings Inspector", group: "Coatings & corrosion" },
  { slug: "frosio", label: "FROSIO Coating Inspector", group: "Coatings & corrosion" },
  { slug: "corrosion-monitoring", label: "Corrosion Monitoring / Probes", group: "Coatings & corrosion" },
  { slug: "galvanic-survey", label: "Galvanic Survey", group: "Coatings & corrosion" },
  { slug: "cathodic-protection", label: "Cathodic Protection Design", group: "Coatings & corrosion" },
  { slug: "cui", label: "Corrosion-Under-Insulation (CUI)", group: "Coatings & corrosion" },
  { slug: "painting", label: "Painting & Surface Prep", group: "Coatings & corrosion" },
  { slug: "blast-cleaning", label: "Abrasive Blast Cleaning", group: "Coatings & corrosion" },
  { slug: "galvanizing", label: "Galvanizing Inspection", group: "Coatings & corrosion" },
  {
    slug: "corrosion-engineering",
    label: "Corrosion Engineering",
    group: "Coatings & corrosion",
    description: "Corrosion mechanism diagnosis, CP design, monitoring.",
    synonyms: ["corrosion", "cp", "cathodic protection"],
  },
  {
    slug: "bgas-cswip-coating",
    label: "BGAS-CSWIP Coating Inspector",
    group: "Coatings & corrosion",
    description: "BGAS-CSWIP painting inspector certification.",
    synonyms: ["bgas", "bgas-cswip", "painting inspector"],
  },

  // ── Pressure equipment & boilers ────────────────────────────────────────────
  { slug: "asme-bpvc-i", label: "ASME BPVC Section I (Power Boilers)", group: "Pressure equipment & boilers" },
  { slug: "asme-bpvc-iv", label: "ASME BPVC Section IV (Heating Boilers)", group: "Pressure equipment & boilers" },
  { slug: "asme-bpvc-viii-1", label: "ASME BPVC Section VIII Div 1", group: "Pressure equipment & boilers" },
  { slug: "asme-bpvc-viii-2", label: "ASME BPVC Section VIII Div 2", group: "Pressure equipment & boilers" },
  { slug: "asme-bpvc-viii-3", label: "ASME BPVC Section VIII Div 3", group: "Pressure equipment & boilers" },
  { slug: "asme-bpvc-x", label: "ASME BPVC Section X (FRP Vessels)", group: "Pressure equipment & boilers" },
  { slug: "asme-bpvc-xi", label: "ASME BPVC Section XI (ISI Nuclear)", group: "Pressure equipment & boilers" },
  { slug: "asme-bpvc-xii", label: "ASME BPVC Section XII (Transport Tanks)", group: "Pressure equipment & boilers" },
  { slug: "pressure-relief", label: "Pressure-Relief Devices", group: "Pressure equipment & boilers" },
  { slug: "boiler-startup", label: "Boiler Startup & Commissioning", group: "Pressure equipment & boilers" },
  { slug: "heat-exchanger", label: "Heat Exchanger Inspection", group: "Pressure equipment & boilers" },
  { slug: "reactor-vessel", label: "Reactor Vessel Inspection", group: "Pressure equipment & boilers" },
  { slug: "columns-towers", label: "Distillation Columns & Towers", group: "Pressure equipment & boilers" },
  { slug: "air-cooled-hx", label: "Air-Cooled Heat Exchangers", group: "Pressure equipment & boilers" },
  { slug: "cryogenic-vessels", label: "Cryogenic Vessels", group: "Pressure equipment & boilers" },
  { slug: "hydrostatic-test", label: "Hydrostatic / Pneumatic Testing", group: "Pressure equipment & boilers" },
  {
    slug: "asme-section-viii",
    label: "ASME Section VIII (Pressure Vessels)",
    group: "Pressure equipment & boilers",
    description: "Code review for unfired pressure vessels.",
    synonyms: ["asme viii", "asme section 8", "pressure vessel code"],
  },

  // ── Piping & pipelines ────────────────────────────────────────────
  { slug: "asme-b31-1", label: "ASME B31.1 (Power Piping)", group: "Piping & pipelines" },
  { slug: "asme-b31-3", label: "ASME B31.3 (Process Piping)", group: "Piping & pipelines" },
  { slug: "asme-b31-4", label: "ASME B31.4 (Liquid Pipelines)", group: "Piping & pipelines" },
  { slug: "asme-b31-5", label: "ASME B31.5 (Refrigeration)", group: "Piping & pipelines" },
  { slug: "asme-b31-8", label: "ASME B31.8 (Gas Pipelines)", group: "Piping & pipelines" },
  { slug: "asme-b31-9", label: "ASME B31.9 (Building Services)", group: "Piping & pipelines" },
  { slug: "asme-b31-12", label: "ASME B31.12 (Hydrogen Piping)", group: "Piping & pipelines" },
  {
    slug: "pipeline-integrity",
    label: "Pipeline Integrity Management",
    group: "Piping & pipelines",
    description: "Onshore/offshore pipeline integrity management.",
    synonyms: ["pipeline", "integrity", "pim"],
  },
  { slug: "pipeline-construction", label: "Pipeline Construction", group: "Piping & pipelines" },
  { slug: "pipeline-pigging", label: "In-Line Inspection (Pigging)", group: "Piping & pipelines" },
  { slug: "pipeline-hydrotest", label: "Pipeline Hydrotest", group: "Piping & pipelines" },
  { slug: "pipeline-coating", label: "Pipeline Coating", group: "Piping & pipelines" },
  { slug: "directional-drilling", label: "Horizontal Directional Drilling", group: "Piping & pipelines" },
  { slug: "subsea-pipeline", label: "Subsea Pipeline", group: "Piping & pipelines" },
  { slug: "fiber-optic-leak", label: "Fiber-Optic Leak Detection", group: "Piping & pipelines" },
  {
    slug: "asme-b31",
    label: "ASME B31 (Piping Codes)",
    group: "Piping & pipelines",
    description: "B31.1 power piping, B31.3 process piping, B31.4/8 pipelines.",
    synonyms: ["asme b31", "b31.1", "b31.3", "b31.4", "b31.8"],
  },
  {
    slug: "pigging-ili",
    label: "Pigging & In-Line Inspection (ILI)",
    group: "Piping & pipelines",
    description: "ILI tool runs, MFL / UT pigging programs.",
    synonyms: ["pigging", "ili", "mfl"],
  },

  // ── Storage tanks ────────────────────────────────────────────
  { slug: "tank-floor-scan", label: "Tank Floor MFL Scan", group: "Storage tanks" },
  { slug: "tank-shell-ut", label: "Tank Shell UT Mapping", group: "Storage tanks" },
  { slug: "tank-roof", label: "Tank Roof Inspection", group: "Storage tanks" },
  { slug: "tank-foundation", label: "Tank Foundation Settlement", group: "Storage tanks" },
  { slug: "tank-internal", label: "Internal Out-of-Service Tank", group: "Storage tanks" },
  { slug: "tank-external", label: "External In-Service Tank", group: "Storage tanks" },
  { slug: "lng-tank", label: "LNG Storage Tank", group: "Storage tanks" },
  { slug: "cryo-tank", label: "Cryogenic Tank", group: "Storage tanks" },
  { slug: "spherical-tank", label: "Spherical / Horton Sphere", group: "Storage tanks" },
  { slug: "bullet-tank", label: "Bullet Tank / Horizontal Vessel", group: "Storage tanks" },

  // ── Mechanical & rotating ────────────────────────────────────────────
  { slug: "rotating-equipment", label: "Rotating Equipment", group: "Mechanical & rotating" },
  { slug: "pumps-centrifugal", label: "Centrifugal Pumps", group: "Mechanical & rotating" },
  { slug: "pumps-reciprocating", label: "Reciprocating Pumps", group: "Mechanical & rotating" },
  { slug: "compressors-centrifugal", label: "Centrifugal Compressors", group: "Mechanical & rotating" },
  { slug: "compressors-reciprocating", label: "Reciprocating Compressors", group: "Mechanical & rotating" },
  { slug: "gas-turbines", label: "Gas Turbines", group: "Mechanical & rotating" },
  { slug: "steam-turbines", label: "Steam Turbines", group: "Mechanical & rotating" },
  { slug: "gearboxes", label: "Gearboxes", group: "Mechanical & rotating" },
  {
    slug: "vibration-analysis",
    label: "Vibration Analysis (CAT II/III/IV)",
    group: "Mechanical & rotating",
    description: "Cat I/II/III/IV vibration analysis on rotating machinery.",
    synonyms: ["vibration", "iso 18436", "condition monitoring"],
  },
  { slug: "lubrication", label: "Lubrication / Oil Analysis", group: "Mechanical & rotating" },
  { slug: "alignment-laser", label: "Laser Shaft Alignment", group: "Mechanical & rotating" },
  { slug: "balancing-field", label: "Field Balancing", group: "Mechanical & rotating" },
  { slug: "hvac-mechanical", label: "HVAC Mechanical", group: "Mechanical & rotating" },
  {
    slug: "rotating-equipment-inspection",
    label: "Rotating Equipment Inspection",
    group: "Mechanical & rotating",
    description: "Pumps, compressors, gearboxes, alignment, condition monitoring.",
    synonyms: ["rotating", "compressor", "pump", "gearbox"],
  },
  {
    slug: "gas-turbine-inspection",
    label: "Gas Turbine Inspection",
    group: "Mechanical & rotating",
    description: "Boroscope, hot-gas-path, combustor inspection on industrial turbines.",
    synonyms: ["gas turbine", "gt", "boroscope", "hot gas path"],
  },
  {
    slug: "valves-actuators",
    label: "Valves & Actuators",
    group: "Mechanical & rotating",
    description: "PSV/PRV pop-testing, control valve maintenance.",
    synonyms: ["valves", "psv", "prv", "actuators"],
  },

  // ── Electrical & instrumentation ────────────────────────────────────────────
  {
    slug: "electrical-inspection",
    label: "Electrical Inspection",
    group: "Electrical & instrumentation",
    description: "LV/HV systems, switchgear, motor testing.",
    synonyms: ["electrical", "switchgear", "hv", "lv"],
  },
  { slug: "hazardous-area-ex", label: "Hazardous-Area / Ex (IECEx, ATEX)", group: "Electrical & instrumentation" },
  { slug: "compex-foundation", label: "CompEx Foundation", group: "Electrical & instrumentation" },
  { slug: "compex-ex01-04", label: "CompEx Ex01–04", group: "Electrical & instrumentation" },
  { slug: "compex-ex05-06", label: "CompEx Ex05–06 / Mechanical", group: "Electrical & instrumentation" },
  { slug: "compex-ex11-12", label: "CompEx Ex11–12 / Inspector", group: "Electrical & instrumentation" },
  { slug: "high-voltage", label: "High-Voltage / Substations", group: "Electrical & instrumentation" },
  { slug: "thermography-electrical", label: "Electrical Thermography", group: "Electrical & instrumentation" },
  { slug: "instrumentation", label: "Instrumentation & Controls", group: "Electrical & instrumentation" },
  {
    slug: "plc-scada",
    label: "PLC / SCADA",
    group: "Electrical & instrumentation",
    description: "Industrial control system review and FAT/SAT.",
    synonyms: ["plc", "scada", "dcs", "fat", "sat"],
  },
  { slug: "cable-fault", label: "Cable Fault Location", group: "Electrical & instrumentation" },
  { slug: "partial-discharge", label: "Partial Discharge Testing", group: "Electrical & instrumentation" },
  { slug: "earthing-bonding", label: "Earthing / Bonding", group: "Electrical & instrumentation" },
  {
    slug: "instrumentation-control",
    label: "Instrumentation & Control",
    group: "Electrical & instrumentation",
    description: "Loop testing, calibration, SIS / SIL verification.",
    synonyms: ["instrumentation", "i&c", "sil", "sis", "calibration"],
  },
  {
    slug: "ex-atex-iecex-inspection",
    label: "Ex / ATEX / IECEx Inspection",
    group: "Electrical & instrumentation",
    description: "Hazardous-area electrical equipment inspection (EN 60079-17).",
    synonyms: ["atex", "iecex", "ex inspection", "hazardous area"],
  },

  // ── Civil & structural ────────────────────────────────────────────
  {
    slug: "structural-steel",
    label: "Structural Steel",
    group: "Civil & structural",
    description: "Structural fabrication + erection inspection.",
    synonyms: ["steel", "structural", "fabrication"],
  },
  {
    slug: "concrete-inspection",
    label: "Concrete Inspection",
    group: "Civil & structural",
    description: "Reinforced concrete inspection, NDT on concrete.",
    synonyms: ["concrete", "rebar", "rc"],
  },
  { slug: "rebar-scanning", label: "Rebar / GPR Scanning", group: "Civil & structural" },
  { slug: "post-tension", label: "Post-Tension Cable", group: "Civil & structural" },
  {
    slug: "bridge-inspection",
    label: "Bridge Inspection",
    group: "Civil & structural",
    description: "Highway + rail bridge condition assessment.",
    synonyms: ["bridges", "bridge inspector"],
  },
  { slug: "high-rise", label: "High-Rise Buildings", group: "Civil & structural" },
  { slug: "foundation", label: "Foundation Inspection", group: "Civil & structural" },
  { slug: "seismic-assessment", label: "Seismic Assessment", group: "Civil & structural" },
  { slug: "rope-access-l1", label: "Rope Access IRATA / SPRAT L1", group: "Civil & structural" },
  { slug: "rope-access-l2", label: "Rope Access IRATA / SPRAT L2", group: "Civil & structural" },
  { slug: "rope-access-l3", label: "Rope Access IRATA / SPRAT L3", group: "Civil & structural" },
  { slug: "scaffolding-inspector", label: "Scaffolding Inspector", group: "Civil & structural" },
  { slug: "masonry", label: "Masonry", group: "Civil & structural" },
  { slug: "geotechnical", label: "Geotechnical", group: "Civil & structural" },
  { slug: "soil-testing", label: "Soil Testing", group: "Civil & structural" },
  {
    slug: "tank-foundation-bunds",
    label: "Tank Foundation / Bunds",
    group: "Civil & structural",
    description: "Civil aspects of storage-tank foundations and bunds.",
    synonyms: ["bunds", "foundations"],
  },

  // ── Oil & gas — upstream ────────────────────────────────────────────
  { slug: "drilling-rig", label: "Drilling Rig Inspection", group: "Oil & gas — upstream" },
  { slug: "well-completions", label: "Well Completions", group: "Oil & gas — upstream" },
  { slug: "wellhead-xmas", label: "Wellhead / Christmas Tree", group: "Oil & gas — upstream" },
  { slug: "mud-logging", label: "Mud Logging", group: "Oil & gas — upstream" },
  { slug: "wireline", label: "Wireline / Slickline", group: "Oil & gas — upstream" },
  { slug: "fracking", label: "Hydraulic Fracturing", group: "Oil & gas — upstream" },
  { slug: "subsea-equipment", label: "Subsea Equipment", group: "Oil & gas — upstream" },
  { slug: "offshore-platform", label: "Offshore Platform", group: "Oil & gas — upstream" },
  { slug: "fpso", label: "FPSO / FSO", group: "Oil & gas — upstream" },
  { slug: "jackup-rig", label: "Jackup Rig", group: "Oil & gas — upstream" },
  { slug: "semi-submersible", label: "Semi-Submersible", group: "Oil & gas — upstream" },
  {
    slug: "oil-gas-upstream-experience",
    label: "Oil & Gas — Upstream Experience",
    group: "Oil & gas — upstream",
    description: "Wellhead, separator, production-train inspection.",
    synonyms: ["upstream", "wellhead", "production"],
  },
  {
    slug: "oil-gas-midstream-experience",
    label: "Oil & Gas — Midstream Experience",
    group: "Oil & gas — upstream",
    description: "Compressor stations, terminals, midstream piping.",
    synonyms: ["midstream", "terminal", "compressor station"],
  },

  // ── Oil & gas — downstream / process ────────────────────────────────────────────
  { slug: "refinery", label: "Refinery Inspection", group: "Oil & gas — downstream / process" },
  { slug: "petrochemical", label: "Petrochemical Plant", group: "Oil & gas — downstream / process" },
  { slug: "lng-plant", label: "LNG Plant", group: "Oil & gas — downstream / process" },
  { slug: "turnaround", label: "Turnaround / Shutdown", group: "Oil & gas — downstream / process" },
  { slug: "fcc-unit", label: "FCC Unit", group: "Oil & gas — downstream / process" },
  { slug: "crude-distillation", label: "Crude Distillation Unit", group: "Oil & gas — downstream / process" },
  { slug: "hydrocracker", label: "Hydrocracker / Hydrotreater", group: "Oil & gas — downstream / process" },
  { slug: "sulfur-recovery", label: "Sulfur Recovery Unit", group: "Oil & gas — downstream / process" },
  { slug: "gas-treatment", label: "Gas Treatment / Amine", group: "Oil & gas — downstream / process" },
  { slug: "hydrogen-unit", label: "Hydrogen Production Unit", group: "Oil & gas — downstream / process" },
  { slug: "flare-system", label: "Flare System", group: "Oil & gas — downstream / process" },
  { slug: "process-safety", label: "Process Safety (PSM / OSHA 1910.119)", group: "Oil & gas — downstream / process" },
  { slug: "hazop-pha", label: "HAZOP / PHA Facilitation", group: "Oil & gas — downstream / process" },
  { slug: "sil-assessment", label: "SIL / SIS Assessment", group: "Oil & gas — downstream / process" },
  {
    slug: "oil-gas-downstream-experience",
    label: "Oil & Gas — Downstream / Refinery Experience",
    group: "Oil & gas — downstream / process",
    description: "Refinery turnaround inspection, FCC, hydrotreater units.",
    synonyms: ["refinery", "downstream", "turnaround", "ta"],
  },
  {
    slug: "lng-cryogenic",
    label: "LNG & Cryogenic",
    group: "Oil & gas — downstream / process",
    description: "LNG plant / terminal inspection, cryogenic systems.",
    synonyms: ["lng", "cryogenic"],
  },

  // ── Power & renewables ────────────────────────────────────────────
  { slug: "fossil-power", label: "Fossil Power Plant", group: "Power & renewables" },
  { slug: "combined-cycle", label: "Combined-Cycle Plant", group: "Power & renewables" },
  { slug: "nuclear-power", label: "Nuclear Power Plant", group: "Power & renewables" },
  { slug: "hydro-power", label: "Hydroelectric", group: "Power & renewables" },
  { slug: "wind-onshore", label: "Wind — Onshore", group: "Power & renewables" },
  { slug: "wind-offshore", label: "Wind — Offshore", group: "Power & renewables" },
  { slug: "wind-blade", label: "Wind Blade Inspection", group: "Power & renewables" },
  { slug: "solar-pv", label: "Solar PV", group: "Power & renewables" },
  { slug: "csp-solar", label: "Concentrated Solar Power (CSP)", group: "Power & renewables" },
  { slug: "battery-storage", label: "Battery Energy Storage (BESS)", group: "Power & renewables" },
  { slug: "hydrogen-electrolyser", label: "Hydrogen Electrolyser", group: "Power & renewables" },
  { slug: "geothermal", label: "Geothermal", group: "Power & renewables" },
  { slug: "transmission-tower", label: "Transmission Tower", group: "Power & renewables" },
  { slug: "substation-audit", label: "Substation Audit", group: "Power & renewables" },
  {
    slug: "power-generation-conventional",
    label: "Power Generation (Conventional)",
    group: "Power & renewables",
    description: "Boilers, HRSGs, steam turbines, BOP inspection.",
    synonyms: ["power gen", "boiler", "hrsg", "steam turbine"],
  },
  {
    slug: "wind-renewables",
    label: "Wind & Renewables",
    group: "Power & renewables",
    description: "Wind turbine GWO/BTT, solar PV plant inspection.",
    synonyms: ["wind", "gwo", "solar", "pv", "renewables"],
  },
  {
    slug: "nuclear-inspection",
    label: "Nuclear Inspection",
    group: "Power & renewables",
    description: "ASME III, N-stamp work, nuclear-grade NDT.",
    synonyms: ["nuclear", "asme iii", "n-stamp"],
  },

  // ── Marine & offshore ────────────────────────────────────────────
  { slug: "marine-survey", label: "Marine Survey", group: "Marine & offshore" },
  { slug: "cargo-survey", label: "Cargo Survey", group: "Marine & offshore" },
  { slug: "h-h-survey", label: "Hull & Machinery Survey", group: "Marine & offshore" },
  { slug: "p-i-survey", label: "P&I Survey", group: "Marine & offshore" },
  { slug: "class-survey", label: "Class Survey (DNV, ABS, LR, BV)", group: "Marine & offshore" },
  { slug: "underwater-inspection", label: "Underwater / Diver Inspection", group: "Marine & offshore" },
  { slug: "rov-inspection", label: "ROV Inspection", group: "Marine & offshore" },
  { slug: "sims", label: "Structural Integrity Mgmt (SIM)", group: "Marine & offshore" },
  { slug: "mooring-inspection", label: "Mooring & Anchor Inspection", group: "Marine & offshore" },
  { slug: "cathodic-marine", label: "Marine Cathodic Protection", group: "Marine & offshore" },
  {
    slug: "subsea-inspection",
    label: "Subsea Inspection",
    group: "Marine & offshore",
    description: "ROV/diver-based subsea structure + pipeline inspection.",
    synonyms: ["subsea", "rov", "underwater inspection"],
  },

  // ── Lifting & rigging ────────────────────────────────────────────
  { slug: "leea-foundation", label: "LEEA Foundation", group: "Lifting & rigging" },
  { slug: "leea-general", label: "LEEA General Lifting", group: "Lifting & rigging" },
  { slug: "leea-overhead", label: "LEEA Overhead Cranes", group: "Lifting & rigging" },
  { slug: "leea-mewp", label: "LEEA MEWP", group: "Lifting & rigging" },
  { slug: "crane-inspection", label: "Crane Inspection (ASME B30)", group: "Lifting & rigging" },
  { slug: "wire-rope-inspection", label: "Wire Rope Inspection", group: "Lifting & rigging" },
  { slug: "lifting-gear", label: "Lifting Gear / Slings", group: "Lifting & rigging" },
  { slug: "rigging-loft", label: "Rigging Loft Audit", group: "Lifting & rigging" },
  { slug: "forklift-thorough", label: "Forklift Thorough Examination", group: "Lifting & rigging" },
  {
    slug: "lifting-gear-cranes",
    label: "Lifting Gear & Cranes",
    group: "Lifting & rigging",
    description: "LOLER thorough exam, crane / sling / shackle inspection.",
    synonyms: ["cranes", "lifting", "loler", "slings"],
  },

  // ── Aerospace & defense ────────────────────────────────────────────
  { slug: "nas-410", label: "NAS 410 NDT", group: "Aerospace & defense" },
  { slug: "easa-part-145", label: "EASA Part-145", group: "Aerospace & defense" },
  { slug: "faa-airframe", label: "FAA Airframe / Powerplant", group: "Aerospace & defense" },
  { slug: "composite-inspect", label: "Composite Inspection", group: "Aerospace & defense" },
  { slug: "engine-overhaul", label: "Engine Overhaul", group: "Aerospace & defense" },
  { slug: "mil-std-2154", label: "MIL-STD-2154", group: "Aerospace & defense" },

  // ── Quality, safety & systems ────────────────────────────────────────────
  {
    slug: "iso-9001-auditor",
    label: "ISO 9001 Lead Auditor",
    group: "Quality, safety & systems",
    description: "Lead auditor — QMS audits to ISO 9001.",
    synonyms: ["iso 9001", "qms", "lead auditor"],
  },
  {
    slug: "iso-14001-auditor",
    label: "ISO 14001 Lead Auditor",
    group: "Quality, safety & systems",
    description: "Environmental management system auditing.",
    synonyms: ["iso 14001", "ems"],
  },
  {
    slug: "iso-45001-auditor",
    label: "ISO 45001 Lead Auditor",
    group: "Quality, safety & systems",
    description: "Occupational H&S management system auditing.",
    synonyms: ["iso 45001", "ohsas"],
  },
  { slug: "iso-17020-auditor", label: "ISO 17020 (Inspection Bodies)", group: "Quality, safety & systems" },
  { slug: "iso-17025-auditor", label: "ISO 17025 (Test Labs)", group: "Quality, safety & systems" },
  { slug: "iso-iec-19011", label: "ISO 19011 Auditing", group: "Quality, safety & systems" },
  { slug: "osha-30", label: "OSHA 30 Construction", group: "Quality, safety & systems" },
  { slug: "osha-510", label: "OSHA 510", group: "Quality, safety & systems" },
  { slug: "nebosh-igc", label: "NEBOSH IGC", group: "Quality, safety & systems" },
  { slug: "nebosh-diploma", label: "NEBOSH Diploma", group: "Quality, safety & systems" },
  { slug: "iosh-managing", label: "IOSH Managing Safely", group: "Quality, safety & systems" },
  { slug: "six-sigma-black", label: "Six Sigma Black Belt", group: "Quality, safety & systems" },
  { slug: "fmea-rcm", label: "FMEA / RCM", group: "Quality, safety & systems" },
  { slug: "rcfa", label: "Root Cause Failure Analysis", group: "Quality, safety & systems" },
  { slug: "qa-qc-management", label: "QA / QC Management", group: "Quality, safety & systems" },
  { slug: "document-control", label: "Document Control", group: "Quality, safety & systems" },
  { slug: "witness-inspection", label: "Witness / Source Inspection", group: "Quality, safety & systems" },
  { slug: "vendor-surveillance", label: "Vendor Surveillance", group: "Quality, safety & systems" },
  { slug: "expediting", label: "Expediting", group: "Quality, safety & systems" },
  {
    slug: "rope-access-irata-sprat",
    label: "Rope Access (IRATA / SPRAT)",
    group: "Quality, safety & systems",
    description: "IRATA L1/L2/L3 or SPRAT-certified rope access work.",
    synonyms: ["irata", "sprat", "rope access"],
  },
  {
    slug: "confined-space-entry",
    label: "Confined Space Entry",
    group: "Quality, safety & systems",
    description: "Confined-space attendant / entrant / supervisor.",
    synonyms: ["confined space", "cse"],
  },
  {
    slug: "osha-authorised-person",
    label: "OSHA / Authorised Person",
    group: "Quality, safety & systems",
    description: "OSHA 30, scaffold competent person, fall protection.",
    synonyms: ["osha", "osha 30", "authorised person"],
  },
  {
    slug: "hse-management",
    label: "HSE Management",
    group: "Quality, safety & systems",
    description: "On-site HSE oversight, permit-to-work, audits.",
    synonyms: ["hse", "safety", "ehs"],
  },
  {
    slug: "qaqc-management",
    label: "QA/QC Management",
    group: "Quality, safety & systems",
    description: "Project QA/QC plans, ITPs, dossiers, MDR/QDR closeout.",
    synonyms: ["qaqc", "qa", "qc", "itp", "mdr"],
  },

  // ── Special domains ────────────────────────────────────────────
  { slug: "mining", label: "Mining", group: "Special domains" },
  { slug: "tunneling", label: "Tunneling", group: "Special domains" },
  { slug: "rail-track", label: "Rail Track / Rolling Stock", group: "Special domains" },
  { slug: "fire-protection", label: "Fire Protection Systems", group: "Special domains" },
  { slug: "sprinkler-nfpa", label: "NFPA Sprinkler", group: "Special domains" },
  { slug: "food-pharma", label: "Food & Pharma (GMP)", group: "Special domains" },
  { slug: "cleanroom", label: "Cleanroom Validation", group: "Special domains" },
  { slug: "environmental-audit", label: "Environmental Audit", group: "Special domains" },
  { slug: "asbestos-survey", label: "Asbestos Survey", group: "Special domains" },
  { slug: "lead-paint", label: "Lead Paint Survey", group: "Special domains" },
  { slug: "water-treatment", label: "Water / Wastewater Treatment", group: "Special domains" },
  { slug: "desalination", label: "Desalination", group: "Special domains" },
  { slug: "cement-plant", label: "Cement Plant", group: "Special domains" },
  { slug: "glass-manufacturing", label: "Glass Manufacturing", group: "Special domains" },
  { slug: "pulp-paper", label: "Pulp & Paper", group: "Special domains" },
  { slug: "steel-mill", label: "Steel Mill", group: "Special domains" },
  { slug: "automotive-mfg", label: "Automotive Manufacturing", group: "Special domains" },
  { slug: "shipbuilding", label: "Shipbuilding", group: "Special domains" },
  { slug: "composites-aerospace", label: "Aerospace Composites", group: "Special domains" },

  // ── Chemical & process ────────────────────────────────────────────
  {
    slug: "psm",
    label: "Process Safety Management (PSM)",
    group: "Chemical & process",
    description: "OSHA 1910.119 PSM compliance auditing and program implementation.",
    synonyms: ["psm", "osha 1910.119", "process safety"],
  },
  {
    slug: "mechanical-integrity",
    label: "Mechanical Integrity (MI)",
    group: "Chemical & process",
    description: "MI program inspection per OSHA 1910.119(j) — equipment criticality, inspection planning, RBI integration.",
    synonyms: ["mi", "mechanical integrity", "rbi", "osha 1910.119(j)"],
  },
  {
    slug: "pha-hazop",
    label: "Process Hazard Analysis (PHA / HAZOP)",
    group: "Chemical & process",
    description: "HAZOP, what-if, LOPA, FMEA facilitation and team leadership for process hazard reviews.",
    synonyms: ["pha", "hazop", "lopa", "what-if", "fmea", "process hazard"],
  },
  {
    slug: "pressure-relief-devices",
    label: "Pressure Relief Device Inspection",
    group: "Chemical & process",
    description: "Pressure safety valve (PSV), rupture disc, and conservation vent testing per API 576 / ASME PTC 25.",
    synonyms: ["psv", "prv", "relief valve", "rupture disc", "api 576", "pop test"],
  },
  {
    slug: "heat-exchanger-inspection",
    label: "Heat Exchanger Inspection",
    group: "Chemical & process",
    description: "Tube bundle, shell, channel head, and tubesheet inspection — eddy current, IRIS, hydrostatic testing.",
    synonyms: ["heat exchanger", "shell and tube", "tube bundle", "iris", "hx turnaround"],
  },
  {
    slug: "ldar",
    label: "LDAR (Leak Detection & Repair)",
    group: "Chemical & process",
    description: "Fugitive emissions inspection per EPA Method 21 — connector/valve/flange surveys, recordkeeping, optical gas imaging.",
    synonyms: ["ldar", "leak detection", "epa method 21", "fugitive emissions", "ogi"],
  },

];

// ─────────────────────────────────────────────────────────────────────
//  GROUPS — taxonomy structure. Titles are stable strings stored in
//  inspection_domains.default_specialty_groups; do not rename.
// ─────────────────────────────────────────────────────────────────────

export const GROUPS: readonly SpecialtyGroup[] = [
  {
    title: "NDT methods",
    disciplineSlugs: [
      "ndt-ut",
      "ndt-paut",
      "ndt-tofd",
      "ndt-rt",
      "ndt-dr",
      "ndt-ct",
      "ndt-mt",
      "ndt-pt",
      "ndt-vt",
      "ndt-et",
      "ndt-rfet",
      "ndt-nrft",
      "ndt-irt",
      "ndt-lt",
      "ndt-ae",
      "ndt-guided-wave",
      "ndt-iris",
      "ndt-mfl",
      "ndt-ecpit",
      "ndt-hardness",
      "ndt-pmi",
      "ndt-ferrite",
      "ndt-borescope",
      "ndt-replication",
    ],
  },
  {
    title: "API standards",
    disciplineSlugs: [
      "api-510",
      "api-570",
      "api-653",
      "api-1169",
      "api-577",
      "api-580",
      "api-581",
      "api-936",
      "api-571",
      "api-574",
      "api-575",
      "api-576",
      "api-578",
      "api-579",
      "api-510-rsp",
      "api-source-fixed",
      "api-source-electrical",
      "api-source-rotating",
      "api-source-coatings",
      "api-icp-tank",
      "api-icp-aboveground",
    ],
  },
  {
    title: "Welding & joining",
    disciplineSlugs: [
      "aws-cwi",
      "aws-scwi",
      "aws-cawi",
      "aws-cwe",
      "aws-cwsupervisor",
      "cswip-3-1",
      "cswip-3-2",
      "cswip-3-2-2",
      "iwe",
      "iws",
      "iwt",
      "asme-section-ix",
      "wps-pqr",
      "welder-qualification",
      "orbital-welding",
      "tig-gtaw",
      "mig-gmaw",
      "smaw",
      "fcaw",
      "saw",
      "brazing",
      "metallurgy-materials-engineering",
    ],
  },
  {
    title: "Coatings & corrosion",
    disciplineSlugs: [
      "nace-cip-1",
      "nace-cip-2",
      "nace-cip-3",
      "nace-pcs-1",
      "nace-pcs-2",
      "nace-cp-1",
      "nace-cp-2",
      "nace-cp-3",
      "nace-cp-4",
      "sspc-pci",
      "sspc-bci",
      "sspc-cas",
      "icorr-coatings",
      "frosio",
      "corrosion-monitoring",
      "galvanic-survey",
      "cathodic-protection",
      "cui",
      "painting",
      "blast-cleaning",
      "galvanizing",
      "corrosion-engineering",
      "bgas-cswip-coating",
    ],
  },
  {
    title: "Pressure equipment & boilers",
    disciplineSlugs: [
      "asme-bpvc-i",
      "asme-bpvc-iv",
      "asme-bpvc-viii-1",
      "asme-bpvc-viii-2",
      "asme-bpvc-viii-3",
      "asme-bpvc-x",
      "asme-bpvc-xi",
      "asme-bpvc-xii",
      "pressure-relief",
      "boiler-startup",
      "heat-exchanger",
      "reactor-vessel",
      "columns-towers",
      "air-cooled-hx",
      "cryogenic-vessels",
      "hydrostatic-test",
      "asme-section-viii",
    ],
  },
  {
    title: "Piping & pipelines",
    disciplineSlugs: [
      "asme-b31-1",
      "asme-b31-3",
      "asme-b31-4",
      "asme-b31-5",
      "asme-b31-8",
      "asme-b31-9",
      "asme-b31-12",
      "pipeline-integrity",
      "pipeline-construction",
      "pipeline-pigging",
      "pipeline-hydrotest",
      "pipeline-coating",
      "directional-drilling",
      "subsea-pipeline",
      "fiber-optic-leak",
      "asme-b31",
      "pigging-ili",
    ],
  },
  {
    title: "Storage tanks",
    disciplineSlugs: [
      "tank-floor-scan",
      "tank-shell-ut",
      "tank-roof",
      "tank-foundation",
      "tank-internal",
      "tank-external",
      "lng-tank",
      "cryo-tank",
      "spherical-tank",
      "bullet-tank",
    ],
  },
  {
    title: "Mechanical & rotating",
    disciplineSlugs: [
      "rotating-equipment",
      "pumps-centrifugal",
      "pumps-reciprocating",
      "compressors-centrifugal",
      "compressors-reciprocating",
      "gas-turbines",
      "steam-turbines",
      "gearboxes",
      "vibration-analysis",
      "lubrication",
      "alignment-laser",
      "balancing-field",
      "hvac-mechanical",
      "rotating-equipment-inspection",
      "gas-turbine-inspection",
      "valves-actuators",
    ],
  },
  {
    title: "Electrical & instrumentation",
    disciplineSlugs: [
      "electrical-inspection",
      "hazardous-area-ex",
      "compex-foundation",
      "compex-ex01-04",
      "compex-ex05-06",
      "compex-ex11-12",
      "high-voltage",
      "thermography-electrical",
      "instrumentation",
      "plc-scada",
      "cable-fault",
      "partial-discharge",
      "earthing-bonding",
      "instrumentation-control",
      "ex-atex-iecex-inspection",
    ],
  },
  {
    title: "Civil & structural",
    disciplineSlugs: [
      "structural-steel",
      "concrete-inspection",
      "rebar-scanning",
      "post-tension",
      "bridge-inspection",
      "high-rise",
      "foundation",
      "seismic-assessment",
      "rope-access-l1",
      "rope-access-l2",
      "rope-access-l3",
      "scaffolding-inspector",
      "masonry",
      "geotechnical",
      "soil-testing",
      "tank-foundation-bunds",
    ],
  },
  {
    title: "Oil & gas — upstream",
    disciplineSlugs: [
      "drilling-rig",
      "well-completions",
      "wellhead-xmas",
      "mud-logging",
      "wireline",
      "fracking",
      "subsea-equipment",
      "offshore-platform",
      "fpso",
      "jackup-rig",
      "semi-submersible",
      "oil-gas-upstream-experience",
      "oil-gas-midstream-experience",
    ],
  },
  {
    title: "Oil & gas — downstream / process",
    disciplineSlugs: [
      "refinery",
      "petrochemical",
      "lng-plant",
      "turnaround",
      "fcc-unit",
      "crude-distillation",
      "hydrocracker",
      "sulfur-recovery",
      "gas-treatment",
      "hydrogen-unit",
      "flare-system",
      "process-safety",
      "hazop-pha",
      "sil-assessment",
      "oil-gas-downstream-experience",
      "lng-cryogenic",
    ],
  },
  {
    title: "Power & renewables",
    disciplineSlugs: [
      "fossil-power",
      "combined-cycle",
      "nuclear-power",
      "hydro-power",
      "wind-onshore",
      "wind-offshore",
      "wind-blade",
      "solar-pv",
      "csp-solar",
      "battery-storage",
      "hydrogen-electrolyser",
      "geothermal",
      "transmission-tower",
      "substation-audit",
      "power-generation-conventional",
      "wind-renewables",
      "nuclear-inspection",
    ],
  },
  {
    title: "Marine & offshore",
    disciplineSlugs: [
      "marine-survey",
      "cargo-survey",
      "h-h-survey",
      "p-i-survey",
      "class-survey",
      "underwater-inspection",
      "rov-inspection",
      "sims",
      "mooring-inspection",
      "cathodic-marine",
      "subsea-inspection",
    ],
  },
  {
    title: "Lifting & rigging",
    disciplineSlugs: [
      "leea-foundation",
      "leea-general",
      "leea-overhead",
      "leea-mewp",
      "crane-inspection",
      "wire-rope-inspection",
      "lifting-gear",
      "rigging-loft",
      "forklift-thorough",
      "lifting-gear-cranes",
    ],
  },
  {
    title: "Aerospace & defense",
    disciplineSlugs: [
      "nas-410",
      "easa-part-145",
      "faa-airframe",
      "composite-inspect",
      "engine-overhaul",
      "mil-std-2154",
    ],
  },
  {
    title: "Quality, safety & systems",
    disciplineSlugs: [
      "iso-9001-auditor",
      "iso-14001-auditor",
      "iso-45001-auditor",
      "iso-17020-auditor",
      "iso-17025-auditor",
      "iso-iec-19011",
      "osha-30",
      "osha-510",
      "nebosh-igc",
      "nebosh-diploma",
      "iosh-managing",
      "six-sigma-black",
      "fmea-rcm",
      "rcfa",
      "qa-qc-management",
      "document-control",
      "witness-inspection",
      "vendor-surveillance",
      "expediting",
      "rope-access-irata-sprat",
      "confined-space-entry",
      "osha-authorised-person",
      "hse-management",
      "qaqc-management",
    ],
  },
  {
    title: "Special domains",
    disciplineSlugs: [
      "mining",
      "tunneling",
      "rail-track",
      "fire-protection",
      "sprinkler-nfpa",
      "food-pharma",
      "cleanroom",
      "environmental-audit",
      "asbestos-survey",
      "lead-paint",
      "water-treatment",
      "desalination",
      "cement-plant",
      "glass-manufacturing",
      "pulp-paper",
      "steel-mill",
      "automotive-mfg",
      "shipbuilding",
      "composites-aerospace",
    ],
  },
  {
    title: "Chemical & process",
    disciplineSlugs: [
      "psm",
      "mechanical-integrity",
      "pha-hazop",
      "pressure-relief-devices",
      "heat-exchanger-inspection",
      "ldar",
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────
//  DERIVED LOOKUPS — built once at module init.
// ─────────────────────────────────────────────────────────────────────

export const SPECIALTY_BY_SLUG: ReadonlyMap<string, Specialty> = new Map(
  DISCIPLINES.map((s) => [s.slug, s]),
);

export const GROUP_BY_TITLE: ReadonlyMap<GroupTitle, SpecialtyGroup> = new Map(
  GROUPS.map((g) => [g.title, g]),
);

export const SPECIALTY_LABEL_BY_SLUG: Readonly<Record<string, string>> =
  Object.fromEntries(DISCIPLINES.map((s) => [s.slug, s.label]));

/** Type guard — true if `slug` is a known canonical specialty. */
export function isKnownSpecialty(slug: string): boolean {
  return SPECIALTY_BY_SLUG.has(slug);
}

/** Returns the canonical Specialty for `slug`, or null if unknown. */
export function getSpecialty(slug: string): Specialty | null {
  return SPECIALTY_BY_SLUG.get(slug) ?? null;
}

/** Returns the SpecialtyGroup for `title`, or null if unknown. */
export function getSpecialtyGroup(title: string): SpecialtyGroup | null {
  return GROUP_BY_TITLE.get(title as GroupTitle) ?? null;
}

/**
 * Prefix used by the mobile "custom specialty" feature when a user
 * types a free-form discipline that isn't in the canonical list.
 * Persisted slugs of the form `custom_<base64>` are NOT looked up via
 * isKnownSpecialty() and are rendered with their stored label.
 */
export const CUSTOM_SLUG_PREFIX = 'custom_';

// ─────────────────────────────────────────────────────────────────────
//  LEGACY SHAPES — kept for source-compat with both consumer files.
//  Prefer DISCIPLINES + GROUPS in new code.
// ─────────────────────────────────────────────────────────────────────

export interface LegacyGroupView {
  readonly title: GroupTitle;
  readonly items: ReadonlyArray<{ readonly slug: string; readonly label: string }>;
}

/** {title, items: [{slug, label}]} view — matches the old web shape. */
export const SPECIALTY_GROUPS: readonly LegacyGroupView[] = GROUPS.map((g) => ({
  title: g.title,
  items: g.disciplineSlugs.map((slug) => ({
    slug,
    label: SPECIALTY_LABEL_BY_SLUG[slug],
  })),
}));

/** Flat list of every {slug, label}. Matches old web ALL_SPECIALTIES. */
export const ALL_SPECIALTIES: ReadonlyArray<{ slug: string; label: string }> =
  DISCIPLINES.map((d) => ({ slug: d.slug, label: d.label }));
