# apps/mobile/ — reserved

The current Expo / React Native app lives at the **repository root** (the
`app/`, `src/`, `ios/`, `android/` directories plus the root `package.json`).
It is the workspace root for now.

## Why it isn't physically inside `apps/mobile/` yet

Moving the mobile app requires:

1. Relocating `/app`, `/src`, `/lib`, `/hooks`, `/providers`, `/assets`,
   `/ios`, `/android`, `/supabase` into `apps/mobile/`.
2. Updating every `@/...` and relative-path import across ~100 files.
3. Editing `tsconfig.json`, `metro.config.js`, `babel.config.js`,
   `app.config.js`, `eas.json` paths, and the Expo Router root.
4. Re-running `npx expo prebuild --clean` to regenerate the native
   projects under the new path.
5. Verifying the device build still runs identically.

This is a dedicated PR — explicitly held off the Phase 5 + Phase 6 / Step 1
sprint to keep the working device build undisturbed.

## What's already in place

- The workspace root (`/package.json`) lists `apps/*` and `packages/*` as
  yarn workspaces.
- `@nexpec/shared-core` is published at `packages/shared-core/` and is
  resolvable from anywhere in the workspace.
- The mobile app can begin importing from `@nexpec/shared-core` today —
  the legacy `src/core/net/supabaseRetry.ts` and
  `src/core/storage/signedUrls.ts` are kept in place so existing imports
  keep working during the migration window. Move call sites to
  `@nexpec/shared-core` one folder at a time.

## Migration plan (sequenced)

1. **PR-1: shared-core adoption.** Mobile imports `rpcWithRetry`, `signedUrl`,
   etc. from `@nexpec/shared-core` and deletes the duplicated files in
   `src/core/net/` and `src/core/storage/`. Call `createCore({ supabase })`
   in `app/_layout.tsx` boot path.
2. **PR-2: physical move.** `git mv` the mobile tree into `apps/mobile/`,
   update paths, rerun prebuild, verify device boot.
3. **PR-3: tsconfig + metro alignment.** Mobile `tsconfig` extends
   `../../tsconfig.base.json`; Metro `watchFolders` includes
   `../../packages/shared-core/src`.
