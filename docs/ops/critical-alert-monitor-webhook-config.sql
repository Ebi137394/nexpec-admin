-- Critical Alert Monitor - Database Webhook Configuration
-- This SQL file provides multiple options for setting up the webhook trigger

-- Option 1: Using Supabase Dashboard UI (Recommended)
-- Go to Database → Webhooks → Create
-- 1. Table: inspection_events
-- 2. Events: INSERT
-- 3. Type: Supabase Edge Function
-- 4. Function: critical-alert-monitor
-- 5. Add header: Authorization = Bearer <WEBHOOK_SECRET>

-- Option 2: Using pg_net-based webhook (Alternative)
-- This approach uses pg_net to call the edge function directly
-- Note: Requires pg_net extension to be enabled

-- First, ensure pg_net is enabled (if not already done)
-- CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create a function that will be triggered on INSERT
CREATE OR REPLACE FUNCTION public.notify_critical_alert()
RETURNS TRIGGER AS $$
DECLARE
  _payload JSONB;
  _function_url TEXT;
  _webhook_secret TEXT;
BEGIN
  -- Only fire for fail or incident
  IF NEW.result = 'fail' OR NEW.type = 'incident' THEN
    -- Get the function URL and webhook secret from app settings
    _function_url := current_setting('app.settings.edge_function_url', true);
    _webhook_secret := current_setting('app.settings.webhook_secret', true);
    
    -- If settings are not configured, use environment variables
    IF _function_url IS NULL THEN
      _function_url := current_setting('SUPABASE_URL', true);
      IF _function_url IS NOT NULL THEN
        _function_url := _function_url || '/functions/v1/critical-alert-monitor';
      END IF;
    END IF;
    
    IF _function_url IS NOT NULL THEN
      _payload := jsonb_build_object(
        'type',       TG_OP,
        'table',      TG_TABLE_NAME,
        'schema',     TG_TABLE_SCHEMA,
        'record',     row_to_json(NEW)::jsonb,
        'old_record', NULL
      );

      PERFORM net.http_post(
        url     := _function_url,
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || COALESCE(_webhook_secret, current_setting('WEBHOOK_SECRET', true))
        ),
        body    := _payload
      );
    ELSE
      -- Fallback: log the event for manual processing
      RAISE NOTICE 'Critical alert detected but webhook URL not configured: %', NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger
CREATE TRIGGER trg_critical_alert
  AFTER INSERT ON public.inspection_events
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_critical_alert();

-- Option 3: Manual webhook setup using pg_cron (Scheduled approach)
-- This is useful if you want to batch process events
-- Note: Requires pg_cron extension

-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create a function to process pending critical events
-- CREATE OR REPLACE FUNCTION public.process_critical_events()
-- RETURNS void AS $$
-- DECLARE
--   event_record inspection_events%ROWTYPE;
-- BEGIN
--   FOR event_record IN 
--     SELECT * FROM inspection_events 
--     WHERE (result = 'fail' OR type = 'incident') 
--       AND id NOT IN (SELECT event_id FROM alerts)
--       AND created_at > NOW() - INTERVAL '1 minute'
--   LOOP
--     -- Call the edge function for each event
--     PERFORM net.http_post(
--       url     := current_setting('app.settings.edge_function_url') || '/critical-alert-monitor',
--       headers := jsonb_build_object(
--         'Content-Type',  'application/json',
--         'Authorization', 'Bearer ' || current_setting('app.settings.webhook_secret')
--       ),
--       body    := jsonb_build_object(
--         'type',       'INSERT',
--         'table',      'inspection_events',
--         'schema',     'public',
--         'record',     row_to_json(event_record)::jsonb,
--         'old_record', NULL
--       )
--     );
--   END LOOP;
-- END;
-- $$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule the function to run every minute
-- SELECT cron.schedule('process-critical-events', '* * * * *', 'SELECT public.process_critical_events();');

-- Cleanup function to remove the trigger (if needed)
CREATE OR REPLACE FUNCTION public.remove_critical_alert_trigger()
RETURNS void AS $$
BEGIN
  DROP TRIGGER IF EXISTS trg_critical_alert ON public.inspection_events;
  DROP FUNCTION IF EXISTS public.notify_critical_alert() CASCADE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Usage notes:
-- 1. Set the webhook secret in Supabase settings:
--    ALTER DATABASE your_database SET app.settings.webhook_secret = 'your-secret-here';
--
-- 2. Set the edge function URL:
--    ALTER DATABASE your_database SET app.settings.edge_function_url = 'https://your-project.supabase.co/functions/v1';
--
-- 3. Test the trigger:
--    INSERT INTO inspection_events (id, asset_id, type, result, severity, summary, performed_by, performed_at)
--    VALUES (gen_random_uuid(), 'asset-123', 'inspection', 'fail', 'high', 'Test critical failure', 'test-user', NOW());
--
-- 4. Check if alert was created:
--    SELECT * FROM alerts WHERE event_id = 'your-event-id';