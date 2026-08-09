// Route for the job_supplier_inspector two-party room. Path matches the mobile deep link
// exactly (/chat/supplier-inspector/<id>) so one notification link opens the same
// conversation on either platform.
import type { Metadata } from 'next';
import TwoPartyRoomPage from '@/components/messaging/TwoPartyRoomPage';

export const metadata: Metadata = { title: 'Inspection coordination' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string }>;
}

export default async function Page({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  return <TwoPartyRoomPage id={id} expectedKind="job_supplier_inspector" error={sp.error} />;
}
