// ─────────────────────────────────────────────────────────────────
//  src/core/offline/network.ts
//  Connectivity source-of-truth for the offline outbox.
//  - synchronous isOnline() (cached last state)
//  - subscriber pattern for connectivity changes
//  - refreshOnce() for an explicit re-poll
//  - onAppForeground() seam (QA-F6)
//
//  QA fix (Failure 1): the old evaluate() keyed off `isInternetReachable`, which
//  is advisory and stays `false`/`null` on iOS + simulators right after a
//  reconnect — so once connectivity returned, the queue stayed 'offline'
//  forever. We now key off the reliable `isConnected` signal, push EVERY update
//  path (event / prime / refresh / foreground) through a single notify, and
//  re-poll on foreground so events missed while backgrounded are recovered.
// ─────────────────────────────────────────────────────────────────

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';

type Listener = (online: boolean) => void;
const listeners = new Set<Listener>();

let lastState = false;
let primed = false; // ensures the first update always broadcasts
let unsubscribeNetInfo: (() => void) | null = null;
let appStateSub: { remove: () => void } | null = null;

function evaluate(state: NetInfoState): boolean {
  // `isConnected` is the reliable signal. `isInternetReachable` is advisory and
  // is notoriously stuck `false`/`null` on iOS + simulators immediately after a
  // reconnect — keying off it left the queue 'offline' forever once the network
  // came back (QA Failure 1). Be optimistic: online unless explicitly
  // disconnected. A captive portal / no-internet Wi-Fi just produces transient
  // failures the drain loop already retries — far safer than a stuck-offline.
  return state.isConnected === true;
}

/** The ONE place connectivity is mutated + broadcast. Every path funnels here so
 *  the cached value and every subscriber (e.g. the Outbox Inspector) stay in
 *  lock-step. Broadcasts on the first call and on every real change. */
function setOnline(online: boolean): void {
  if (primed && online === lastState) return;
  primed = true;
  lastState = online;
  listeners.forEach((l) => {
    try {
      l(online);
    } catch {
      /* a bad subscriber must not break connectivity propagation */
    }
  });
}

export function startNetworkListener(): () => void {
  if (unsubscribeNetInfo) return unsubscribeNetInfo;

  unsubscribeNetInfo = NetInfo.addEventListener((s) => setOnline(evaluate(s)));

  // Prime immediately — through setOnline, so any subscriber that registered
  // before the first OS event still receives the correct initial state.
  NetInfo.fetch()
    .then((s) => setOnline(evaluate(s)))
    .catch(() => {
      /* keep last known */
    });

  // Re-poll on foreground: connectivity events can be dropped while the app is
  // backgrounded — exactly when a field device flips Wi-Fi↔cellular.
  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', (st: AppStateStatus) => {
      if (st === 'active') void refreshOnce();
    });
  }

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

/** Explicit re-poll. Now routes through setOnline so a change is broadcast (the
 *  old version updated the cache silently, so the UI never saw a foreground
 *  reconnect). */
export async function refreshOnce(): Promise<boolean> {
  try {
    const s = await NetInfo.fetch();
    setOnline(evaluate(s));
  } catch {
    /* keep last known */
  }
  return lastState;
}

/**
 * QA-F6 — subscribe to the app returning to the foreground. Fires the listener
 * each time AppState transitions to 'active'. Kept here (the RN-coupling layer)
 * so sync.ts stays free of a direct react-native import. Returns an unsubscribe.
 */
export function onAppForeground(listener: () => void): () => void {
  const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') listener();
  });
  return () => sub.remove();
}
