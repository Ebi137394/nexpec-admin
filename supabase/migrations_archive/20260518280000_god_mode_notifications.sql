-- ============================================================================
-- GOD-MODE NOTIFICATIONS — automatic event pipeline.
--
-- Hooks BEFORE/AFTER triggers into every meaningful table so users get
-- pushed a notification when something happens to them, instead of relying
-- on individual RPCs to remember to call notify().
--
-- Coverage:
--   - messages           → notify counterparty (admin ↔ user)
--   - jobs               → status/escrow/moderation transitions
--   - job_applications   → new app to client; status change to inspector
--   - reviews            → new review to the reviewee
--   - contract_assignments → contract attached to a party
--   - disputes           → opener confirmation + admin queue
--   - transactions       → payout state changes
--
-- DEFENSIVE: every block wrapped in DO $$ ... EXCEPTION WHEN OTHERS THEN
-- RAISE NOTICE so a missing table/column never breaks the migration.
-- Triggers are idempotent (DROP IF EXISTS + CREATE).
-- ============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Make sure notify() can be called from triggers under any caller.
--    Reduce noise: notify() never raises — it logs and returns NULL.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notify_safe(
  p_recipient uuid,
  p_kind      text,
  p_title     text,
  p_body      text DEFAULT NULL,
  p_link      text DEFAULT NULL,
  p_job_id    uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_id uuid;
BEGIN
  IF p_recipient IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.notifications(recipient_id, kind, title, body, link_href, job_id)
       VALUES (p_recipient, p_kind, p_title, p_body, p_link, p_job_id)
    RETURNING id INTO v_id;
  BEGIN
    UPDATE public.profiles
       SET unread_notifications_count = COALESCE(unread_notifications_count, 0) + 1
     WHERE id = p_recipient;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'notify_safe: profile counter update failed: %', SQLERRM;
  END;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_safe(%, %, %): %', p_kind, p_recipient, p_title, SQLERRM;
  RETURN NULL;
END $fn$;

GRANT EXECUTE ON FUNCTION public.notify_safe(uuid, text, text, text, text, uuid) TO authenticated;

-- Broadcast helper: notify ALL admin/super_admin users at once.
CREATE OR REPLACE FUNCTION public.notify_admins(
  p_kind  text,
  p_title text,
  p_body  text DEFAULT NULL,
  p_link  text DEFAULT NULL,
  p_job_id uuid DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_count int := 0; r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM public.profiles WHERE role IN ('admin','super_admin')
  LOOP
    PERFORM public.notify_safe(r.id, p_kind, p_title, p_body, p_link, p_job_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_admins(%, %): %', p_kind, p_title, SQLERRM;
  RETURN 0;
END $fn$;

GRANT EXECUTE ON FUNCTION public.notify_admins(text, text, text, text, uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) MESSAGES — notify the counterparty after each INSERT.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notify_on_new_message()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
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
    -- Case B: sender is admin → notify the conversation owner
    PERFORM public.notify_safe(
      v_conv.user_id,
      'message',
      'NEXPEC Admin replied',
      v_preview,
      CASE
        WHEN v_conv.kind LIKE 'job_%inspector%' THEN '/inspector/messages/' || v_conv.id::text
        ELSE '/client/messages/' || v_conv.id::text
      END,
      v_conv.job_id
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_on_new_message: %', SQLERRM;
  RETURN NEW;
END $fn$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='messages' AND relnamespace='public'::regnamespace) THEN
    DROP TRIGGER IF EXISTS trg_notify_on_new_message ON public.messages;
    CREATE TRIGGER trg_notify_on_new_message
      AFTER INSERT ON public.messages
      FOR EACH ROW EXECUTE FUNCTION public.notify_on_new_message();
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'trg_notify_on_new_message: %', SQLERRM; END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) JOBS — status transitions notify the involved parties.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notify_on_job_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_inspector uuid;
  v_client    uuid;
  v_title     text;
BEGIN
  v_client    := COALESCE(NEW.client_id, NEW.agency_id);
  v_inspector := COALESCE(NEW.hired_inspector_id, NEW.inspector_id);
  v_title     := COALESCE(NULLIF(NEW.title, ''), 'Inspection job');

  -- A) Status transitions
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    -- Client notifications
    IF v_client IS NOT NULL THEN
      PERFORM public.notify_safe(
        v_client,
        'assignment',
        CASE NEW.status
          WHEN 'assigned'    THEN 'Inspector assigned'
          WHEN 'in_progress' THEN 'Inspection started'
          WHEN 'completed'   THEN 'Inspection completed'
          WHEN 'cancelled'   THEN 'Job cancelled'
          ELSE 'Job status updated'
        END,
        v_title || ' → ' || NEW.status,
        '/client/jobs/' || NEW.id::text,
        NEW.id
      );
    END IF;
    -- Inspector notifications
    IF v_inspector IS NOT NULL THEN
      PERFORM public.notify_safe(
        v_inspector,
        'assignment',
        CASE NEW.status
          WHEN 'assigned'    THEN 'New assignment'
          WHEN 'in_progress' THEN 'Inspection in progress'
          WHEN 'completed'   THEN 'Inspection marked complete'
          WHEN 'cancelled'   THEN 'Assignment cancelled'
          ELSE 'Job status updated'
        END,
        v_title || ' → ' || NEW.status,
        '/inspector/jobs/' || NEW.id::text,
        NEW.id
      );
    END IF;
  END IF;

  -- B) Inspector assignment (hired_inspector_id changed from null → uuid)
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.hired_inspector_id::text,'') <> COALESCE(OLD.hired_inspector_id::text,'')
     AND NEW.hired_inspector_id IS NOT NULL THEN
    PERFORM public.notify_safe(
      NEW.hired_inspector_id,
      'assignment',
      'You were assigned to a job',
      v_title,
      '/inspector/jobs/' || NEW.id::text,
      NEW.id
    );
    IF v_client IS NOT NULL THEN
      PERFORM public.notify_safe(
        v_client,
        'assignment',
        'Inspector hired for your job',
        v_title,
        '/client/jobs/' || NEW.id::text,
        NEW.id
      );
    END IF;
  END IF;

  -- C) Moderation status change
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.moderation_status,'') <> COALESCE(OLD.moderation_status,'') THEN
    IF v_client IS NOT NULL THEN
      PERFORM public.notify_safe(
        v_client,
        'job_moderated',
        CASE NEW.moderation_status
          WHEN 'approved' THEN 'Job approved'
          WHEN 'rejected' THEN 'Job rejected by review'
          WHEN 'flagged'  THEN 'Job flagged for review'
          ELSE 'Job moderation updated'
        END,
        v_title,
        '/client/jobs/' || NEW.id::text,
        NEW.id
      );
    END IF;
  END IF;

  -- D) Escrow paused
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.escrow_paused, false) IS DISTINCT FROM COALESCE(OLD.escrow_paused, false) THEN
    IF NEW.escrow_paused = true THEN
      IF v_client IS NOT NULL THEN
        PERFORM public.notify_safe(v_client, 'system', 'Escrow paused on your job',
          COALESCE(NEW.escrow_paused_reason, 'Pending admin review.'),
          '/client/jobs/' || NEW.id::text, NEW.id);
      END IF;
      IF v_inspector IS NOT NULL THEN
        PERFORM public.notify_safe(v_inspector, 'system', 'Escrow paused on your assignment',
          COALESCE(NEW.escrow_paused_reason, 'Pending admin review.'),
          '/inspector/jobs/' || NEW.id::text, NEW.id);
      END IF;
    END IF;
  END IF;

  -- E) Payout status change
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.payout_status,'') <> COALESCE(OLD.payout_status,'') THEN
    IF v_inspector IS NOT NULL AND NEW.payout_status IN ('paid','released','complete') THEN
      PERFORM public.notify_safe(v_inspector, 'payout_released',
        'Payout released', v_title || ' · payout sent.',
        '/inspector/payouts', NEW.id);
    END IF;
  END IF;

  -- F) New job posted (notify admins for moderation queue)
  IF TG_OP = 'INSERT' THEN
    PERFORM public.notify_admins(
      'job_moderated',
      'New job posted',
      v_title,
      '/admin/jobs/' || NEW.id::text,
      NEW.id
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_on_job_change: %', SQLERRM;
  RETURN NEW;
END $fn$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='jobs' AND relnamespace='public'::regnamespace) THEN
    DROP TRIGGER IF EXISTS trg_notify_on_job_change ON public.jobs;
    CREATE TRIGGER trg_notify_on_job_change
      AFTER INSERT OR UPDATE ON public.jobs
      FOR EACH ROW EXECUTE FUNCTION public.notify_on_job_change();
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'trg_notify_on_job_change: %', SQLERRM; END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) JOB APPLICATIONS — new app → notify client; status change → notify inspector.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notify_on_application_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_client uuid;
  v_title  text;
BEGIN
  BEGIN
    SELECT COALESCE(client_id, agency_id), COALESCE(NULLIF(title,''), 'your job')
      INTO v_client, v_title
      FROM public.jobs WHERE id = NEW.job_id;
  EXCEPTION WHEN OTHERS THEN
    v_client := NULL; v_title := 'your job';
  END;

  IF TG_OP = 'INSERT' THEN
    IF v_client IS NOT NULL THEN
      PERFORM public.notify_safe(
        v_client, 'application_status',
        'New inspector application',
        'An inspector applied to ' || v_title || '.',
        '/client/jobs/' || NEW.job_id::text || '/applications',
        NEW.job_id
      );
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.inspector_id IS NOT NULL THEN
      PERFORM public.notify_safe(
        NEW.inspector_id, 'application_status',
        CASE NEW.status
          WHEN 'accepted' THEN 'Application accepted'
          WHEN 'rejected' THEN 'Application not selected'
          WHEN 'withdrawn' THEN 'Application withdrawn'
          ELSE 'Application updated'
        END,
        v_title,
        '/inspector/jobs/' || NEW.job_id::text,
        NEW.job_id
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_on_application_change: %', SQLERRM;
  RETURN NEW;
END $fn$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='job_applications' AND relnamespace='public'::regnamespace) THEN
    DROP TRIGGER IF EXISTS trg_notify_on_application_change ON public.job_applications;
    CREATE TRIGGER trg_notify_on_application_change
      AFTER INSERT OR UPDATE ON public.job_applications
      FOR EACH ROW EXECUTE FUNCTION public.notify_on_application_change();
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'trg_notify_on_application_change: %', SQLERRM; END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) REVIEWS — new review notifies the reviewee.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notify_on_new_review()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.reviewee_id IS NOT NULL THEN
    PERFORM public.notify_safe(
      NEW.reviewee_id, 'review_received',
      'You received a review',
      'Rated ' || COALESCE(NEW.rating::text, '?') || '/5. Open to see the full review.',
      CASE WHEN NEW.direction = 'client_to_inspector'
           THEN '/inspector/reviews'
           ELSE '/client/reviews' END,
      NEW.job_id
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_on_new_review: %', SQLERRM;
  RETURN NEW;
END $fn$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='reviews' AND relnamespace='public'::regnamespace) THEN
    DROP TRIGGER IF EXISTS trg_notify_on_new_review ON public.reviews;
    CREATE TRIGGER trg_notify_on_new_review
      AFTER INSERT ON public.reviews
      FOR EACH ROW EXECUTE FUNCTION public.notify_on_new_review();
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'trg_notify_on_new_review: %', SQLERRM; END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) DISPUTES — already partially handled. Make sure the *opener* also gets a
--    confirmation receipt and the counterparty gets pinged.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notify_on_dispute_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_client uuid; v_inspector uuid; v_title text;
BEGIN
  BEGIN
    SELECT COALESCE(client_id, agency_id),
           COALESCE(hired_inspector_id, inspector_id),
           COALESCE(NULLIF(title,''), 'your job')
      INTO v_client, v_inspector, v_title
      FROM public.jobs WHERE id = NEW.job_id;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF TG_OP = 'INSERT' THEN
    -- Confirm to opener
    IF NEW.opener_id IS NOT NULL THEN
      PERFORM public.notify_safe(
        NEW.opener_id, 'dispute_filed',
        'Dispute filed',
        'Our team will respond within one business day.',
        '/disputes/' || NEW.id::text,
        NEW.job_id
      );
    END IF;
    -- Notify counterparty
    DECLARE v_counter uuid;
    BEGIN
      v_counter := CASE
        WHEN NEW.opener_id = v_client THEN v_inspector
        WHEN NEW.opener_id = v_inspector THEN v_client
        ELSE NULL
      END;
      IF v_counter IS NOT NULL THEN
        PERFORM public.notify_safe(
          v_counter, 'dispute_filed',
          'A dispute was opened on your job',
          v_title,
          '/disputes/' || NEW.id::text,
          NEW.job_id
        );
      END IF;
    END;
    -- Notify admins (broadcast)
    PERFORM public.notify_admins(
      'dispute_filed',
      'New dispute filed',
      v_title,
      '/admin/disputes/' || NEW.id::text,
      NEW.job_id
    );

  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    -- Resolution updates both parties
    IF v_client IS NOT NULL THEN
      PERFORM public.notify_safe(v_client, 'dispute_update',
        'Dispute ' || NEW.status, v_title,
        '/disputes/' || NEW.id::text, NEW.job_id);
    END IF;
    IF v_inspector IS NOT NULL THEN
      PERFORM public.notify_safe(v_inspector, 'dispute_update',
        'Dispute ' || NEW.status, v_title,
        '/disputes/' || NEW.id::text, NEW.job_id);
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_on_dispute_change: %', SQLERRM;
  RETURN NEW;
END $fn$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='disputes' AND relnamespace='public'::regnamespace) THEN
    DROP TRIGGER IF EXISTS trg_notify_on_dispute_change ON public.disputes;
    CREATE TRIGGER trg_notify_on_dispute_change
      AFTER INSERT OR UPDATE ON public.disputes
      FOR EACH ROW EXECUTE FUNCTION public.notify_on_dispute_change();
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'trg_notify_on_dispute_change: %', SQLERRM; END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) CONTRACT ASSIGNMENTS — notify the assigned party.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notify_on_contract_assignment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_title text;
BEGIN
  BEGIN
    SELECT COALESCE(NULLIF(title,''), kind) INTO v_title
      FROM public.contracts WHERE id = NEW.contract_id;
  EXCEPTION WHEN OTHERS THEN v_title := 'Contract'; END;

  IF TG_OP = 'INSERT' AND NEW.party_id IS NOT NULL THEN
    PERFORM public.notify_safe(
      NEW.party_id, 'contract_assigned',
      'Contract awaiting signature',
      COALESCE(v_title, 'Open to review and sign.'),
      '/contracts/' || NEW.id::text,
      NULL
    );
  ELSIF TG_OP = 'UPDATE'
        AND NEW.signed_at IS NOT NULL
        AND OLD.signed_at IS NULL THEN
    PERFORM public.notify_admins(
      'contract_assigned',
      'Contract signed',
      v_title,
      '/admin/contracts/' || NEW.id::text,
      NULL
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_on_contract_assignment: %', SQLERRM;
  RETURN NEW;
END $fn$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='contract_assignments' AND relnamespace='public'::regnamespace) THEN
    DROP TRIGGER IF EXISTS trg_notify_on_contract_assignment ON public.contract_assignments;
    CREATE TRIGGER trg_notify_on_contract_assignment
      AFTER INSERT OR UPDATE ON public.contract_assignments
      FOR EACH ROW EXECUTE FUNCTION public.notify_on_contract_assignment();
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'trg_notify_on_contract_assignment: %', SQLERRM; END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 8) TRANSACTIONS — notify inspector on completion / status changes.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notify_on_transaction_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_amount numeric;
BEGIN
  IF NEW.inspector_id IS NULL THEN RETURN NEW; END IF;

  v_amount := COALESCE(NEW.net_amount_halalas, NEW.gross_amount_halalas, 0) / 100.0;

  IF TG_OP = 'INSERT' AND NEW.status IN ('completed','paid','released') THEN
    PERFORM public.notify_safe(
      NEW.inspector_id, 'payout_released',
      'Earnings credited',
      'SAR ' || v_amount::text || ' from ' || COALESCE(NEW.description, 'a recent inspection'),
      '/inspector/payouts',
      NEW.job_id
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
        AND NEW.status IN ('completed','paid','released') THEN
    PERFORM public.notify_safe(
      NEW.inspector_id, 'payout_released',
      'Payout sent',
      'SAR ' || v_amount::text || ' is on its way to your bank.',
      '/inspector/payouts',
      NEW.job_id
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_on_transaction_change: %', SQLERRM;
  RETURN NEW;
END $fn$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='transactions' AND relnamespace='public'::regnamespace) THEN
    DROP TRIGGER IF EXISTS trg_notify_on_transaction_change ON public.transactions;
    CREATE TRIGGER trg_notify_on_transaction_change
      AFTER INSERT OR UPDATE ON public.transactions
      FOR EACH ROW EXECUTE FUNCTION public.notify_on_transaction_change();
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'trg_notify_on_transaction_change: %', SQLERRM; END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 9) Realtime publication: make sure notifications are streamed to clients.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'realtime publication add: %', SQLERRM; END $$;

COMMIT;
