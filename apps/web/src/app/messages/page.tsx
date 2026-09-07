// /messages — role-resolving canonical route. See lib/routing/roleRoutes.ts.
//
// Mobile has one inbox screen (app/messages/index.tsx) while web has four
// role-scoped ones, so a single cross-platform link can only work if the role
// is resolved server-side at click time.
import { redirectToFamily } from '@/lib/routing/canonicalRedirect';

export const dynamic = 'force-dynamic';

export default async function Page() {
  return redirectToFamily('messages', '/messages');
}
