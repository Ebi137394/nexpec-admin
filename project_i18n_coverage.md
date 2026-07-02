---
name: project_i18n_coverage
description: "NEXPEC mobile i18n — engine, 7 languages, namespace layout, and the Admin-English-by-design decision"
metadata: 
  node_type: memory
  type: project
  originSessionId: e7f049a2-95b3-4e16-b16b-9fc33e7f5b15
---

NEXPEC mobile app is **7-language capable** (en/fr/es/de/zh/ar/fa) as of Batch 4 (2026-06-22). Engine = `src/i18n/LanguageProvider.tsx` (`useLanguage()` → `{ t, isRTL, language }`); `t('Exact English string')` is namespace-agnostic and falls back English→key, so **English carries no dictionary** — only the 6 non-English locales do. RTL (ar/fa) auto-reloads via `Updates.reloadAsync`.

`src/i18n/translations.ts` namespaces (all keyed by the exact English UI string): `profile` (~175, strict-typed), then loose `common?` / `b2?` / `b3?` / `b4?` (added per batch; locales may omit any → English fallback). Adding a new screen = wrap strings in `t('...')` and append net-new keys to a `bN` block in each non-English locale. Keys containing an ASCII apostrophe must be double-quoted in the TS object.

Coverage by batch: B1 Dashboard+Profile; B2 tab bar + Finance/Docs + Inspector dashboard/assignments/negotiations; B3 role dashboards + jobs detail + deep Inspector; B4 (548 net-new keys) Supplier deep (`app/suppliers/*`) + remaining Inspector (verification, cci-application, disputes, tax-center, notifications, wallet/*, legal/*, jobs/[id]/*).

**DECISION — the Admin console is intentionally English-only** (the ~40 `app/(admin)/*` screens + the `(super-admin)` re-export shims are NOT wired to t()). Rationale: internal tool used only by the single god-mode operator (ebi, see [[feedback_god_mode_admin]]); localizing it has ~zero user value. Do NOT treat the un-wired admin screens as an oversight to "fix."

Caveats: ar/zh/fa are high-quality machine-seed translations — native review recommended before App Store submission. A few count strings are wired as fragments (e.g. "{n} jobs") pending real interpolation in the engine. Relates to price-blindness ([[reference_audit_trail_price_blindness]]): supplier/inspector finance + contract screens were wired without surfacing any new pricing internals.
