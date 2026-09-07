// /contracts/[id] — role-resolving canonical route. See lib/routing/roleRoutes.ts.
import { redirectToFamilyItem } from '@/lib/routing/canonicalRedirect';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return redirectToFamilyItem('contracts', id, `/contracts/${id}`);
}
