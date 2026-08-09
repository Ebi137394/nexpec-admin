-- ════════════════════════════════════════════════════════════════════════════
--  20260801340000_supplier_operational_chat.sql
--
--  Completes the NEXPEC communication graph with the two channels the platform
--  was missing, both strictly relationship-scoped:
--
--    job_supplier_inspector  Supplier facility ↔ assigned Inspector
--                            operational inspection coordination
--    buyer_supplier          Buyer principal ↔ Supplier
--                            ordinary procurement / business communication
--
--  ── WHY NEITHER IS GATED ON identity_mode ──────────────────────────────────
--  identity_mode is an INSPECTOR-disclosure policy: it decides whether the
--  BUYER may learn who the inspector is. It has nothing to say about a supplier
--  arranging site access, or a buyer talking to a vendor it already holds a
--  contract with. Gating either on 'full' would mean a Protected buyer could
--  block the inspection from being scheduled at all.
--
--  ── WHY THIS IS NOT A HOLE IN ANTI-POACHING ────────────────────────────────
--  These rooms carry MESSAGES. They do not widen nx_can_read_profile, so the
--  supplier still cannot read the inspector's profile row, real name, contact
--  details or résumé — the party UIs fall back to the generic "Inspector"
--  label. Operational coordination without identity disclosure is the point.
--
--  ── THE RELATIONSHIPS (derived from the real supplier workflow) ────────────
--  Supplier ↔ Inspector requires ALL of:
--    • the supplier is attached to THAT job — either a non-voided
--      supplier_contracts row for the job, or the accepted quote on the RFQ the
--      job was spawned from (jobs.source_rfq_id)
--    • the inspector holds the active contract on that job
--    • the job is not cancelled/paid
--
--  Buyer ↔ Supplier requires the buyer principal to hold a real commercial
--  relationship with that supplier:
--    • a supplier_contracts row that is not draft/voided, OR
--    • a quote from that supplier on the buyer's RFQ that admin has PRESENTED
--      or the buyer has ACCEPTED
--  'presented' is the threshold on purpose: before admin presents a quote the
--  buyer is not supposed to know the supplier exists, and opening a chat would
--  leak the brokered shortlist.
--
--  ── broker_mode IS NOT USED AS A GATE, DELIBERATELY ────────────────────────
--  supplier_rfqs.broker_mode ∈ (admin|direct) looks like the natural switch,
--  but it is written and never read: create_rfq stores it and NOTHING in the
--  schema or either client enforces it, and every shipped call site
--  (apps/web .../rfqs/new, app/rfqs/new.tsx) hard-codes 'admin'. Gating on
--  'direct' would ship a feature that is unreachable for every RFQ in the
--  system. Left untouched for a future explicit product decision.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── unread counters for the two new two-party shapes ────────────────────────
--  Reusing unread_for_client/unread_for_inspector would be wrong: a
--  buyer_supplier room has no inspector, and a job_supplier_inspector room has
--  no buyer. Separate columns keep every counter's meaning unambiguous.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS unread_for_supplier integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.conversations.unread_for_supplier IS
  'Supplier-side unread for job_supplier_inspector and buyer_supplier rooms. Never touched by admin reads.';

-- One operational room per (job, inspector, supplier); one commercial room per
-- (buyer principal, supplier). Partial unique indexes make duplicate creation
-- impossible even under a race, which is what lets the RPCs be idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_supplier_inspector_room
  ON public.conversations (job_id, contractor_id, client_id)
  WHERE kind = 'job_supplier_inspector'::public.conversation_kind;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_buyer_supplier_room
  ON public.conversations (user_id, contractor_id)
  WHERE kind = 'buyer_supplier'::public.conversation_kind;

-- ════════════════════════════════════════════════════════════════════════════
--  1. SUPPLIER ↔ INSPECTOR
-- ════════════════════════════════════════════════════════════════════════════

--  Is this supplier the vendor attached to this specific job?
CREATE OR REPLACE FUNCTION public.nx_is_job_supplier(p_job_id uuid, p_supplier_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p_job_id IS NOT NULL AND p_supplier_id IS NOT NULL AND (
    -- a live supplier contract naming this job
    EXISTS (
      SELECT 1 FROM public.supplier_contracts sc
       WHERE sc.job_id = p_job_id
         AND sc.supplier_id = p_supplier_id
         AND COALESCE(sc.status, '') NOT IN ('voided', 'draft')
    )
    -- …or the accepted quote on the RFQ this inspection was spawned from
    OR EXISTS (
      SELECT 1
        FROM public.jobs j
        JOIN public.supplier_rfqs   r ON r.id = j.source_rfq_id
        JOIN public.supplier_quotes q ON q.rfq_id = r.id
       WHERE j.id = p_job_id
         AND q.supplier_id = p_supplier_id
         AND q.status = 'accepted'
    )
  );
$$;
ALTER FUNCTION public.nx_is_job_supplier(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_is_job_supplier(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_is_job_supplier(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.nx_is_job_supplier(uuid, uuid) IS
  'True when a supplier is the vendor attached to a specific inspection job, via a non-voided supplier_contracts row or the accepted quote on jobs.source_rfq_id. The single definition of "this supplier belongs to this job".';

CREATE OR REPLACE FUNCTION public.nx_supplier_inspector_chat_authorized(
  p_job_id       uuid,
  p_inspector_id uuid,
  p_supplier_id  uuid,
  p_uid          uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.jobs j
     WHERE j.id = p_job_id
       AND p_uid IS NOT NULL
       AND p_inspector_id IS NOT NULL
       AND p_supplier_id  IS NOT NULL
       -- only the two parties themselves; the buyer is NOT in this room
       AND (p_uid = p_inspector_id OR p_uid = p_supplier_id)
       AND public.is_active_contract_inspector(p_job_id, p_inspector_id)
       AND public.nx_is_job_supplier(p_job_id, p_supplier_id)
       AND COALESCE(j.status, '') NOT IN ('cancelled', 'paid')
  );
$$;
ALTER FUNCTION public.nx_supplier_inspector_chat_authorized(uuid, uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_supplier_inspector_chat_authorized(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_supplier_inspector_chat_authorized(uuid, uuid, uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.nx_supplier_inspector_chat_authorized(uuid, uuid, uuid, uuid) IS
  'THE authority for operational supplier↔inspector chat. Requires the caller to BE one of the two parties, the inspector to hold the active contract, the supplier to be attached to that job, and the job to be non-terminal. Deliberately does NOT consult identity_mode: scheduling a site visit is not identity disclosure. Consulted by RLS, send_message, the RPCs and nx_can_access_doc.';

CREATE OR REPLACE FUNCTION public.nx_supplier_inspector_conversation_authorized(
  p_conversation_id uuid,
  p_uid             uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
     WHERE c.id = p_conversation_id
       AND c.kind = 'job_supplier_inspector'::public.conversation_kind
       AND public.nx_supplier_inspector_chat_authorized(
             c.job_id, c.contractor_id, c.client_id, p_uid)
  );
$$;
ALTER FUNCTION public.nx_supplier_inspector_conversation_authorized(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_supplier_inspector_conversation_authorized(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_supplier_inspector_conversation_authorized(uuid, uuid) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
--  2. BUYER ↔ SUPPLIER
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.nx_buyer_supplier_related(
  p_buyer_id    uuid,
  p_supplier_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p_buyer_id IS NOT NULL AND p_supplier_id IS NOT NULL AND (
    -- a live supplier contract on one of this buyer's RFQs
    EXISTS (
      SELECT 1
        FROM public.supplier_contracts sc
        JOIN public.supplier_rfqs r ON r.id = sc.rfq_id
       WHERE sc.supplier_id = p_supplier_id
         AND r.client_id = p_buyer_id
         AND COALESCE(sc.status, '') NOT IN ('voided', 'draft')
    )
    -- …or a quote admin has PRESENTED to this buyer, or the buyer accepted
    OR EXISTS (
      SELECT 1
        FROM public.supplier_quotes q
        JOIN public.supplier_rfqs r ON r.id = q.rfq_id
       WHERE q.supplier_id = p_supplier_id
         AND r.client_id = p_buyer_id
         AND q.status IN ('presented', 'accepted')
    )
  );
$$;
ALTER FUNCTION public.nx_buyer_supplier_related(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_buyer_supplier_related(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_buyer_supplier_related(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.nx_buyer_supplier_related(uuid, uuid) IS
  'True when a buyer principal and a supplier share a real commercial relationship: a non-draft, non-voided supplier_contracts row on the buyer''s RFQ, or a quote from that supplier that admin has presented / the buyer has accepted. "presented" is the threshold because before presentation the brokered shortlist must stay hidden from the buyer.';

--  The buyer side may act as the principal OR as a non-viewer org teammate, the
--  same rule 20260801336000 established for buyer↔inspector. Reuses
--  nx_is_job_buyer_side's org logic without needing a job, since a procurement
--  relationship can exist before any job is spawned.
CREATE OR REPLACE FUNCTION public.nx_is_buyer_principal_side(
  p_principal_id uuid,
  p_uid          uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p_uid IS NOT NULL AND p_principal_id IS NOT NULL AND (
    p_principal_id = p_uid
    OR EXISTS (
      SELECT 1
        FROM public.org_members o_owner
        JOIN public.org_members o_me ON o_me.org_id = o_owner.org_id
       WHERE o_owner.user_id = p_principal_id
         AND o_me.user_id    = p_uid
         AND o_me.role::text <> 'viewer'
    )
  );
$$;
ALTER FUNCTION public.nx_is_buyer_principal_side(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_is_buyer_principal_side(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_is_buyer_principal_side(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.nx_is_buyer_principal_side(uuid, uuid) IS
  'Job-free counterpart to nx_is_job_buyer_side: is p_uid the buyer principal, or a non-viewer teammate in that principal''s org? Used by buyer↔supplier chat, where the relationship can predate any job. Viewers are excluded, matching nx_can_team_manage_job.';

CREATE OR REPLACE FUNCTION public.nx_buyer_supplier_chat_authorized(
  p_buyer_id    uuid,
  p_supplier_id uuid,
  p_uid         uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p_uid IS NOT NULL
     AND p_buyer_id IS NOT NULL
     AND p_supplier_id IS NOT NULL
     AND (public.nx_is_buyer_principal_side(p_buyer_id, p_uid) OR p_uid = p_supplier_id)
     AND public.nx_buyer_supplier_related(p_buyer_id, p_supplier_id);
$$;
ALTER FUNCTION public.nx_buyer_supplier_chat_authorized(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_buyer_supplier_chat_authorized(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_buyer_supplier_chat_authorized(uuid, uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.nx_buyer_supplier_chat_authorized(uuid, uuid, uuid) IS
  'THE authority for buyer↔supplier commercial chat: caller is the buyer side (principal or non-viewer teammate) or the supplier, AND a real presented/accepted quote or live contract links them. Independent of identity_mode by design — that policy governs inspector disclosure, not buyer↔vendor commerce.';

CREATE OR REPLACE FUNCTION public.nx_buyer_supplier_conversation_authorized(
  p_conversation_id uuid,
  p_uid             uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
     WHERE c.id = p_conversation_id
       AND c.kind = 'buyer_supplier'::public.conversation_kind
       AND public.nx_buyer_supplier_chat_authorized(c.user_id, c.contractor_id, p_uid)
  );
$$;
ALTER FUNCTION public.nx_buyer_supplier_conversation_authorized(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_buyer_supplier_conversation_authorized(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_buyer_supplier_conversation_authorized(uuid, uuid) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
--  3. RLS — each policy is kind-scoped so it cannot widen any other channel
-- ════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS conv_supplier_inspector_select ON public.conversations;
CREATE POLICY conv_supplier_inspector_select ON public.conversations
  FOR SELECT TO authenticated
  USING (
    kind = 'job_supplier_inspector'::public.conversation_kind
    AND public.nx_supplier_inspector_chat_authorized(job_id, contractor_id, client_id, auth.uid())
  );

DROP POLICY IF EXISTS conv_supplier_inspector_update ON public.conversations;
CREATE POLICY conv_supplier_inspector_update ON public.conversations
  FOR UPDATE TO authenticated
  USING (
    kind = 'job_supplier_inspector'::public.conversation_kind
    AND public.nx_supplier_inspector_chat_authorized(job_id, contractor_id, client_id, auth.uid())
  )
  WITH CHECK (
    kind = 'job_supplier_inspector'::public.conversation_kind
    AND public.nx_supplier_inspector_chat_authorized(job_id, contractor_id, client_id, auth.uid())
  );

DROP POLICY IF EXISTS conv_buyer_supplier_select ON public.conversations;
CREATE POLICY conv_buyer_supplier_select ON public.conversations
  FOR SELECT TO authenticated
  USING (
    kind = 'buyer_supplier'::public.conversation_kind
    AND public.nx_buyer_supplier_chat_authorized(user_id, contractor_id, auth.uid())
  );

DROP POLICY IF EXISTS conv_buyer_supplier_update ON public.conversations;
CREATE POLICY conv_buyer_supplier_update ON public.conversations
  FOR UPDATE TO authenticated
  USING (
    kind = 'buyer_supplier'::public.conversation_kind
    AND public.nx_buyer_supplier_chat_authorized(user_id, contractor_id, auth.uid())
  )
  WITH CHECK (
    kind = 'buyer_supplier'::public.conversation_kind
    AND public.nx_buyer_supplier_chat_authorized(user_id, contractor_id, auth.uid())
  );

DROP POLICY IF EXISTS msg_supplier_inspector_select ON public.messages;
CREATE POLICY msg_supplier_inspector_select ON public.messages
  FOR SELECT TO authenticated
  USING (public.nx_supplier_inspector_conversation_authorized(conversation_id, auth.uid()));

DROP POLICY IF EXISTS msg_supplier_inspector_insert ON public.messages;
CREATE POLICY msg_supplier_inspector_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.nx_supplier_inspector_conversation_authorized(conversation_id, auth.uid())
    AND sender_id = auth.uid()
  );

DROP POLICY IF EXISTS msg_buyer_supplier_select ON public.messages;
CREATE POLICY msg_buyer_supplier_select ON public.messages
  FOR SELECT TO authenticated
  USING (public.nx_buyer_supplier_conversation_authorized(conversation_id, auth.uid()));

DROP POLICY IF EXISTS msg_buyer_supplier_insert ON public.messages;
CREATE POLICY msg_buyer_supplier_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.nx_buyer_supplier_conversation_authorized(conversation_id, auth.uid())
    AND sender_id = auth.uid()
  );


-- ════════════════════════════════════════════════════════════════════════════
--  7. send_message + nx_can_access_doc, extended with the two new channels
--     Both are full re-definitions carrying EVERY pre-existing branch verbatim.
--     Nothing is text-rewritten at runtime.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.send_message(
  p_conversation_id  uuid,
  p_content          text DEFAULT NULL,
  p_attachment_url   text DEFAULT NULL,
  p_attachment_type  text DEFAULT NULL,
  p_attachment_name  text DEFAULT NULL
) RETURNS public.messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_kind public.conversation_kind;
  v_row  public.messages;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '28000';
  END IF;
  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'conversation_id required';
  END IF;
  IF btrim(COALESCE(p_content, '')) = '' AND p_attachment_url IS NULL THEN
    RAISE EXCEPTION 'empty message (need content or attachment)';
  END IF;

  SELECT kind INTO v_kind FROM public.conversations WHERE id = p_conversation_id;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;

  -- ★ DIRECT ROOM (20260801334000). Authorization is recomputed from the LIVE
  --   relationship on every send, so a stale conversation id held open across a
  --   downgrade, a replacement, or a move to cancelled/paid stops working
  --   immediately. Admins are excluded on purpose: they observe, never post.
  IF v_kind = 'job_client_inspector'::public.conversation_kind THEN
    IF public.nx_is_admin() THEN
      RAISE EXCEPTION 'admins do not post into client-inspector direct rooms'
        USING errcode = '42501';
    END IF;
    IF NOT public.nx_direct_conversation_authorized(p_conversation_id, v_uid) THEN
      RAISE EXCEPTION 'direct chat is not authorized for this relationship'
        USING errcode = '42501';
    END IF;

  -- ★ SUPPLIER ↔ INSPECTOR OPERATIONAL ROOM (20260801340000). Deliberately NOT
  --   gated on identity_mode: this channel exists so the inspection can happen
  --   (site access, attendance, drawings, certificates), and a buyer choosing
  --   Protected must not be able to stop the supplier and inspector arranging
  --   the visit. It is still strictly relationship-scoped and re-evaluated live.
  ELSIF v_kind = 'job_supplier_inspector'::public.conversation_kind THEN
    IF public.nx_is_admin() THEN
      RAISE EXCEPTION 'admins do not post into supplier-inspector rooms'
        USING errcode = '42501';
    END IF;
    IF NOT public.nx_supplier_inspector_conversation_authorized(p_conversation_id, v_uid) THEN
      RAISE EXCEPTION 'supplier-inspector chat is not authorized for this relationship'
        USING errcode = '42501';
    END IF;

  -- ★ BUYER ↔ SUPPLIER COMMERCIAL ROOM (20260801340000). identity_mode is an
  --   INSPECTOR-disclosure policy; it has no bearing on whether a buyer may
  --   talk to a vendor they already hold a presented quote or a live contract
  --   with. Gated on that commercial relationship instead.
  ELSIF v_kind = 'buyer_supplier'::public.conversation_kind THEN
    IF public.nx_is_admin() THEN
      RAISE EXCEPTION 'admins do not post into buyer-supplier rooms'
        USING errcode = '42501';
    END IF;
    IF NOT public.nx_buyer_supplier_conversation_authorized(p_conversation_id, v_uid) THEN
      RAISE EXCEPTION 'buyer-supplier chat is not authorized for this relationship'
        USING errcode = '42501';
    END IF;

  ELSIF v_kind = 'job_team_internal'::public.conversation_kind THEN
    -- Ghost-mode internal thread (20260801208000) — unchanged.
    IF NOT public.nx_can_team_manage_internal(p_conversation_id) THEN
      RAISE EXCEPTION 'not authorised to post to this internal team thread' USING errcode = '42501';
    END IF;

  ELSE
    -- Legacy admin-mediated branch (20260801288000) — unchanged, including the
    -- former-inspector cutoff.
    IF NOT (
          public.nx_is_admin()
       OR EXISTS (SELECT 1 FROM public.conversations c
                   WHERE c.id = p_conversation_id
                     AND c.user_id = v_uid
                     AND c.status = 'open'
                     AND NOT (
                       c.job_id IS NOT NULL
                       AND EXISTS (SELECT 1 FROM public.job_contracts jc
                                    WHERE jc.job_id = c.job_id AND jc.inspector_id = v_uid)
                       AND NOT public.is_active_contract_inspector(c.job_id, v_uid)
                     ))
       OR public.nx_can_team_manage_conversation(p_conversation_id)
    ) THEN
      RAISE EXCEPTION 'not authorised to post to this conversation' USING errcode = '42501';
    END IF;
  END IF;

  INSERT INTO public.messages (conversation_id, sender_id, content,
                               attachment_url, attachment_type, attachment_name)
  VALUES (p_conversation_id, v_uid, NULLIF(btrim(COALESCE(p_content, '')), ''),
          p_attachment_url, p_attachment_type, p_attachment_name)
  RETURNING * INTO v_row;

  RETURN v_row;
END
$fn$;

ALTER FUNCTION public.send_message(uuid, text, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.send_message(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text, text, text, text) TO authenticated, service_role;

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

  IF EXISTS (
    SELECT 1 FROM public.messages m
      JOIN public.conversations cv ON cv.id = m.conversation_id
     WHERE m.attachment_url = p_path
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
REVOKE ALL ON FUNCTION public.nx_can_access_doc(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_can_access_doc(uuid, text, text) TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
--  4. Room creation + read RPCs
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.open_supplier_inspector_conversation(
  p_job_id       uuid,
  p_inspector_id uuid,
  p_supplier_id  uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job RECORD;
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '28000';
  END IF;
  IF public.nx_is_admin() THEN
    RAISE EXCEPTION 'admins observe operational rooms via the monitoring view, not by joining'
      USING errcode = '42501';
  END IF;
  IF NOT public.nx_supplier_inspector_chat_authorized(p_job_id, p_inspector_id, p_supplier_id, v_uid) THEN
    RAISE EXCEPTION 'supplier-inspector chat is not authorized for this relationship'
      USING errcode = '42501';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;

  SELECT id INTO v_id FROM public.conversations
   WHERE job_id = p_job_id AND contractor_id = p_inspector_id AND client_id = p_supplier_id
     AND kind = 'job_supplier_inspector'::public.conversation_kind;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- client_id carries the SUPPLIER here, not a buyer. The column is a generic
  -- "second party" slot on this table; the kind disambiguates it, and every
  -- gate reads it through nx_supplier_inspector_chat_authorized(..., c.client_id, ...).
  -- user_id is the inspector so the row satisfies the NOT NULL owner column.
  INSERT INTO public.conversations (
    job_id, client_id, contractor_id, kind, user_id, title, status
  ) VALUES (
    p_job_id, p_supplier_id, p_inspector_id,
    'job_supplier_inspector'::public.conversation_kind,
    p_inspector_id,
    'Inspection coordination — ' || COALESCE(v_job.title, p_job_id::text),
    'open'
  )
  ON CONFLICT (job_id, contractor_id, client_id)
    WHERE kind = 'job_supplier_inspector'::public.conversation_kind
  DO UPDATE SET updated_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;
ALTER FUNCTION public.open_supplier_inspector_conversation(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.open_supplier_inspector_conversation(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_supplier_inspector_conversation(uuid, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.open_buyer_supplier_conversation(
  p_buyer_id    uuid,
  p_supplier_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '28000';
  END IF;
  IF public.nx_is_admin() THEN
    RAISE EXCEPTION 'admins observe commercial rooms via the monitoring view, not by joining'
      USING errcode = '42501';
  END IF;
  IF NOT public.nx_buyer_supplier_chat_authorized(p_buyer_id, p_supplier_id, v_uid) THEN
    RAISE EXCEPTION 'buyer-supplier chat is not authorized for this relationship'
      USING errcode = '42501';
  END IF;

  SELECT id INTO v_id FROM public.conversations
   WHERE user_id = p_buyer_id AND contractor_id = p_supplier_id
     AND kind = 'buyer_supplier'::public.conversation_kind;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- No job_id: a procurement relationship exists before any job is spawned, and
  -- one buyer↔supplier thread spans all their RFQs rather than fragmenting.
  INSERT INTO public.conversations (
    job_id, client_id, contractor_id, kind, user_id, title, status
  ) VALUES (
    NULL, p_buyer_id, p_supplier_id,
    'buyer_supplier'::public.conversation_kind,
    p_buyer_id, 'Supplier conversation', 'open'
  )
  ON CONFLICT (user_id, contractor_id)
    WHERE kind = 'buyer_supplier'::public.conversation_kind
  DO UPDATE SET updated_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;
ALTER FUNCTION public.open_buyer_supplier_conversation(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.open_buyer_supplier_conversation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_buyer_supplier_conversation(uuid, uuid) TO authenticated, service_role;

--  One read RPC for both new kinds. Admin is a no-op, exactly as for
--  mark_direct_conversation_read, so admin monitoring can never consume a
--  participant's unread state on any channel.
CREATE OR REPLACE FUNCTION public.mark_operational_conversation_read(
  p_conversation_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_c   RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '28000';
  END IF;
  IF public.nx_is_admin() THEN RETURN; END IF;

  SELECT * INTO v_c FROM public.conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_c.kind = 'job_supplier_inspector'::public.conversation_kind THEN
    IF NOT public.nx_supplier_inspector_chat_authorized(
             v_c.job_id, v_c.contractor_id, v_c.client_id, v_uid) THEN
      RAISE EXCEPTION 'not authorized for this conversation' USING errcode = '42501';
    END IF;
    IF v_uid = v_c.contractor_id THEN
      UPDATE public.conversations SET unread_for_inspector = 0, updated_at = NOW()
       WHERE id = p_conversation_id;
    ELSE
      UPDATE public.conversations SET unread_for_supplier = 0, updated_at = NOW()
       WHERE id = p_conversation_id;
    END IF;

  ELSIF v_c.kind = 'buyer_supplier'::public.conversation_kind THEN
    IF NOT public.nx_buyer_supplier_chat_authorized(v_c.user_id, v_c.contractor_id, v_uid) THEN
      RAISE EXCEPTION 'not authorized for this conversation' USING errcode = '42501';
    END IF;
    IF v_uid = v_c.contractor_id THEN
      UPDATE public.conversations SET unread_for_supplier = 0, updated_at = NOW()
       WHERE id = p_conversation_id;
    ELSE
      UPDATE public.conversations SET unread_for_client = 0, updated_at = NOW()
       WHERE id = p_conversation_id;
    END IF;

  ELSE
    RETURN;  -- other kinds keep their own read RPCs
  END IF;

  UPDATE public.messages SET is_read = true
   WHERE conversation_id = p_conversation_id AND sender_id <> v_uid AND is_read = false;
END;
$fn$;
ALTER FUNCTION public.mark_operational_conversation_read(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mark_operational_conversation_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_operational_conversation_read(uuid) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
--  5. Fan-out: unread + notifications for the two new kinds
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.tg_operational_message_fanout()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_c         RECORD;
  v_recipient uuid;
  v_href      text;
  v_title     text;
  v_target    uuid;
BEGIN
  SELECT * INTO v_c FROM public.conversations WHERE id = NEW.conversation_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF v_c.kind = 'job_supplier_inspector'::public.conversation_kind THEN
    v_href  := '/chat/supplier-inspector/' || NEW.conversation_id::text;
    v_title := 'Inspection coordination';
    IF NEW.sender_id = v_c.contractor_id THEN
      v_recipient := v_c.client_id;     -- supplier
      UPDATE public.conversations
         SET unread_for_supplier = unread_for_supplier + 1, last_message_at = NOW(),
             last_message_preview = left(COALESCE(NEW.content, '[attachment]'), 120),
             updated_at = NOW()
       WHERE id = NEW.conversation_id;
    ELSE
      v_recipient := v_c.contractor_id; -- inspector
      UPDATE public.conversations
         SET unread_for_inspector = unread_for_inspector + 1, last_message_at = NOW(),
             last_message_preview = left(COALESCE(NEW.content, '[attachment]'), 120),
             updated_at = NOW()
       WHERE id = NEW.conversation_id;
    END IF;

    BEGIN
      PERFORM public.create_system_notification(
        v_recipient, v_title,
        left(COALESCE(NEW.content, 'Sent an attachment'), 120),
        'message', v_href, v_c.job_id);
    EXCEPTION WHEN OTHERS THEN NULL; END;

  ELSIF v_c.kind = 'buyer_supplier'::public.conversation_kind THEN
    v_href  := '/chat/buyer-supplier/' || NEW.conversation_id::text;
    v_title := 'New supplier message';
    IF NEW.sender_id = v_c.contractor_id THEN
      -- supplier → buyer side. One shared counter, then notify the principal
      -- AND every non-viewer teammate, matching the buyer↔inspector model.
      UPDATE public.conversations
         SET unread_for_client = unread_for_client + 1, last_message_at = NOW(),
             last_message_preview = left(COALESCE(NEW.content, '[attachment]'), 120),
             updated_at = NOW()
       WHERE id = NEW.conversation_id;

      FOR v_target IN
        SELECT DISTINCT u FROM (
          SELECT v_c.user_id AS u
          UNION
          SELECT o_me.user_id
            FROM public.org_members o_owner
            JOIN public.org_members o_me ON o_me.org_id = o_owner.org_id
           WHERE o_owner.user_id = v_c.user_id AND o_me.role::text <> 'viewer'
        ) s
        WHERE u IS NOT NULL AND u <> NEW.sender_id
      LOOP
        BEGIN
          PERFORM public.create_system_notification(
            v_target, v_title,
            left(COALESCE(NEW.content, 'Sent an attachment'), 120),
            'message', v_href, NULL);
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END LOOP;

    ELSE
      UPDATE public.conversations
         SET unread_for_supplier = unread_for_supplier + 1, last_message_at = NOW(),
             last_message_preview = left(COALESCE(NEW.content, '[attachment]'), 120),
             updated_at = NOW()
       WHERE id = NEW.conversation_id;
      BEGIN
        PERFORM public.create_system_notification(
          v_c.contractor_id, v_title,
          left(COALESCE(NEW.content, 'Sent an attachment'), 120),
          'message', v_href, NULL);
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;
ALTER FUNCTION public.tg_operational_message_fanout() OWNER TO postgres;

DROP TRIGGER IF EXISTS operational_message_fanout ON public.messages;
CREATE TRIGGER operational_message_fanout
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_operational_message_fanout();

-- ════════════════════════════════════════════════════════════════════════════
--  6. Admin monitoring — one view per new channel, money-free
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.admin_operational_conversations_view
WITH (security_barrier = 'true') AS
SELECT
  c.id            AS conversation_id,
  c.kind::text    AS channel,
  c.job_id,
  j.title         AS job_title,
  j.status        AS job_status,
  j.source_rfq_id AS rfq_id,
  CASE WHEN c.kind = 'buyer_supplier'::public.conversation_kind
       THEN c.user_id ELSE c.contractor_id END          AS party_a_id,
  CASE WHEN c.kind = 'buyer_supplier'::public.conversation_kind
       THEN 'buyer' ELSE 'inspector' END                AS party_a_role,
  pa.full_name                                          AS party_a_name,
  c.contractor_id                                       AS raw_contractor_id,
  CASE WHEN c.kind = 'buyer_supplier'::public.conversation_kind
       THEN c.contractor_id ELSE c.client_id END        AS supplier_id,
  ps.full_name                                          AS supplier_name,
  c.created_at,
  c.last_message_at,
  c.unread_for_client,
  c.unread_for_inspector,
  c.unread_for_supplier,
  (SELECT count(*) FROM public.messages m
    WHERE m.conversation_id = c.id AND m.deleted_at IS NULL) AS message_count
FROM public.conversations c
LEFT JOIN public.jobs j ON j.id = c.job_id
LEFT JOIN public.profiles pa ON pa.id = CASE
    WHEN c.kind = 'buyer_supplier'::public.conversation_kind THEN c.user_id
    ELSE c.contractor_id END
LEFT JOIN public.profiles ps ON ps.id = CASE
    WHEN c.kind = 'buyer_supplier'::public.conversation_kind THEN c.contractor_id
    ELSE c.client_id END
WHERE c.kind IN ('job_supplier_inspector'::public.conversation_kind,
                 'buyer_supplier'::public.conversation_kind)
  AND public.nx_is_admin();

ALTER VIEW public.admin_operational_conversations_view OWNER TO postgres;
REVOKE ALL ON public.admin_operational_conversations_view FROM PUBLIC, anon;
GRANT SELECT ON public.admin_operational_conversations_view TO authenticated, service_role;
COMMENT ON VIEW public.admin_operational_conversations_view IS
  'Admin-only index of supplier↔inspector and buyer↔supplier rooms, with job/RFQ context. No payout, margin, spread or price column is selected — GR2 blindness here is unfetched, not merely unrendered.';

CREATE OR REPLACE VIEW public.admin_operational_messages_view
WITH (security_barrier = 'true') AS
SELECT
  m.id,
  m.conversation_id,
  c.kind::text AS channel,
  c.job_id,
  m.sender_id,
  sp.full_name AS sender_name,
  sp.role      AS sender_role,
  CASE
    WHEN c.kind = 'buyer_supplier'::public.conversation_kind THEN
      CASE WHEN m.sender_id = c.contractor_id THEN 'supplier' ELSE 'buyer' END
    ELSE
      CASE WHEN m.sender_id = c.contractor_id THEN 'inspector' ELSE 'supplier' END
  END AS sender_party,
  m.content,
  m.attachment_url,
  m.attachment_type,
  m.attachment_name,
  m.created_at,
  m.is_read,
  m.deleted_at
FROM public.messages m
JOIN public.conversations c ON c.id = m.conversation_id
LEFT JOIN public.profiles sp ON sp.id = m.sender_id
WHERE c.kind IN ('job_supplier_inspector'::public.conversation_kind,
                 'buyer_supplier'::public.conversation_kind)
  AND public.nx_is_admin();

ALTER VIEW public.admin_operational_messages_view OWNER TO postgres;
REVOKE ALL ON public.admin_operational_messages_view FROM PUBLIC, anon;
GRANT SELECT ON public.admin_operational_messages_view TO authenticated, service_role;
COMMENT ON VIEW public.admin_operational_messages_view IS
  'Admin-only transcript of supplier↔inspector and buyer↔supplier rooms: text, attachments, timestamps and sender party. Read-only — admin never joins these rooms and reading cannot change is_read or any unread counter.';

-- ════════════════════════════════════════════════════════════════════════════
--  8. Self-tests
-- ════════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE v text;
BEGIN
  -- neither new gate may consult identity_mode
  FOR v IN
    SELECT prosrc FROM pg_proc WHERE oid IN (
      'public.nx_supplier_inspector_chat_authorized(uuid,uuid,uuid,uuid)'::regprocedure,
      'public.nx_buyer_supplier_chat_authorized(uuid,uuid,uuid)'::regprocedure)
  LOOP
    IF v ~* 'identity_mode' THEN
      RAISE EXCEPTION 'DESIGN: an operational gate consults identity_mode — that policy governs inspector disclosure only';
    END IF;
    IF v ~* 'profiles\.role|''supplier''\s*=|role\s*=\s*''supplier''' THEN
      RAISE EXCEPTION 'DESIGN: an operational gate branches on a role NAME instead of the relationship';
    END IF;
  END LOOP;

  -- buyer↔inspector must STILL require full: proving the new work did not relax it
  v := (SELECT prosrc FROM pg_proc
         WHERE oid = 'public.nx_direct_chat_authorized(uuid,uuid,uuid)'::regprocedure);
  IF v !~* 'nx_job_effective_identity_mode' THEN
    RAISE EXCEPTION 'REGRESSION: buyer↔inspector chat no longer checks live identity mode';
  END IF;

  -- send_message must carry every branch, old and new
  v := (SELECT prosrc FROM pg_proc
         WHERE oid = 'public.send_message(uuid,text,text,text,text)'::regprocedure);
  IF v !~* 'job_client_inspector'  THEN RAISE EXCEPTION 'send_message lost the buyer-inspector branch'; END IF;
  IF v !~* 'job_supplier_inspector' THEN RAISE EXCEPTION 'send_message lacks the supplier-inspector branch'; END IF;
  IF v !~* 'buyer_supplier'         THEN RAISE EXCEPTION 'send_message lacks the buyer-supplier branch'; END IF;
  IF v !~* 'job_team_internal'      THEN RAISE EXCEPTION 'send_message lost the team-internal branch'; END IF;
  IF v !~* 'nx_can_team_manage_conversation' THEN
    RAISE EXCEPTION 'send_message lost the legacy admin-mediated branch';
  END IF;

  -- attachments must be gated for every two-party kind
  v := (SELECT prosrc FROM pg_proc WHERE oid = 'public.nx_can_access_doc(uuid,text,text)'::regprocedure);
  IF v !~* 'nx_supplier_inspector_chat_authorized' THEN
    RAISE EXCEPTION 'ATTACHMENTS: supplier-inspector media is not gated';
  END IF;
  IF v !~* 'nx_buyer_supplier_chat_authorized' THEN
    RAISE EXCEPTION 'ATTACHMENTS: buyer-supplier media is not gated';
  END IF;
  IF v !~* 'nx_direct_chat_authorized' THEN
    RAISE EXCEPTION 'ATTACHMENTS: the buyer-inspector branch was lost';
  END IF;
  -- the dispute branch healed by 20260801252000 must survive every rewrite
  IF v ~* '(FROM|JOIN)[[:space:]]+public\.projects\M' THEN
    RAISE EXCEPTION 'REGRESSION: nx_can_access_doc reintroduced public.projects (see 252000)';
  END IF;

  -- both fanout triggers must be attached; neither may replace the other
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'direct_message_fanout' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'REGRESSION: the buyer-inspector fanout trigger was lost';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'operational_message_fanout' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'the operational fanout trigger is missing';
  END IF;

  -- duplicate-room prevention
  IF to_regclass('public.conversations_one_supplier_inspector_room') IS NULL THEN
    RAISE EXCEPTION 'missing unique index for supplier-inspector rooms';
  END IF;
  IF to_regclass('public.conversations_one_buyer_supplier_room') IS NULL THEN
    RAISE EXCEPTION 'missing unique index for buyer-supplier rooms';
  END IF;

  -- GR2: no money anywhere in the admin operational views
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name IN ('admin_operational_conversations_view','admin_operational_messages_view')
                AND column_name ~* 'payout|margin|spread|price_cents|commission|amount_cents') THEN
    RAISE EXCEPTION 'GR2: a money column leaked into an admin operational view';
  END IF;

  -- the new rooms must not have widened profile disclosure
  v := (SELECT prosrc FROM pg_proc WHERE oid = 'public.nx_can_read_profile(uuid)'::regprocedure);
  IF v ~* 'job_supplier_inspector|buyer_supplier' THEN
    RAISE EXCEPTION 'DISCLOSURE: an operational chat kind leaked into profile read authorization';
  END IF;
END
$verify$;

COMMIT;
