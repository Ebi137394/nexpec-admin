-- ════════════════════════════════════════════════════════════════════════════
--  20260617120000_inspector_domain_practice.sql
--  LAYER 2 — declare which inspection domains each inspector practices in.
--
--  Coexists with the existing capability primitives:
--    • profiles.specialty_slugs (the discipline-level tags)
--    • inspector_certificates    (the formal credential records)
--    • profiles.skills           (the free-form skill tags)
--
--  This table answers ONE question: "Which inspection domains does this
--  inspector serve?" — a higher-level filter for the marketplace.
--  Certification-to-scope mapping is deferred to a later layer when we
--  ship the civil / electrical / mechanical scope catalogue.
--
--  Every existing inspector is backfilled with industrial_ndt = primary.
--
--  ORDER DEPENDENCY
--  ────────────────
--  This migration assumes 20260616120000_inspection_domain_primitive.sql
--  has been applied (it provides `public.inspection_domain` ENUM).
--
--  NO-TOUCH COMMITMENTS (verified at write time)
--  ─────────────────────────────────────────────
--    • `profiles.specialty_slugs`            — untouched
--    • `profiles.skills`                     — untouched
--    • `profiles.role`                       — untouched
--    • `inspector_certificates` (any column) — untouched
--    • Every existing RLS policy             — untouched
--    • Every existing RPC                    — untouched
--    • Existing matching engine (array       — untouched
--       overlap on specialty_slugs)            (Layer 3+ optionally
--                                              joins this table for
--                                              additional filtering)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) The table.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inspector_domain_practice (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspector_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  domain        public.inspection_domain NOT NULL,
  is_primary    boolean NOT NULL DEFAULT false,
  declared_at   timestamptz NOT NULL DEFAULT now(),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inspector_domain_practice_unique UNIQUE (inspector_id, domain)
);

COMMENT ON TABLE public.inspector_domain_practice IS
  'Inspector self-declared (and admin-verifiable) inspection-domain '
  'practice. Composes with profiles.specialty_slugs and inspector_certificates; '
  'does not replace either. One row per (inspector_id, domain). Exactly one '
  'is_primary=true per inspector — enforced via partial unique index.';

-- Exactly one primary domain per inspector. Partial unique index because
-- the constraint only applies when is_primary = true.
CREATE UNIQUE INDEX IF NOT EXISTS inspector_domain_practice_one_primary_per_inspector
  ON public.inspector_domain_practice (inspector_id)
  WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS inspector_domain_practice_domain_idx
  ON public.inspector_domain_practice (domain)
  WHERE active = true;

-- updated_at trigger.
CREATE OR REPLACE FUNCTION public.tg_inspector_domain_practice_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$fn$;

DROP TRIGGER IF EXISTS tg_inspector_domain_practice_set_updated_at ON public.inspector_domain_practice;
CREATE TRIGGER tg_inspector_domain_practice_set_updated_at
  BEFORE UPDATE ON public.inspector_domain_practice
  FOR EACH ROW EXECUTE FUNCTION public.tg_inspector_domain_practice_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- 2) Backfill — every existing inspector gets industrial_ndt = primary.
--    Idempotent via ON CONFLICT — re-running the migration is safe.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO public.inspector_domain_practice (inspector_id, domain, is_primary, declared_at)
SELECT p.id, 'industrial_ndt'::public.inspection_domain, true, COALESCE(p.created_at, now())
  FROM public.profiles p
 WHERE p.role = 'inspector'
ON CONFLICT (inspector_id, domain) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 3) RLS — inspectors manage their own rows; admins manage anything;
--    everyone authenticated can read (for marketplace matching).
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.inspector_domain_practice ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS idp_read_all          ON public.inspector_domain_practice;
DROP POLICY IF EXISTS idp_insert_self       ON public.inspector_domain_practice;
DROP POLICY IF EXISTS idp_update_self_admin ON public.inspector_domain_practice;
DROP POLICY IF EXISTS idp_delete_self_admin ON public.inspector_domain_practice;

CREATE POLICY idp_read_all
  ON public.inspector_domain_practice FOR SELECT
  USING (true);

CREATE POLICY idp_insert_self
  ON public.inspector_domain_practice FOR INSERT
  WITH CHECK (inspector_id = auth.uid() OR public.nx_is_admin());

CREATE POLICY idp_update_self_admin
  ON public.inspector_domain_practice FOR UPDATE
  USING (inspector_id = auth.uid() OR public.nx_is_admin())
  WITH CHECK (inspector_id = auth.uid() OR public.nx_is_admin());

CREATE POLICY idp_delete_self_admin
  ON public.inspector_domain_practice FOR DELETE
  USING (inspector_id = auth.uid() OR public.nx_is_admin());

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK PROCEDURE
-- ─────────────────────────────────────────────────────────────────────
-- BEGIN;
--   DROP POLICY IF EXISTS idp_read_all          ON public.inspector_domain_practice;
--   DROP POLICY IF EXISTS idp_insert_self       ON public.inspector_domain_practice;
--   DROP POLICY IF EXISTS idp_update_self_admin ON public.inspector_domain_practice;
--   DROP POLICY IF EXISTS idp_delete_self_admin ON public.inspector_domain_practice;
--   DROP TRIGGER IF EXISTS tg_inspector_domain_practice_set_updated_at ON public.inspector_domain_practice;
--   DROP FUNCTION IF EXISTS public.tg_inspector_domain_practice_set_updated_at();
--   DROP TABLE IF EXISTS public.inspector_domain_practice;
-- COMMIT;
