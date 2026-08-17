-- Rollback for 20260801550000 — re-deadens the public contact form.
REVOKE INSERT ON public.contact_submissions FROM anon, authenticated;
-- (also reverts 20260801552000's ip_address grant via the blanket REVOKE above)
