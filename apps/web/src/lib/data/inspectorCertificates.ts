// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectorCertificates.ts — fetch the current inspector's certs
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface InspectorCertificate {
  id: string;
  name: string;
  issuingBody: string | null;
  certificateNo: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  notes: string | null;
  filePath: string | null;
  fileSignedUrl: string | null;
  fileMime: string | null;
  fileSizeBytes: number | null;
  createdAt: string;
}

const BUCKET = 'inspector_certificates';
const SIGN_TTL = 60 * 30; // 30 min

export async function fetchMyInspectorCertificates(): Promise<InspectorCertificate[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('inspector_certificates')
      .select(
        'id, name, issuing_body, certificate_no, issue_date, expiry_date, notes, file_path, file_mime, file_size_bytes, created_at',
      )
      .eq('inspector_id', user.id)
      .order('created_at', { ascending: false });

    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchMyInspectorCertificates] failed:', error.message);
      }
      return [];
    }

    const rows = data as Array<Record<string, unknown>>;
    const out: InspectorCertificate[] = [];
    for (const r of rows) {
      const filePath = (r.file_path as string | null) ?? null;
      let signed: string | null = null;
      if (filePath) {
        try {
          const res = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(filePath, SIGN_TTL);
          signed = res.data?.signedUrl ?? null;
        } catch {
          signed = null;
        }
      }
      out.push({
        id: String(r.id),
        name: String(r.name ?? ''),
        issuingBody: (r.issuing_body as string | null) ?? null,
        certificateNo: (r.certificate_no as string | null) ?? null,
        issueDate: (r.issue_date as string | null) ?? null,
        expiryDate: (r.expiry_date as string | null) ?? null,
        notes: (r.notes as string | null) ?? null,
        filePath,
        fileSignedUrl: signed,
        fileMime: (r.file_mime as string | null) ?? null,
        fileSizeBytes:
          typeof r.file_size_bytes === 'number'
            ? (r.file_size_bytes as number)
            : null,
        createdAt: String(r.created_at ?? ''),
      });
    }
    return out;
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchMyInspectorCertificates] threw:', e);
    }
    return [];
  }
}
