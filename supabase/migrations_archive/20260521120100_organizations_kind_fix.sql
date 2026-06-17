-- ════════════════════════════════════════════════════════════════════════════
--  20260521120100_organizations_kind_fix.sql — superseded
--
--  This file is intentionally empty. The fix for the `column "kind" does
--  not exist` error from 20260521120000 lives in:
--
--    20260521120100_organizations_schema_align.sql
--
--  Both files share a timestamp; Supabase picks alphabetical order. The
--  align variant is the canonical migration. Running this empty file is
--  a no-op.
-- ════════════════════════════════════════════════════════════════════════════

-- intentional no-op
SELECT 1;
