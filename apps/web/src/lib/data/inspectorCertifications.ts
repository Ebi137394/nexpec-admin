// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectorCertifications.ts — current inspector's certifications
//
//  Reads from the proper inspector_certifications table (separate from
//  profiles.certifications text[] which the existing chip cloud still uses).
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { InspectorCertification } from './inspectorCertifications.types';

export type { InspectorCertification };

const SIGNED_URL_TTL_SECONDS = 60 * 10;

export async function fetchInspectorCertifications(): Promise<
  InspectorCertification[]
> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('inspector_certifications')
      .select(
        // SCHEMA: four of these are renames onto columns that already existed under
      // other names (certification_type / certification_number / issued_date /
      // expiry_date). The other four were genuinely absent and are added by
      // 20260801524000. Before both changes every read here failed 42703.
        'id, certification_type, issuing_body, certification_number, issued_date, expiry_date, certificate_path, notes, created_at, updated_at',
      )
      .eq('inspector_id', user.id)
      .order('expiry_date', { ascending: true, nullsFirst: false });

    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchInspectorCertifications] failed:', error.message);
      }
      return [];
    }

    const rows = data as unknown as Array<Record<string, unknown>>;
    const items: InspectorCertification[] = [];
    for (const r of rows) {
      const path = (r.certificate_path as string | null) ?? null;
      let signedUrl: string | null = null;
      if (path) {
        const { data: signed } = await supabase.storage
          .from('inspector_credentials')
          .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
        signedUrl = signed?.signedUrl ?? null;
      }

      items.push({
        id: String(r.id),
        name: String(r.certification_type ?? ''),
        issuingBody: (r.issuing_body as string | null) ?? null,
        certificateNumber: (r.certification_number as string | null) ?? null,
        issuedAt: (r.issued_date as string | null) ?? null,
        expiresAt: (r.expiry_date as string | null) ?? null,
        certificateUrl: signedUrl,
        certificatePath: path,
        notes: (r.notes as string | null) ?? null,
        createdAt: String(r.created_at ?? ''),
        updatedAt: String(r.updated_at ?? ''),
      });
    }
    return items;
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchInspectorCertifications] threw:', e);
    }
    return [];
  }
}
