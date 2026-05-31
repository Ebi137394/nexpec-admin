# NEXPEC — Sentry observability setup (web + mobile)

The **PII-scrubbing core is already built and unit-tested** in
`@nexpec/shared-core` (`observability/scrub.ts`): `scrubSentryEvent` (Sentry
`beforeSend`), `redactPiiString`, `scrubValue`, and `safeErrorTags`. Everything
below is the thin wiring that plugs that scrubber into Sentry on each platform.

> These config files import `@sentry/*`, which isn't installed yet (the sandbox
> registry is 403-blocked). They're kept here, not dropped live, so they can't
> break your active build. Install the SDKs, paste the files, set a DSN — done.
> With no DSN set, every `init` below is a **no-op**, so committing the wiring is
> safe before you've created the Sentry projects.

PII guarantees (this is a legal-compliance platform):
- `scrubSentryEvent` runs on every event/breadcrumb → emails, JWTs, bearer
  tokens, Stripe/secret keys, card numbers, and ~40 sensitive keys are redacted;
  `user` is reduced to a pseudonymous `id`; request headers/cookies/body stripped.
- `sendDefaultPii: false`, conservative `tracesSampleRate`.
- Seal **hashes** are non-reversible and intentionally kept (via `safeErrorTags`)
  for correlation; raw payloads never leave the process.

---

## Web — `@sentry/nextjs`

```bash
npm install @sentry/nextjs -w @nexpec/web
```

`apps/web/sentry.server.config.ts` (and an identical `sentry.edge.config.ts`):

```ts
import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from '@nexpec/shared-core';

const dsn = process.env.SENTRY_DSN;
Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend: (event) => scrubSentryEvent(event as any) as any,
  beforeBreadcrumb: (b) => scrubSentryEvent({ breadcrumbs: [b as any] } as any).breadcrumbs![0] as any,
});
```

`apps/web/instrumentation-client.ts` (Next 15 client init):

```ts
import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from '@nexpec/shared-core';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
Sentry.init({
  dsn,
  enabled: !!dsn,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,           // no session replay on a compliance app
  replaysOnErrorSampleRate: 0,
  sendDefaultPii: false,
  beforeSend: (event) => scrubSentryEvent(event as any) as any,
});
```

`apps/web/instrumentation.ts`:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./sentry.server.config');
  if (process.env.NEXT_RUNTIME === 'edge') await import('./sentry.edge.config');
}
export { captureRequestError as onRequestError } from '@sentry/nextjs';
```

Wrap `apps/web/next.config.mjs`:

```ts
import { withSentryConfig } from '@sentry/nextjs';
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN, // CI-only, for source maps
  silent: true,
});
```

Env: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`,
`SENTRY_AUTH_TOKEN` (CI secret).

---

## Mobile — `@sentry/react-native` (Expo)

```bash
npx expo install @sentry/react-native
```

Add the config plugin to `app.config.js` `plugins` (infra config, no UI change):

```js
['@sentry/react-native/expo', {
  url: 'https://sentry.io/',
  organization: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT_MOBILE,
}],
```

Create `src/observability/sentry.native.ts` (init lives in logic, not the layout):

```ts
import * as Sentry from '@sentry/react-native';
import { scrubSentryEvent } from '@nexpec/shared-core';

export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;                       // no-op until a DSN is provided
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event as any) as any,
    beforeBreadcrumb: (b) => scrubSentryEvent({ breadcrumbs: [b as any] } as any).breadcrumbs![0] as any,
  });
}
```

Then call `initSentry()` once at app start (a single line near the top of
`app/_layout.tsx` — I left this edit to you so I don't touch the layout). Wrap the
root export with `Sentry.wrap(...)` per the SDK docs.

Env: `EXPO_PUBLIC_SENTRY_DSN`. Source maps upload via EAS (`SENTRY_AUTH_TOKEN`).

---

## Instrument the moat (seal + payment), PII-free

Use `safeErrorTags` so only ids/names/hashes — never payloads — are attached:

```ts
import * as Sentry from '@sentry/nextjs'; // or @sentry/react-native
import { safeErrorTags } from '@nexpec/shared-core';

try {
  const { error } = await supabase.rpc('pi_seal_inspection_report', { p_report_id });
  if (error) throw error;
} catch (e) {
  Sentry.captureException(e, { tags: safeErrorTags({ rpc: 'pi_seal_inspection_report', reportId: p_report_id }) });
  throw e;
}
```

Priority capture sites: `pi_seal_inspection_report` / `assemble_evidence_pack`
(seal+evidence), the Stripe webhook handler branches, and the silently-swallowed
`AddFundsModal` payment error the audit flagged (promote `console.error` →
`captureException` with `safeErrorTags`).

---

## CI

Add to `.github/workflows/ci.yml` once installed: the `web · typecheck` job will
cover the Sentry config; set `SENTRY_AUTH_TOKEN` as a repo secret for source-map
upload on release builds.
