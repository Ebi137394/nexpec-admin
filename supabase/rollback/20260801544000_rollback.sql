-- Rollback for 20260801544000_fix_submit_inspection_report_rpc.sql
-- Restores the ORIGINAL broken body for the record. Note restoring it
-- re-breaks the RPC (illegal under_review write => always rolls back) and
-- re-removes the authorization check that 544000 added.
CREATE OR REPLACE FUNCTION public.submit_inspection_report(p_job_id uuid, p_photo_url text, p_notes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO public.inspection_reports (job_id, inspector_id, photo_url, notes)
    VALUES (p_job_id, auth.uid(), p_photo_url, p_notes)
    ON CONFLICT (job_id, inspector_id) DO UPDATE SET photo_url = EXCLUDED.photo_url, notes = EXCLUDED.notes;

    UPDATE public.jobs SET status = 'under_review', updated_at = NOW() WHERE id = p_job_id;

    RETURN jsonb_build_object('success', true);
END;
$function$;
