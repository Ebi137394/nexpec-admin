// ════════════════════════════════════════════════════════════════════════════
//  lib/data/clientSettings.ts — read the current client's own profile row
//
//  GOLDEN_RULE_2 — Selects only fields a client may legitimately see/edit.
//  Payout-related columns (balance_cents, hourly_rate_cents, stripe_*) are
//  intentionally omitted; if they ever surface in this fetcher's projection
//  someone has reintroduced inspector-side data into a client surface.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { ClientProfileSettings } from './clientSettings.types';

export type { ClientProfileSettings };

export async function fetchClientSettings(): Promise<ClientProfileSettings | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('profiles')
      .select(
        // GOLDEN_RULE_2 — explicit projection. Do NOT add payout fields.
        'id, email, full_name, company_name, phone, avatar_url, unread_notifications_count, last_active, created_at',
      )
      .eq('id', user.id)
      .maybeSingle();

    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchClientSettings] failed:', error.message);
      }
      return null;
    }

    const r = data as unknown as Record<string, unknown>;
    return {
      id: String(r.id),
      email: String(r.email ?? user.email ?? ''),
      fullName: (r.full_name as string | null) ?? null,
      companyName: (r.company_name as string | null) ?? null,
      phone: (r.phone as string | null) ?? null,
      avatarUrl: (r.avatar_url as string | null) ?? null,
      unreadNotificationsCount:
        typeof r.unread_notifications_count === 'number'
          ? r.unread_notifications_count
          : 0,
      lastActive: (r.last_active as string | null) ?? null,
      createdAt: (r.created_at as string | null) ?? null,
    };
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchClientSettings] threw:', e);
    }
    return null;
  }
}
