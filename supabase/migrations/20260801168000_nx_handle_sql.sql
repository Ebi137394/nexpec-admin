-- ════════════════════════════════════════════════════════════════════════════
--  20260801168000_nx_handle_sql.sql
--
--  public.nx_handle(uuid) — deterministic, non-reversible pseudonym ("NX-7F3A2C")
--  derived from an opaque id. This is the SQL twin of the TS implementation in
--  src/core/utils/handle.ts (and apps/web/src/lib/identity/inspectorHandle.ts).
--  It MUST stay byte-identical so the same id renders the same handle on the
--  public web feed (server-rendered) and inside the app.
--
--  Algorithm (verbatim from handle.ts):
--    - FNV-1a 32-bit over the seed 'nexpec-handle:' || id   (offset 0x811c9dc5,
--      prime 0x01000193), kept to an unsigned 32-bit value.
--    - 6 base-32 digits over the Crockford alphabet (no I/L/O/U), MSB-first.
--    - NULL id → 'NX-000000'.
--
--  plpgsql notes: JS uses Math.imul (signed 32-bit multiply, low 32 bits).
--  Modular multiplication is sign-agnostic in its low bits, so (h * prime) masked
--  with 0xFFFFFFFF reproduces Math.imul's bit pattern exactly. Verified against
--  handle.ts on 4 vectors + NULL (see self-test below).
--
--  IMMUTABLE / PARALLEL SAFE / no table access. Idempotent. ADDITIVE.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.nx_handle(p_id uuid)
RETURNS text
  LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  c_alphabet constant text   := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';  -- 32 chars
  c_mask     constant bigint := 4294967295;                          -- 0xFFFFFFFF
  v_seed     text;
  v_h        bigint := 2166136261;   -- 0x811c9dc5  (FNV-1a offset basis)
  v_i        int;
  v_n        bigint;
  v_out      text := '';
BEGIN
  IF p_id IS NULL THEN
    RETURN 'NX-000000';
  END IF;

  v_seed := 'nexpec-handle:' || p_id::text;   -- uuid::text is lowercase canonical

  -- FNV-1a 32-bit
  FOR v_i IN 1 .. length(v_seed) LOOP
    v_h := (v_h # ascii(substr(v_seed, v_i, 1))::bigint);   -- XOR byte
    v_h := (v_h * 16777619) & c_mask;                       -- *prime, low 32 bits
  END LOOP;

  -- 6 base-32 digits, most-significant first
  v_n := v_h;
  FOR v_i IN 1 .. 6 LOOP
    v_out := substr(c_alphabet, (v_n % 32)::int + 1, 1) || v_out;
    v_n := v_n / 32;   -- bigint integer division (v_n >= 0 ⇒ floor)
  END LOOP;

  RETURN 'NX-' || v_out;
END
$fn$;

REVOKE ALL   ON FUNCTION public.nx_handle(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nx_handle(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.nx_handle(uuid) IS
  'Deterministic pseudonym (NX-XXXXXX) for an opaque id. Byte-identical twin of src/core/utils/handle.ts. Anti-poaching: public/buyer surfaces emit this, never the real name or raw id.';

-- ── Parity self-test: must match handle.ts exactly ───────────────────────────
DO $$
BEGIN
  IF public.nx_handle(NULL) <> 'NX-000000' THEN
    RAISE EXCEPTION 'SELFTEST nx_handle(NULL) = % (expected NX-000000)', public.nx_handle(NULL);
  END IF;
  IF public.nx_handle('00000000-0000-0000-0000-000000000000') <> 'NX-9S1PC5' THEN
    RAISE EXCEPTION 'SELFTEST nx_handle #1 = % (expected NX-9S1PC5)', public.nx_handle('00000000-0000-0000-0000-000000000000');
  END IF;
  IF public.nx_handle('11111111-1111-1111-1111-111111111111') <> 'NX-RHFP6N' THEN
    RAISE EXCEPTION 'SELFTEST nx_handle #2 = % (expected NX-RHFP6N)', public.nx_handle('11111111-1111-1111-1111-111111111111');
  END IF;
  IF public.nx_handle('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11') <> 'NX-55Q97B' THEN
    RAISE EXCEPTION 'SELFTEST nx_handle #3 = % (expected NX-55Q97B)', public.nx_handle('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  END IF;
  IF public.nx_handle('deadbeef-dead-beef-dead-beefdeadbeef') <> 'NX-WW4AKN' THEN
    RAISE EXCEPTION 'SELFTEST nx_handle #4 = % (expected NX-WW4AKN)', public.nx_handle('deadbeef-dead-beef-dead-beefdeadbeef');
  END IF;
  RAISE NOTICE 'nx_handle parity OK (matches handle.ts on 4 vectors + NULL).';
END $$;

COMMIT;
