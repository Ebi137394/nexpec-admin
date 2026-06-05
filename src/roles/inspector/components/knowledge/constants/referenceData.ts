// src/components/inspector/knowledge/constants/referenceData.ts

export interface Standard {
  id: string;
  code: string;
  title: string;
  organization: 'API' | 'ASME' | 'ISO' | 'AWS' | 'NACE';
  version: string;
  scope: string;
  keyPoints: string[];
  relatedCodes: string[];
  tags: string[];
}

export interface GlossaryTerm {
  id: string;
  term: string;
  abbreviation?: string;
  definition: string;
  category: 'defect' | 'process' | 'material' | 'measurement' | 'safety' | 'method';
  relatedTerms: string[];
  standardRefs: string[];
  severity?: 'info' | 'caution' | 'critical';
}

export const STANDARDS_DATA: Standard[] = [
  {
    id: 'std-001',
    code: 'API 570',
    title: 'Piping Inspection Code: In-Service Inspection, Rating, Repair, and Alteration of Piping Systems',
    organization: 'API',
    version: '4th Edition, February 2016',
    scope:
      'Covers inspection, repair, alteration, and rerating of metallic and fiberglass-reinforced plastic (FRP) piping systems and their respective pressure relieving devices that have been placed in service for use in petroleum refineries, chemical plants, natural gas processing plants, and related industries.',
    keyPoints: [
      'Applies to piping systems operating above 15 psig or above 400°F',
      'Defines inspection intervals based on corrosion rates and remaining life calculations',
      'Covers both on-stream and shutdown inspection methods',
      'Requires a Risk-Based Inspection (RBI) program or prescriptive intervals',
      'Establishes minimum qualifications for Piping Inspectors (API 570 certified)',
      'Addresses injection points, mixing points, and deadlegs as high-priority areas',
    ],
    relatedCodes: ['API 574', 'ASME B31.3', 'API 571', 'API 580'],
    tags: ['piping', 'in-service', 'inspection', 'repair', 'corrosion', 'RBI'],
  },
  {
    id: 'std-002',
    code: 'API 653',
    title: 'Tank Inspection, Repair, Alteration, and Reconstruction',
    organization: 'API',
    version: '5th Edition, November 2014 (Addendum 2, 2018)',
    scope:
      'Covers steel aboveground storage tanks built to API 650, API 12C, and other recognized industry standards. Provides minimum requirements for maintaining the integrity of welded or riveted, non-refrigerated, atmospheric pressure, aboveground storage tanks after they have been placed in service.',
    keyPoints: [
      'Defines routine, formal, and RBI-based inspection schedules',
      'Shell thickness evaluation using UT measurements and minimum thickness formulas',
      'Bottom plate evaluation including floor scan and MFL techniques',
      'Settlement evaluation criteria and foundation integrity',
      'Hot tap and on-stream repair procedures',
      'Reconstruction and relocation requirements',
      'Tank roof inspection including floating roof seals and fittings',
    ],
    relatedCodes: ['API 650', 'API 651', 'API 652', 'API 575'],
    tags: ['tank', 'storage', 'aboveground', 'atmospheric', 'settlement', 'floor scan'],
  },
  {
    id: 'std-003',
    code: 'ASME B31.3',
    title: 'Process Piping',
    organization: 'ASME',
    version: '2022 Edition',
    scope:
      'Prescribes requirements for materials and components, design, fabrication, assembly, erection, examination, inspection, and testing of piping systems for chemical, petroleum, textile, paper, semiconductor, cryogenic, and related processing plants and terminals.',
    keyPoints: [
      'Categorizes fluids into Category D, Category M, High-Pressure, and Normal service',
      'Defines allowable stresses for pipe materials at various temperatures',
      'Specifies wall thickness calculation formulas including corrosion allowance',
      'Welding procedure qualification per ASME Section IX',
      'NDE requirements based on fluid category and service conditions',
      'Flexibility analysis and sustained/occasional stress evaluation',
      'Pressure testing requirements (hydrostatic, pneumatic, or initial service)',
    ],
    relatedCodes: ['ASME Section IX', 'ASME Section V', 'ASME B16.5', 'ASME B16.9'],
    tags: ['process piping', 'design', 'fabrication', 'welding', 'NDE', 'pressure test'],
  },
  {
    id: 'std-004',
    code: 'API 571',
    title: 'Damage Mechanisms Affecting Fixed Equipment in the Refining Industry',
    organization: 'API',
    version: '3rd Edition, March 2020',
    scope:
      'Provides detailed descriptions of damage mechanisms commonly found in refinery equipment. Serves as a reference for inspection planning by identifying potential degradation modes and their associated process conditions.',
    keyPoints: [
      'Catalogs 60+ damage mechanisms with appearance, morphology, and critical factors',
      'Covers uniform/localized corrosion, environmental cracking, and high-temp mechanisms',
      'Sulfidation, naphthenic acid corrosion, and chloride SCC detailed',
      'Hydrogen-related damage: HIC, SOHIC, HF alkylation, hydrogen blistering',
      'Creep and stress rupture at elevated temperatures',
      'Mechanical and metallurgical failure modes (fatigue, embrittlement)',
      'Essential companion to API 580/581 RBI methodology',
    ],
    relatedCodes: ['API 580', 'API 581', 'API 570', 'API 510'],
    tags: ['damage mechanisms', 'corrosion', 'cracking', 'refinery', 'degradation', 'RBI'],
  },
  {
    id: 'std-005',
    code: 'API 510',
    title: 'Pressure Vessel Inspection Code: In-Service Inspection, Rating, Repair, and Alteration',
    organization: 'API',
    version: '10th Edition, May 2014 (Addendum 1, 2017)',
    scope:
      'Covers maintenance, inspection, repair, alteration, and rerating procedures for pressure vessels and pressure-relieving devices that have been placed in service. Applies to vessels constructed in accordance with ASME BPVC or other applicable codes.',
    keyPoints: [
      'Internal and external inspection intervals defined by remaining life',
      'Corrosion rate calculation and remaining thickness evaluation',
      'Weld repair procedures including PWHT exemptions where applicable',
      'Pressure test requirements after repair or alteration',
      'Conditions for condemning or rerating a vessel',
      'Qualifications required for API 510 Authorized Inspectors',
      'Supplemental NDE methods: UT, RT, MT, PT, AE',
    ],
    relatedCodes: ['ASME BPVC Section VIII', 'API 572', 'API 571', 'NBIC'],
    tags: ['pressure vessel', 'in-service', 'inspection', 'repair', 'PWHT', 'rerating'],
  },
  {
    id: 'std-006',
    code: 'ISO 19232-1',
    title: 'Non-Destructive Testing, Image Quality of Radiographs, Part 1: Wire-Type IQI',
    organization: 'ISO',
    version: '2013 Edition',
    scope:
      'Specifies the use of wire-type image quality indicators (IQI) to determine radiographic image quality for industrial radiographic testing. Defines wire sizes, placement, and acceptance criteria.',
    keyPoints: [
      'Defines wire IQI sets A through D for various thickness ranges',
      'Specifies placement on source side or film side with appropriate correction',
      'Determines minimum required image quality level (sensitivity)',
      'Complements EN ISO 17636-1 for film radiography and -2 for digital',
      'Tables correlate wall thickness to required visible wire number',
    ],
    relatedCodes: ['ISO 17636-1', 'ISO 17636-2', 'ASTM E747', 'ASME Section V Art. 2'],
    tags: ['radiography', 'NDE', 'IQI', 'image quality', 'film', 'digital'],
  },
  {
    id: 'std-007',
    code: 'ASME Section V',
    title: 'Nondestructive Examination',
    organization: 'ASME',
    version: '2023 Edition',
    scope:
      'Contains requirements and methods for nondestructive examination (NDE) referenced by other ASME code sections. Covers radiographic, ultrasonic, magnetic particle, liquid penetrant, eddy current, visual, leak testing, and acoustic emission methods.',
    keyPoints: [
      'Article 1: General requirements applicable to all NDE methods',
      'Article 2: Radiographic examination of welds',
      'Article 4: Ultrasonic examination (pulse-echo and TOFD)',
      'Article 6: Magnetic particle examination (MT)',
      'Article 7: Liquid penetrant examination (PT)',
      'Article 9: Visual examination requirements',
      'Article 14: PAUT (Phased Array Ultrasonic Testing) requirements',
    ],
    relatedCodes: ['ASME Section VIII', 'ASME Section IX', 'ASME B31.3', 'ASTM E164'],
    tags: ['NDE', 'ultrasonic', 'radiography', 'MT', 'PT', 'PAUT', 'TOFD', 'examination'],
  },
];

export const GLOSSARY_DATA: GlossaryTerm[] = [
  {
    id: 'gls-001',
    term: 'Corrosion',
    definition:
      'The deterioration of a material, usually a metal, by chemical or electrochemical reaction with its environment. In inspection, it is quantified by measuring wall loss over time to determine a corrosion rate (typically in mils per year, mpy).',
    category: 'defect',
    relatedTerms: ['Erosion', 'Pitting', 'Galvanic Corrosion', 'CUI'],
    standardRefs: ['API 571', 'API 570', 'API 510'],
    severity: 'critical',
  },
  {
    id: 'gls-002',
    term: 'Pitting',
    definition:
      'A form of extremely localized corrosion that produces small holes or cavities in the metal surface. Pitting is particularly dangerous because it can cause perforation with minimal overall metal loss. Difficult to detect by UT spot readings alone; requires scanning or grid mapping.',
    category: 'defect',
    relatedTerms: ['Corrosion', 'MIC', 'Chloride Attack'],
    standardRefs: ['API 571', 'API 579-1/ASME FFS-1'],
    severity: 'critical',
  },
  {
    id: 'gls-003',
    term: 'Heat Affected Zone',
    abbreviation: 'HAZ',
    definition:
      'The area of base metal adjacent to a weld that has had its microstructure and mechanical properties altered by the heat of welding. The HAZ is susceptible to cracking, hardness changes, and reduced corrosion resistance depending on material and welding parameters.',
    category: 'process',
    relatedTerms: ['Weld Metal', 'Base Metal', 'PWHT', 'Hardness Testing'],
    standardRefs: ['ASME Section IX', 'AWS D1.1', 'API 571'],
    severity: 'caution',
  },
  {
    id: 'gls-004',
    term: 'Ultrasonic Testing',
    abbreviation: 'UT',
    definition:
      'A non-destructive testing method that uses high-frequency sound waves to detect internal flaws, measure wall thickness, or characterize material properties. The transducer sends a pulse into the material and analyzes the returning echoes for indications of defects.',
    category: 'method',
    relatedTerms: ['PAUT', 'TOFD', 'Shear Wave', 'Straight Beam'],
    standardRefs: ['ASME Section V Art. 4', 'ASTM E164', 'ISO 17640'],
    severity: 'info',
  },
  {
    id: 'gls-005',
    term: 'Corrosion Under Insulation',
    abbreviation: 'CUI',
    definition:
      'External corrosion that occurs on the outer surface of insulated equipment and piping when moisture penetrates damaged or poorly maintained insulation. Most common in carbon steel systems operating between 10°F and 350°F (−12°C to 175°C). Often undetected until insulation is removed or advanced NDE is applied.',
    category: 'defect',
    relatedTerms: ['Corrosion', 'External Inspection', 'Profile Radiography'],
    standardRefs: ['API 570', 'API 571', 'NACE SP0198'],
    severity: 'critical',
  },
  {
    id: 'gls-006',
    term: 'Post Weld Heat Treatment',
    abbreviation: 'PWHT',
    definition:
      'A controlled heating process applied to a weldment after welding to reduce residual stresses, temper hard microstructures in the HAZ, and improve mechanical properties. Required by many codes for certain materials, thicknesses, and service conditions.',
    category: 'process',
    relatedTerms: ['HAZ', 'Stress Relief', 'Preheat', 'Hardness Testing'],
    standardRefs: ['ASME Section VIII', 'ASME B31.3', 'ASME Section IX'],
    severity: 'caution',
  },
  {
    id: 'gls-007',
    term: 'Magnetic Particle Testing',
    abbreviation: 'MT',
    definition:
      'A non-destructive testing method for detecting surface and near-surface discontinuities in ferromagnetic materials. The part is magnetized and fine ferromagnetic particles are applied; they accumulate at discontinuities, forming visible indications. Used extensively on weld surfaces and HAZ.',
    category: 'method',
    relatedTerms: ['PT', 'NDE', 'Surface Breaking Defects', 'Yoke'],
    standardRefs: ['ASME Section V Art. 7', 'ASTM E709', 'ISO 17638'],
    severity: 'info',
  },
  {
    id: 'gls-008',
    term: 'Stress Corrosion Cracking',
    abbreviation: 'SCC',
    definition:
      'The growth of cracks in a material due to the combined and synergistic action of a tensile stress (residual or applied) and a specific corrosive environment. Common forms include chloride SCC in austenitic stainless steels, caustic SCC in carbon steels, and polythionic acid SCC in sensitized stainless steels.',
    category: 'defect',
    relatedTerms: ['HAZ', 'PWHT', 'Environmental Cracking', 'Sensitization'],
    standardRefs: ['API 571', 'API 579-1', 'NACE MR0175'],
    severity: 'critical',
  },
  {
    id: 'gls-009',
    term: 'Fitness-for-Service',
    abbreviation: 'FFS',
    definition:
      'An engineering evaluation methodology used to determine whether equipment containing flaws, damage, or deviations from original design conditions is still safe and suitable for continued operation. API 579-1/ASME FFS-1 provides standardized assessment procedures at three levels of increasing complexity.',
    category: 'measurement',
    relatedTerms: ['Remaining Life', 'MAWP', 'Critical Thickness', 'Level 1/2/3 Assessment'],
    standardRefs: ['API 579-1/ASME FFS-1', 'API 510', 'API 570'],
    severity: 'info',
  },
  {
    id: 'gls-010',
    term: 'Undercut',
    definition:
      'A groove melted into the base metal adjacent to the weld toe or root that is left unfilled by weld metal. Undercut creates a stress concentration and reduces the effective cross-sectional area of the joint, potentially leading to fatigue or stress cracking in service.',
    category: 'defect',
    relatedTerms: ['Weld Defect', 'Toe Crack', 'Lack of Fusion', 'Overlap'],
    standardRefs: ['AWS D1.1', 'ASME Section IX', 'API 1104'],
    severity: 'caution',
  },
  {
    id: 'gls-011',
    term: 'Phased Array Ultrasonic Testing',
    abbreviation: 'PAUT',
    definition:
      'An advanced ultrasonic testing technique using multi-element transducers that can electronically steer and focus the sound beam at multiple angles and focal depths. Provides real-time sectorial scans (S-scans) and linear scans for comprehensive weld and corrosion mapping.',
    category: 'method',
    relatedTerms: ['UT', 'TOFD', 'S-Scan', 'Encoder'],
    standardRefs: ['ASME Section V Art. 4 & 14', 'ISO 13588', 'ASTM E2491'],
    severity: 'info',
  },
  {
    id: 'gls-012',
    term: 'Maximum Allowable Working Pressure',
    abbreviation: 'MAWP',
    definition:
      'The maximum gauge pressure permissible at the top of a pressure vessel in its operating position for a designated temperature. Calculated based on minimum measured thickness, allowable stress, joint efficiency, and corrosion allowance. Rerating requires recalculation per the original construction code.',
    category: 'measurement',
    relatedTerms: ['Design Pressure', 'Hydrotest Pressure', 'Rerating', 'FFS'],
    standardRefs: ['API 510', 'ASME Section VIII Div. 1', 'API 579-1'],
    severity: 'caution',
  },
];

export const CATEGORY_COLORS: Record<GlossaryTerm['category'], string> = {
  defect: '#FF4C6E',
  process: '#6C5CE7',
  material: '#00B894',
  measurement: '#0984E3',
  safety: '#FDCB6E',
  method: '#00CEC9',
};

export const SEVERITY_COLORS: Record<string, string> = {
  info: '#0984E3',
  caution: '#FDCB6E',
  critical: '#FF4C6E',
};

export const ORG_COLORS: Record<Standard['organization'], string> = {
  API: '#FF6B35',
  ASME: '#0984E3',
  ISO: '#00B894',
  AWS: '#E17055',
  NACE: '#6C5CE7',
};