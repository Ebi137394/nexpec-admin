// ════════════════════════════════════════════════════════════════════════════
//  ml/defectTaxonomy.ts — the canonical Universal Defect Ontology
//
//  This is what makes the AI Co-Inspector "universal from Day 1": a single,
//  extensible catalog of industrial defects, each mapped to recognized
//  standards (ISO 4628 / ASTM / AWS / API / ACI / NACE) and to the inspection
//  domains it applies to. The model is a swappable artifact; THIS is the stable
//  contract every model, RPC param set, and UI surface speaks. Adding a new
//  defect = one entry here, consumed identically by web + mobile.
// ════════════════════════════════════════════════════════════════════════════

export type DefectFamily =
  | 'coating'
  | 'metal_loss'
  | 'cracking'
  | 'weld'
  | 'concrete'
  | 'mechanical';

export type DomainSlug =
  | 'industrial_ndt'
  | 'civil_construction'
  | 'electrical'
  | 'mechanical_field'
  | 'chemical_process';

export interface DefectMeta {
  id: string;
  label: string;
  family: DefectFamily;
  domains: DomainSlug[];
  /** Recognized standards an inspector/report cites for this defect. */
  standardRefs: string[];
  /** Default severity scale id (model params may override). */
  severityScale?: string;
  description: string;
}

export const DEFECT_FAMILIES: Record<DefectFamily, { label: string }> = {
  coating: { label: 'Coating & Surface' },
  metal_loss: { label: 'Metal Loss' },
  cracking: { label: 'Cracking' },
  weld: { label: 'Weld Discontinuity' },
  concrete: { label: 'Concrete / Civil' },
  mechanical: { label: 'Mechanical / Integrity' },
};

const D = (m: DefectMeta): DefectMeta => m;

export const DEFECT_TAXONOMY: Record<string, DefectMeta> = {
  corrosion: D({ id: 'corrosion', label: 'Corrosion / Rusting', family: 'coating', domains: ['industrial_ndt', 'mechanical_field', 'chemical_process', 'civil_construction'], standardRefs: ['ISO 4628-3', 'ASTM D610'], severityScale: 'ISO-4628-3', description: 'General oxidation / rusting of a metallic substrate.' }),
  pitting: D({ id: 'pitting', label: 'Pitting Corrosion', family: 'metal_loss', domains: ['industrial_ndt', 'chemical_process', 'mechanical_field'], standardRefs: ['ASTM G46'], severityScale: 'ASTM-G46', description: 'Localized metal loss forming cavities / pits.' }),
  wall_thinning: D({ id: 'wall_thinning', label: 'Wall Thinning / Metal Loss', family: 'metal_loss', domains: ['industrial_ndt', 'chemical_process', 'mechanical_field'], standardRefs: ['API 510', 'API 570', 'API 579'], description: 'General loss of wall thickness (UT-confirmed).' }),
  erosion: D({ id: 'erosion', label: 'Erosion', family: 'metal_loss', domains: ['chemical_process', 'mechanical_field'], standardRefs: ['API 579'], description: 'Mechanical wear / flow-assisted material removal.' }),
  coating_blistering: D({ id: 'coating_blistering', label: 'Coating Blistering', family: 'coating', domains: ['industrial_ndt', 'chemical_process', 'civil_construction'], standardRefs: ['ISO 4628-2', 'ASTM D714'], severityScale: 'ISO-4628-2', description: 'Dome-shaped coating detachment from trapped pressure.' }),
  coating_cracking: D({ id: 'coating_cracking', label: 'Coating Cracking', family: 'coating', domains: ['industrial_ndt', 'civil_construction'], standardRefs: ['ISO 4628-4'], severityScale: 'ISO-4628-4', description: 'Cracking of the coating film.' }),
  coating_flaking: D({ id: 'coating_flaking', label: 'Coating Flaking / Peeling', family: 'coating', domains: ['industrial_ndt', 'civil_construction'], standardRefs: ['ISO 4628-5'], severityScale: 'ISO-4628-5', description: 'Detachment of coating flakes from the substrate.' }),
  coating_disbondment: D({ id: 'coating_disbondment', label: 'Coating Disbondment / Delamination', family: 'coating', domains: ['industrial_ndt', 'chemical_process'], standardRefs: ['ISO 4628', 'ASTM D7234'], description: 'Loss of adhesion between coating and substrate.' }),
  crack: D({ id: 'crack', label: 'Crack (general)', family: 'cracking', domains: ['industrial_ndt', 'mechanical_field', 'chemical_process'], standardRefs: ['ASME V', 'API 579'], description: 'Linear discontinuity / fracture in the base material.' }),
  fatigue_crack: D({ id: 'fatigue_crack', label: 'Fatigue Crack', family: 'cracking', domains: ['industrial_ndt', 'mechanical_field'], standardRefs: ['API 579', 'BS 7910'], description: 'Crack from cyclic loading.' }),
  stress_corrosion_cracking: D({ id: 'stress_corrosion_cracking', label: 'Stress-Corrosion Cracking (SCC)', family: 'cracking', domains: ['chemical_process', 'industrial_ndt'], standardRefs: ['NACE SP0204', 'API 579'], description: 'Cracking from combined tensile stress + corrosive environment.' }),
  weld_porosity: D({ id: 'weld_porosity', label: 'Weld Porosity', family: 'weld', domains: ['industrial_ndt', 'mechanical_field'], standardRefs: ['AWS D1.1', 'ASME IX'], description: 'Gas-pocket voids in the weld metal.' }),
  weld_undercut: D({ id: 'weld_undercut', label: 'Weld Undercut', family: 'weld', domains: ['industrial_ndt', 'mechanical_field'], standardRefs: ['AWS D1.1'], description: 'Groove melted into the base metal at the weld toe.' }),
  weld_incomplete_fusion: D({ id: 'weld_incomplete_fusion', label: 'Incomplete Fusion / Penetration', family: 'weld', domains: ['industrial_ndt', 'mechanical_field'], standardRefs: ['AWS D1.1', 'ASME IX'], description: 'Lack of fusion between weld passes or base metal.' }),
  concrete_crack: D({ id: 'concrete_crack', label: 'Concrete Cracking', family: 'concrete', domains: ['civil_construction'], standardRefs: ['ACI 224.1R'], severityScale: 'ACI-224', description: 'Cracking in concrete (map vs. structural).' }),
  concrete_spalling: D({ id: 'concrete_spalling', label: 'Spalling', family: 'concrete', domains: ['civil_construction'], standardRefs: ['ACI 201.1R'], description: 'Fragmentation / flaking of the concrete surface.' }),
  rebar_exposure: D({ id: 'rebar_exposure', label: 'Rebar Exposure / Corrosion', family: 'concrete', domains: ['civil_construction'], standardRefs: ['ACI 201.1R', 'ASTM C876'], description: 'Exposed or corroding reinforcement.' }),
  efflorescence: D({ id: 'efflorescence', label: 'Efflorescence / Leaching', family: 'concrete', domains: ['civil_construction'], standardRefs: ['ACI 201.1R'], description: 'Salt deposits indicating moisture migration.' }),
  cui_risk: D({ id: 'cui_risk', label: 'Insulation Damage / CUI Risk', family: 'mechanical', domains: ['chemical_process', 'mechanical_field'], standardRefs: ['API 583'], description: 'Damaged insulation / jacketing — corrosion-under-insulation risk.' }),
  leak: D({ id: 'leak', label: 'Leak / Seepage', family: 'mechanical', domains: ['chemical_process', 'mechanical_field'], standardRefs: ['API 570'], description: 'Visible product/fluid escape or staining.' }),
  deformation: D({ id: 'deformation', label: 'Deformation / Dent / Bulge', family: 'mechanical', domains: ['mechanical_field', 'chemical_process', 'civil_construction'], standardRefs: ['API 579'], description: 'Geometric distortion of the component.' }),
};

export function getDefectMeta(id: string): DefectMeta | undefined {
  return DEFECT_TAXONOMY[id];
}

export function allDefects(): DefectMeta[] {
  return Object.values(DEFECT_TAXONOMY);
}

/** The defects relevant to a given inspection domain (UI can filter to these). */
export function defectsForDomain(domain: DomainSlug): DefectMeta[] {
  return Object.values(DEFECT_TAXONOMY).filter((d) => d.domains.includes(domain));
}
