-- ════════════════════════════════════════════════════════════════════════════
--  20260801660000_canonical_message_route.sql
--
--  P1 — message notifications pointed real users at a route their own role is
--  refused from, and at a route that has never existed on mobile.
--
--  ── THE DEFECT (measured on Production) ────────────────────────────────────
--  Both message producers chose the recipient's link from the CONVERSATION
--  KIND, never from the recipient's role:
--
--    notify_on_new_message : kind LIKE 'job_%inspector%' ? /inspector : /client
--    tg_notify_messages    : kind = 'job_inspector_admin' ? /inspector : /client
--
--  A Help & Support thread matches neither test, so every support reply fell
--  to the ELSE branch and was written as '/client/messages/<id>' regardless of
--  who received it. Counted on Production before this migration:
--
--    recipient role   rows   people
--    client             16       14      (worked)
--    inspector          16       16      (BROKEN)
--    agency              1        1      (worked - CLIENT_PREFIX allows it)
--    supplier            1        1      (BROKEN)
--
--  src/middleware.ts gates CLIENT_PREFIX to client/agency/enterprise/admin/
--  super_admin, so those 17 inspector and supplier notifications sent a user
--  to a page middleware bounces them from — about their own conversation.
--
--  On mobile it is worse: expo-router has exactly ONE conversation screen,
--  app/messages/[id].tsx. '/client/messages/<id>' has never resolved there at
--  all, so the identical link is a hard 404 on the phone for EVERY role,
--  including the clients for whom it happens to work on web.
--
--  ── THE FIX ────────────────────────────────────────────────────────────────
--  Emit '/messages/<id>'. That path already exists natively on mobile, and
--  apps/web/src/app/messages/[id]/page.tsx (added with this migration)
--  resolves the role SERVER-SIDE at click time and forwards to the correct
--  role-scoped web route. One link is now correct on both platforms, and it
--  keeps working if a user's role changes after the notification was written.
--
--  Deriving the role inside the trigger instead was rejected: it would bake
--  the role in at write time, so a link would rot the moment a role changed —
--  which is exactly how an admin role change on 2026-09-01 could have stranded
--  this user's earlier links.
--
--  Admin-facing links are deliberately UNCHANGED. '/admin/messages/<id>' is
--  correct: those rows only ever go to admins, and the admin console is
--  web-only, so there is no cross-platform ambiguity to resolve.
--
--  ── WHAT THIS DOES NOT CHANGE ──────────────────────────────────────────────
--  Both function bodies are reproduced VERBATIM apart from the recipient link
--  expression. Same signature, same SECURITY DEFINER, same pinned search_path,
--  same triggers, same ghost-thread short-circuit, same exception handling.
--  No table, policy or grant is touched. Historical rows are repaired in place;
--  nothing is deleted.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Producer 1 ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_on_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conv    RECORD;
  v_preview text;
  v_link    text;
  v_admin   RECORD;
BEGIN
  SELECT id, user_id, kind, title, job_id
    INTO v_conv
    FROM public.conversations
   WHERE id = NEW.conversation_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_preview := COALESCE(NULLIF(LEFT(NEW.content, 140), ''),
                        CASE WHEN NEW.attachment_url IS NOT NULL THEN '📎 Attachment' ELSE 'New message' END);

  -- Case A: sender is the user → notify all admins (admin queue)
  IF NEW.sender_id = v_conv.user_id THEN
    PERFORM public.notify_admins(
      'message',
      COALESCE(NULLIF(v_conv.title, ''), 'New message'),
      v_preview,
      '/admin/messages/' || v_conv.id::text,
      v_conv.job_id
    );
  ELSE
    -- Case B: sender is admin → notify the conversation owner.
    -- Role-resolving canonical path; see the header of this migration.
    PERFORM public.notify_safe(
      v_conv.user_id,
      'message',
      'NEXPEC Admin replied',
      v_preview,
      '/messages/' || v_conv.id::text,
      v_conv.job_id
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_on_new_message: %', SQLERRM;
  RETURN NEW;
END $function$;

-- ── Producer 2 ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_notify_messages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conv     RECORD;
  v_preview  text;
  v_owner    uuid;
  v_has_team boolean := false;
  v_is_admin boolean;
  v_title    text;
  r          RECORD;
BEGIN
  SELECT id, user_id, kind, title, job_id INTO v_conv
    FROM public.conversations WHERE id = NEW.conversation_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_preview := COALESCE(
    NULLIF(LEFT(NEW.content, 140), ''),
    CASE WHEN NEW.attachment_url IS NOT NULL THEN '📎 Attachment' ELSE 'New message' END
  );
  v_is_admin := public.nx_is_admin(NEW.sender_id);

  -- ★ GHOST BRANCH: internal team thread → notify TEAMMATES ONLY, never admins.
  --   Short-circuits so no admin-notifying branch below can ever run. v_conv.user_id
  --   is the principal; the org is resolved from their membership.
  IF v_conv.kind = 'job_team_internal'::public.conversation_kind THEN
    FOR r IN
      SELECT DISTINCT om.user_id
      FROM public.org_members om
      WHERE om.org_id IN (SELECT org_id FROM public.org_members WHERE user_id = v_conv.user_id)
        AND om.user_id <> NEW.sender_id
    LOOP
      PERFORM public.nx_notify(
        r.user_id, 'New internal team message', v_preview, 'message',
        '/client/jobs/' || COALESCE(v_conv.job_id::text, ''), v_conv.job_id);
    END LOOP;
    RETURN NEW;
  END IF;

  IF v_conv.kind = 'job_client_admin'::public.conversation_kind AND v_conv.job_id IS NOT NULL THEN
    SELECT COALESCE(j.agency_id, j.client_id) INTO v_owner
      FROM public.jobs j WHERE j.id = v_conv.job_id;
    IF v_owner IS NOT NULL THEN
      SELECT EXISTS (SELECT 1 FROM public.org_members WHERE user_id = v_owner) INTO v_has_team;
    END IF;
  END IF;

  IF v_has_team THEN
    IF NOT v_is_admin THEN
      PERFORM public.nx_notify_admins(
        COALESCE(NULLIF(v_conv.title, ''), 'New message'), v_preview, 'message',
        '/admin/messages/' || v_conv.id::text, v_conv.job_id);
    END IF;
    v_title := CASE WHEN v_is_admin THEN 'NEXPEC Admin replied' ELSE 'New team message' END;
    FOR r IN
      SELECT DISTINCT om.user_id
      FROM public.org_members om
      WHERE om.org_id IN (SELECT org_id FROM public.org_members WHERE user_id = v_owner)
        AND om.user_id <> NEW.sender_id
    LOOP
      PERFORM public.nx_notify(
        r.user_id, v_title, v_preview, 'message',
        '/client/jobs/' || v_conv.job_id::text, v_conv.job_id);
    END LOOP;

  ELSE
    IF NEW.sender_id = v_conv.user_id THEN
      PERFORM public.nx_notify_admins(
        COALESCE(NULLIF(v_conv.title, ''), 'New message'), v_preview, 'message',
        '/admin/messages/' || v_conv.id::text, v_conv.job_id);
    ELSE
      -- Role-resolving canonical path; see the header of this migration.
      PERFORM public.nx_notify(
        v_conv.user_id, 'NEXPEC Admin replied', v_preview, 'message',
        '/messages/' || v_conv.id::text,
        v_conv.job_id);
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'tg_notify_messages failed: %', SQLERRM;
  RETURN NEW;
END
$function$;

-- ── The SECOND profile-path function ───────────────────────────────────────
-- nx_role_profile_path was corrected to '/profile' on 2026-09-07, but an older
-- duplicate, nx_profile_path, was left behind still returning the dead
-- '/client/profile' and '/inspector/profile'. It is live: the link guard found
-- it emitting both. Same defect class as the completeness rule unified in
-- 20260801658000 — a second copy of a mapping, quietly drifting.
--
-- Delegation rather than deletion, so existing callers keep working and there
-- is only one definition left. Signature, IMMUTABLE volatility and return type
-- are reproduced exactly, so CREATE OR REPLACE preserves existing grants.
CREATE OR REPLACE FUNCTION public.nx_profile_path(p_role text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  -- Single source of truth. p_role is now unused: the destination is resolved
  -- from the live session by apps/web/src/app/profile/page.tsx, not baked into
  -- the link. Kept in the signature so callers do not have to change.
  SELECT public.nx_role_profile_path(p_role);
$function$;

COMMENT ON FUNCTION public.nx_profile_path(text) IS
  'Deprecated name kept for existing callers. Delegates to nx_role_profile_path. '
  'Do not reintroduce a role-to-path table here.';

-- ── Repair the rows already sitting in users' notification lists ───────────
-- Recipient-facing rows only. '/admin/messages/%' is left untouched: those go
-- to admins, for whom that route is correct and reachable.
--
-- Rows that happen to work today on web (clients, agencies) are rewritten too,
-- deliberately: '/messages/<id>' is correct for them on web AND fixes the same
-- link on mobile, where '/client/messages/<id>' has never resolved.
UPDATE public.notifications
   SET link_href = '/messages/' || split_part(link_href, '/', 4)
 WHERE (link_href LIKE '/client/messages/%' OR link_href LIKE '/inspector/messages/%')
   AND split_part(link_href, '/', 4) <> '';

-- Any profile links nx_profile_path emitted after 20260801648000 repaired the
-- earlier batch. Idempotent: matches nothing if there are none.
UPDATE public.notifications
   SET link_href = '/profile'
 WHERE link_href IN ('/client/profile', '/inspector/profile', '/suppliers/profile')
   AND link_href <> '/profile';

COMMIT;
