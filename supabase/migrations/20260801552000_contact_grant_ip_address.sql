-- Follow-up to 20260801550000 (D28). The contact Server Action also records
-- ip_address (derived server-side from request headers — the visitor never
-- supplies it), so the column-scoped INSERT grant must include it or the whole
-- insert still dies with 42501. status/admin_notes remain non-writable.
GRANT INSERT (ip_address) ON public.contact_submissions TO anon, authenticated;
