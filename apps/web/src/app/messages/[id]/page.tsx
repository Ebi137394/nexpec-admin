// /messages/[id] — the ONE stable link to a conversation, for every role.
//
// notify_on_new_message and tg_notify_messages both wrote a hard-coded
// '/client/messages/<id>' into every message notification, whatever the
// recipient's role. Measured on Production: 34 rows to 32 people, of which 16
// inspectors and 1 supplier were pointed at a route middleware refuses them
// (CLIENT_PREFIX allows client/agency/enterprise/admin/super_admin only).
//
// Mobile compounds it: expo-router has exactly one conversation screen,
// app/messages/[id].tsx, so '/client/messages/<id>' has never resolved there
// at all. '/messages/<id>' is the only path that can be correct on both.
import { redirectToFamilyItem } from '@/lib/routing/canonicalRedirect';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return redirectToFamilyItem('messages', id, `/messages/${id}`);
}
