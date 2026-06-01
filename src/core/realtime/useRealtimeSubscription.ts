// ─────────────────────────────────────────────────────────────────────────────
//  src/core/realtime/useRealtimeSubscription.ts
//
//  One correct Supabase realtime subscription, so screens stop reinventing it
//  (and reinventing the same two bugs).
//
//  THE BUGS THIS PREVENTS
//  ──────────────────────
//   1. SILENT DEATH. The common pattern was `supabase.channel(name).on(...).
//      subscribe()` with NO status callback. When the socket dropped (a field
//      device flipping Wi-Fi↔cellular, a backgrounded app) the channel went to
//      CHANNEL_ERROR / TIMED_OUT / CLOSED and simply stopped delivering events —
//      forever, with no error surfaced. A wallet balance, a chat thread, or a
//      CRITICAL SAFETY ALERT feed would quietly freeze and the user would never
//      know. Here, any non-healthy status fires `onDesync`, so the caller
//      refetches and catches up on whatever it missed; Supabase's socket layer
//      auto-rejoins the channel, so live updates resume too.
//   2. LEAK / DUPLICATE NAME. Channels created without teardown (or with a
//      constant name mounted twice) leak websockets and double-deliver events.
//      This always `removeChannel`s on cleanup, and the caller is expected to
//      pass an instance-unique `channelName` (suffix it with a useId()/uid).
//
//  Keep callbacks inline — they're held in refs, so changing them does NOT churn
//  the subscription. Only `channelName`, `enabled`, or the binding shape do.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';

export interface RealtimeBinding {
  /** Defaults to '*'. */
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
  /** Defaults to 'public'. */
  schema?: string;
  table: string;
  /** PostgREST-style filter, e.g. `user_id=eq.${id}`. */
  filter?: string;
}

export interface UseRealtimeSubscriptionOptions {
  /** MUST be unique per mounted instance — suffix with a useId()/uid to avoid the
   *  "same channel name mounted twice" silent-drop. */
  channelName: string;
  /** One or more postgres_changes bindings handled by `onChange`. */
  bindings: RealtimeBinding[];
  /** Fires for each matching row change (do optimistic state updates here). */
  onChange?: (payload: RealtimePostgresChangesPayload<{ [key: string]: any }>) => void;
  /** Fires when the channel errors/times out/closes mid-life — refetch here so a
   *  dropped socket can't leave the UI silently stale. */
  onDesync?: () => void;
  /** Gate subscription until ready (e.g. until a userId is known). Default true. */
  enabled?: boolean;
}

export function useRealtimeSubscription({
  channelName,
  bindings,
  onChange,
  onDesync,
  enabled = true,
}: UseRealtimeSubscriptionOptions): void {
  // Latest callbacks, so changing them never resubscribes.
  const onChangeRef = useRef(onChange);
  const onDesyncRef = useRef(onDesync);
  onChangeRef.current = onChange;
  onDesyncRef.current = onDesync;

  // Stable structural key — only (re)subscribe when the bindings actually change.
  const bindingsKey = JSON.stringify(bindings);

  useEffect(() => {
    if (!enabled || !channelName) return;

    // Guards a teardown-time CLOSED status from being mistaken for a mid-life
    // desync (which would fire a spurious refetch on every unmount).
    let active = true;
    let channel: RealtimeChannel | null = supabase.channel(channelName);

    for (const b of bindings) {
      channel = channel.on(
        'postgres_changes',
        {
          event: b.event ?? '*',
          schema: b.schema ?? 'public',
          table: b.table,
          ...(b.filter ? { filter: b.filter } : {}),
        } as never,
        (payload: RealtimePostgresChangesPayload<{ [key: string]: any }>) =>
          onChangeRef.current?.(payload),
      );
    }

    channel.subscribe((status) => {
      if (
        active &&
        (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')
      ) {
        onDesyncRef.current?.();
      }
    });

    return () => {
      active = false;
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, enabled, bindingsKey]);
}
