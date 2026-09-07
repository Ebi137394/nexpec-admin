// ════════════════════════════════════════════════════════════════════════════
//  lib/cv/extract.ts — CV text extraction and field SUGGESTIONS.
//
//  Everything here is a SUGGESTION for an admin to look at. Nothing in this
//  file writes anything, and nothing here decides that a claim is true.
//
//  Two rules the whole module is built around:
//
//   1. Every suggestion carries the EXACT LINE it came from. An admin approves
//      a value because they can see the sentence it was read out of, not
//      because a machine scored it. There are deliberately no confidence
//      percentages — an invented number reads as evidence and is not.
//
//   2. A certification found in a CV is a CLAIM, never a verified credential.
//      Certification lines are surfaced as read-only evidence and are NOT
//      offered as applyable fields, so this path cannot mark anything verified.
//
//  Parsing is pure and synchronous so it can be unit-tested without a network,
//  a database or a PDF.
// ════════════════════════════════════════════════════════════════════════════

/** Hard ceilings. A CV is a document, not a payload. */
export const CV_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const CV_MAX_PAGES = 40;
export const CV_MAX_CHARS = 400_000;
export const CV_PARSE_TIMEOUT_MS = 15_000;

export type CvField =
  | 'professional_title'
  | 'phone'
  | 'location'
  | 'years_of_experience'
  | 'ndt_methods'
  | 'specialty_slugs';

export interface CvSuggestion {
  field: CvField;
  /** What we would write. Arrays are joined for display by the caller. */
  value: string | string[];
  /** The verbatim line it was read from. Shown to the admin as evidence. */
  evidence: string;
  /** 1-based line number within the extracted text. */
  line: number;
}

export interface CvClaim {
  /** A certification-looking line. EVIDENCE ONLY — never applyable. */
  text: string;
  line: number;
}

export interface CvExtraction {
  suggestions: CvSuggestion[];
  /** Certification-shaped lines, surfaced but never applyable. */
  claims: CvClaim[];
  charCount: number;
  pageCount: number;
  truncated: boolean;
}

// ── Vocabularies ──────────────────────────────────────────────────────────
// Method codes are matched as WHOLE WORDS. Substring matching turned "PT" into
// a hit inside "Inspection", "Equipment" and "Department".
const NDT_METHODS: Record<string, string> = {
  UT: 'ut', 'ULTRASONIC': 'ut',
  RT: 'rt', 'RADIOGRAPHIC': 'rt', 'RADIOGRAPHY': 'rt',
  MT: 'mt', 'MAGNETIC PARTICLE': 'mt',
  PT: 'pt', 'DYE PENETRANT': 'pt', 'LIQUID PENETRANT': 'pt',
  VT: 'vt', 'VISUAL INSPECTION': 'vt',
  ET: 'et', 'EDDY CURRENT': 'et',
  PAUT: 'paut', 'TOFD': 'tofd',
};

const TITLE_HINTS = [
  'ndt inspector', 'ndt technician', 'qa/qc inspector', 'qaqc inspector',
  'welding inspector', 'senior inspector', 'lead inspector', 'inspection engineer',
  'quality inspector', 'piping inspector', 'coating inspector', 'cwi',
  'mechanical inspector', 'civil inspector', 'electrical inspector',
];

// A certification is a CLAIM. Listed here only so those lines can be shown as
// evidence — never to derive an applyable field.
const CERT_HINTS = [
  'asnt', 'iso 9712', 'pcn', 'cswip', 'aws cwi', 'api 510', 'api 570',
  'api 653', 'nace', 'ampp', 'level ii', 'level iii', 'certified',
];

/** Phone numbers only in an unambiguous international/long form. */
const PHONE_RE = /(\+\d[\d\s().-]{7,}\d)/;
const YEARS_RE = /(\d{1,2})\+?\s*(?:years?|yrs?)\b[^.\n]{0,30}(?:experience|exp\b)/i;
const LOCATION_RE = /^(?:location|address|based\s*(?:in|at)|city)\s*[:\-]\s*(.+)$/i;

function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Derive suggestions from already-extracted text.
 *
 * Deliberately conservative: it is far better to suggest three fields an
 * admin can confirm at a glance than fifteen they must audit. A field is only
 * offered when a line states it plainly.
 */
export function deriveSuggestions(text: string): CvExtraction {
  const truncated = text.length > CV_MAX_CHARS;
  const body = truncated ? text.slice(0, CV_MAX_CHARS) : text;
  const lines = body.split(/\r?\n/);

  const suggestions: CvSuggestion[] = [];
  const claims: CvClaim[] = [];
  const seenFields = new Set<CvField>();
  const methods = new Map<string, { evidence: string; line: number }>();

  const push = (
    field: CvField,
    value: string | string[],
    evidence: string,
    line: number,
  ) => {
    // First plain statement wins. A CV repeats itself, and a later mention is
    // rarely a better source than the first.
    if (seenFields.has(field)) return;
    seenFields.add(field);
    suggestions.push({ field, value, evidence: tidy(evidence).slice(0, 300), line });
  };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const lower = line.toLowerCase();
    const n = i + 1;

    // Phone — international form only.
    const phone = line.match(PHONE_RE);
    const phoneRaw = phone?.[1];
    if (phoneRaw) {
      const digits = phoneRaw.replace(/\D/g, '');
      if (digits.length >= 8 && digits.length <= 15) push('phone', tidy(phoneRaw), line, n);
    }

    // Location — only from an explicitly labelled line. A bare city name in
    // free text is far too easy to confuse with an employer or a project site.
    const locRaw = line.match(LOCATION_RE)?.[1];
    if (locRaw && locRaw.trim().length >= 2) {
      push('location', tidy(locRaw).slice(0, 120), line, n);
    }

    // Years of experience.
    const yrsRaw = line.match(YEARS_RE)?.[1];
    if (yrsRaw) push('years_of_experience', yrsRaw, line, n);

    // Professional title — a short line that IS a title, not a sentence
    // mentioning one.
    if (line.length <= 80) {
      const hit = TITLE_HINTS.find((t) => lower.includes(t));
      if (hit) push('professional_title', tidy(line).slice(0, 120), line, n);
    }

    // NDT methods — whole-word only.
    for (const [needle, slug] of Object.entries(NDT_METHODS)) {
      if (methods.has(slug)) continue;
      const re = new RegExp(`(?:^|[^A-Za-z])${needle.replace(/ /g, '\\s+')}(?:[^A-Za-z]|$)`, 'i');
      if (re.test(line)) methods.set(slug, { evidence: line, line: n });
    }

    // Certification-shaped lines: EVIDENCE ONLY.
    if (CERT_HINTS.some((c) => lower.includes(c)) && claims.length < 40) {
      claims.push({ text: tidy(line).slice(0, 300), line: n });
    }
  });

  const firstMethod = [...methods.values()][0];
  if (firstMethod) {
    const first = firstMethod;
    suggestions.push({
      field: 'ndt_methods',
      value: [...methods.keys()],
      evidence: tidy(first.evidence).slice(0, 300),
      line: first.line,
    });
  }

  return {
    suggestions,
    claims,
    charCount: body.length,
    pageCount: 0,
    truncated,
  };
}

/** Human label for a field, reusing the platform's wording. */
export const CV_FIELD_LABEL: Record<CvField, string> = {
  professional_title: 'Professional title',
  phone: 'Phone',
  location: 'Location',
  years_of_experience: 'Years of experience',
  ndt_methods: 'NDT methods',
  specialty_slugs: 'Specialties',
};

/** Which admin-edit section each field is saved through. */
export const CV_FIELD_SECTION: Record<CvField, 'contact' | 'professional' | 'skills'> = {
  phone: 'contact',
  location: 'contact',
  professional_title: 'professional',
  years_of_experience: 'professional',
  ndt_methods: 'skills',
  specialty_slugs: 'skills',
};
