-- Add calendar_event_id column to jobs table for calendar sync
ALTER TABLE public.jobs 
ADD COLUMN IF NOT EXISTS calendar_event_id TEXT,
ADD COLUMN IF NOT EXISTS calendar_synced_at TIMESTAMPTZ;

-- Create index for quick lookups
CREATE INDEX IF NOT EXISTS idx_jobs_calendar_event_id
  ON public.jobs(calendar_event_id)
  WHERE calendar_event_id IS NOT NULL;

COMMENT ON COLUMN public.jobs.calendar_event_id IS 'The native calendar event ID for syncing job inspections to device calendar';
COMMENT ON COLUMN public.jobs.calendar_synced_at IS 'Timestamp when the job was last synced to the calendar';