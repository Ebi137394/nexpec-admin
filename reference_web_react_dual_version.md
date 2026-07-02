---
name: reference-web-react-dual-version
description: Vercel web-build React
metadata: 
  node_type: memory
  type: reference
  originSessionId: 49b95114-7fa8-48bb-91e6-6eeb9c30c3df
---

NEXPEC is a dual-React monorepo: repo-root `package.json` pins **react/react-dom 18.3.1** (React Native 0.76 requires it), `apps/web/package.json` pins **react/react-dom 19.0.0** (Next 15.5). React 19 renamed the element symbol `$$typeof` from `Symbol(react.element)` → `Symbol(react.transitional.element)`, so a React-18 element rendered by React-19 fails `isValidElement` and is treated as a plain object → **Minified React error #31 (`object with keys {$$typeof,type,key,ref,props}`)** during `next build` static prerender (first seen on /_error:/404, but it hits EVERY page via the root layout).

Trigger: after the **yarn→npm** package-manager switch, npm hoisted web-only libs (`next-intl`, `use-intl`, `lucide-react`, `geist`, `@radix-ui/*`) to the **root `node_modules`**, where they resolve `react` → 18. `NextIntlClientProvider` is rendered directly in `apps/web/src/app/layout.tsx`, so it emitted React-18 elements on every page.

**Fix is TWO parts (the alias ALONE is insufficient):**
1. webpack `resolve.alias` (12c0fff) → `react`/`react-dom`/jsx-runtimes to `apps/web/node_modules/*` (React 19). BUT this only covers code webpack BUNDLES.
2. **`transpilePackages` (a9760b8) → the critical second half.** Next EXTERNALIZES node_modules deps for the SERVER build; an externalized package is `require()`'d at runtime from its install location, where the alias can't reach. So when `next-intl`/`use-intl` are hoisted to ROOT (React 18), the /404 prerender (root layout → `NextIntlClientProvider`) emits React-18 elements → React-19 renderer → #31, EVEN WITH the alias. Fix: list every React-element-creating web dep in `transpilePackages` so they're bundled (and aliased) on client AND server: currently `['@nexpec/shared-core','next-intl','use-intl','lucide-react','framer-motion']`.

CAUSE OF THE GREEN→RED FLIP (2026-06): `c070366` deployed green only because THAT lockfile happened to NEST `next-intl` under `apps/web` (→ React 19 at runtime). A later `npm install` (adding the ESLint toolchain) RE-HOISTED `next-intl` to root (→ React 18) and #31 returned. Lesson: the alias was never the real server-side fix — dep hoisting was, by luck. `transpilePackages` makes it hoisting-INDEPENDENT (the durable fix). Do NOT rely on hoisting; do NOT unify versions (RN can't take React 19); do NOT use a global npm `override` (breaks RN). When adding a new React-using web dep, ADD IT TO `transpilePackages` or it can reintroduce #31. The build uses webpack (not Turbopack), so both levers apply.

GOTCHA for future debugging: the 37 pre-existing TS errors are a RED HERRING for this crash — `next.config` has `typescript.ignoreBuildErrors` + `eslint.ignoreDuringBuilds` ON (the build logs "Skipping validation of types" and still fails at prerender). The real web typecheck gate is `npm run typecheck -w @nexpec/web`. The not-found.tsx `dynamic='force-dynamic'` + stripped layout fonts were earlier symptom-treatments and are now unnecessary (left in place; can be reverted post-launch). See [[reference-web-build-typecheck-gated]], [[user-profile-ebi-nexpec]].
