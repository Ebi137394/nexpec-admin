// ════════════════════════════════════════════════════════════════════════════
//  src/observability/sentry.native.ts — mobile Sentry init (logic, not layout)
//
//  Initialized via a side-effect import in index.js (before expo-router/entry),
//  so the app shell / _layout is untouched. No-op until EXPO_PUBLIC_SENTRY_DSN
//  is set, so it's safe to ship before the DSN exists. Every event passes
//  through the shared, unit-tested PII scrubber.
//
//  Note: @sentry/react-native is native — it runs in a dev/EAS build (the app
//  already requires one for Nitro/Skia), not Expo Go. For navigation/perf
//  instrumentation, wrap the root export with Sentry.wrap(...) in app/_layout —
//  left to the app owner so this module never touches the UI.
// ════════════════════════════════════════════════════════════════════════════

import * as Sentry from '@sentry/react-native';
import { scrubSentryEvent, scrubValue } from '@nexpec/shared-core';

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event as never) as never,
    beforeBreadcrumb: (breadcrumb) => scrubValue(breadcrumb) as never,
  });
  initialized = true;
}

// Initialize on import — the entry point imports this module for its side effect.
initSentry();
