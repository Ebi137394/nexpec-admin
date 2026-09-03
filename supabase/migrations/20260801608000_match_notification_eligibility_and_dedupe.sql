-- ════════════════════════════════════════════════════════════════════════════
--  "New job matched to you" must mean discover_jobs will actually return it
--
--  ROOT CAUSE A (false promise). Neither notification path applied the CCI gate
--  that discover_jobs enforces:
--    * notify_inspectors_about_existing_job() looped over
--      `SELECT id FROM profiles WHERE role='inspector'` — EVERY inspector, with
--      no eligibility test of any kind.
--    * nx_job_broadcast_targets() (used by the approval trigger) never
--      references is_active_cci or inspection_type.
--  discover_jobs STEP 5.5 hides a compliance job unless the inspector holds an
--  active CCI credential at the scope template's tier, so an inspector without
--  one was told about a job the feed would always refuse to show.
--
--  ROOT CAUSE B (duplicates). The approval trigger had a SELECT-then-INSERT
--  guard; notify_inspectors_about_existing_job() had none, so repeat calls
--  fanned out again. A read-then-write check is also not race-proof.
--
--  FIX. One canonical predicate, used by both paths, plus a UNIQUE INDEX so the
--  database — not application logic — enforces one job-match notification per
--  (recipient, job). Additive: no table, column, policy or RPC signature
--  changes, and no mobile contract is touched.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · Canonical eligibility, mirroring discover_jobs ─────────────────────
CREATE OR REPLACE FUNCTION public.nx_inspector_can_discover_job(
  p_job_id       uuid,
  p_inspector_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.jobs j
     WHERE j.id = p_job_id
       -- Row conditions enforced by jobs_inspector_secure_view, which
       -- discover_jobs reads instead of the base table.
       AND j.deleted_at IS NULL
       AND j.status = 'open'
       AND j.moderation_status = 'approved'
       AND COALESCE(j.marketplace_hidden, false) = false
       -- discover_jobs: AND j.contractor_id IS NULL
       AND j.contractor_id IS NULL
       -- discover_jobs STEP 5.5, verbatim. Fail-closed: a NULL required tier
       -- makes is_active_cci() false, exactly as in the feed.
       AND (
         COALESCE(j.inspection_type, 'quality') <> 'compliance'
         OR (
           j.scope_template_id IS NOT NULL
           AND public.is_active_cci(
                 p_inspector_id,
                 (SELECT t.requires_credential_tier
                    FROM public.inspection_scope_templates t
                   WHERE t.id = j.scope_template_id)
               )
         )
       )
  )
  -- Recipient must still be an inspector-side role.
  AND EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_inspector_id AND p.role IN ('inspector', 'senior')
  );
$$;

COMMENT ON FUNCTION public.nx_inspector_can_discover_job(uuid, uuid) IS
  'Single source of truth for "can this inspector discover this job": mirrors the non-geographic filters of discover_jobs, including the compliance/CCI tier gate. Distance/radius is deliberately excluded — it is a user preference in the feed, not an eligibility rule.';

GRANT EXECUTE ON FUNCTION public.nx_inspector_can_discover_job(uuid, uuid) TO authenticated;

-- ── 2 · Durable idempotency ────────────────────────────────────────────────
-- Collapse existing duplicates first (keep the earliest per recipient+job), or
-- the unique index cannot be built. Scoped strictly to job-match notifications.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY recipient_id, job_id
                                ORDER BY created_at, id) AS rn
    FROM public.notifications
   WHERE job_id IS NOT NULL AND kind = 'assignment'
)
DELETE FROM public.notifications n
 USING ranked r
 WHERE n.id = r.id AND r.rn > 1;

-- Race-proof: concurrent approvals and retries now collide in the database
-- rather than relying on a SELECT-then-INSERT check that can interleave.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_job_match_unique
  ON public.notifications (recipient_id, job_id)
  WHERE job_id IS NOT NULL AND kind = 'assignment';

-- ── 3 · Apply eligibility + idempotency to the broadcast path ──────────────
CREATE OR REPLACE FUNCTION public.notify_inspectors_about_existing_job(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  r       RECORD;
  v_title text;
BEGIN
  SELECT COALESCE(NULLIF(title, ''), 'New inspection') INTO v_title
    FROM public.jobs WHERE id = p_job_id;

  FOR r IN
    SELECT p.id
      FROM public.profiles p
     WHERE p.role IN ('inspector', 'senior')
       -- Was: every inspector, unconditionally. Now the same rule the feed uses.
       AND public.nx_inspector_can_discover_job(p_job_id, p.id)
  LOOP
    BEGIN
      PERFORM public.notify_safe(
        r.id, 'assignment', 'New job available', v_title,
        -- link_href is retained for the web console. The released mobile app
        -- deliberately ignores it and routes by job_id (app/notifications.tsx),
        -- so this value cannot change mobile behaviour either way.
        '/admin/jobs/' || p_job_id::text, p_job_id);
    EXCEPTION WHEN unique_violation THEN
      NULL;  -- already notified about this job; the index did its job
    END;
  END LOOP;
END $$;

-- ── 4 · Same gate on the approval trigger ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_inspectors_on_job_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  t     RECORD;
  v_why text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.moderation_status, '') = 'approved'
     AND COALESCE(OLD.moderation_status, '') <> 'approved'
     AND NEW.status = 'open'
     AND NEW.deleted_at IS NULL THEN

    FOR t IN SELECT * FROM public.nx_job_broadcast_targets(NEW.id) LOOP
      -- nx_job_broadcast_targets scores match quality but does NOT check
      -- discoverability, so the canonical gate is applied here.
      CONTINUE WHEN NOT public.nx_inspector_can_discover_job(NEW.id, t.inspector_id);
      v_why := NULLIF(array_to_string(t.reasons, ' · '), '');
      BEGIN
        PERFORM public.notify_safe(
          t.inspector_id, 'assignment', 'New job matched to you',
          COALESCE(NULLIF(NEW.title, ''), 'New inspection')
            || CASE WHEN v_why IS NULL THEN '' ELSE ' — ' || v_why END,
          '/admin/jobs/' || NEW.id::text, NEW.id);
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
