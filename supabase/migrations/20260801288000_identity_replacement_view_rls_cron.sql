-- ════════════════════════════════════════════════════════════════════════════
--  20260801288000_identity_replacement_view_rls_cron.sql
--
--  INSPECTION MARKETPLACE — DB-resolved identity disclosure on the client view,
--  operational-vs-historical RLS (additive + restrictive; nothing weakened),
--  the message-insert active-contract cutoff, and an informational pg_cron
--  reminder. Workflow A only; Supplier/Brokered objects untouched.
--
--  Depends on …284000 (columns, helpers) and …286000 (RPCs).
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) client_job_contracts_view — append DB-resolved identity fields.
--    • Existing 16 columns kept in the SAME names/order (append-only ⇒
--      .select('*') consumers unaffected).
--    • Disclosure is resolved in SQL from the effective identity mode:
--        active/pending contract → Job's CURRENT identity_mode (policy changes
--                                  affect the live relationship)
--        voided/historical row   → the immutable contract snapshot
--                                  (COALESCE …, 'protected' ⇒ legacy fail-closed)
--    • NEVER exposes inspector payout / platform spread (GR2). Only the client's
--      own price (client_price_cents) and mode-gated identity fields.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.client_job_contracts_view
WITH (security_barrier = 'true') AS
SELECT
  -- ── existing columns (unchanged names + order) ──
  jc.id,
  jc.job_id,
  jc.application_id,
  jc.client_id,
  jc.inspector_id,
  jc.client_price_cents,
  jc.status,
  jc.contract_text_md,
  jc.custom_contract_url,
  jc.client_signed_at,
  jc.client_signed_name,
  jc.inspector_signed_at,
  jc.voided_at,
  jc.voided_reason,
  jc.created_at,
  jc.updated_at,
  -- ── appended: approval provenance (lets the UI show pending/authorized state) ──
  jc.client_approval_type,
  jc.admin_authorized_at,
  -- ── appended: the effective identity mode governing THIS row's disclosure ──
  m.eff_mode AS identity_mode,
  -- ── appended: mode-gated inspector identity (NULL unless permitted) ──
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.full_name       END AS inspector_display_name,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.headline        END AS inspector_headline,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.bio             END AS inspector_resume_summary,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.resume_url      END AS inspector_resume_url,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.certifications  END AS inspector_certifications,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.specialty_slugs END AS inspector_qualifications,
  CASE WHEN m.eff_mode = 'full' THEN p.email END AS inspector_email,
  CASE WHEN m.eff_mode = 'full' THEN p.phone END AS inspector_phone
FROM public.job_contracts jc
JOIN public.jobs j ON j.id = jc.job_id
LEFT JOIN public.profiles p ON p.id = jc.inspector_id
CROSS JOIN LATERAL (
  SELECT CASE
           WHEN jc.status = 'voided' THEN COALESCE(jc.effective_identity_mode, 'protected')
           ELSE COALESCE(j.identity_mode, 'protected')
         END AS eff_mode
) m
WHERE jc.client_id = auth.uid() OR public.nx_is_admin();

ALTER VIEW public.client_job_contracts_view OWNER TO postgres;

COMMENT ON VIEW public.client_job_contracts_view IS
  'Buyer-facing contract view. Identity disclosure resolved in DB from the effective identity mode (active=live jobs.identity_mode; voided=immutable snapshot, fail-closed protected). GR2: never exposes inspector payout / platform spread. Shortlist stays protected — this view only surfaces an assigned/contracted inspector.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) RLS — operational vs historical.
--
--    Principle: former-inspector historical READ is authorship-scoped
--    (inspector_id = auth.uid()); former-inspector operational WRITE is cut off
--    the instant their contract is voided (is_active_contract_inspector → false).
--    Everything here is either a NEW permissive read policy or a NEW RESTRICTIVE
--    write gate — no existing policy is dropped or loosened. Admin branches are
--    preserved everywhere (god-mode invariant).
-- ─────────────────────────────────────────────────────────────────────────────

-- 2a) job_contracts: inspectors may read their OWN contract rows (active AND
--     former). Existing policies were admin-only for direct table reads; clients
--     read via the view. This adds authorship-scoped inspector read.
DROP POLICY IF EXISTS job_contracts_inspector_select_own ON public.job_contracts;
CREATE POLICY job_contracts_inspector_select_own ON public.job_contracts
  FOR SELECT TO authenticated
  USING (inspector_id = auth.uid());

-- 2b) inspection_captures: former inspector must retain READ of their OWN
--     captures after contractor_id flips away at replacement. (Existing
--     captures_read_parties is job-party keyed and revokes at replacement; there
--     was no authorship read policy, so add one.)
DROP POLICY IF EXISTS captures_select_own_inspector ON public.inspection_captures;
CREATE POLICY captures_select_own_inspector ON public.inspection_captures
  FOR SELECT TO authenticated
  USING (inspector_id = auth.uid());

-- 2c) inspection_captures: WRITE requires the ACTIVE contract. The authoring
--     inspector (inspector_id = uid) may UPDATE only while their contract is
--     non-voided. (INSERT is already gated by jobs.contractor_id in
--     captures_insert_inspector_self, which flips at void/replace.) Restrictive
--     ⇒ AND-ed with the existing permissive policy; admins & non-authors pass.
DROP POLICY IF EXISTS captures_update_requires_active_inspector ON public.inspection_captures;
CREATE POLICY captures_update_requires_active_inspector ON public.inspection_captures
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING  (public.nx_is_admin() OR inspector_id IS DISTINCT FROM auth.uid() OR public.is_active_contract_inspector(job_id, auth.uid()))
  WITH CHECK (public.nx_is_admin() OR inspector_id IS DISTINCT FROM auth.uid() OR public.is_active_contract_inspector(job_id, auth.uid()));

-- 2d) inspection_reports: WRITE requires the ACTIVE contract (authoring
--     inspector only). Buyers (inspector_id <> uid) and admins are unaffected,
--     so "Buyers can update report status" keeps working.
DROP POLICY IF EXISTS reports_insert_requires_active_inspector ON public.inspection_reports;
CREATE POLICY reports_insert_requires_active_inspector ON public.inspection_reports
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.nx_is_admin() OR inspector_id IS DISTINCT FROM auth.uid() OR public.is_active_contract_inspector(job_id, auth.uid()));

DROP POLICY IF EXISTS reports_update_requires_active_inspector ON public.inspection_reports;
CREATE POLICY reports_update_requires_active_inspector ON public.inspection_reports
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING  (public.nx_is_admin() OR inspector_id IS DISTINCT FROM auth.uid() OR public.is_active_contract_inspector(job_id, auth.uid()))
  WITH CHECK (public.nx_is_admin() OR inspector_id IS DISTINCT FROM auth.uid() OR public.is_active_contract_inspector(job_id, auth.uid()));

-- 2e) messages: block a DIRECT insert by a FORMER inspector (defense-in-depth;
--     the canonical path send_message carries the same cutoff below). This is a
--     BLOCKLIST, not an allowlist: it denies ONLY a sender who is/was the
--     inspector on this conversation's job (has a contract) but is no longer the
--     active one. Every other poster — admin, client, agency, buyer-side
--     teammates, the active inspector, and non-job conversations — is untouched,
--     so it can never block a legitimate direct insert (an allowlist could).
--     Mirrors the former-inspector cutoff in send_message() exactly.
DROP POLICY IF EXISTS messages_insert_requires_active_inspector ON public.messages;
CREATE POLICY messages_insert_requires_active_inspector ON public.messages
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    NOT EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.job_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.job_contracts jc
                     WHERE jc.job_id = c.job_id AND jc.inspector_id = auth.uid())
        AND NOT public.is_active_contract_inspector(c.job_id, auth.uid())
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) send_message — REBUILT on the ghost-mode-aware definition from
--    20260801208000 (job_team_internal branch with NO admin path; the ghost
--    admin can never post). The ONLY addition is the former-inspector cutoff in
--    the non-internal ELSE branch: a conversation OWNER who is/was the inspector
--    on the job (has a contract) but is no longer the ACTIVE one may not post.
--    Team-internal handling, the ghost guard, clients, managers, and active
--    inspectors are all preserved exactly.
--    (Prior revision of this migration mistakenly rebuilt on the older 198000
--     body and dropped the ghost guard — fixed here.)
-- ─────────────────────────────────────────────────────────────────────────────
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

  IF v_kind = 'job_team_internal'::public.conversation_kind THEN
    -- GHOST INTEGRITY: internal threads accept posts ONLY from non-viewer
    -- teammates. There is deliberately NO admin branch — a platform-admin post
    -- would uncloak the ghost — and this explicit check neutralises the DEFINER
    -- RLS bypass (the RESTRICTIVE policy guards every other insert path).
    IF NOT public.nx_can_team_manage_internal(p_conversation_id) THEN
      RAISE EXCEPTION 'not authorised to post to this internal team thread' USING errcode = '42501';
    END IF;
  ELSE
    -- Admin, the conversation OWNER on an open thread, or a non-viewer TEAMMATE.
    -- ADDED: on a job conversation, an owner who is/was the inspector (has a
    -- contract) but is NOT the active contract inspector (i.e. a former,
    -- replaced inspector) may not post. Clients, managers (no contract), and the
    -- active inspector are unaffected.
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
  VALUES (p_conversation_id, v_uid, btrim(COALESCE(p_content, '')),
          p_attachment_url, p_attachment_type, p_attachment_name)
  RETURNING * INTO v_row;

  RETURN v_row;
END
$fn$;
ALTER FUNCTION public.send_message(uuid, text, text, text, text) OWNER TO postgres;
REVOKE ALL    ON FUNCTION public.send_message(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text, text, text, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Informational reminders (pg_cron). NEVER auto-voids / auto-selects /
--    auto-replaces / auto-signs. Uses the existing enqueue_notification (which
--    dedups) + create_admin_notification. No SMS / proxy / paid service.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_identity_replacement_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  r RECORD;
BEGIN
  -- (a) Inspection jobs in_progress that had a contract voided ≥ 1 day ago and
  --     still have NO active contract → awaiting a replacement (admin action).
  FOR r IN
    SELECT j.id AS job_id
      FROM public.jobs j
     WHERE j.status = 'in_progress'
       AND j.source_rfq_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.job_contracts jc WHERE jc.job_id = j.id AND jc.status <> 'voided')
       AND EXISTS (SELECT 1 FROM public.job_contracts jc
                    WHERE jc.job_id = j.id AND jc.status = 'voided'
                      AND jc.voided_at < now() - interval '1 day'
                      AND jc.voided_at > now() - interval '30 days')
  LOOP
    PERFORM public.create_admin_notification(
      'Job awaiting replacement inspector',
      'A contract was voided and no active inspector is assigned. Select a replacement.',
      'contract_assigned',
      '/admin/jobs?inspect=' || r.job_id::text,
      r.job_id);
  END LOOP;

  -- (b) Replacement/pending contracts waiting too long (2–14 days) for the
  --     required signature/acceptance → remind the pending party. Bounded window
  --     + enqueue_notification dedup prevent spam.
  FOR r IN
    SELECT jc.id, jc.job_id, jc.client_id, jc.inspector_id, jc.status
      FROM public.job_contracts jc
      JOIN public.jobs j ON j.id = jc.job_id
     WHERE jc.status IN ('pending_client_signature', 'pending_inspector_signature')
       AND j.source_rfq_id IS NULL
       AND jc.created_at < now() - interval '2 days'
       AND jc.created_at > now() - interval '14 days'
  LOOP
    IF r.status = 'pending_client_signature' THEN
      PERFORM public.enqueue_notification(
        r.client_id, 'contract_reminder',
        'Contract awaiting your signature',
        'A contract for your job is waiting for your review and signature.',
        '/client/contracts/job/' || r.id::text, r.job_id);
    ELSE
      PERFORM public.enqueue_notification(
        r.inspector_id, 'contract_reminder',
        'Contract awaiting your acceptance',
        'A contract assigned to you is waiting for your review and signature.',
        '/inspector/contracts/job/' || r.id::text, r.job_id);
    END IF;
  END LOOP;
END;
$$;
ALTER FUNCTION public.nx_identity_replacement_reminders() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_identity_replacement_reminders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_identity_replacement_reminders() TO service_role;

-- Schedule daily (idempotent; guarded so migration never fails if the running
-- role lacks cron privileges — the function still exists to schedule manually).
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('nx_identity_replacement_reminders');
    EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN
      PERFORM cron.schedule('nx_identity_replacement_reminders', '15 9 * * *',
        'SELECT public.nx_identity_replacement_reminders();');
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'nx_identity_replacement_reminders: could not schedule via pg_cron here; schedule manually.';
    END;
  END IF;
END
$cron$;

NOTIFY pgrst, 'reload schema';
