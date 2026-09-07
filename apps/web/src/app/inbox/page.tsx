// /inbox — role-resolving canonical route. See lib/routing/roleRoutes.ts.
import { redirectToFamily } from '@/lib/routing/canonicalRedirect';

export const dynamic = 'force-dynamic';

export default async function Page() {
  return redirectToFamily('messages', '/inbox');
}
