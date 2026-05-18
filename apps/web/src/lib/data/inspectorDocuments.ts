// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectorDocuments.ts — current inspector's compliance docs
//
//  Returns rows the inspector owns. Builds short-lived signed URLs for the
//  files (the inspector_credentials bucket is PRIVATE). Admin-side viewers
//  use their own server fetcher; this one is intentionally scoped to self.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  InspectorDocument,
  InspectorDocumentKind,
} from './inspectorDocuments.types';

export type { InspectorDocument };

const SIGNED_URL_TTL_SECONDS = 60 * 10; // 10 min — enough for a page render

export async function fetchInspectorDocuments(): Promise<InspectorDocument[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('inspector_documents')
      .select(
        'id, kind, label, file_path, expires_at, notes, created_at, updated_at',
      )
      .eq('inspector_id', user.id)
      .order('created_at', { ascending: false });

    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchInspectorDocuments] failed:', error.message);
      }
      return [];
    }

    const rows = data as unknown as Array<Record<string, unknown>>;

    // Batch-sign URLs (one round-trip per row; could be optimised with
    // createSignedUrls if the list grows — fine for typical dossier sizes).
    const docs: InspectorDocument[] = [];
    for (const r of rows) {
      const filePath = String(r.file_path ?? '');
      let fileUrl: string | null = null;
      if (filePath) {
        const { data: signed } = await supabase.storage
          .from('inspector_credentials')
          .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);
        fileUrl = signed?.signedUrl ?? null;
      }

      docs.push({
        id: String(r.id),
        kind: (r.kind as InspectorDocumentKind) ?? 'other',
        label: String(r.label ?? ''),
        fileUrl,
        filePath,
        expiresAt: (r.expires_at as string | null) ?? null,
        notes: (r.notes as string | null) ?? null,
        createdAt: String(r.created_at ?? ''),
        updatedAt: String(r.updated_at ?? ''),
      });
    }
    return docs;
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchInspectorDocuments] threw:', e);
    }
    return [];
  }
}
