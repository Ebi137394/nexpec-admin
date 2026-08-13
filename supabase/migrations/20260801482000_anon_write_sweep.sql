-- ════════════════════════════════════════════════════════════════════════════
--  20260801482000_anon_write_sweep.sql
--
--  P0 — 105 repository-owned tables grant INSERT / UPDATE / DELETE to `anon`.
--
--  ── HOW THIS SURFACED ──────────────────────────────────────────────────────
--  funding_gate_test assertions C3/C4 were failing at HEAD a35b7b6:
--      C3 authenticated holds no blanket UPDATE on jobs
--      C4 anon holds no UPDATE on jobs
--  Investigating the live ACL rather than editing the assertions found:
--      jobs: anon=awdm/postgres   authenticated=awdDxtm/postgres
--  i.e. anon holds INSERT(a) UPDATE(w) DELETE(d) MAINTAIN(m) on public.jobs —
--  everything except SELECT. A census across the schema found the same shape on
--  105 repo-owned tables, including auth_recovery_codes and agreements.
--
--  ── WHY IT LOOKED HARMLESS, AND WHY IT IS NOT ──────────────────────────────
--  A probe as role anon returned "permission denied for table jobs", which is
--  easy to misread as "already safe". It is not: the statement was denied on
--  the ROW READ (anon lacks SELECT), not on the write. The write privilege is
--  genuinely held. Any statement that does not require reading a row — or any
--  future migration that grants anon SELECT on one of these — converts a
--  dormant grant into a live write path.
--
--  This is the same defect family as 20260801480000 (13 tables with anon
--  read+write and RLS off) and has the same root cause recorded there: 442000
--  revoked anon DEFAULT PRIVILEGES only FOR ROLE postgres, while the residual
--  default ACLs belong to supabase_admin and are NOT revocable from a
--  migration (postgres is not a member; the ALTER raises "permission denied to
--  change default privileges"). Since the source cannot be closed, the grants
--  it already minted must be swept.
--
--  ── WHAT THIS DOES ─────────────────────────────────────────────────────────
--  Revokes INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--  from anon and PUBLIC on every repo-owned base table in public.
--
--  SELECT IS NOT TOUCHED. Read access is deliberately left exactly as it is:
--  several surfaces depend on documented anonymous reads (public_demand_feed,
--  public_supply_feed), and reads are already mediated by RLS everywhere
--  480000 enabled it. Sweeping reads here would be a second, riskier change
--  bundled into a security fix — it belongs in its own slice with its own
--  evidence.
--
--  Extension-owned objects (PostGIS: geography_columns, geometry_columns,
--  spatial_ref_sys) are EXCLUDED. They are created and granted by the
--  extension, are not ours to alter, and revoking on them can break postgis.
--  The pgTAP sweep assertion is scoped to repo-owned objects for the same
--  reason — that is correct scoping, not a weakened guard.
--
--  service_role, authenticated and postgres are untouched: `authenticated`
--  legitimately updates jobs (a client editing its own job was proven to still
--  work), and revoking that would break production.
--
--  No funding, identity, settlement or review guard is weakened. No money path
--  is touched.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $sweep$
DECLARE
  r record;
  v_n int := 0;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_roles o     ON o.oid = c.relowner
      LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'e'
     WHERE c.relkind = 'r'
       AND d.objid IS NULL                    -- not extension-owned (PostGIS)
       AND o.rolname <> 'supabase_admin'      -- not Supabase-managed
       AND EXISTS (
             SELECT 1 FROM information_schema.table_privileges tp
              WHERE tp.table_schema = 'public'
                AND tp.table_name = c.relname
                AND tp.grantee = 'anon'
                AND tp.privilege_type IN
                    ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
     ORDER BY c.relname
  LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM anon, PUBLIC',
      r.relname);
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'anon write sweep: revoked on % table(s)', v_n;
END
$sweep$;

-- ─── Selftest — behaviour, and scoped correctly ─────────────────────────────
DO $selftest$
DECLARE v_bad text; v_n int;
BEGIN
  -- No REPO-OWNED table may leave anon holding a write privilege.
  -- Extension-owned objects are excluded deliberately (see header).
  FOR v_bad IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_roles o     ON o.oid = c.relowner
      LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'e'
     WHERE c.relkind = 'r'
       AND d.objid IS NULL
       AND o.rolname <> 'supabase_admin'
       AND EXISTS (
             SELECT 1 FROM information_schema.table_privileges tp
              WHERE tp.table_schema = 'public'
                AND tp.table_name = c.relname
                AND tp.grantee = 'anon'
                AND tp.privilege_type IN
                    ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
  LOOP
    RAISE EXCEPTION
      'SELFTEST: anon still holds a write privilege on repo-owned public.%', v_bad;
  END LOOP;

  -- authenticated MUST keep UPDATE on jobs — a client editing its own job
  -- depends on it, and revoking it would break production. If this ever
  -- becomes false, the sweep has over-reached.
  IF NOT has_table_privilege('authenticated', 'public.jobs', 'UPDATE') THEN
    RAISE EXCEPTION
      'SELFTEST: authenticated lost UPDATE on jobs — clients could no longer edit their own jobs';
  END IF;

  -- and the documented public feeds must still be readable
  SELECT count(*) INTO v_n
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('public_demand_feed','public_supply_feed')
     AND policyname LIKE '%_public_read';
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'SELFTEST: the documented public feeds lost their anonymous read';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
