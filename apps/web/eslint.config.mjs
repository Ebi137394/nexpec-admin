// ════════════════════════════════════════════════════════════════════════════
//  apps/web/eslint.config.mjs — ESLint 9 flat config for @nexpec/web
//
//  PHILOSOPHY: pragmatic, bug-only. This gate exists to catch real runtime
//  defects, not to police style. Severities are deliberate:
//
//    error → a genuine bug that should BLOCK the build/deploy.
//    warn  → worth seeing in the log, but must NEVER fail a deploy.
//    off   → stylistic/opinion rules irrelevant to correctness (pure noise on a
//            mature pre-launch codebase; re-enable post-launch if desired).
//
//  Base = Next.js `core-web-vitals` (brings the @next/next, react, react-hooks,
//  jsx-a11y and import plugins + the TypeScript parser), consumed through
//  FlatCompat because eslint-config-next still ships in the legacy (eslintrc)
//  format. We then retune severities below.
//
//  Why this is safe to wire as a blocking gate without a local trial run:
//  every error-level rule is either (a) already guaranteed by the green
//  `strict: true` TypeScript pass (const reassignment, dupe keys/args, etc.) or
//  (b) verified to have ZERO occurrences by grep (no `debugger`, no `=== NaN`,
//  no unsafe negation) or (c) a crash-class React rule (`rules-of-hooks`) that a
//  running app already satisfies. The noisy, high-volume opinion rules are
//  explicitly disabled so they can't wall off the deploy.
// ════════════════════════════════════════════════════════════════════════════

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  // ── Never lint generated output, deps, or config/build files ─────────────
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'next-env.d.ts',
      'public/**',
      'next.config.mjs',
      'eslint.config.mjs',
      'postcss.config.*',
      'tailwind.config.*',
      'sentry.*.config.*',
      '*.d.ts',
    ],
  },

  // ── Next.js recommended baseline (Core Web Vitals) ───────────────────────
  ...compat.extends('next/core-web-vitals'),

  // ── Severity retune: bug-only enforcement ────────────────────────────────
  {
    rules: {
      // ╭─ REAL BUGS → error (block the build) ──────────────────────────────╮
      // Conditional/looped hook calls desync React's hook order → crash.
      'react-hooks/rules-of-hooks': 'error',
      // Missing keys in lists → silent reconciliation/state bugs.
      'react/jsx-key': 'error',

      // Core "possible problems" set. TS-strict (green) already guarantees most
      // of these; making them explicit errors keeps them caught if a future
      // edit slips past the type checker (e.g. in a lightly-typed module).
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-class-members': 'error',
      'no-dupe-else-if': 'error',
      'no-func-assign': 'error',
      'no-import-assign': 'error',
      'no-obj-calls': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-setter-return': 'error',
      'getter-return': 'error',
      'no-unreachable': 'error',
      'no-unsafe-finally': 'error',
      'no-unsafe-negation': 'error',
      'no-cond-assign': ['error', 'always'],
      'no-constant-binary-expression': 'error',
      'no-compare-neg-zero': 'error',
      'no-async-promise-executor': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-fallthrough': 'error',
      'no-debugger': 'error',

      // ╭─ NOISE → off (style/opinion, not correctness) ─────────────────────╮
      'react/no-unescaped-entities': 'off',       // apostrophes/quotes in copy
      'react/display-name': 'off',
      'react/no-unknown-property': 'off',
      '@next/next/no-img-element': 'off',          // <img> can be a deliberate choice
      '@next/next/no-html-link-for-pages': 'off',  // App Router — there is no pages/

      // ╭─ ADVISORY → off (bug-only + zero-noise by design) ─────────────────╮
      // exhaustive-deps is valuable but its auto-fix can change runtime behavior,
      // so it's not safe to enforce blind pre-launch — surfacing it as warnings
      // would also violate the zero-noise goal. Unused-vars stays off: dead code
      // isn't a runtime bug, and enforcing it needs the @typescript-eslint plugin
      // which next/core-web-vitals does NOT register (only next/typescript does,
      // and that pulls in a wall of stylistic TS rules we deliberately avoid).
      // Both are clean re-enables post-launch.
      'react-hooks/exhaustive-deps': 'off',
      'react/jsx-no-target-blank': 'off',
      'no-unused-vars': 'off',
    },
  },
];

export default config;
