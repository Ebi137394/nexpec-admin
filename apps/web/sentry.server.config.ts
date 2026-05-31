// Sentry — Next.js server runtime. Loaded by instrumentation.ts on the Node
// runtime. No-op until SENTRY_DSN is set. All events pass through the shared,
// unit-tested PII scrubber before leaving the process (legal-compliance app).
import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent, scrubValue } from '@nexpec/shared-core';

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend: (event) => scrubSentryEvent(event as never) as never,
  beforeBreadcrumb: (breadcrumb) => scrubValue(breadcrumb) as never,
});
