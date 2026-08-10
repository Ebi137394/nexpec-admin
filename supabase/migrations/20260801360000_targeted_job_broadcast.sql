-- ════════════════════════════════════════════════════════════════════════════
--  20260801360000_targeted_job_broadcast.sql
--
--  TARGETED JOB BROADCAST — tell the RIGHT inspectors a job went live.
--
--  ── CORRECTION TO AN EARLIER NOTE ──────────────────────────────────────────
--  The header of 20260801358000 says notify_inspectors_on_job_approved "pushes
--  EVERY approved job to EVERY inspector". That was wrong, and this migration
--  corrects the record: the function exists (baseline:13907) and does contain
--  `FOR r IN SELECT id FROM public.profiles WHERE role = 'inspector'`, but NO
--  TRIGGER HAS EVER BEEN ATTACHED TO IT. It is dormant. So the real defect is
--  the opposite of noise — inspectors are told NOTHING when a job is approved.
--
--  The live notifier, tg_notify_jobs (trg_notify_jobs), covers three audiences:
--  admins on job INSERT, the client on moderation change, and the ALREADY
--  ASSIGNED inspector on status change. Nobody tells the inspector POOL that a
--  job is open. On a marketplace, that is the liquidity path.
--
--  ── WHAT THIS DOES ─────────────────────────────────────────────────────────
--  Activates the dormant function with match-based targeting, and attaches the
--  trigger. tg_notify_jobs is NOT touched — it works, and duplicating its three
--  audiences would be the "second system" mistake.
--
--  ── ADDITIVE ONLY ──────────────────────────────────────────────────────────
--  Nothing is dropped. notify_inspectors_on_job_approved is IMPROVED IN PLACE
--  (same name, same signature) rather than replaced by a parallel function, so
--  there is exactly one job-broadcast path. A new trigger is added. The
--  pre-existing matchers and tg_notify_jobs are untouched.
--
--  ── WHY A "CORE" SPLIT ─────────────────────────────────────────────────────
--  20260801358000 gave nx_inspector_job_match a location-oracle guard
--  (self-or-admin). A TRIGGER has no reliable auth.uid() — moderation approval
--  can arrive from an Edge Function on service_role, where auth.uid() is NULL —
--  so calling the guarded function from the trigger would raise
--  'not_authenticated' and (because the handler swallows errors) silently
--  notify nobody. The scoring math therefore moves to a PRIVATE core function
--  that carries no auth check and is granted to NOBODY. The public entry points
--  keep their guards and delegate. One source of scoring truth, two doors.
--
--  ── SAFETY ─────────────────────────────────────────────────────────────────
--   • MONEY-FREE: reads no money column; sends no money. Self-tested.
--   • Never notifies the job owner, or the already-assigned inspector.
--   • Never notifies twice for the same job (idempotent re-approval).
--   • A floor guarantees a niche job still reaches its best candidates.
--   • A cap prevents a notification storm.
--   • Handler swallows errors: a notification failure must never block a job
--     approval (same defensive posture as tg_notify_jobs).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) PRIVATE scoring core (no auth check; granted to nobody) ──────────────
CREATE OR REPLACE FUNCTION public.nx_inspector_job_match_core(
  p_job_id       uuid,
  p_inspector_id uuid
) RETURNS TABLE (
  score          int,
  specialty_pts  int,
  cert_pts       int,
  distance_pts   int,
  distance_km    numeric,
  verified_pts   int,
  available_pts  int,
  work_authorized boolean,
  reasons        text[]
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  j          RECORD;
  p          RECORD;
  v_req_spec int;
  v_overlap  int;
  v_req_cert int;
  v_held     int;
  v_radius   numeric;
  v_reasons  text[] := '{}';
BEGIN
  SELECT jb.specialty_slugs, jb.required_certifications, jb.job_country, jb.geog
    INTO j FROM public.jobs jb WHERE jb.id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'job not found' USING errcode = 'P0002'; END IF;

  SELECT pr.specialty_slugs, pr.is_verified, pr.is_available,
         pr.home_base_lat, pr.home_base_lng, pr.travel_radius_km,
         pr.work_authorized_countries
    INTO p FROM public.profiles pr WHERE pr.id = p_inspector_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'inspector not found' USING errcode = 'P0002'; END IF;

  -- specialty (40)
  v_req_spec := COALESCE(array_length(j.specialty_slugs, 1), 0);
  IF v_req_spec = 0 THEN
    specialty_pts := 20;
  ELSE
    SELECT count(*) INTO v_overlap FROM unnest(j.specialty_slugs) s WHERE s = ANY (p.specialty_slugs);
    specialty_pts := round(40.0 * v_overlap / v_req_spec)::int;
    v_reasons := v_reasons || CASE WHEN v_overlap > 0
      THEN format('covers %s/%s discipline(s)', v_overlap, v_req_spec)
      ELSE 'no matching discipline' END;
  END IF;

  -- certifications (25) — verified and unexpired only
  v_req_cert := COALESCE(array_length(j.required_certifications, 1), 0);
  IF v_req_cert = 0 THEN
    cert_pts := 12;
  ELSE
    SELECT count(DISTINCT lower(btrim(r))) INTO v_held
      FROM unnest(j.required_certifications) r
     WHERE EXISTS (
       SELECT 1 FROM public.certifications c
        WHERE c.user_id = p_inspector_id
          AND c.status = 'verified'
          AND (c.expiry_date IS NULL OR c.expiry_date > current_date)
          AND lower(btrim(c.name)) = lower(btrim(r)));
    cert_pts := round(25.0 * v_held / v_req_cert)::int;
    v_reasons := v_reasons || format('holds %s/%s required cert(s)', v_held, v_req_cert);
  END IF;

  -- distance (20)
  IF j.geog IS NOT NULL AND p.home_base_lat IS NOT NULL AND p.home_base_lng IS NOT NULL THEN
    distance_km := round((public.st_distance(
      j.geog,
      public.st_setsrid(public.st_makepoint(p.home_base_lng::double precision,
                                            p.home_base_lat::double precision), 4326)::public.geography
    ) / 1000.0)::numeric, 1);
    v_radius := GREATEST(COALESCE(p.travel_radius_km, 100), 1)::numeric;
    distance_pts := CASE WHEN distance_km <= v_radius
                         THEN round(20.0 * (1 - distance_km / v_radius))::int ELSE 0 END;
    v_reasons := v_reasons || format('%s km away', distance_km);
  ELSE
    distance_km := NULL; distance_pts := 10;
  END IF;

  verified_pts  := CASE WHEN COALESCE(p.is_verified, false)  THEN 10 ELSE 0 END;
  available_pts := CASE WHEN COALESCE(p.is_available, false) THEN 5  ELSE 0 END;
  IF verified_pts  > 0 THEN v_reasons := v_reasons || 'verified';  END IF;
  IF available_pts > 0 THEN v_reasons := v_reasons || 'available'; END IF;

  work_authorized := (j.job_country IS NULL) OR (j.job_country = ANY (p.work_authorized_countries));
  score := LEAST(GREATEST(specialty_pts + cert_pts + distance_pts + verified_pts + available_pts, 0), 100);
  reasons := v_reasons;
  RETURN NEXT;
END $fn$;

ALTER FUNCTION public.nx_inspector_job_match_core(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_inspector_job_match_core(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_inspector_job_match_core(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.nx_inspector_job_match_core(uuid, uuid) IS
  'PRIVATE scoring core — the single source of matching truth. No auth check by design, so triggers (which may run with a NULL auth.uid()) can score. Granted to NOBODY except service_role; the location-oracle guard lives in the public wrapper nx_inspector_job_match.';

-- ── 2) Public wrappers now delegate to the core (guards unchanged) ──────────
CREATE OR REPLACE FUNCTION public.nx_inspector_job_match(
  p_job_id uuid, p_inspector_id uuid
) RETURNS TABLE (
  score int, specialty_pts int, cert_pts int, distance_pts int, distance_km numeric,
  verified_pts int, available_pts int, work_authorized boolean, reasons text[]
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;
  -- LOCATION-ORACLE GUARD (see 20260801358000): distance_km would otherwise let
  -- one inspector trilaterate another's home_base across known-coordinate jobs.
  IF auth.uid() <> p_inspector_id AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'may only score yourself' USING errcode = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.nx_inspector_job_match_core(p_job_id, p_inspector_id);
END $fn$;

ALTER FUNCTION public.nx_inspector_job_match(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_inspector_job_match(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_inspector_job_match(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.nx_match_inspectors_for_job(
  p_job_id uuid, p_limit int DEFAULT 20, p_include_unverified boolean DEFAULT false
) RETURNS TABLE (
  inspector_id uuid, full_name text, score int, specialty_pts int, cert_pts int,
  distance_pts int, distance_km numeric, work_authorized boolean, is_verified boolean,
  rating numeric, completed_jobs int, reasons text[]
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE j RECORD;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;
  SELECT jb.client_id, jb.agency_id INTO j FROM public.jobs jb WHERE jb.id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'job not found' USING errcode = 'P0002'; END IF;

  RETURN QUERY
  SELECT pr.id, pr.full_name, m.score, m.specialty_pts, m.cert_pts, m.distance_pts,
         m.distance_km, m.work_authorized, COALESCE(pr.is_verified, false),
         pr.rating_average, pr.completed_jobs_count, m.reasons
    FROM public.profiles pr
    CROSS JOIN LATERAL public.nx_inspector_job_match_core(p_job_id, pr.id) m
   WHERE pr.role IN ('inspector', 'senior')
     AND (p_include_unverified OR COALESCE(pr.is_verified, false) = true)
     AND pr.id IS DISTINCT FROM j.client_id
     AND pr.id IS DISTINCT FROM j.agency_id
   ORDER BY m.score DESC, pr.rating_average DESC NULLS LAST, pr.completed_jobs_count DESC NULLS LAST
   LIMIT GREATEST(COALESCE(p_limit, 20), 1);
END $fn$;

ALTER FUNCTION public.nx_match_inspectors_for_job(uuid, int, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_match_inspectors_for_job(uuid, int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_match_inspectors_for_job(uuid, int, boolean) TO authenticated, service_role;

-- ── 3) Who should hear about this job ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_job_broadcast_targets(
  p_job_id    uuid,
  p_threshold int DEFAULT NULL,
  p_min       int DEFAULT NULL,
  p_max       int DEFAULT NULL
) RETURNS TABLE (inspector_id uuid, score int, reasons text[])
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_threshold int;
  v_min       int;
  v_max       int;
  v_job       RECORD;
BEGIN
  -- Tunable at runtime by an admin without a migration.
  v_threshold := GREATEST(COALESCE(p_threshold,
                   NULLIF(public._app_config_get('job_broadcast_min_score'), '')::int, 45), 0);
  v_min       := GREATEST(COALESCE(p_min,
                   NULLIF(public._app_config_get('job_broadcast_min_targets'), '')::int, 3), 0);
  v_max       := GREATEST(COALESCE(p_max,
                   NULLIF(public._app_config_get('job_broadcast_max_targets'), '')::int, 50), 1);

  SELECT jb.client_id, jb.agency_id, jb.contractor_id INTO v_job
    FROM public.jobs jb WHERE jb.id = p_job_id;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  WITH scored AS (
    SELECT pr.id AS iid, m.score AS s, m.reasons AS rs,
           pr.rating_average AS ra, pr.completed_jobs_count AS cj
      FROM public.profiles pr
      CROSS JOIN LATERAL public.nx_inspector_job_match_core(p_job_id, pr.id) m
     WHERE pr.role IN ('inspector', 'senior')
       -- Explicitly unavailable inspectors are noise, not candidates. This
       -- removes no existing behaviour: nothing was being sent at all.
       AND COALESCE(pr.is_available, true) = true
       AND pr.id IS DISTINCT FROM v_job.client_id
       AND pr.id IS DISTINCT FROM v_job.agency_id
       -- the already-assigned inspector does not need a "new job" ping
       AND pr.id IS DISTINCT FROM v_job.contractor_id
  ), ranked AS (
    SELECT scored.*, row_number() OVER (ORDER BY s DESC, ra DESC NULLS LAST, cj DESC NULLS LAST) AS rn
      FROM scored
  )
  SELECT iid, s, rs FROM ranked
   -- Above the bar, OR in the top v_min so a niche job still reaches its best
   -- candidates rather than reaching nobody.
   WHERE (s >= v_threshold OR rn <= v_min)
   ORDER BY rn
   LIMIT v_max;
END $fn$;

ALTER FUNCTION public.nx_job_broadcast_targets(uuid, int, int, int) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_broadcast_targets(uuid, int, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_job_broadcast_targets(uuid, int, int, int) TO service_role;

COMMENT ON FUNCTION public.nx_job_broadcast_targets(uuid, int, int, int) IS
  'Inspectors who should hear that a job is open: score >= threshold, OR in the top N so a niche job still reaches its best candidates. Excludes the job owner, the assigned inspector, and explicitly-unavailable inspectors. Thresholds tunable via _app_config keys job_broadcast_min_score / _min_targets / _max_targets. Not granted to end users — it returns a candidate list.';

-- ── 4) Activate the dormant broadcaster, now targeted ───────────────────────
CREATE OR REPLACE FUNCTION public.notify_inspectors_on_job_approved() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  t     RECORD;
  v_why text;
  v_n   int := 0;
BEGIN
  -- Fire only on the transition into an open, approved, live job.
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.moderation_status, '') = 'approved'
     AND COALESCE(OLD.moderation_status, '') <> 'approved'
     AND NEW.status = 'open'
     AND NEW.deleted_at IS NULL
  THEN
    FOR t IN SELECT * FROM public.nx_job_broadcast_targets(NEW.id) LOOP
      -- Idempotent: never notify the same inspector twice about one job.
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.notifications n
         WHERE n.job_id = NEW.id AND n.recipient_id = t.inspector_id);

      v_why := NULLIF(array_to_string(t.reasons, ' · '), '');
      PERFORM public.notify_safe(
        t.inspector_id,
        'assignment',
        'New job matched to you',
        COALESCE(NULLIF(NEW.title, ''), 'A new inspection just cleared moderation.')
          || CASE WHEN v_why IS NOT NULL THEN ' — ' || v_why ELSE '' END,
        '/inspector/jobs/' || NEW.id::text,
        NEW.id);
      v_n := v_n + 1;
    END LOOP;
    IF v_n > 0 THEN
      RAISE NOTICE 'job % broadcast to % matched inspector(s)', NEW.id, v_n;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A notification problem must never block a job approval.
  RAISE WARNING 'notify_inspectors_on_job_approved: %', SQLERRM;
  RETURN NEW;
END $fn$;

ALTER FUNCTION public.notify_inspectors_on_job_approved() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_notify_inspectors_on_job_approved ON public.jobs;
CREATE TRIGGER trg_notify_inspectors_on_job_approved
  AFTER UPDATE OF moderation_status, status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.notify_inspectors_on_job_approved();

-- ── 5) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  dcore text := pg_get_functiondef('public.nx_inspector_job_match_core(uuid,uuid)'::regprocedure);
  dpub  text := pg_get_functiondef('public.nx_inspector_job_match(uuid,uuid)'::regprocedure);
  dtrg  text := pg_get_functiondef('public.notify_inspectors_on_job_approved()'::regprocedure);
  dtgt  text := pg_get_functiondef('public.nx_job_broadcast_targets(uuid,int,int,int)'::regprocedure);
BEGIN
  -- the trigger is actually attached (the whole point of this migration)
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notify_inspectors_on_job_approved'
       AND tgrelid = 'public.jobs'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the broadcast trigger is not attached to public.jobs';
  END IF;

  -- the pre-existing live notifier must still be attached (nothing removed)
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notify_jobs'
       AND tgrelid = 'public.jobs'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: trg_notify_jobs was disturbed — it must remain untouched';
  END IF;

  -- the core is private
  IF has_function_privilege('authenticated','public.nx_inspector_job_match_core(uuid,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.nx_inspector_job_match_core(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the unguarded scoring core is reachable by end users';
  END IF;
  IF has_function_privilege('authenticated','public.nx_job_broadcast_targets(uuid,int,int,int)','EXECUTE')
     OR has_function_privilege('anon','public.nx_job_broadcast_targets(uuid,int,int,int)','EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the broadcast target list is reachable by end users';
  END IF;

  -- the public wrapper kept its guard
  IF position('may only score yourself' IN dpub) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: nx_inspector_job_match lost its location-oracle guard';
  END IF;

  -- MONEY-FREE
  IF dcore ~* '\m(client_price_cents|inspector_payout_cents|payout_amount_cents|platform_spread_cents|budget_cents|price_cents|admin_confirmed_at|escrow|wallet)\M'
     OR dtrg ~* '\m(client_price_cents|inspector_payout_cents|payout_amount_cents|platform_spread_cents|budget_cents|price_cents|admin_confirmed_at|escrow|wallet)\M'
     OR dtgt ~* '\m(client_price_cents|inspector_payout_cents|payout_amount_cents|platform_spread_cents|budget_cents|price_cents|admin_confirmed_at|escrow|wallet)\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a broadcast function names a money surface';
  END IF;

  -- the broadcaster is idempotent by construction
  IF position('CONTINUE WHEN EXISTS' IN dtrg) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the broadcaster lost its duplicate guard';
  END IF;

  RAISE NOTICE 'targeted job broadcast active: matched inspectors are now told when a job opens.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
