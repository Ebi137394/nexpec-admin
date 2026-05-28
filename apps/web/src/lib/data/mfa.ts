// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/lib/data/mfa.ts
//
//  Server-side helpers for the MFA settings card. Reads the current
//  authentication-assurance-level + enrolled-factor status server-side
//  so the card renders correctly on first paint (no client-side flash).
//
//  Browser-side enrollment / verify / unenroll all happen via
//  supabase.auth.mfa.* in the MfaSection client component — that path
//  needs an active browser session anyway.
// ════════════════════════════════════════════════════════════════════════════

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface MfaStatusSummary {
  /** Is there an active TOTP factor on this user? */
  enrolled: boolean;
  /** Current AAL the session is at (aal1 = password only, aal2 = MFA verified). */
  currentLevel: 'aal1' | 'aal2' | null;
  /** Next AAL required by Supabase Auth — when > current, the user must verify. */
  nextLevel: 'aal1' | 'aal2' | null;
  /** Friendly name + ID of the verified TOTP factor (if any). */
  factor: { id: string; friendly_name: string | null } | null;
  /** Unused recovery codes remaining for this user. */
  recoveryCodesRemaining: number;
}

/**
 * Return null for unauthenticated requests so callers can render nothing
 * gracefully. Never throws.
 */
export async function fetchMfaStatus(): Promise<MfaStatusSummary | null> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return null;

  let enrolled = false;
  let factor: MfaStatusSummary['factor'] = null;
  try {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const verifiedTotp = (factors?.totp ?? []).find(
      (f) => f.status === 'verified',
    );
    if (verifiedTotp) {
      enrolled = true;
      factor = {
        id: verifiedTotp.id,
        friendly_name: verifiedTotp.friendly_name ?? null,
      };
    }
  } catch (err) {
    console.error('[mfa] listFactors error', err);
  }

  let currentLevel: MfaStatusSummary['currentLevel'] = null;
  let nextLevel: MfaStatusSummary['nextLevel'] = null;
  try {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    currentLevel = (data?.currentLevel as 'aal1' | 'aal2' | null) ?? null;
    nextLevel = (data?.nextLevel as 'aal1' | 'aal2' | null) ?? null;
  } catch (err) {
    console.error('[mfa] getAuthenticatorAssuranceLevel error', err);
  }

  let recoveryCodesRemaining = 0;
  try {
    const { count } = await supabase
      .from('auth_recovery_codes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('used_at', null);
    recoveryCodesRemaining = count ?? 0;
  } catch (err) {
    console.error('[mfa] recovery codes count error', err);
  }

  return {
    enrolled,
    currentLevel,
    nextLevel,
    factor,
    recoveryCodesRemaining,
  };
}
