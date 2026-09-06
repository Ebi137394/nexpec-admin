-- ════════════════════════════════════════════════════════════════════════════
--  Canonical ingest for provider delivery events.
--
--  Polling only learned about a bounce when we happened to look. This turns a
--  bounce or complaint into suppression the moment Resend reports it, which is
--  what actually protects the sending domain.
--
--  A COMPLAINT is treated as strictly more serious than a bounce: the person
--  exists and asked not to be contacted, so they are suppressed permanently
--  and never reclassified as 'fake' — they are a real user exercising a real
--  choice.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.email_delivery_events (
  id           bigserial PRIMARY KEY,
  email        text NOT NULL,
  event        text NOT NULL,
  reason       text,
  provider_id  text,
  received_at  timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS email_delivery_events_email_idx ON public.email_delivery_events (lower(email), received_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS email_delivery_events_dedupe
  ON public.email_delivery_events (provider_id, event) WHERE provider_id IS NOT NULL;
ALTER TABLE public.email_delivery_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_events_admin_only ON public.email_delivery_events;
CREATE POLICY email_events_admin_only ON public.email_delivery_events
  FOR SELECT TO authenticated USING (public.nx_is_admin());
REVOKE ALL ON public.email_delivery_events FROM anon, authenticated;
GRANT SELECT, INSERT ON public.email_delivery_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.email_delivery_events_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.nx_apply_email_event(p_email text,
                                                       p_event text,
                                                       p_reason text DEFAULT NULL,
                                                       p_provider_id text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_hard boolean := p_event IN ('email.bounced','email.complained');
BEGIN
  -- Idempotent: Svix retries, and a retried bounce must not double-count.
  INSERT INTO public.email_delivery_events (email, event, reason, provider_id)
  VALUES (lower(btrim(p_email)), p_event, p_reason, p_provider_id)
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_user FROM public.profiles
   WHERE lower(email) = lower(btrim(p_email)) LIMIT 1;
  IF v_user IS NULL THEN RETURN false; END IF;

  IF v_hard THEN
    -- Stop future sends immediately. State stays 'suspicious' unless the
    -- deterministic rules already proved the account synthetic: a complaint
    -- comes from a REAL person, and a bounce may be a real user's typo.
    INSERT INTO public.account_quality AS q (user_id, state, reasons, email_suppressed, suppress_reason)
    VALUES (v_user,
            CASE WHEN p_event='email.complained' THEN 'normal' ELSE 'suspicious' END,
            ARRAY[replace(p_event,'email.','provider_')],
            true,
            COALESCE(p_reason, p_event))
    ON CONFLICT (user_id) DO UPDATE
      SET email_suppressed = true,
          suppress_reason  = COALESCE(EXCLUDED.suppress_reason, q.suppress_reason),
          reasons          = (SELECT array_agg(DISTINCT x)
                                FROM unnest(q.reasons || EXCLUDED.reasons) x),
          -- Never downgrade a confirmed classification, never override a human.
          state            = CASE WHEN q.state = 'known_test_or_fake' OR q.is_manual
                                  THEN q.state ELSE EXCLUDED.state END,
          classified_at    = NOW();

    -- Stop the outbox retrying this address.
    UPDATE public.notifications
       SET email_send_error = COALESCE(email_send_error,'') || ' | ' || COALESCE(p_reason, p_event),
           email_attempts   = GREATEST(COALESCE(email_attempts,0), 5)
     WHERE recipient_id = v_user AND email_required AND email_dispatched_at IS NULL;
  END IF;

  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.nx_apply_email_event(text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_apply_email_event(text,text,text,text) TO service_role;

-- Systemic-failure signal for the owner: a SPIKE, not individual bounces.
CREATE OR REPLACE FUNCTION public.nx_email_bounce_spike(p_hours integer DEFAULT 24)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
  SELECT jsonb_build_object(
    'window_hours', GREATEST(COALESCE(p_hours,24),1),
    'bounced',   count(*) FILTER (WHERE event='email.bounced'),
    'complained',count(*) FILTER (WHERE event='email.complained'),
    'delivered', count(*) FILTER (WHERE event='email.delivered'),
    'spike',     count(*) FILTER (WHERE event IN ('email.bounced','email.complained')) >= 5)
    FROM public.email_delivery_events
   WHERE received_at > NOW() - make_interval(hours => GREATEST(COALESCE(p_hours,24),1));
$$;
REVOKE ALL ON FUNCTION public.nx_email_bounce_spike(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_email_bounce_spike(integer) TO authenticated, service_role;
