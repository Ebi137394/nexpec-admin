// Compatibility shim. notify_on_new_review emits '/client/reviews' when an
// inspector reviews a client, but that route has never existed on web or in
// the mobile app. There is no client-side reviews list today, so the nearest
// real destination is the client dashboard.
//
// The inspector side of the same trigger emits '/inspector/reviews', which is
// a real route and is left alone.
//
// No user input is forwarded, so this cannot become an open redirect.
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function LegacyClientReviewsRedirect() {
  redirect('/client/dashboard');
}
