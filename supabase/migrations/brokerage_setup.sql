-- Create Job Applications Table (The Brokerage Engine)
CREATE TABLE IF NOT EXISTS public.job_applications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    inspector_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'client_selected', 'rejected', 'assigned')),
    cover_letter TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(job_id, inspector_id)
);

-- Enable RLS
ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;

-- 1. Inspectors can view and create their own applications
CREATE POLICY "Inspectors can view own applications" ON public.job_applications FOR SELECT USING (auth.uid() = inspector_id);
CREATE POLICY "Inspectors can apply to open jobs" ON public.job_applications FOR INSERT WITH CHECK (auth.uid() = inspector_id);

-- 2. Clients AND Agencies can view applications for the jobs they posted
CREATE POLICY "Job Owners can view applications" ON public.job_applications FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.jobs WHERE jobs.id = job_applications.job_id AND jobs.client_id = auth.uid())
);

-- 3. Clients AND Agencies can update status to 'client_selected'
CREATE POLICY "Job Owners can select an inspector" ON public.job_applications FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.jobs WHERE jobs.id = job_applications.job_id AND jobs.client_id = auth.uid())
);

-- 4. Super Admins can do everything
CREATE POLICY "Super Admins can manage all applications" ON public.job_applications FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin')
);