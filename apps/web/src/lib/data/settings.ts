// ════════════════════════════════════════════════════════════════════════════
//  lib/data/settings.ts — fee schedule + integration secrets reads
//
//  Secrets viewer is server-only by definition; only masked previews ever
//  reach the rendered HTML. Actual values stay on the server.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { FeeSchedule, IntegrationSecret } from './settings.types';

export type { FeeSchedule, IntegrationSecret };

const DEFAULT_FEES: FeeSchedule = {
  client_commission_bps: 1500,
  stripe_application_fee_bps: 250,
  dispute_fee_cents: 5000,
  payout_fee_bps: 0,
  updated_at: null,
};

export async function fetchFeeSchedule(): Promise<FeeSchedule> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('platform_settings')
    .select(
      'client_commission_bps, stripe_application_fee_bps, dispute_fee_cents, payout_fee_bps, updated_at',
    )
    .eq('id', 'global')
    .maybeSingle();

  if (error || !data) {
    if (error) console.warn('[settings] fee fetch failed:', error.message);
    return DEFAULT_FEES;
  }
  return {
    client_commission_bps: (data.client_commission_bps as number) ?? DEFAULT_FEES.client_commission_bps,
    stripe_application_fee_bps:
      (data.stripe_application_fee_bps as number) ?? DEFAULT_FEES.stripe_application_fee_bps,
    dispute_fee_cents: (data.dispute_fee_cents as number) ?? DEFAULT_FEES.dispute_fee_cents,
    payout_fee_bps: (data.payout_fee_bps as number) ?? DEFAULT_FEES.payout_fee_bps,
    updated_at: (data.updated_at as string | null) ?? null,
  };
}

/* ────────────────────────────────────────────────────────────────────── */

function mask(value: string | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim();
  if (v.length === 0) return null;
  if (v.length <= 8) return '••••••••';
  // Show first 8 (often the prefix like `sk_live_` / `eyJhbGc.`) and last 4.
  return `${v.slice(0, 8)}…${v.slice(-4)}`;
}

/**
 * Build the masked secrets snapshot. Server-only — actual values stay
 * in process.env and never reach the client bundle. The web UI only ever
 * receives the prefix + suffix preview.
 */
export function readIntegrationSecrets(): IntegrationSecret[] {
  const e = process.env;
  return [
    {
      key: 'NEXT_PUBLIC_SUPABASE_URL',
      label: 'Supabase project URL',
      category: 'supabase',
      masked: mask(e.NEXT_PUBLIC_SUPABASE_URL),
      present: !!e.NEXT_PUBLIC_SUPABASE_URL,
      hint: 'Public URL of the project. Safe to ship to the browser.',
    },
    {
      key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      label: 'Supabase anon key',
      category: 'supabase',
      masked: mask(e.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      present: !!e.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      hint: 'Public anon JWT. RLS gates row access.',
    },
    {
      key: 'SUPABASE_SERVICE_ROLE_KEY',
      label: 'Supabase service-role key',
      category: 'supabase',
      masked: mask(e.SUPABASE_SERVICE_ROLE_KEY),
      present: !!e.SUPABASE_SERVICE_ROLE_KEY,
      hint: 'BYPASSES RLS. Server-side only. NEVER expose to the browser.',
    },
    {
      key: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
      label: 'Stripe publishable key',
      category: 'stripe',
      masked: mask(e.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
      present: !!e.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      hint: 'Public — starts with pk_test_ or pk_live_.',
    },
    {
      key: 'STRIPE_SECRET_KEY',
      label: 'Stripe secret key',
      category: 'stripe',
      masked: mask(e.STRIPE_SECRET_KEY),
      present: !!e.STRIPE_SECRET_KEY,
      hint: 'Server-side. Starts with sk_test_ or sk_live_.',
    },
    {
      key: 'STRIPE_WEBHOOK_SIGNING_SECRET',
      label: 'Stripe webhook signing secret',
      category: 'stripe',
      masked: mask(e.STRIPE_WEBHOOK_SIGNING_SECRET),
      present: !!e.STRIPE_WEBHOOK_SIGNING_SECRET,
      hint: 'Server-side. Starts with whsec_. Rotates on demand.',
    },
    {
      key: 'RESEND_API_KEY',
      label: 'Resend API key',
      category: 'mail',
      masked: mask(e.RESEND_API_KEY),
      present: !!e.RESEND_API_KEY,
      hint: 'Transactional email. Starts with re_.',
    },
    {
      key: 'EAS_PROJECT_ID',
      label: 'EAS project id',
      category: 'expo',
      masked: mask(e.EAS_PROJECT_ID),
      present: !!e.EAS_PROJECT_ID,
      hint: 'Bound when you run `eas init`.',
    },
    {
      key: 'NEXT_PUBLIC_SITE_URL',
      label: 'Site URL',
      category: 'platform',
      masked: mask(e.NEXT_PUBLIC_SITE_URL),
      present: !!e.NEXT_PUBLIC_SITE_URL,
      hint: 'Used by OAuth redirects. Must be the canonical https://nexpecapp.com in production.',
    },
  ];
}
