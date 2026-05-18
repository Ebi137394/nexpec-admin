# @nexpec/shared-core

The cross-platform spine of NEXPEC. Pure TypeScript — no React, no React Native, no Next.js. Consumed by both `apps/mobile` and `apps/web`.

## Modules

| Path | Purpose |
|------|---------|
| `client/` | Factory binding the package to a Supabase client at boot. |
| `net/` | Retry-wrapped Supabase RPC helpers for critical writes. |
| `storage/` | Signed-URL minting + Supabase storage URL parsing. |
| `domain/` | Pure business logic: job state machine, money helpers, audit intent. |
| `schemas/` | Zod schemas for every state-machine mutation. |

## Initialization

Each platform shell calls `createCore` once at boot:

```ts
import { createClient } from '@supabase/supabase-js';
import { createCore } from '@nexpec/shared-core';

const supabase = createClient(URL, ANON_KEY, { /* platform-specific options */ });
createCore({ supabase });
```

After that, any module in the package can be called from anywhere:

```ts
import { rpcWithRetry, canTransition, JOB_STATUS } from '@nexpec/shared-core';

if (canTransition(job.status, JOB_STATUS.IN_PROGRESS)) {
  await rpcWithRetry('inspector_start_job', { p_job_id: job.id });
}
```

## Philosophical rule

If a module would need to import from `react`, `react-native`, `next`, `expo`, or any platform shell, it does not belong here. Build it in the consumer app and use shared-core helpers from there.
