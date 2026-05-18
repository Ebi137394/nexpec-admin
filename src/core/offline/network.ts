// ─────────────────────────────────────────────────────────────────
//  lib/offline/network.ts
//  Tiny wrapper around @react-native-community/netinfo.
//  - Exposes a synchronous `isOnline()` (cached last state)
//  - Subscriber pattern for connectivity changes
//  - `refreshOnce()` for an explicit re-poll
// ─────────────────────────────────────────────────────────────────

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

type Listener = (online: boolean) => void;
const listeners = new Set<Listener>();
let lastState = false;
let unsubscribeNetInfo: (() => void) | null = null;

function evaluate(state: NetInfoState): boolean {
  // isInternetReachable can be `null` on iOS until probed — treat null as "probably online"
  return !!state.isConnected && state.isInternetReachable !== false;
}

export function startNetworkListener(): () => void {
  if (unsubscribeNetInfo) return unsubscribeNetInfo;
  unsubscribeNetInfo = NetInfo.addEventListener((s) => {
    const online = evaluate(s);
    if (online !== lastState) {
      lastState = online;
      listeners.forEach((l) => l(online));
    }
  });
  // Prime cached value
  NetInfo.fetch().then((s) => {
    lastState = evaluate(s);
  });
  return unsubscribeNetInfo;
}

export function isOnline(): boolean {
  return lastState;
}

export function onNetworkChange(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export async function refreshOnce(): Promise<boolean> {
  const s = await NetInfo.fetch();
  lastState = evaluate(s);
  return lastState;
}
