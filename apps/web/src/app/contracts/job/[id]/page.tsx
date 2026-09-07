// /contracts/job/[id] — role-resolving canonical route.
//
// client_sign_job_contract notifies the INSPECTOR at '/contracts/job/<id>',
// which exists in the mobile app (app/contracts/job/[id].tsx) but had no web
// route at all. It was invisible to the link guard until the producer filter
// was widened to include create_system_notification.
import { redirectToFamilyItem } from '@/lib/routing/canonicalRedirect';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return redirectToFamilyItem('contractJob', id, `/contracts/job/${id}`);
}
