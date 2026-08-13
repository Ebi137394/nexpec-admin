// ════════════════════════════════════════════════════════════════════════════
//  app/admin/sso/format.ts — deterministic timestamp rendering
//
//  Everything on this surface is evidence: when a credential was minted, when
//  it was retired, when an IdP last provisioned someone. Two reasons it is all
//  rendered in UTC rather than through toLocaleString():
//
//    • Hydration. These tables are client components rendered first on the
//      server. A locale- or timezone-dependent string differs between the two
//      renders and React reports a mismatch.
//    • Reading the audit trail. An operator correlating this history with IdP
//      logs and Edge Function logs is reading UTC in both of those; silently
//      re-basing only this column to the browser's zone invites an off-by-hours
//      misreading of a security timeline.
// ════════════════════════════════════════════════════════════════════════════

/** `2026-08-13 14:05 UTC`, or an em dash when there is no timestamp. */
export function utcStamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** `2026-08-13`, for grouping rather than precision. */
export function utcDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 10);
}
