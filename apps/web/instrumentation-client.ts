// Sentry — Next.js browser runtime. No-op until NEXT_PUBLIC_SENTRY_DSN is set.
// Session replay is disabled outright (a compliance app must not record user
// sessions). Every event is PII-scrubbed before send.
import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent, scrubValue } from '@nexpec/shared-core';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  sendDefaultPii: false,
  beforeSend: (event) => scrubSentryEvent(event as never) as never,
  beforeBreadcrumb: (breadcrumb) => scrubValue(breadcrumb) as never,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
