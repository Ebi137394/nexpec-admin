// Compatibility shim. Notifications and onboarding emails already sent to real
// users point at /client/profile, a route that never existed. Rather than leave
// those permanently broken, they now land on the canonical /profile resolver,
// which derives the real role server-side. No user input is forwarded, so this
// cannot become an open redirect.
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function LegacyProfileRedirect() {
  redirect('/profile');
}
