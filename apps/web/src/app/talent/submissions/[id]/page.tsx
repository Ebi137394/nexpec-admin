// /talent/submissions/[id] — role-resolving canonical route.
//
// nx_talent_submit_candidate emits '/talent/submissions/<id>', which exists on
// neither platform. No role has a per-submission detail page on web, so the id
// is deliberately dropped and the user lands on their talent panel, where the
// submission is listed. Preserving the id would only produce a second 404.
import { redirectToFamily } from '@/lib/routing/canonicalRedirect';

export const dynamic = 'force-dynamic';

export default async function Page() {
  return redirectToFamily('talent', '/talent/submissions');
}
