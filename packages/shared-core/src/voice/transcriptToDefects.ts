// ════════════════════════════════════════════════════════════════════════════
//  voice/transcriptToDefects.ts — $0 taxonomy-driven NLU for the Voice Copilot
//
//  Maps a free-form spoken inspection note (transcribed ON-DEVICE via Whisper /
//  the OS recognizer) → candidate defect findings, by matching against the
//  defect taxonomy's labels + curated synonyms. Pure TS, no model, no API.
// ════════════════════════════════════════════════════════════════════════════

import { allDefects } from '../ml/defectTaxonomy';
import type { DefectDetection } from '../ml/defectResult';

const SYNONYMS: Record<string, string[]> = {
  corrosion: ['corrosion', 'rust', 'rusting', 'rusted', 'oxidation'],
  pitting: ['pit', 'pitting', 'pits'],
  wall_thinning: ['thinning', 'wall loss', 'metal loss', 'thin wall'],
  erosion: ['erosion', 'eroded'],
  coating_blistering: ['blister', 'blistering', 'blisters'],
  coating_cracking: ['coating crack', 'paint crack'],
  coating_flaking: ['flaking', 'peeling', 'peel', 'flake'],
  coating_disbondment: ['disbond', 'disbondment', 'delamination', 'delaminated'],
  crack: ['crack', 'cracking', 'cracked', 'fracture'],
  fatigue_crack: ['fatigue crack', 'fatigue'],
  stress_corrosion_cracking: ['stress corrosion', 'scc'],
  weld_porosity: ['porosity', 'porous', 'gas pocket'],
  weld_undercut: ['undercut'],
  weld_incomplete_fusion: ['incomplete fusion', 'lack of fusion', 'incomplete penetration'],
  concrete_crack: ['concrete crack'],
  concrete_spalling: ['spall', 'spalling', 'spalled'],
  rebar_exposure: ['rebar', 'reinforcement', 'exposed steel'],
  efflorescence: ['efflorescence', 'leaching', 'salt deposit'],
  cui_risk: ['insulation damage', 'cui', 'corrosion under insulation', 'damaged insulation'],
  leak: ['leak', 'leaking', 'seepage', 'seep', 'weeping'],
  deformation: ['dent', 'deformation', 'bulge', 'distortion', 'deformed'],
};

export interface VoiceFindingSuggestion extends DefectDetection {
  matchedPhrase: string;
}

/** Heuristic, $0 mapping from a transcript to candidate defect findings.
 *  Confidence is fixed-low (0.6) — these are *suggestions* the inspector edits. */
export function transcriptToDefects(transcript: string): VoiceFindingSuggestion[] {
  const haystack = ' ' + transcript.toLowerCase() + ' ';
  const seen = new Set<string>();
  const out: VoiceFindingSuggestion[] = [];
  for (const def of allDefects()) {
    const kws = SYNONYMS[def.id] ?? [def.label.toLowerCase()];
    let matched: string | null = null;
    for (const k of kws) {
      if (haystack.includes(k)) { matched = k; break; }
    }
    if (matched && !seen.has(def.id)) {
      seen.add(def.id);
      out.push({
        defectId: def.id,
        label: def.label,
        confidence: 0.6,
        severityScale: def.severityScale,
        standardRefs: def.standardRefs,
        matchedPhrase: matched,
      });
    }
  }
  return out;
}
