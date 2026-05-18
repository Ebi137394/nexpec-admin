// ════════════════════════════════════════════════════════════════════════════
//  src/legal/marketGating.ts
//
//  Platform-side market-gating policy. Mirrors the activation status of each
//  Country Addendum and enforces signup-time blocks for jurisdictions that
//  NEXPEC has elected NOT to serve in v1.
//
//  Current policy (Checkpoint 5):
//    - China (CN): signup-blocked. The ADDENDUM-CN-001 scaffold is
//      NOT-FOR-ACTIVATION; mainland-China residents cannot create accounts
//      until that Addendum is moved to status: active by NEXPEC management.
//    - All other priority markets (CA, US, EU, UK, GCC, JP, KR, IN):
//      permitted at signup. The applicable Country Addendum is attached
//      automatically by ADDENDUM-FRAMEWORK-001 §3 trigger logic.
//    - All non-priority markets default to permitted under the master
//      stack (Québec governing law, no per-country overlay).
//
//  Integration point for the signup screen — typical usage:
//
//      import { evaluateMarketEligibility } from '@/src/legal/marketGating';
//      // ...
//      const result = evaluateMarketEligibility({ countryCode });
//      if (!result.permitted) {
//        // Show a "not yet available in your region" message including
//        // result.reasonCode and result.userFacingMessage.
//        return;
//      }
//      // Otherwise proceed with signup.
// ════════════════════════════════════════════════════════════════════════════

/** ISO-3166-1 alpha-2 country code (uppercase). */
export type Iso3166Alpha2 = string;

export type MarketGatingReasonCode =
  | 'OK'
  | 'BLOCKED_PENDING_ACTIVATION'
  | 'BLOCKED_SANCTIONS_OR_COMPLIANCE';

export interface MarketGatingResult {
  permitted: boolean;
  reasonCode: MarketGatingReasonCode;
  /** Country code in normalized form, or null if input couldn't be parsed. */
  countryCode: Iso3166Alpha2 | null;
  /** Short user-facing message suitable for surfacing in a signup error banner. */
  userFacingMessage: string;
  /** Internal audit string explaining the decision. */
  auditNote: string;
}

/**
 * Countries where account creation is currently BLOCKED at signup.
 * Driven by per-country Addendum activation status.
 *
 * To unblock: move the corresponding ADDENDUM-XX-001 to status: active,
 * complete the business-action checklist listed in that Addendum's
 * frontmatter, then remove the entry below.
 */
const SIGNUP_BLOCKED_COUNTRIES: ReadonlyArray<Iso3166Alpha2> = [
  'CN', // ADDENDUM-CN-001 scaffold-only — NOT-FOR-ACTIVATION
];

/**
 * Normalize loosely-shaped country input to an uppercase ISO-3166-1
 * alpha-2 code. Returns null for input we cannot confidently map.
 */
export function normalizeCountryCode(
  input: string | null | undefined,
): Iso3166Alpha2 | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim().toUpperCase();
  if (trimmed.length !== 2) return null;
  // Defensive: confirm A-Z only.
  if (!/^[A-Z]{2}$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Evaluate whether a prospective signup is permitted from a given
 * country. Pure function; safe to call from anywhere — UI, form
 * validator, server-side edge function.
 */
export function evaluateMarketEligibility(args: {
  countryCode: string | null | undefined;
}): MarketGatingResult {
  const normalized = normalizeCountryCode(args.countryCode);

  if (!normalized) {
    // Permit signup when country is genuinely unknown. The platform will
    // require a country selection elsewhere (profile completion) before
    // any Job can be posted or accepted.
    return {
      permitted: true,
      reasonCode: 'OK',
      countryCode: null,
      userFacingMessage: '',
      auditNote: 'marketGating: country unknown — permitted at signup, gated downstream',
    };
  }

  if (SIGNUP_BLOCKED_COUNTRIES.includes(normalized)) {
    return {
      permitted: false,
      reasonCode: 'BLOCKED_PENDING_ACTIVATION',
      countryCode: normalized,
      userFacingMessage:
        'NEXPEC is not yet available in your region. We are working to expand availability — please check back, or contact legal@nexpec.com if you believe this is in error.',
      auditNote: `marketGating: ${normalized} signup-blocked pending ADDENDUM-${normalized}-001 activation`,
    };
  }

  return {
    permitted: true,
    reasonCode: 'OK',
    countryCode: normalized,
    userFacingMessage: '',
    auditNote: `marketGating: ${normalized} permitted under v1 policy`,
  };
}

/** Quick check that returns just the boolean — convenience for form validators. */
export function isJurisdictionSupported(
  countryCode: string | null | undefined,
): boolean {
  return evaluateMarketEligibility({ countryCode }).permitted;
}

/** The full list of currently-blocked countries (for admin / debugging views). */
export function getSignupBlockedCountries(): ReadonlyArray<Iso3166Alpha2> {
  return SIGNUP_BLOCKED_COUNTRIES;
}
