'use client';
// ════════════════════════════════════════════════════════════════════════════
//  lib/payments/useOnlinePayments.ts — client-side counterpart of
//  onlinePayments.ts, for interactive components that cannot read the flag
//  server-side.
//
//  Fail CLOSED: null (resolving) and false both mean "do not offer card
//  payment". Callers must gate on `=== true`.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

export function useOnlinePayments(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
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
