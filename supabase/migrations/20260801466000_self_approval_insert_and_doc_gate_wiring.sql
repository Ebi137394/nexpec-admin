-- ════════════════════════════════════════════════════════════════════════════
--  20260801466000_self_approval_insert_and_doc_gate_wiring.sql
--
--  A third independent review found two P0s, both mine, both the SAME mistake:
--  I verified that a guard was ATTACHED, not that it BEHAVED.
--
--  ── P0-1: THE SELF-APPROVAL GUARD IS A NO-OP ON INSERT ─────────────────────
--  20260801462000 attached nx_guard_report_no_self_approval to
--  BEFORE INSERT OR UPDATE — but never redefined the FUNCTION, which reads
--  authorship from OLD (430000:515):
--      IF v_actor IS NULL OR v_actor IS DISTINCT FROM OLD.inspector_id
--         THEN RETURN NEW;
--  On INSERT, PL/pgSQL reads OLD.<field> as NULL rather than erroring, so that
--  first branch ALWAYS returns and the guard does nothing at all. An inspector
--  could POST a report with status='approved' and every approval flag already
--  true. Reachable: authenticated holds INSERT (baseline:40372) and the
--  permissive INSERT policies check only auth.uid() = inspector_id.
--
--  462000's selftest inspected tgtype bits and reported 4/4 — it proved the
--  trigger existed, which was exactly the wrong question.
--
--  Fixed by deriving the comparison row from TG_OP: on INSERT the author is
--  NEW.inspector_id and every prior flag is treated as false, so granting one
--  at creation is the same act as granting it later. 430000's reasoning for
--  reading OLD on UPDATE is preserved verbatim — it exists so a writer cannot
--  disclaim authorship in the same statement — and only the INSERT case, where
--  there is no OLD to read, uses NEW.
--
--  ── P0-2: THE DOCUMENT GATE WAS NEVER WIRED IN ─────────────────────────────
--  20260801462000 created nx_client_may_read_report_doc and claimed the 80%
--  gate now covered the deliverable. It is DEAD CODE: its only callers are
--  assertions in the behavioural suite. nx_can_access_doc (last redefined
--  20260801348000) still returns true for j.client_id = p_uid with no status,
--  approval or funding predicate, and mint-doc-url consults THAT. So the client
--  could still mint a signed URL for the final report before review, before the
--  remaining tranche and before delivery — only the `status` COLUMN was gated.
--
--  Worse, the test I wrote called the dead helper directly, so it certified the
--  function I authored rather than the path that ships. That is the same trap
--  the prosrc-regex suite fell into, one layer up.
--
--  Fixed by wiring the predicate into nx_can_access_doc's inspection_reports
--  branch, which is the function mint-doc-url and the storage path actually
--  call.
--
--  ── P1: A DUPLICATE TRIGGER FROM A NAME TYPO ───────────────────────────────
--  430000:543 installs trg_report_no_self_approval (SINGULAR). 462000:196
--  dropped trg_reportS_no_self_approval (PLURAL) — a name that never existed,
--  so the drop was a no-op — then created the plural. Both are attached and
--  both call the same function, so it double-fires on every UPDATE. 462000's
--  selftest enumerated only the plural name and reported 4/4.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. The guard now works on INSERT ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_guard_report_no_self_approval()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor  uuid := auth.uid();
  v_author uuid;
  v_old_status            text;
  v_old_client_approved   boolean;
  v_old_published         boolean;
  v_old_technical         boolean;
  v_old_financial         boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- No OLD exists. The author is the row being created, and every prior flag
    -- is false by definition — creating a report with a flag already set is the
    -- same act as setting it afterwards, and must be refused the same way.
    v_author              := NEW.inspector_id;
    v_old_status          := NULL;
    v_old_client_approved := false;
    v_old_published       := false;
    v_old_technical       := false;
    v_old_financial       := false;
  ELSE
    -- UPDATE: authorship is read from OLD, deliberately. 430000's reasoning
    -- stands — comparing against NEW would let a writer disclaim authorship in
    -- the same statement (reassign inspector_id AND grant a flag) and fall
    -- straight through. OLD is the row whose author actually did the work.
    v_author              := OLD.inspector_id;
    v_old_status          := OLD.status;
    v_old_client_approved := COALESCE(OLD.is_client_approved, false);
    v_old_published       := COALESCE(OLD.is_published, false);
    v_old_technical       := COALESCE(OLD.technical_approved, false);
    v_old_financial       := COALESCE(OLD.financial_approved, false);
  END IF;

  IF v_actor IS NULL OR v_actor IS DISTINCT FROM v_author THEN
    RETURN NEW;
  END IF;

  IF public.nx_report_review_transition(NEW.status) = 'approved'
     AND public.nx_report_review_transition(v_old_status) IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION
      'inspector % may not approve their own report % — review authority is explicit and belongs to the buyer or an admin',
      v_actor, NEW.id
      USING errcode = '42501';
  END IF;

  IF (COALESCE(NEW.is_client_approved, false) AND NOT v_old_client_approved)
     OR (COALESCE(NEW.is_published,       false) AND NOT v_old_published)
     OR (COALESCE(NEW.technical_approved, false) AND NOT v_old_technical)
     OR (COALESCE(NEW.financial_approved, false) AND NOT v_old_financial) THEN
    RAISE EXCEPTION
      'inspector % may not grant an approval flag on their own report %',
      v_actor, NEW.id
      USING errcode = '42501';
  END IF;

  RETURN NEW;
END $fn$;

ALTER FUNCTION public.nx_guard_report_no_self_approval() OWNER TO postgres;

-- ─── 2. One trigger, not two ────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_report_no_self_approval  ON public.inspection_reports;  -- 430000, singular
DROP TRIGGER IF EXISTS trg_reports_no_self_approval ON public.inspection_reports;  -- 462000, plural
CREATE TRIGGER trg_reports_no_self_approval
  BEFORE INSERT OR UPDATE ON public.inspection_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.nx_guard_report_no_self_approval();

-- ─── 3. Wire the document gate into the function that is actually called ────
CREATE OR REPLACE FUNCTION public.nx_client_may_read_report_doc(p_report_id uuid, p_uid uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_status text; v_author uuid; v_client uuid;
BEGIN
  SELECT r.status, r.inspector_id, j.client_id
    INTO v_status, v_author, v_client
    FROM public.inspection_reports r
    JOIN public.jobs j ON j.id = r.job_id
   WHERE r.id = p_report_id;

  IF v_status IS NULL THEN RETURN false; END IF;
  IF p_uid = v_author THEN RETURN true; END IF;
  IF public.nx_is_admin() THEN RETURN true; END IF;
  IF p_uid = v_client THEN RETURN v_status = 'delivered'; END IF;
  RETURN false;
END $fn$;

--  nx_can_access_doc is what mint-doc-url and the storage path consult. Its
--  inspection_reports branch granted the buyer access on job membership alone.
--  Delegate the CLIENT decision to the predicate; everything else is unchanged.
CREATE OR REPLACE FUNCTION public.nx_gate_report_doc_for_client(
  p_report_id uuid, p_uid uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_client uuid;
BEGIN
  SELECT j.client_id INTO v_client
    FROM public.inspection_reports r JOIN public.jobs j ON j.id = r.job_id
   WHERE r.id = p_report_id;

  -- Only constrain the CLIENT. Inspector/agency/admin paths keep whatever
  -- nx_can_access_doc already decided; this must not become an over-block.
  IF v_client IS NULL OR p_uid IS DISTINCT FROM v_client THEN
    RETURN true;
  END IF;
  RETURN public.nx_client_may_read_report_doc(p_report_id, p_uid);
END $fn$;

ALTER FUNCTION public.nx_gate_report_doc_for_client(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_gate_report_doc_for_client(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_gate_report_doc_for_client(uuid, uuid)
  TO authenticated, service_role;


-- ─── 5. nx_can_access_doc: the branch mint-doc-url actually calls ───────────
--  Reproduced from 20260801348000 with ONE added conjunct on the
--  inspection_reports branch. Every other media path is verbatim.
CREATE OR REPLACE FUNCTION public.nx_can_access_doc(
  p_uid    uuid,
  p_bucket text,
  p_path   text
) RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_role text;
BEGIN
  IF p_uid IS NULL OR p_bucket IS NULL OR p_path IS NULL OR btrim(p_path) = '' THEN
    RETURN false;
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = p_uid;
  IF v_role IN ('admin', 'super_admin') THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM storage.objects o
     WHERE o.bucket_id = p_bucket AND o.name = p_path AND o.owner = p_uid
  ) THEN
    RETURN true;
  END IF;

  -- ★★ DIRECT-ROOM ATTACHMENT (20260801334000). Images, files and voice notes
  --    obey EXACTLY the same live gate as text: a revoked party cannot mint a
  --    URL for a message they can no longer read, and the storage-owner branch
  --    above still lets each sender reach their own upload.
  IF p_bucket = 'chat_attachments' AND EXISTS (
    SELECT 1
      FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
     WHERE m.attachment_url = p_path
       AND c.kind = 'job_client_inspector'::public.conversation_kind
       AND public.nx_direct_chat_authorized(c.job_id, c.contractor_id, p_uid)
  ) THEN RETURN true; END IF;

  -- ★★ SUPPLIER-INSPECTOR / BUYER-SUPPLIER ATTACHMENTS (20260801340000).
  --    Same shape as the direct-room branch above: media obeys EXACTLY the gate
  --    its message row obeys, so a supplier whose contract was voided cannot
  --    mint a URL for a drawing they can no longer read.
  IF p_bucket = 'chat_attachments' AND EXISTS (
    SELECT 1
      FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
     WHERE m.attachment_url = p_path
       AND c.kind = 'job_supplier_inspector'::public.conversation_kind
       AND public.nx_supplier_inspector_chat_authorized(c.job_id, c.contractor_id, c.client_id, p_uid)
  ) THEN RETURN true; END IF;

  IF p_bucket = 'chat_attachments' AND EXISTS (
    SELECT 1
      FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
     WHERE m.attachment_url = p_path
       AND c.kind = 'buyer_supplier'::public.conversation_kind
       AND public.nx_buyer_supplier_chat_authorized(c.user_id, c.contractor_id, p_uid)
  ) THEN RETURN true; END IF;

  IF p_bucket = 'resumes' AND EXISTS (
    SELECT 1
      FROM public.applications a
      JOIN public.jobs      j  ON j.id = a.job_id
      JOIN public.profiles  pr ON pr.id = a.applicant_id
     WHERE (j.client_id = p_uid OR j.agency_id = p_uid)
       AND a.forwarded_to_client_at IS NOT NULL
       AND public.nx_job_effective_identity_mode(j.id) IN ('professional', 'full')
       AND NOT (j.status = ANY (public.nx_terminal_job_statuses()))
       AND a.status NOT IN ('rejected', 'withdrawn')
       AND NOT EXISTS (
             SELECT 1 FROM public.job_contracts jc
              WHERE jc.job_id = j.id
                AND jc.inspector_id = a.applicant_id
                AND jc.status = 'voided'
                AND NOT EXISTS (
                      SELECT 1 FROM public.job_contracts jc2
                       WHERE jc2.job_id = j.id
                         AND jc2.inspector_id = a.applicant_id
                         AND jc2.status <> 'voided'
                    )
           )
       AND (
             pr.resume_url LIKE '%' || p_path
          OR pr.cv_url     LIKE '%' || p_path
           )
       AND (
             p_path LIKE a.applicant_id::text || '/%'
          OR EXISTS (
               SELECT 1 FROM storage.objects o2
                WHERE o2.bucket_id = 'resumes'
                  AND o2.name = p_path
                  AND o2.owner = a.applicant_id
             )
           )
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.inspection_reports r
      JOIN public.jobs j ON j.id = r.job_id
     WHERE (r.photo_url LIKE '%' || p_path
            OR r.pdf_url LIKE '%' || p_path
            OR r.final_report_doc LIKE '%' || p_path)
       AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid)
       -- GATED 20260801466000. This branch granted on job membership alone, so
       -- the BUYER could mint a signed URL for the final report before review,
       -- before the remaining tranche and before delivery. Inspector and agency
       -- are unaffected; only the client is constrained, and only until the
       -- report is actually delivered.
       AND public.nx_gate_report_doc_for_client(r.id, p_uid)
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.contracts c
     WHERE c.document_url LIKE '%' || p_path
       AND (c.client_id = p_uid OR c.contractor_id = p_uid)
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.project_documents pd
      JOIN public.jobs j ON j.id = pd.job_id
     WHERE pd.file_url LIKE '%' || p_path
       AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid)
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.jobs j
     WHERE j.template_url LIKE '%' || p_path
       AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid)
  ) THEN RETURN true; END IF;

  -- ★★ LEGACY CHAT-ATTACHMENT BRANCH — NOW KIND-SCOPED (20260801348000).
  --
  --    THIS WAS THE STALE-MEDIA LEAK. The branch grants any message attachment
  --    to whoever OWNS the conversation (cv.user_id) or is a party on its job.
  --    That was correct when every conversation was admin-mediated: room
  --    membership and job membership were the same thing, and neither could be
  --    revoked without the job itself changing.
  --
  --    The two-party kinds broke that equivalence. open_direct_conversation
  --    sets cv.user_id = the BUYER PRINCIPAL, so after a Full → Professional
  --    downgrade the buyer still matched `cv.user_id = p_uid` here and this
  --    branch returned true — overriding the live gate three branches above and
  --    handing the buyer a fresh signed URL for the INSPECTOR'S voice note.
  --    The inspector leaked symmetrically through the job-party arm.
  --
  --    An IF/RETURN chain is a disjunction: adding a correctly-gated branch
  --    earlier cannot revoke anything, because a later permissive branch still
  --    wins. The two-party kinds must therefore be EXCLUDED here so their own
  --    live-gated branches are the only thing that can authorize their media.
  --    No authorization logic is duplicated — this only stops the legacy rule
  --    from answering for channels it does not understand.
  IF EXISTS (
    SELECT 1 FROM public.messages m
      JOIN public.conversations cv ON cv.id = m.conversation_id
     WHERE m.attachment_url = p_path
       AND cv.kind NOT IN (
             'job_client_inspector'::public.conversation_kind,
             'job_supplier_inspector'::public.conversation_kind,
             'buyer_supplier'::public.conversation_kind
           )
       AND (
         cv.user_id = p_uid
         OR (cv.job_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.jobs j
               WHERE j.id = cv.job_id
                 AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid)
            ))
       )
  ) THEN RETURN true; END IF;

  -- dispute-reports: the generated PDF is visible to the dispute's parties.
  -- ★ disputes.project_id is an FK to public.work_orders(id) — NOT the
  --   org/budget projects table, which has no client_id / inspector_id.
  --   Healed by 20260801252000. Never rewire this back.
  IF EXISTS (
    SELECT 1 FROM public.disputes d
      JOIN public.work_orders w ON w.id = d.project_id
     WHERE d.report_url LIKE '%' || p_path
       AND (w.client_id = p_uid OR w.inspector_id = p_uid OR d.raised_by = p_uid)
  ) THEN RETURN true; END IF;

  RETURN false;  -- deny by default
END;
$$;

ALTER FUNCTION public.nx_can_access_doc(uuid, text, text) OWNER TO postgres;

-- ─── 4. Selftest — BEHAVIOUR this time, not attachment ──────────────────────
DO $selftest$
DECLARE v_n int;
BEGIN
  -- exactly ONE self-approval trigger
  SELECT count(*) INTO v_n FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE NOT t.tgisinternal
     AND p.proname = 'nx_guard_report_no_self_approval';
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'SELFTEST: % self-approval triggers attached (expected exactly 1) — the 430000/462000 name mismatch left a duplicate', v_n;
  END IF;

  -- the guard must actually READ TG_OP, not just be attached to INSERT.
  -- Attachment is what 462000 checked, and the guard was inert anyway.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='nx_guard_report_no_self_approval'
       AND p.prosrc ~* 'TG_OP') THEN
    RAISE EXCEPTION
      'SELFTEST: nx_guard_report_no_self_approval does not branch on TG_OP — it is a no-op on INSERT, because OLD.<field> reads as NULL there';
  END IF;

  -- the document predicate must no longer be dead code
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='nx_gate_report_doc_for_client'
       AND p.prosrc ~* 'nx_client_may_read_report_doc') THEN
    RAISE EXCEPTION 'SELFTEST: the client document gate is not wired to the predicate';
  END IF;

  -- THE ONE THAT MATTERS. The predicate must be reachable from the function
  -- mint-doc-url actually calls. It was dead code, and the test I wrote called
  -- it directly — certifying my function rather than the shipping path.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='nx_can_access_doc'
       AND p.prosrc ~* 'nx_gate_report_doc_for_client') THEN
    RAISE EXCEPTION
      'SELFTEST: nx_can_access_doc does not consult the client document gate — the deliverable is still ungated';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
