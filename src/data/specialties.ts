// ════════════════════════════════════════════════════════════════════════════
//  src/data/specialties.ts
//  NEXPEC — Specialty taxonomy (Phase 1 data).
//
//  Single source of truth for the industrial-inspection discipline tree
//  used by:
//    • job-post screens (clients/agencies pick which specialties a job needs)
//    • inspector profile-edit (inspectors pick which specialties they cover)
//    • job feed matching (server-side intersection of the two arrays)
//
//  Why a separate taxonomy from `skills` and `required_certifications`?
//  ───────────────────────────────────────────────────────────────────
//    • `skills`           = free-form personal skills text array (legacy)
//    • `required_certifications` = formal credentials (CWI, API 510, etc.)
//    • SPECIALTIES (this file) = a controlled, slug-keyed taxonomy of
//      DISCIPLINES — the "what kind of inspection work is this?" axis.
//
//  Discipline = a slug, a display name, a group, and search synonyms.
//  The slug is the canonical identifier; display names can be localised
//  later without breaking joins or queries.
//
//  Adding a specialty:
//    1. Pick a stable lowercase snake_case slug. NEVER rename an existing slug.
//    2. Append a new SpecialtyOption to `SPECIALTIES`.
//    3. Add it to the corresponding group's `disciplineSlugs` in
//       `SPECIALTY_GROUPS` (or create a new group).
//    4. Add 2–4 search synonyms (industry abbreviations, alt spellings).
//
//  Renaming a display name is safe. Renaming a slug is NOT — slugs are
//  written into jobs.specialty_slugs and profiles.specialty_slugs and a
//  rename strands existing rows.
// ════════════════════════════════════════════════════════════════════════════

export interface SpecialtyOption {
  /** Stable identifier. Lowercase snake_case. NEVER mutate after release. */
  slug: string;
  /** Display name shown in the UI (English; localise via i18n later). */
  name: string;
  /** One-line description used in pickers + tooltips. */
  description: string;
  /** Group slug this specialty belongs to (see SPECIALTY_GROUPS). */
  group: SpecialtyGroupSlug;
  /**
   * Lowercase tokens the search bar matches in addition to `name` —
   * common industry abbreviations, alternate spellings, related cert
   * codes. Keep tight; over-broad synonyms cause false positives.
   */
  synonyms: string[];
}

export type SpecialtyGroupSlug =
  | 'welding_materials'
  | 'ndt'
  | 'pressure_equipment'
  | 'coatings_corrosion'
  | 'rotating_mechanical'
  | 'electrical_instrumentation'
  | 'civil_structural'
  | 'safety_access'
  | 'qaqc_audit'
  | 'subsea_pipeline'
  | 'energy_specific'
  // Layer 5 — Chemical & Process Engineering domain. Six foundational
  // disciplines (PSM, MI, PHA, relief devices, heat exchangers, LDAR).
  | 'chemical_process';

export interface SpecialtyGroup {
  slug: SpecialtyGroupSlug;
  name: string;
  /** Slugs of disciplines in this group, in display order. */
  disciplineSlugs: string[];
}

// ─── DISCIPLINES ──────────────────────────────────────────────────────────

export const SPECIALTIES: readonly SpecialtyOption[] = [
  // ── Welding & Materials ────────────────────────────────────────────────
  {
    slug: 'welding_inspection_cwi',
    name: 'Welding Inspection (CWI)',
    description: 'Visual + procedure-based weld inspection per AWS D1.1 / D1.5.',
    group: 'welding_materials',
    synonyms: ['cwi', 'aws cwi', 'weld inspector', 'aws d1.1'],
  },
  {
    slug: 'welding_inspection_cswip',
    name: 'Welding Inspection (CSWIP)',
    description: 'CSWIP 3.1 / 3.2 welding inspection competence.',
    group: 'welding_materials',
    synonyms: ['cswip', 'cswip 3.1', 'cswip 3.2'],
  },
  {
    slug: 'metallurgy',
    name: 'Metallurgy & Materials Engineering',
    description: 'Failure analysis, material selection, hardness/PMI testing.',
    group: 'welding_materials',
    synonyms: ['materials', 'pmi', 'positive material id', 'hardness testing'],
  },
  {
    slug: 'corrosion_engineering',
    name: 'Corrosion Engineering',
    description: 'Corrosion mechanism diagnosis, CP design, monitoring.',
    group: 'welding_materials',
    synonyms: ['corrosion', 'cp', 'cathodic protection'],
  },

  // ── NDT ────────────────────────────────────────────────────────────────
  {
    slug: 'ndt_ultrasonic',
    name: 'NDT — Ultrasonic (UT)',
    description: 'Conventional + phased-array UT, TOFD.',
    group: 'ndt',
    synonyms: ['ut', 'ultrasonic', 'phased array', 'paut', 'tofd'],
  },
  {
    slug: 'ndt_radiography',
    name: 'NDT — Radiography (RT)',
    description: 'Film + digital radiography, CR/DR.',
    group: 'ndt',
    synonyms: ['rt', 'radiography', 'x-ray', 'gamma', 'cr', 'dr'],
  },
  {
    slug: 'ndt_magnetic_particle',
    name: 'NDT — Magnetic Particle (MT)',
    description: 'Wet/dry fluorescent + visible magnetic particle inspection.',
    group: 'ndt',
    synonyms: ['mt', 'mpi', 'magnetic particle'],
  },
  {
    slug: 'ndt_liquid_penetrant',
    name: 'NDT — Liquid Penetrant (PT)',
    description: 'Visible + fluorescent dye penetrant inspection.',
    group: 'ndt',
    synonyms: ['pt', 'dpi', 'dye penetrant', 'liquid penetrant'],
  },
  {
    slug: 'ndt_eddy_current',
    name: 'NDT — Eddy Current (ET)',
    description: 'Eddy current array, tube inspection.',
    group: 'ndt',
    synonyms: ['et', 'eddy current', 'eca', 'tube inspection'],
  },
  {
    slug: 'ndt_visual',
    name: 'NDT — Visual (VT)',
    description: 'ASNT/SNT-TC-1A Level II visual inspection.',
    group: 'ndt',
    synonyms: ['vt', 'visual inspection'],
  },
  {
    slug: 'ndt_thickness_uts',
    name: 'NDT — Ultrasonic Thickness',
    description: 'UTM corrosion mapping and B-scan thickness surveys.',
    group: 'ndt',
    synonyms: ['utm', 'thickness survey', 'corrosion mapping'],
  },

  // ── Pressure Equipment ─────────────────────────────────────────────────
  {
    slug: 'api_510_pressure_vessels',
    name: 'API 510 — Pressure Vessels',
    description: 'In-service inspection, repair, alteration of pressure vessels.',
    group: 'pressure_equipment',
    synonyms: ['api 510', 'pressure vessel', 'vessel inspection'],
  },
  {
    slug: 'api_570_piping',
    name: 'API 570 — Piping',
    description: 'In-service inspection of process piping circuits.',
    group: 'pressure_equipment',
    synonyms: ['api 570', 'piping inspector', 'process piping'],
  },
  {
    slug: 'api_653_storage_tanks',
    name: 'API 653 — Aboveground Storage Tanks',
    description: 'Tank inspection, repair, alteration, reconstruction.',
    group: 'pressure_equipment',
    synonyms: ['api 653', 'ast', 'storage tank', 'tank inspector'],
  },
  {
    slug: 'api_580_rbi',
    name: 'API 580 / 581 — Risk-Based Inspection',
    description: 'Quantitative + qualitative RBI program design and review.',
    group: 'pressure_equipment',
    synonyms: ['api 580', 'api 581', 'rbi', 'risk based inspection'],
  },
  {
    slug: 'asme_section_viii',
    name: 'ASME Section VIII (Pressure Vessels)',
    description: 'Code review for unfired pressure vessels.',
    group: 'pressure_equipment',
    synonyms: ['asme viii', 'asme section 8', 'pressure vessel code'],
  },
  {
    slug: 'asme_b31_piping',
    name: 'ASME B31 — Piping Codes',
    description: 'B31.1 power piping, B31.3 process piping, B31.4/8 pipelines.',
    group: 'pressure_equipment',
    synonyms: ['asme b31', 'b31.1', 'b31.3', 'b31.4', 'b31.8'],
  },

  // ── Coatings & Corrosion ───────────────────────────────────────────────
  {
    slug: 'coating_inspection_nace',
    name: 'Coating Inspection (NACE / AMPP)',
    description: 'NACE CIP 1/2/3 / AMPP coatings inspection.',
    group: 'coatings_corrosion',
    synonyms: ['nace', 'ampp', 'cip', 'coating inspector'],
  },
  {
    slug: 'coating_inspection_bgas',
    name: 'Coating Inspection (BGAS-CSWIP)',
    description: 'BGAS-CSWIP painting inspector certification.',
    group: 'coatings_corrosion',
    synonyms: ['bgas', 'bgas-cswip', 'painting inspector'],
  },
  {
    slug: 'cathodic_protection',
    name: 'Cathodic Protection',
    description: 'CP design, install, monitoring (NACE CP).',
    group: 'coatings_corrosion',
    synonyms: ['cp', 'cathodic protection', 'nace cp'],
  },

  // ── Rotating & Mechanical ──────────────────────────────────────────────
  {
    slug: 'rotating_equipment',
    name: 'Rotating Equipment',
    description: 'Pumps, compressors, gearboxes, alignment, condition monitoring.',
    group: 'rotating_mechanical',
    synonyms: ['rotating', 'compressor', 'pump', 'gearbox'],
  },
  {
    slug: 'gas_turbine_inspection',
    name: 'Gas Turbine Inspection',
    description: 'Boroscope, hot-gas-path, combustor inspection on industrial turbines.',
    group: 'rotating_mechanical',
    synonyms: ['gas turbine', 'gt', 'boroscope', 'hot gas path'],
  },
  {
    slug: 'vibration_analysis',
    name: 'Vibration Analysis',
    description: 'Cat I/II/III/IV vibration analysis on rotating machinery.',
    group: 'rotating_mechanical',
    synonyms: ['vibration', 'iso 18436', 'condition monitoring'],
  },
  {
    slug: 'lifting_cranes',
    name: 'Lifting Gear & Cranes',
    description: 'LOLER thorough exam, crane / sling / shackle inspection.',
    group: 'rotating_mechanical',
    synonyms: ['cranes', 'lifting', 'loler', 'slings'],
  },
  {
    slug: 'valves_actuators',
    name: 'Valves & Actuators',
    description: 'PSV/PRV pop-testing, control valve maintenance.',
    group: 'rotating_mechanical',
    synonyms: ['valves', 'psv', 'prv', 'actuators'],
  },

  // ── Electrical & Instrumentation ───────────────────────────────────────
  {
    slug: 'electrical_inspection',
    name: 'Electrical Inspection',
    description: 'LV/HV systems, switchgear, motor testing.',
    group: 'electrical_instrumentation',
    synonyms: ['electrical', 'switchgear', 'hv', 'lv'],
  },
  {
    slug: 'instrumentation_control',
    name: 'Instrumentation & Control',
    description: 'Loop testing, calibration, SIS / SIL verification.',
    group: 'electrical_instrumentation',
    synonyms: ['instrumentation', 'i&c', 'sil', 'sis', 'calibration'],
  },
  {
    slug: 'plc_scada',
    name: 'PLC / SCADA / DCS',
    description: 'Industrial control system review and FAT/SAT.',
    group: 'electrical_instrumentation',
    synonyms: ['plc', 'scada', 'dcs', 'fat', 'sat'],
  },
  {
    slug: 'thermography',
    name: 'Thermography (Infrared)',
    description: 'IR thermal surveys on electrical + mechanical equipment.',
    group: 'electrical_instrumentation',
    synonyms: ['thermography', 'ir', 'infrared', 'thermal imaging'],
  },
  {
    slug: 'ex_inspection_atex_iecex',
    name: 'Ex / ATEX / IECEx Inspection',
    description: 'Hazardous-area electrical equipment inspection (EN 60079-17).',
    group: 'electrical_instrumentation',
    synonyms: ['atex', 'iecex', 'ex inspection', 'hazardous area'],
  },

  // ── Civil & Structural ─────────────────────────────────────────────────
  {
    slug: 'structural_steel',
    name: 'Structural Steel',
    description: 'Structural fabrication + erection inspection.',
    group: 'civil_structural',
    synonyms: ['steel', 'structural', 'fabrication'],
  },
  {
    slug: 'concrete_inspection',
    name: 'Concrete Inspection',
    description: 'Reinforced concrete inspection, NDT on concrete.',
    group: 'civil_structural',
    synonyms: ['concrete', 'rebar', 'rc'],
  },
  {
    slug: 'bridge_inspection',
    name: 'Bridge Inspection',
    description: 'Highway + rail bridge condition assessment.',
    group: 'civil_structural',
    synonyms: ['bridges', 'bridge inspector'],
  },
  {
    slug: 'tank_inspection_civil',
    name: 'Tank Foundation / Bunds',
    description: 'Civil aspects of storage-tank foundations and bunds.',
    group: 'civil_structural',
    synonyms: ['bunds', 'foundations'],
  },

  // ── Safety, HSE & Rope Access ──────────────────────────────────────────
  {
    slug: 'hse_management',
    name: 'HSE Management',
    description: 'On-site HSE oversight, permit-to-work, audits.',
    group: 'safety_access',
    synonyms: ['hse', 'safety', 'ehs'],
  },
  {
    slug: 'rope_access_irata',
    name: 'Rope Access (IRATA / SPRAT)',
    description: 'IRATA L1/L2/L3 or SPRAT-certified rope access work.',
    group: 'safety_access',
    synonyms: ['irata', 'sprat', 'rope access'],
  },
  {
    slug: 'confined_space',
    name: 'Confined Space Entry',
    description: 'Confined-space attendant / entrant / supervisor.',
    group: 'safety_access',
    synonyms: ['confined space', 'cse'],
  },
  {
    slug: 'osha_authority',
    name: 'OSHA / Authorised Person',
    description: 'OSHA 30, scaffold competent person, fall protection.',
    group: 'safety_access',
    synonyms: ['osha', 'osha 30', 'authorised person'],
  },

  // ── QA/QC & Audit ──────────────────────────────────────────────────────
  {
    slug: 'qaqc_management',
    name: 'QA / QC Management',
    description: 'Project QA/QC plans, ITPs, dossiers, MDR/QDR closeout.',
    group: 'qaqc_audit',
    synonyms: ['qaqc', 'qa', 'qc', 'itp', 'mdr'],
  },
  {
    slug: 'iso_9001_audit',
    name: 'ISO 9001 Auditing',
    description: 'Lead auditor — QMS audits to ISO 9001.',
    group: 'qaqc_audit',
    synonyms: ['iso 9001', 'qms', 'lead auditor'],
  },
  {
    slug: 'iso_45001_audit',
    name: 'ISO 45001 Auditing',
    description: 'Occupational H&S management system auditing.',
    group: 'qaqc_audit',
    synonyms: ['iso 45001', 'ohsas'],
  },
  {
    slug: 'iso_14001_audit',
    name: 'ISO 14001 Auditing',
    description: 'Environmental management system auditing.',
    group: 'qaqc_audit',
    synonyms: ['iso 14001', 'ems'],
  },

  // ── Subsea & Pipeline ──────────────────────────────────────────────────
  {
    slug: 'pipeline_integrity',
    name: 'Pipeline Integrity',
    description: 'Onshore/offshore pipeline integrity management.',
    group: 'subsea_pipeline',
    synonyms: ['pipeline', 'integrity', 'pim'],
  },
  {
    slug: 'subsea_inspection',
    name: 'Subsea Inspection',
    description: 'ROV/diver-based subsea structure + pipeline inspection.',
    group: 'subsea_pipeline',
    synonyms: ['subsea', 'rov', 'underwater inspection'],
  },
  {
    slug: 'pigging_ili',
    name: 'Pigging & In-Line Inspection',
    description: 'ILI tool runs, MFL / UT pigging programs.',
    group: 'subsea_pipeline',
    synonyms: ['pigging', 'ili', 'mfl'],
  },

  // ── Energy-Specific ────────────────────────────────────────────────────
  {
    slug: 'oil_gas_upstream',
    name: 'Oil & Gas — Upstream',
    description: 'Wellhead, separator, production-train inspection.',
    group: 'energy_specific',
    synonyms: ['upstream', 'wellhead', 'production'],
  },
  {
    slug: 'oil_gas_midstream',
    name: 'Oil & Gas — Midstream',
    description: 'Compressor stations, terminals, midstream piping.',
    group: 'energy_specific',
    synonyms: ['midstream', 'terminal', 'compressor station'],
  },
  {
    slug: 'oil_gas_downstream',
    name: 'Oil & Gas — Downstream (Refinery)',
    description: 'Refinery turnaround inspection, FCC, hydrotreater units.',
    group: 'energy_specific',
    synonyms: ['refinery', 'downstream', 'turnaround', 'ta'],
  },
  {
    slug: 'lng_cryogenic',
    name: 'LNG & Cryogenic',
    description: 'LNG plant / terminal inspection, cryogenic systems.',
    group: 'energy_specific',
    synonyms: ['lng', 'cryogenic'],
  },
  {
    slug: 'power_generation',
    name: 'Power Generation (Conventional)',
    description: 'Boilers, HRSGs, steam turbines, BOP inspection.',
    group: 'energy_specific',
    synonyms: ['power gen', 'boiler', 'hrsg', 'steam turbine'],
  },
  {
    slug: 'wind_renewables',
    name: 'Wind & Renewables',
    description: 'Wind turbine GWO/BTT, solar PV plant inspection.',
    group: 'energy_specific',
    synonyms: ['wind', 'gwo', 'solar', 'pv', 'renewables'],
  },
  {
    slug: 'nuclear_inspection',
    name: 'Nuclear Inspection',
    description: 'ASME III, N-stamp work, nuclear-grade NDT.',
    group: 'energy_specific',
    synonyms: ['nuclear', 'asme iii', 'n-stamp'],
  },

  // ── Chemical & Process ────────────────────────────────────────────────
  {
    slug: 'process_safety_management',
    name: 'Process Safety Management (PSM)',
    description: 'OSHA 1910.119 PSM compliance auditing and program implementation.',
    group: 'chemical_process',
    synonyms: ['psm', 'osha 1910.119', 'process safety'],
  },
  {
    slug: 'mechanical_integrity_program',
    name: 'Mechanical Integrity (MI)',
    description: 'MI program inspection per OSHA 1910.119(j) — equipment criticality, inspection planning, RBI integration.',
    group: 'chemical_process',
    synonyms: ['mi', 'mechanical integrity', 'rbi', 'osha 1910.119(j)'],
  },
  {
    slug: 'process_hazard_analysis',
    name: 'Process Hazard Analysis (PHA / HAZOP)',
    description: 'HAZOP, what-if, LOPA, FMEA facilitation and team leadership for process hazard reviews.',
    group: 'chemical_process',
    synonyms: ['pha', 'hazop', 'lopa', 'what-if', 'fmea', 'process hazard'],
  },
  {
    slug: 'pressure_relief_inspection',
    name: 'Pressure Relief Device Inspection',
    description: 'Pressure safety valve (PSV), rupture disc, and conservation vent testing per API 576 / ASME PTC 25.',
    group: 'chemical_process',
    synonyms: ['psv', 'prv', 'relief valve', 'rupture disc', 'api 576', 'pop test'],
  },
  {
    slug: 'heat_exchanger_inspection',
    name: 'Heat Exchanger Inspection',
    description: 'Tube bundle, shell, channel head, and tubesheet inspection — eddy current, IRIS, hydrostatic testing.',
    group: 'chemical_process',
    synonyms: ['heat exchanger', 'shell and tube', 'tube bundle', 'iris', 'hx turnaround'],
  },
  {
    slug: 'ldar_leak_detection',
    name: 'LDAR (Leak Detection & Repair)',
    description: 'Fugitive emissions inspection per EPA Method 21 — connector/valve/flange surveys, recordkeeping, optical gas imaging.',
    group: 'chemical_process',
    synonyms: ['ldar', 'leak detection', 'epa method 21', 'fugitive emissions', 'ogi'],
  },
];

// ─── GROUPS ───────────────────────────────────────────────────────────────

export const SPECIALTY_GROUPS: readonly SpecialtyGroup[] = [
  {
    slug: 'welding_materials',
    name: 'Welding & Materials',
    disciplineSlugs: [
      'welding_inspection_cwi',
      'welding_inspection_cswip',
      'metallurgy',
      'corrosion_engineering',
    ],
  },
  {
    slug: 'ndt',
    name: 'NDT',
    disciplineSlugs: [
      'ndt_ultrasonic',
      'ndt_radiography',
      'ndt_magnetic_particle',
      'ndt_liquid_penetrant',
      'ndt_eddy_current',
      'ndt_visual',
      'ndt_thickness_uts',
    ],
  },
  {
    slug: 'pressure_equipment',
    name: 'Pressure Equipment',
    disciplineSlugs: [
      'api_510_pressure_vessels',
      'api_570_piping',
      'api_653_storage_tanks',
      'api_580_rbi',
      'asme_section_viii',
      'asme_b31_piping',
    ],
  },
  {
    slug: 'coatings_corrosion',
    name: 'Coatings & Corrosion',
    disciplineSlugs: [
      'coating_inspection_nace',
      'coating_inspection_bgas',
      'cathodic_protection',
    ],
  },
  {
    slug: 'rotating_mechanical',
    name: 'Rotating & Mechanical',
    disciplineSlugs: [
      'rotating_equipment',
      'gas_turbine_inspection',
      'vibration_analysis',
      'lifting_cranes',
      'valves_actuators',
    ],
  },
  {
    slug: 'electrical_instrumentation',
    name: 'Electrical & Instrumentation',
    disciplineSlugs: [
      'electrical_inspection',
      'instrumentation_control',
      'plc_scada',
      'thermography',
      'ex_inspection_atex_iecex',
    ],
  },
  {
    slug: 'civil_structural',
    name: 'Civil & Structural',
    disciplineSlugs: [
      'structural_steel',
      'concrete_inspection',
      'bridge_inspection',
      'tank_inspection_civil',
    ],
  },
  {
    slug: 'safety_access',
    name: 'Safety & Access',
    disciplineSlugs: [
      'hse_management',
      'rope_access_irata',
      'confined_space',
      'osha_authority',
    ],
  },
  {
    slug: 'qaqc_audit',
    name: 'QA/QC & Audit',
    disciplineSlugs: [
      'qaqc_management',
      'iso_9001_audit',
      'iso_45001_audit',
      'iso_14001_audit',
    ],
  },
  {
    slug: 'subsea_pipeline',
    name: 'Subsea & Pipeline',
    disciplineSlugs: [
      'pipeline_integrity',
      'subsea_inspection',
      'pigging_ili',
    ],
  },
  {
    slug: 'energy_specific',
    name: 'Energy-Specific',
    disciplineSlugs: [
      'oil_gas_upstream',
      'oil_gas_midstream',
      'oil_gas_downstream',
      'lng_cryogenic',
      'power_generation',
      'wind_renewables',
      'nuclear_inspection',
    ],
  },
  {
    // Layer 5 — Chemical & Process Engineering domain. Mirrors the
    // 'Chemical & process' group in apps/web/src/lib/data/specialtyTaxonomy.ts.
    // Referenced by inspection_domains.default_specialty_groups for the
    // 'chemical_process' row.
    slug: 'chemical_process',
    name: 'Chemical & Process',
    disciplineSlugs: [
      'process_safety_management',
      'mechanical_integrity_program',
      'process_hazard_analysis',
      'pressure_relief_inspection',
      'heat_exchanger_inspection',
      'ldar_leak_detection',
    ],
  },
];

// ─── LOOKUPS + HELPERS ───────────────────────────────────────────────────

/** O(1) lookup by slug. */
const SPECIALTY_BY_SLUG: Map<string, SpecialtyOption> = new Map(
  SPECIALTIES.map((s) => [s.slug, s]),
);

const GROUP_BY_SLUG: Map<SpecialtyGroupSlug, SpecialtyGroup> = new Map(
  SPECIALTY_GROUPS.map((g) => [g.slug, g]),
);

export function getSpecialtyBySlug(slug: string): SpecialtyOption | undefined {
  return SPECIALTY_BY_SLUG.get(slug);
}

export function getGroupBySlug(slug: SpecialtyGroupSlug): SpecialtyGroup | undefined {
  return GROUP_BY_SLUG.get(slug);
}

// ─── CUSTOM (FREE-TEXT) SPECIALTIES ──────────────────────────────────────
//
// The controlled taxonomy can't cover every niche discipline an inspector
// might claim (e.g. "API 580 Niche Auditor", "Subsea ROV Pilot — Trimix").
// Forcing inspectors to misrepresent themselves is worse for matching than
// admitting a tiny escape hatch.
//
// Custom slugs are written into the SAME column (jobs/profiles.specialty_slugs)
// as canonical slugs, prefixed with `custom_` so they're trivially
// separable for analytics and for a future "promote popular customs into
// the canonical taxonomy" workflow.
//
// Rules:
//   • Slug body: ascii-lowered, non-alphanumeric → underscore, collapsed,
//     trimmed. Length-capped to 64 chars to keep the column tidy.
//   • Slug must be non-empty after sanitisation; empty → null.
//   • Display name is reconstructed from the slug body via prettifySlug.
//
// The matcher treats custom slugs as opaque tokens — exact-equality match
// only. Two inspectors who type the same custom label converge on the
// same slug; two inspectors who type slightly different labels (extra
// space, hyphen vs space) ALSO converge thanks to the sanitiser.

export const CUSTOM_SLUG_PREFIX = 'custom_';
const CUSTOM_SLUG_MAX_BODY_LEN = 64;

export function isCustomSlug(slug: string): boolean {
  return typeof slug === 'string' && slug.startsWith(CUSTOM_SLUG_PREFIX);
}

/**
 * Sanitises a free-text label into a canonical custom slug. Returns
 * `null` when the input doesn't yield any usable characters (purely
 * punctuation / whitespace) — callers MUST handle that to avoid writing
 * a bare `custom_` token.
 *
 * Examples:
 *   slugifyCustomLabel('API 580 Niche Auditor')   → 'custom_api_580_niche_auditor'
 *   slugifyCustomLabel('Subsea — Trimix (ROV)')    → 'custom_subsea_trimix_rov'
 *   slugifyCustomLabel('   ')                      → null
 *   slugifyCustomLabel('custom_already_prefixed')  → 'custom_already_prefixed'  (idempotent)
 */
export function slugifyCustomLabel(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Idempotency: a value that already looks like a custom slug is
  // returned as-is after a re-sanitise of its body. This protects
  // callers who roundtrip a slug through the input field.
  const bodyRaw = isCustomSlug(trimmed)
    ? trimmed.slice(CUSTOM_SLUG_PREFIX.length)
    : trimmed;

  const body = bodyRaw
    .toLowerCase()
    // Non-alphanumeric → single underscore. Includes hyphens, em-dashes,
    // parentheses, smart quotes. ASCII-folded — we deliberately drop
    // diacritics rather than transliterating: matching is more reliable
    // when everyone strips them, and inspectors writing in scripts that
    // need transliteration should add a canonical specialty instead.
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    // Collapse repeats + trim edges.
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, CUSTOM_SLUG_MAX_BODY_LEN);

  if (!body) return null;
  return CUSTOM_SLUG_PREFIX + body;
}

/**
 * Inverse of slugifyCustomLabel — best-effort. Pulls the body off,
 * splits on underscore, title-cases each word, joins with spaces.
 * Used for rendering custom slugs (and any orphan/unknown slugs) when
 * the canonical lookup misses.
 *
 * Examples:
 *   prettifySlug('custom_api_580_niche_auditor') → 'Api 580 Niche Auditor'
 *   prettifySlug('ndt_ultrasonic')                → 'NDT — Ultrasonic (UT)'   (canonical hit)
 *   prettifySlug('unknown_legacy_token')          → 'Unknown Legacy Token'    (orphan, but renderable)
 */
export function prettifySlug(slug: string): string {
  if (typeof slug !== 'string' || !slug) return '';

  // Canonical wins.
  const canonical = SPECIALTY_BY_SLUG.get(slug);
  if (canonical) return canonical.name;

  // Custom / orphan path — strip the known custom prefix if present.
  const body = isCustomSlug(slug)
    ? slug.slice(CUSTOM_SLUG_PREFIX.length)
    : slug;

  if (!body) return '';

  return body
    .split('_')
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Unified display-name resolver used by every UI surface that renders
 * a specialty slug. Always returns a non-empty string for any non-empty
 * input — never returns the raw slug, never throws.
 *
 * Consumers should reach for this rather than calling getSpecialtyBySlug
 * directly when they only need the name.
 */
export function getSpecialtyDisplayName(slug: string): string {
  return prettifySlug(slug);
}

/**
 * Searches the taxonomy. `query` is matched case-insensitively against
 * each specialty's name + synonyms. An empty query returns all entries.
 * If `groupSlug` is provided, the result is intersected with that group.
 */
export function searchSpecialties(
  query: string,
  groupSlug?: SpecialtyGroupSlug | null,
): SpecialtyOption[] {
  const q = query.trim().toLowerCase();
  let pool: readonly SpecialtyOption[] = SPECIALTIES;
  if (groupSlug) {
    pool = pool.filter((s) => s.group === groupSlug);
  }
  if (!q) return [...pool];
  return pool.filter((s) => {
    if (s.name.toLowerCase().includes(q)) return true;
    return s.synonyms.some((syn) => syn.toLowerCase().includes(q));
  });
}

/**
 * Best-effort migration helper: maps a free-form legacy specialty/skill
 * string to its canonical slug, or `null` if no plausible match exists.
 * The SQL backfill uses the same logic — keep this in sync if the
 * tokenisation rule changes.
 */
export function resolveLegacySpecialty(legacy: string): string | null {
  if (!legacy) return null;
  const norm = legacy.trim().toLowerCase();
  if (!norm) return null;

  // 1. Exact name match (case-insensitive)
  for (const s of SPECIALTIES) {
    if (s.name.toLowerCase() === norm) return s.slug;
  }
  // 2. Exact synonym match
  for (const s of SPECIALTIES) {
    if (s.synonyms.includes(norm)) return s.slug;
  }
  // 3. Substring containment — first name that contains the legacy
  //    token. We deliberately do NOT do reverse-substring (legacy
  //    contains name) to avoid mapping "NDT: Ultrasonic (UT) certified"
  //    to anything other than ultrasonic.
  for (const s of SPECIALTIES) {
    if (s.name.toLowerCase().includes(norm)) return s.slug;
  }
  return null;
}
