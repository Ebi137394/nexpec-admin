-- Simple RLS fix script
-- Enable RLS on jobs table
ALTER TABLE IF EXISTS public.jobs ENABLE ROW LEVEL SECURITY;

-- Create policy for jobs table
CREATE POLICY "Users can view jobs" ON public.jobs
FOR SELECT 
USING (
  -- Clients can view their own jobs
  auth.uid() = client_id
  OR
  -- Contractors can view jobs they've applied to or have contracts for
  EXISTS (
    SELECT 1 FROM public.applications 
    WHERE job_id = jobs.id AND applicant_id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM public.contracts 
    WHERE job_id = jobs.id AND (
      worker_id = auth.uid() 
      OR contractor_id = auth.uid() 
      OR inspector_id = auth.uid()
    )
  )
  OR
  EXISTS (
    SELECT 1 FROM public.proposals 
    WHERE job_id = jobs.id AND contractor_id = auth.uid()
  )
);

-- Create notifications table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    read boolean DEFAULT false,
    created_at timestamptz DEFAULT now()
);

-- Enable RLS on notifications
ALTER TABLE IF EXISTS public.notifications ENABLE ROW LEVEL SECURITY;

-- Create policy for notifications
CREATE POLICY "Users can view their own notifications" ON public.notifications
FOR SELECT 
USING (auth.uid() = user_id);

-- Reload PostgREST config
NOTIFY pgrst, 'reload config';