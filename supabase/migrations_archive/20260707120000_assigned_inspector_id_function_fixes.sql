-- ════════════════════════════════════════════════════════════════════════════
--  20260707120000_assigned_inspector_id_function_fixes.sql
--
--  CLEANUP HOTFIX — the `assigned_inspector_id` phantom, finished.
--
--  EVIDENCE (verified 2026-05-29): `assigned_inspector_id` is declared as a
--  column NOWHERE in the schema; the production baseline's jobs table uses
--  `contractor_id` (set by the authorized dispatch: assign-inspector-to-job).
--  Every reference to `assigned_inspector_id` is a lookup against public.jobs
--  using the wrong (historical) name.
--
--  Two parts, each reproduced verbatim from its latest definition with ONLY the
--  column name corrected (assigned_inspector_id → contractor_id):
--
--  A) plpgsql FUNCTIONS (stored as text → these error at call time on the live DB):
--    • ensure_job_conversation  (20260518160000) — opening inspector↔admin chat
--    • can_review_job           (20260518200000) — review eligibility
--    • file_dispute             (20260518200000) — filing a dispute
--
--  B) RLS / storage POLICIES — on the live DB these are likely already attnum-
--     bound and working, but rather than RELY on that unverifiable assumption we
--     DROP+CREATE them so correctness is provable by construction (same names,
--     same predicates, column corrected):
--    • reviews_insert_reviewer_completed  (public.reviews)
--    • cdocs_inspector_read               (public.client_documents)
--    • cdocs_storage_inspector_read       (storage.objects)
--
--  Pure correctness fix. Additive/replace-only. No schema change.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1) ensure_job_conversation ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_job_conversation(
  p_job_id uuid,
  p_kind   text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_conv_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF p_kind NOT IN ('job_client_admin','job_inspector_admin') THEN
    RAISE EXCEPTION 'invalid conversation kind';
  END IF;

  -- Caller-role gate. Client/agency/enterprise → job_client_admin only.
  -- Inspector (must be the *assigned* one) → job_inspector_admin only.
  IF p_kind = 'job_client_admin' THEN
    IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id AND client_id = v_uid) THEN
      RAISE EXCEPTION 'not authorised: only the job''s client may open a job_client_admin room';
    END IF;
  ELSE -- job_inspector_admin
    IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id AND contractor_id = v_uid) THEN
      RAISE EXCEPTION 'not authorised: only the assigned inspector may open a job_inspector_admin room';
    END IF;
  END IF;

  SELECT id INTO v_conv_id FROM public.conversations
   WHERE job_id = p_job_id AND kind = p_kind::public.conversation_kind AND user_id = v_uid
   LIMIT 1;
  IF v_conv_id IS NULL THEN
    INSERT INTO public.conversations(kind, user_id, job_id, title)
      VALUES (
        p_kind::public.conversation_kind, v_uid, p_job_id,
        CASE p_kind
          WHEN 'job_client_admin'    THEN 'Job chat · client side'
          WHEN 'job_inspector_admin' THEN 'Job chat · inspector side'
        END
      )
      RETURNING id INTO v_conv_id;
  END IF;
  RETURN v_conv_id;
END $$;

GRANT EXECUTE ON FUNCTION public.ensure_job_conversation(uuid, text) TO authenticated;

-- ─── 2) can_review_job ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_review_job(p_job_id uuid, p_direction text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_eligible boolean := false;
  v_already boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  IF p_direction NOT IN ('client_to_inspector','inspector_to_client') THEN RETURN false; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.jobs j
     WHERE j.id = p_job_id AND j.status = 'completed'
       AND (
         (p_direction = 'client_to_inspector' AND j.client_id = v_uid)
         OR (p_direction = 'inspector_to_client' AND j.contractor_id = v_uid)
       )
  ) INTO v_eligible;
  IF NOT v_eligible THEN RETURN false; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.reviews
     WHERE job_id = p_job_id AND reviewer_id = v_uid AND direction = p_direction
  ) INTO v_already;
  RETURN NOT v_already;
END $fn$;

GRANT EXECUTE ON FUNCTION public.can_review_job(uuid, text) TO authenticated;

-- ─── 3) file_dispute ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.file_dispute(
  p_job_id   uuid,
  p_category text,
  p_body     text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_role       text;
  v_dispute_id uuid;
  v_admin_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF p_category NOT IN ('scope','quality','payment','communication','other') THEN
    RAISE EXCEPTION 'invalid category';
  END IF;
  IF char_length(p_body) < 20 OR char_length(p_body) > 8000 THEN
    RAISE EXCEPTION 'body must be 20-8000 characters';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role NOT IN ('client','agency','enterprise','inspector') THEN
    RAISE EXCEPTION 'role % not authorised to file disputes', v_role;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.jobs
     WHERE id = p_job_id
       AND (client_id = v_uid OR contractor_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'not a party to this job';
  END IF;

  INSERT INTO public.disputes (job_id, opener_id, opener_role, category, body)
    VALUES (p_job_id, v_uid, v_role, p_category, p_body)
    RETURNING id INTO v_dispute_id;

  -- Pause escrow release
  UPDATE public.jobs
     SET escrow_paused = true,
         escrow_paused_reason = format('Dispute filed: %s', p_category)
   WHERE id = p_job_id;

  -- Notify every admin / super_admin
  FOR v_admin_id IN
    SELECT id FROM public.profiles WHERE role IN ('admin','super_admin')
  LOOP
    PERFORM public.notify(
      v_admin_id,
      'dispute_filed',
      'New dispute filed',
      format('%s dispute on job (%s) by %s', p_category, p_job_id::text, v_role),
      format('/admin/disputes'),
      p_job_id
    );
  END LOOP;

  RETURN v_dispute_id;
END $fn$;

GRANT EXECUTE ON FUNCTION public.file_dispute(uuid, text, text) TO authenticated;

-- ─── 4) RLS / storage policies (recreated with contractor_id) ─────────
-- Reviews: a party may insert a review only for a completed job they were on.
DROP POLICY IF EXISTS "reviews_insert_reviewer_completed" ON public.reviews;
CREATE POLICY "reviews_insert_reviewer_completed" ON public.reviews FOR INSERT
  WITH CHECK (
    reviewer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = job_id AND j.status = 'completed'
         AND (
           (direction = 'client_to_inspector' AND j.client_id = auth.uid() AND j.contractor_id = reviewee_id)
           OR (direction = 'inspector_to_client' AND j.contractor_id = auth.uid() AND j.client_id = reviewee_id)
         )
    )
  );

-- Client documents: the assigned inspector may read job-scoped docs.
DROP POLICY IF EXISTS "cdocs_inspector_read" ON public.client_documents;
CREATE POLICY "cdocs_inspector_read" ON public.client_documents FOR SELECT
  USING (
    job_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = client_documents.job_id
         AND j.contractor_id = auth.uid()
    )
  );

-- Client-document storage objects: same job-scoped inspector read.
DROP POLICY IF EXISTS "cdocs_storage_inspector_read" ON storage.objects;
CREATE POLICY "cdocs_storage_inspector_read" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'client_documents'
    AND (storage.foldername(name))[2] IS NOT NULL
    AND (storage.foldername(name))[2] <> 'org'
    AND EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id::text = (storage.foldername(name))[2]
         AND j.contractor_id = auth.uid()
    )
  );

COMMIT;
