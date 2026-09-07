// Compatibility shim. notify_on_job_change and notify_on_transaction_change
// both emit '/inspector/payouts' for payout and earnings notifications, but
// that route has never existed on web or in the mobile app — the real page is
// /inspector/wallet. No user has received one of these links yet (0 rows in
// public.notifications at the time of writing), so this closes the hole before
// it reaches anyone rather than repairing damage.
//
// Done as a route rather than by rewriting the three trigger functions: the
// link is one string inside large notification triggers, and reproducing those
// bodies by hand to change it would risk breaking job, transaction and review
// notifications entirely. This is the reversible half of the fix.
//
// No user input is forwarded, so this cannot become an open redirect.
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function LegacyPayoutsRedirect() {
  redirect('/inspector/wallet');
}
