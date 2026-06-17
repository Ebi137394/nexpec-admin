-- ════════════════════════════════════════════════════════════════════════════
--  20260801125000_brokered_agreement_notifications.sql
--
--  Autonomous notification the moment a brokered agreement is PRESENTED to its
--  counterparty. Fires on the agreements row transition itself, so it covers
--  EVERY path that presents a leg:
--     • award_and_dispatch        → client_supply inserted 'presented'  (client)
--     • admin_present_agreement   → supplier_supply draft → 'presented' (supplier)
--     • admin_assign_inspector    → inspector_engagement 'presented'    (inspector)
--
--  public.notify_safe() is the platform-canonical helper: it writes the in-app
--  row (bell + unread badge — ALWAYS, the bell is never muted) and feeds the
--  consent-gated email queue. Expo DEVICE push is layered on top by the
--  notify-agreement Edge Function (invoked by the admin present/assign actions);
--  this trigger is the in-app/email backbone and needs no external infra.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public._brokered_notify_on_present()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_job_id uuid;
  v_title  text;
  v_body   text;
BEGIN
  -- Only on the transition INTO 'presented', and only with a real counterparty.
  IF NEW.status IS DISTINCT FROM 'presented' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'presented' THEN RETURN NEW; END IF;
  IF NEW.counterparty_id IS NULL THEN RETURN NEW; END IF;

  SELECT job_id INTO v_job_id FROM public.deals WHERE id = NEW.deal_id;

  v_title := 'New agreement to sign';
  v_body  := CASE NEW.kind
    WHEN 'supplier_supply'      THEN 'NEXPEC has presented a supply agreement for your review and signature.'
    WHEN 'inspector_engagement' THEN 'NEXPEC has presented an inspection engagement for your review and signature.'
    WHEN 'client_supply'        THEN 'Your supply and inspection agreement is ready to review and sign.'
    ELSE 'NEXPEC has presented an agreement for your review and signature.'
  END;

  PERFORM public.notify_safe(
    NEW.counterparty_id,
    'agreement_presented',
    v_title,
    v_body,
    '/agreements',
    v_job_id
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Fail open: a notification hiccup must never block contract presentation.
  RAISE NOTICE '_brokered_notify_on_present: %', SQLERRM;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_brokered_notify_on_present ON public.agreements;
CREATE TRIGGER trg_brokered_notify_on_present
  AFTER INSERT OR UPDATE OF status ON public.agreements
  FOR EACH ROW EXECUTE FUNCTION public._brokered_notify_on_present();

-- ── Self-tests ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public._brokered_notify_on_present()') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: _brokered_notify_on_present missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_brokered_notify_on_present') THEN
    RAISE EXCEPTION 'SELFTEST: trg_brokered_notify_on_present missing';
  END IF;
  IF to_regprocedure('public.notify_safe(uuid,text,text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: notify_safe dependency missing';
  END IF;
  RAISE NOTICE 'Brokered agreement notifications OK: notify counterparty on presented.';
END $$;

COMMIT;
