// Route for the job_client_inspector two-party room. Path matches the mobile deep link
// exactly (/chat/direct/<id>) so one notification link opens the same
// conversation on either platform.
import type { Metadata } from 'next';
import TwoPartyRoomPage from '@/components/messaging/TwoPartyRoomPage';

export const metadata: Metadata = { title: 'Direct message' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string }>;
}

export default async function Page({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  return <TwoPartyRoomPage id={id} expectedKind="job_client_inspector" error={sp.error} />;
}
