// Tests for CV suggestion derivation.
//
// The properties that matter are the SAFETY ones: a certification mentioned in
// a CV must never become an applyable field, and the loose matching that made
// an earlier draft unusable ("PT" inside "Equipment") must stay fixed.
import { describe, expect, it } from 'vitest';
import { deriveSuggestions, type CvField } from './extract';

const CV = `RAMIN PASHAEI FAKHRI
Senior NDT Inspector
Location: Calgary, Alberta
Phone: +1 403 555 0142
Over 12 years of experience in pipeline integrity.

Methods: UT, RT and Magnetic Particle testing.
Certified ASNT Level II in Ultrasonic Testing.
CSWIP 3.1 Welding Inspector, certificate 998877.

Equipment used: portable department scanners.
`;

const get = (s: ReturnType<typeof deriveSuggestions>, f: CvField) =>
  s.suggestions.find((x) => x.field === f);

describe('deriveSuggestions', () => {
  const out = deriveSuggestions(CV);

  it('reads a professional title from a title-shaped line', () => {
    expect(get(out, 'professional_title')?.value).toBe('Senior NDT Inspector');
  });

  it('reads phone and location only from plainly labelled lines', () => {
    expect(get(out, 'phone')?.value).toBe('+1 403 555 0142');
    expect(get(out, 'location')?.value).toBe('Calgary, Alberta');
  });

  it('reads years of experience', () => {
    expect(get(out, 'years_of_experience')?.value).toBe('12');
  });

  it('matches NDT methods as whole words', () => {
    const m = get(out, 'ndt_methods')?.value as string[];
    expect(m).toContain('ut');
    expect(m).toContain('rt');
    expect(m).toContain('mt');
  });

  it('does NOT match PT inside Equipment or department', () => {
    // The substring bug: "Equipment"/"department" both contain "pt". A CV that
    // never mentions penetrant testing must not claim the method.
    const m = (get(out, 'ndt_methods')?.value as string[]) ?? [];
    expect(m).not.toContain('pt');
  });

  it('NEVER offers a certification as an applyable field', () => {
    // The single most important property here: a certification in a CV is a
    // claim. It may be shown as evidence, never applied, and never verified.
    const fields = out.suggestions.map((s) => s.field as string);
    expect(fields).not.toContain('certifications');
    expect(fields.some((f) => f.includes('cert'))).toBe(false);
    expect(fields.some((f) => f.includes('verif'))).toBe(false);
  });

  it('surfaces certification lines as read-only evidence', () => {
    const texts = out.claims.map((c) => c.text).join(' | ');
    expect(texts).toMatch(/ASNT/);
    expect(texts).toMatch(/CSWIP/);
  });

  it('carries the exact source line for every suggestion', () => {
    // No suggestion may exist without evidence an admin can read.
    for (const s of out.suggestions) {
      expect(s.evidence.length).toBeGreaterThan(0);
      expect(s.line).toBeGreaterThan(0);
    }
  });

  it('invents no confidence score', () => {
    for (const s of out.suggestions) {
      expect(s).not.toHaveProperty('confidence');
      expect(s).not.toHaveProperty('score');
    }
  });

  it('suggests nothing from an empty or contentless CV', () => {
    expect(deriveSuggestions('').suggestions).toHaveLength(0);
    expect(deriveSuggestions('\n\n   \n').suggestions).toHaveLength(0);
  });

  it('does not guess a location from a bare city name in prose', () => {
    // "Worked in Calgary on a shutdown" is not a statement of residence.
    const o = deriveSuggestions('Worked in Calgary on a 2019 shutdown project.');
    expect(get(o, 'location')).toBeUndefined();
  });

  it('rejects a phone-shaped number that is too short to be one', () => {
    const o = deriveSuggestions('Ref +12 345');
    expect(get(o, 'phone')).toBeUndefined();
  });

  it('handles a PDF that extracts as ONE long line without matching the whole document', () => {
    // Found in live testing against a real CV. unpdf returned the entire
    // document as a single line, so per-line matching became per-DOCUMENT
    // matching: every NDT method "matched" and the evidence shown was just the
    // first 300 characters, which did not contain the match at all.
    const oneLine =
      'Ramin Pashaei 437-595-2747 LinkedIn RaminPashaei.1978@gmail.com • PROFILE ' +
      'SUMMARY • Experienced Mechanical Engineer with 22 years in industrial ' +
      'equipment for refineries, power plants, and aerospace • Proven success in ' +
      'renewing efficiency and reducing costs on major projects while expanding pro';
    const o = deriveSuggestions(oneLine);

    // None of these methods appear as words anywhere in that text.
    const m = (get(o, 'ndt_methods')?.value as string[]) ?? [];
    expect(m).toHaveLength(0);

    // "22 years in industrial equipment" IS a statement of experience.
    expect(get(o, 'years_of_experience')?.value).toBe('22');
  });

  it('evidence always contains the value it is evidence for', () => {
    const oneLine =
      'Long preamble that goes on and on about unrelated project history and ' +
      'client names for quite a while before anything useful appears at all, ' +
      'and then finally: Phone: +1 403 555 0142 and more trailing text after it ' +
      'that also runs on for a considerable distance beyond the match itself.';
    const o = deriveSuggestions(oneLine);
    const phone = get(o, 'phone');
    expect(phone).toBeDefined();
    // The window must show the number, not the first 300 characters of prose.
    expect(phone!.evidence).toContain('+1 403 555 0142');
  });

  it('reports truncation instead of silently dropping text', () => {
    const huge = 'Senior NDT Inspector\n' + 'x'.repeat(500_000);
    expect(deriveSuggestions(huge).truncated).toBe(true);
  });
});
