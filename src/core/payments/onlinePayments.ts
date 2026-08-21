// ════════════════════════════════════════════════════════════════════════════
//  src/core/payments/onlinePayments.ts — mobile counterpart of
//  apps/web/src/lib/payments/onlinePayments.ts.
//
//  One hook, read at render time, so the app never renders a Stripe-dependent
//  control the backend would refuse. Fail CLOSED (null → treat as disabled)
//  and it is remote-flag driven: when Stripe is restored, flipping
//  platform_settings.online_payments_enabled turns these surfaces back on with
//  NO store rebuild.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/** null = still resolving. Treat anything other than `true` as "not offered". */
export function useOnlinePaymentsEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('nx_online_payments_enabled');
        if (alive) setEnabled(!error && data === true);
      } catch {
        if (alive) setEnabled(false);
      }
    })();
    return () => { alive = false; };
  }, []);
  return enabled;
}
