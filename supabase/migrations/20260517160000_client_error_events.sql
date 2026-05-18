-- ════════════════════════════════════════════════════════════════════════════
--  20260517160000_client_error_events.sql
--  Phase 5 / Hour 3 — destination table for the in-house ErrorBoundary sink.
--
--  WHY THIS TABLE EXISTS
--  ─────────────────────
--  Sentry isn't installed yet. The root ErrorBoundary catches render-time
--  crashes and ships them to this table best-effort. Post-launch, we can
--  swap the sink for Sentry.captureException and either drop this table or
--  keep it as a redundant local mirror — the contract doesn't change.
--
--  RLS POSTURE
--  ───────────
--  - Anyone authenticated can INSERT their OWN report (actor_id = auth.uid()
--    OR actor_id IS NULL for anon reports that slipped through before
--    sign-in finished bootstrapping). That's the only privilege we grant.
--  - No SELECT for authenticated. Only service_role / super_admin can read,
--    via separate views/dashboards built later.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.client_error_events (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL    DEFAULT now(),
  actor_id          uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  platform          text,         -- 'ios' | 'android' | 'web'
  platform_version  text,
  app_version       text,
  message           text        NOT NULL,
  stack             text,
  component_stack   text,
  url               text,         -- best-effort current route
  extra             jsonb        DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS client_error_events_created_at_idx
  ON public.client_error_events (created_at DESC);

CREATE INDEX IF NOT EXISTS client_error_events_actor_idx
  ON public.client_error_events (actor_id, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.client_error_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_error_events_insert_self
  ON public.client_error_events;

CREATE POLICY client_error_events_insert_self
  ON public.client_error_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_id IS NULL OR actor_id = auth.uid()
  );

-- No SELECT/UPDATE/DELETE policies for authenticated. Only super_admin
-- consumes this surface, via a dedicated view added in a later sprint.

COMMIT;
