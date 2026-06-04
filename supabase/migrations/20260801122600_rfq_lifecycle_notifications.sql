-- ════════════════════════════════════════════════════════════════════════════
--  20260801122600_rfq_lifecycle_notifications.sql
--
--  Make the turnkey loop ALIVE + race-proof.
--
--    • _spawn_inspection_for_award(): now (a) locks the RFQ row FOR UPDATE so
--      concurrent awards serialize (with the 122500 unique index, double-spawn
--      AND double-accept are impossible), and (b) emits notifications via the
--      canonical nx_notify / nx_notify_admins helpers — winner, each losing
--      bidder, and the admin queue. Notification calls are guarded so a notify
--      hiccup can never roll back an award.
--    • award_quote(): locks + re-checks the RFQ under the lock, so a second
--      concurrent award gets a clean rfq_not_awardable instead of a half-accept.
--
--  Function bodies are reproduced verbatim from 121800 with only these additions.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._spawn_inspection_for_award()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rfq    public.supplier_rfqs;
  v_sup    public.supplier_profiles;
  v_job_id uuid;
  v_itype  text;
  v_title  text;
  v_link   text;
  v_losers uuid[];
  v_loser  uuid;
BEGIN
  -- Lock the RFQ row → serialize concurrent awards.
  SELECT * INTO v_rfq FROM public.supplier_rfqs WHERE id = NEW.rfq_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- idempotent: never spawn twice for the same RFQ
  IF v_rfq.spawned_job_id IS NOT NULL THEN RETURN NEW; END IF;

  v_link := '/rfqs/' || v_rfq.id::text;

  -- settle losing quotes + capture them for notification
  WITH d AS (
    UPDATE public.supplier_quotes
       SET status = 'declined'
     WHERE rfq_id = v_rfq.id AND id <> NEW.id AND status NOT IN ('declined','withdrawn')
    RETURNING supplier_id
  )
  SELECT array_agg(supplier_id) INTO v_losers FROM d;

  BEGIN
    IF v_losers IS NOT NULL THEN
      FOREACH v_loser IN ARRAY v_losers LOOP
        PERFORM public.nx_notify(v_loser,
          'Quote not selected',
          'Your quote on "' || coalesce(v_rfq.title,'an RFQ') || '" was not selected.',
          'rfq_quote_declined', v_link, NULL);
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- some RFQs are pure procurement (no inspection requested)
  IF coalesce(v_rfq.requires_source_inspection, true) = false THEN
    UPDATE public.supplier_rfqs SET status = 'awarded' WHERE id = v_rfq.id AND status <> 'awarded';
    BEGIN
      PERFORM public.nx_notify(NEW.supplier_id,
        'Quote awarded',
        'Your quote on "' || coalesce(v_rfq.title,'an RFQ') || '" was accepted.',
        'rfq_quote_awarded', v_link, NULL);
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RETURN NEW;
  END IF;

  SELECT * INTO v_sup FROM public.supplier_profiles WHERE id = NEW.supplier_id;

  -- compliance ⇒ scope set; quality ⇒ scope null  (satisfies jobs_compliance_requires_template)
  v_itype := CASE WHEN v_rfq.scope_template_id IS NOT NULL THEN 'compliance' ELSE 'quality' END;
  v_title := left('Source / FAT inspection — ' || coalesce(v_rfq.title, 'RFQ'), 200);

  INSERT INTO public.jobs (
    title, description, status, moderation_status, inspection_type, scope_template_id,
    client_id, contractor_id, price_cents, payout_status, escrow_status, job_type, urgency,
    latitude, longitude, location, job_country, source_rfq_id
  ) VALUES (
    v_title,
    'Auto-generated from an awarded RFQ. Inspect the fabrication/service at the supplier facility (FAT / QA-QC) before shipment. Discipline is set by the RFQ scope; admin assigns the matched inspector and payout.',
    'open', 'pending_review', v_itype, v_rfq.scope_template_id,
    v_rfq.client_id, NULL, 0, 'unpaid', 'pending', 'on_site', 'normal',
    v_sup.geo_lat, v_sup.geo_lng, coalesce(v_sup.legal_name, 'Supplier facility'), v_sup.country_code,
    v_rfq.id
  )
  RETURNING id INTO v_job_id;

  UPDATE public.supplier_rfqs
     SET status = 'awarded', spawned_job_id = v_job_id
   WHERE id = v_rfq.id;

  BEGIN
    PERFORM public.nx_notify(NEW.supplier_id,
      'Quote awarded',
      'Your quote on "' || coalesce(v_rfq.title,'an RFQ') || '" was accepted. A source/FAT inspection will be scheduled at your facility.',
      'rfq_quote_awarded', v_link, v_job_id);
    PERFORM public.nx_notify_admins(
      'Source/FAT job created',
      'Awarded RFQ "' || coalesce(v_rfq.title,'RFQ') || '" — assign a discipline-matched inspector.',
      'source_job_created', '/(admin)/job-moderation', v_job_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN NEW;
END $$;

-- award_quote — lock the RFQ + re-check awardability under the lock
CREATE OR REPLACE FUNCTION public.award_quote(p_quote_id uuid)
RETURNS public.jobs LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_q public.supplier_quotes; v_rfq public.supplier_rfqs; v_job public.jobs;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_q FROM public.supplier_quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_quote'; END IF;
  SELECT * INTO v_rfq FROM public.supplier_rfqs WHERE id = v_q.rfq_id FOR UPDATE;
  IF NOT (v_rfq.client_id = v_uid OR public.nx_is_admin()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_rfq.status NOT IN ('open','quoted') THEN RAISE EXCEPTION 'rfq_not_awardable'; END IF;

  UPDATE public.supplier_quotes SET status = 'accepted' WHERE id = p_quote_id;   -- fires the spawn trigger

  SELECT * INTO v_job FROM public.jobs WHERE source_rfq_id = v_rfq.id ORDER BY created_at DESC LIMIT 1;
  RETURN v_job;
END $$;

REVOKE ALL ON FUNCTION public.award_quote(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.award_quote(uuid) TO authenticated;

DO $$ BEGIN
  IF to_regprocedure('public.award_quote(uuid)') IS NULL THEN RAISE EXCEPTION 'SELFTEST award_quote missing'; END IF;
  IF to_regprocedure('public.nx_notify(uuid,text,text,text,text,uuid)') IS NULL THEN RAISE EXCEPTION 'SELFTEST nx_notify missing'; END IF;
  RAISE NOTICE 'RFQ lifecycle notifications wired (winner/losers/admin) + award & spawn serialized under row lock.';
END $$;

COMMIT;
