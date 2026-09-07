// /talent/submissions — role-resolving canonical route. See roleRoutes.ts.
import { redirectToFamily } from '@/lib/routing/canonicalRedirect';

export const dynamic = 'force-dynamic';

export default async function Page() {
  return redirectToFamily('talent', '/talent/submissions');
}
