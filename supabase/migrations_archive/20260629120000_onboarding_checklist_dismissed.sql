-- ════════════════════════════════════════════════════════════════════════════
--  20260629120000_onboarding_checklist_dismissed.sql
--
--  Sprint 13.1 — onboarding checklist
--
--  Single column add: profiles.onboarding_checklist_dismissed_at.
--  Every per-step completion is DERIVED at read time from existing data
--  (specialty_slugs, inspector_certificates count, jobs count, etc.), so
--  there is no per-step state to maintain. Only the user's choice to
--  dismiss the whole checklist persists, hence this one column.
--
--  IDEMPOTENT — ADD COLUMN IF NOT EXISTS. Pure additive change; no
--  existing column / constraint / RLS policy is touched.
--
--  No backfill needed. Existing rows get NULL which the checklist
--  widget treats as "not dismissed" (the default visible state).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_checklist_dismissed_at timestamptz;

COMMENT ON COLUMN public.profiles.onboarding_checklist_dismissed_at IS
  'When the user clicked Dismiss on the post-signup onboarding checklist '
  'widget. NULL = checklist is still visible (default). Per-step completion '
  'is derived at read time from other columns / related tables; only this '
  'dismissal flag is persisted.';

COMMIT;
