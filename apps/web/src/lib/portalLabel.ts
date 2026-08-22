/**
 * Maps a profile role to the portal label shown in buyer-portal chrome.
 * Anyone routed into the /client portal layout (client/agency/enterprise)
 * sees their own role's branding — onboarding personality persists past
 * signup. Shared by the Sidebar and page eyebrows so the two can't drift.
 */
export function portalLabelForRole(role: string | null | undefined): string {
  const normalised = (role ?? '').toString().trim().toLowerCase();
  if (normalised === 'agency') return 'Agency Portal';
  if (normalised === 'enterprise') return 'Enterprise Portal';
  if (normalised === 'admin' || normalised === 'super_admin') {
    return 'Operator Portal';
  }
  return 'Client Portal';
}
