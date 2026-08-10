// ─────────────────────────────────────────────────────────────────
//  Fake `./network` — deterministic connectivity for the drain loop.
// ─────────────────────────────────────────────────────────────────

let online = false;

export function setOnline(v) {
  online = v;
}
export function isOnline() {
  return online;
}
export async function refreshOnce() {
  return online;
}
export function startNetworkListener() {
  return () => {};
}
export function onNetworkChange() {
  return () => {};
}
export function onAppForeground() {
  return () => {};
}
