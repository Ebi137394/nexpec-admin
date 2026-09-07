'use server';

// ════════════════════════════════════════════════════════════════════════════
//  cvSuggestions.ts — read an inspector's own CV and propose field values.
//
//  Admin opens Inspector 360 -> "Review CV" -> suggestions with the exact line
//  each came from, beside the value currently on file -> admin ticks what is
//  right -> the existing secure admin-edit action saves it.
//
//  SECURITY, in the order it is enforced:
//
//   1. Admin authority is re-checked SERVER-SIDE via nx_is_admin(). The caller
//      being on an admin page proves nothing.
//   2. The document is addressed by the CANONICAL COLUMN (profiles.resume_path)
//      read from the database. No caller-supplied path or URL is ever fetched,
//      so this cannot be turned into a server-side request forgery.
//   3. Size, page and time ceilings are applied before and during parsing.
//   4. The CV text NEVER leaves this process: it is not logged, not persisted,
//      not returned in full, and not sent to any external service. Only the
//      short evidence line for each suggestion is returned.
//   5. Nothing is written here. Applying a suggestion goes through
//      adminEditProfile, keeping one audited write path with one field
//      allowlist.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  deriveSuggestions,
  CV_MAX_BYTES,
  CV_MAX_PAGES,
  CV_PARSE_TIMEOUT_MS,
  type CvSuggestion,
  type CvClaim,
} from '@/lib/cv/extract';

const RESUME_BUCKET = 'resumes';

export interface CvReviewResult {
  ok: boolean;
  /** Safe to show the admin. Never contains CV text beyond evidence lines. */
  error?: string;
  suggestions?: (CvSuggestion & { current: string | null; differs: boolean })[];
  claims?: CvClaim[];
  meta?: { pages: number; chars: number; truncated: boolean; fileName: string };
}

function asDisplay(v: string | string[]): string {
  return Array.isArray(v) ? v.join(', ') : v;
}

export async function reviewInspectorCv(userId: string): Promise<CvReviewResult> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    return { ok: false, error: 'Invalid user id.' };
  }

  const supabase = await createSupabaseServerClient();

  // 1. Server-side admin check.
  const { data: isAdmin } = await supabase.rpc('nx_is_admin');
  if (isAdmin !== true) {
    return { ok: false, error: 'Not authorised.' };
  }

  // 2. Canonical path from the database — never from the caller.
  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select(
      'resume_path, professional_title, phone, location, location_city, ' +
        'years_of_experience, ndt_methods, specialty_slugs',
    )
    .eq('id', userId)
    .maybeSingle();

  if (pErr || !profile) return { ok: false, error: 'Could not load that user.' };

  const path = (profile as { resume_path?: string | null }).resume_path;
  if (!path) {
    return { ok: false, error: 'This user has no CV on file yet.' };
  }

  // 3. Download server-side from the PRIVATE bucket. The bytes never reach the
  //    browser and no public URL is minted.
  const { data: blob, error: dErr } = await supabase.storage
    .from(RESUME_BUCKET)
    .download(path);

  if (dErr || !blob) {
    return { ok: false, error: 'The CV could not be opened from storage.' };
  }
  if (blob.size > CV_MAX_BYTES) {
    return {
      ok: false,
      error: `That CV is ${(blob.size / 1024 / 1024).toFixed(1)} MB, above the ${
        CV_MAX_BYTES / 1024 / 1024
      } MB limit for automatic reading. Review it by hand.`,
    };
  }

  const lower = path.toLowerCase();
  if (!lower.endsWith('.pdf')) {
    // Honest limitation rather than a fallback that pretends to work.
    return {
      ok: false,
      error:
        'Automatic reading currently supports PDF only. Open the CV and edit the ' +
        'fields by hand.',
    };
  }

  let text = '';
  let pages = 0;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());

    // 4. Bounded parse. A malformed or hostile PDF must not hold a request
    //    open indefinitely.
    const parse = (async () => {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const doc = await getDocumentProxy(bytes);
      pages = doc.numPages ?? 0;
      if (pages > CV_MAX_PAGES) {
        throw new Error(`TOO_MANY_PAGES:${pages}`);
      }
      const res = await extractText(doc, { mergePages: true });
      return Array.isArray(res.text) ? res.text.join('\n') : res.text;
    })();

    text = await Promise.race([
      parse,
      new Promise<string>((_, rej) =>
        setTimeout(() => rej(new Error('TIMEOUT')), CV_PARSE_TIMEOUT_MS),
      ),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.startsWith('TOO_MANY_PAGES:')) {
      return {
        ok: false,
        error: `That CV has ${msg.split(':')[1]} pages, above the ${CV_MAX_PAGES}-page limit. Review it by hand.`,
      };
    }
    if (msg === 'TIMEOUT') {
      return { ok: false, error: 'Reading that CV took too long. Review it by hand.' };
    }
    // Deliberately does not echo the parser error, which can contain document
    // content.
    return {
      ok: false,
      error:
        'That PDF could not be read as text. Scanned or image-only CVs are not ' +
        'supported — review it by hand.',
    };
  }

  if (!text || text.trim().length < 40) {
    return {
      ok: false,
      error:
        'No selectable text was found. This is usually a scanned CV, which is ' +
        'not supported — review it by hand.',
    };
  }

  const extraction = deriveSuggestions(text);

  // 5. Pair each suggestion with what is CURRENTLY on file, so the admin is
  //    deciding a change rather than approving a value blind.
  const row = profile as unknown as Record<string, unknown>;
  const currentOf = (field: string): string | null => {
    if (field === 'location') {
      const l = (row.location as string | null) ?? (row.location_city as string | null);
      return l && String(l).trim() ? String(l) : null;
    }
    const v = row[field];
    if (v == null) return null;
    if (Array.isArray(v)) return v.length ? v.join(', ') : null;
    return String(v).trim() ? String(v) : null;
  };

  const suggestions = extraction.suggestions.map((s) => {
    const current = currentOf(s.field);
    return { ...s, current, differs: current !== asDisplay(s.value) };
  });

  return {
    ok: true,
    suggestions,
    claims: extraction.claims,
    meta: {
      pages,
      chars: extraction.charCount,
      truncated: extraction.truncated,
      fileName: path.split('/').pop() ?? 'CV',
    },
  };
}
