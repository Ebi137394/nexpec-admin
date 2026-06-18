// ════════════════════════════════════════════════════════════════════════════
//  lib/data/taxCenter.ts — Tax Center reads (web).
//
//  Payee reads their OWN tax_profiles row (RLS self); admin reads the review
//  queue (RLS admin). Never reads the encrypted TIN — decryption is brokered by
//  the tax-vault edge function (admin-only, audited). Only last-4 + status here.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';

export type TaxStatus = 'not_started' | 'in_progress' | 'submitted' | 'verified' | 'needs_update';

export interface MyTaxProfile {
  status: TaxStatus;
  formType: string | null;
  country: string | null;
  maskedTaxId: string | null;
  isExempt: boolean;
  exemptReason: string | null;
  expiresAt: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
}

export interface AdminTaxRow {
  userId: string;
  name: string;
  email: string | null;
  role: string;
  status: TaxStatus;
  formType: string | null;
  country: string | null;
  maskedTaxId: string | null;
  isExempt: boolean;
  exemptReason: string | null;
  hasCipher: boolean;        // a TIN is on file to reveal
  submittedAt: string | null;
}

/** The signed-in payee's own tax profile (null if they've never started). */
export async function fetchMyTaxProfile(): Promise<MyTaxProfile | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from('tax_profiles')
      .select('tax_status, form_type, tax_residency_country, masked_tax_id, is_tax_exempt, exempt_reason, expires_at, submitted_at, verified_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error || !data) return null;
    return {
      status: data.tax_status,
      formType: data.form_type,
      country: data.tax_residency_country,
      maskedTaxId: data.masked_tax_id,
      isExempt: !!data.is_tax_exempt,
      exemptReason: data.exempt_reason,
      expiresAt: data.expires_at,
      submittedAt: data.submitted_at,
      verifiedAt: data.verified_at,
    };
  } catch {
    return null;
  }
}

/** Admin review queue — submitted/needs_update first, then the rest. */
export async function fetchTaxReviewQueue(): Promise<AdminTaxRow[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('tax_profiles')
      .select('user_id, tax_status, form_type, tax_residency_country, masked_tax_id, is_tax_exempt, exempt_reason, tax_id_cipher, submitted_at')
      .order('submitted_at', { ascending: false, nullsFirst: false });
    if (error || !data) return [];

    const ids = [...new Set(data.map((r) => r.user_id))];
    const names = new Map<string, { name: string; email: string | null; role: string }>();
    if (ids.length) {
      const { data: profs } = await supabase
        .from('profiles').select('id, full_name, email, role').in('id', ids);
      for (const p of profs ?? []) {
        names.set(p.id, { name: p.full_name || (p.email ? String(p.email).split('@')[0] : 'Unknown'), email: p.email ?? null, role: p.role ?? 'unknown' });
      }
    }
    return data.map((r) => ({
      userId: r.user_id,
      name: names.get(r.user_id)?.name ?? 'Unknown',
      email: names.get(r.user_id)?.email ?? null,
      role: names.get(r.user_id)?.role ?? 'unknown',
      status: r.tax_status,
      formType: r.form_type,
      country: r.tax_residency_country,
      maskedTaxId: r.masked_tax_id,
      isExempt: !!r.is_tax_exempt,
      exemptReason: r.exempt_reason,
      hasCipher: r.tax_id_cipher != null,
      submittedAt: r.submitted_at,
    }));
  } catch {
    return [];
  }
}
