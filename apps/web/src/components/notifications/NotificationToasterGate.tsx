// ════════════════════════════════════════════════════════════════════════════
//  components/notifications/NotificationToasterGate.tsx
//  Server-side gate: resolves the signed-in user and hands the id to the
//  client toaster. Renders nothing when signed-out.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { NotificationToaster } from './NotificationToaster';

export async function NotificationToasterGate() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    return <NotificationToaster userId={user.id} />;
  } catch {
    return null;
  }
}
