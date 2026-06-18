-- ════════════════════════════════════════════════════════════════════════════
--  20260801153000_tax_inhouse_vault.sql
--
--  IN-HOUSE TAX PII VAULT (owner directive; replaces the tokenize route).
--
--  Stores the raw tax identifier (SSN/SIN/TIN) ENCRYPTED AT REST via pgcrypto
--  (pgp_sym_encrypt). Security model:
--    • Key NEVER lives in the DB. It is supplied at call time as a parameterized
--      RPC argument from server-side env (TAX_VAULT_KEY in Supabase function
--      secrets + the web server env). DB stores only ciphertext (bytea) + a
--      display-safe last-4. No plaintext column ever.
--    • Decryption is ADMIN-ONLY and AUDITED — admin_decrypt_tax_id writes a
--      tax.pii_decrypted audit_events row on every access.
--    • RLS: a payee can read their own row (ciphertext is opaque without the key);
--      admin can read any. Writes happen only through these SECURITY DEFINER RPCs.
--
--  Liability accepted by the owner; this storage is in scope for the privacy /
--  SSN-protection / breach-notification review on the launch roadmap.
-- ════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;  -- pgcrypto lives in the "extensions" schema (Supabase default)

ALTER TABLE public.tax_profiles
  ADD COLUMN IF NOT EXISTS tax_id_cipher bytea;   -- pgp_sym_encrypt(raw TIN, key)
-- (masked_tax_id from 151000 holds the display-safe last-4; no plaintext column.)

-- ─── Payee stores their raw TIN (encrypted) — owner-callable ─────────────────
CREATE OR REPLACE FUNCTION public.vault_store_tax_id(
  p_form_type text,
  p_country   text,
  p_tax_id    text,
  p_key       text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_last4 text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '28000'; END IF;
  IF p_form_type IS NULL OR p_form_type NOT IN ('w9','w8ben','w8bene','t4a','dac7') THEN
    RAISE EXCEPTION 'INVALID_FORM_TYPE';
  END IF;
  IF p_tax_id IS NULL OR length(btrim(p_tax_id)) < 4 THEN RAISE EXCEPTION 'INVALID_TAX_ID'; END IF;
  IF p_key IS NULL OR length(p_key) < 16 THEN RAISE EXCEPTION 'VAULT_KEY_MISSING'; END IF;

  v_last4 := right(regexp_replace(p_tax_id, '\s', '', 'g'), 4);

  INSERT INTO public.tax_profiles (user_id, tax_status, form_type, tax_residency_country,
        masked_tax_id, tax_id_cipher, submitted_at, updated_at)
  VALUES (v_uid, 'submitted', p_form_type, p_country,
        v_last4, extensions.pgp_sym_encrypt(p_tax_id, p_key), now(), now())
  ON CONFLICT (user_id) DO UPDATE SET
        tax_status = 'submitted',
        form_type = EXCLUDED.form_type,
        tax_residency_country = EXCLUDED.tax_residency_country,
        masked_tax_id = EXCLUDED.masked_tax_id,
        tax_id_cipher = EXCLUDED.tax_id_cipher,
        submitted_at = now(),
        updated_at = now();

  RETURN jsonb_build_object('ok', true, 'status', 'submitted', 'last4', v_last4);
END
$fn$;

-- ─── Admin decrypts the raw TIN (admin-only, AUDITED on every access) ────────
CREATE OR REPLACE FUNCTION public.admin_decrypt_tax_id(p_user_id uuid, p_key text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cipher bytea;
  v_plain  text;
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501'; END IF;
  IF p_key IS NULL OR length(p_key) < 16 THEN RAISE EXCEPTION 'VAULT_KEY_MISSING'; END IF;

  SELECT tax_id_cipher INTO v_cipher FROM public.tax_profiles WHERE user_id = p_user_id;
  IF v_cipher IS NULL THEN RAISE EXCEPTION 'NO_TAX_ID_ON_FILE' USING ERRCODE = 'P0002'; END IF;

  v_plain := extensions.pgp_sym_decrypt(v_cipher, p_key);   -- raises on wrong key

  -- Accountable: log WHO decrypted WHOSE tax id, every time.
  INSERT INTO public.audit_events
    (event_type, severity, actor_id, actor_role, actor_label, subject_table, subject_id, summary, delta, metadata)
  VALUES ('tax.pii_decrypted', 'warning', auth.uid(), 'admin', 'Tax Center',
          'tax_profiles', p_user_id, 'Admin decrypted a stored tax identifier',
          '{}'::jsonb, jsonb_build_object('user_id', p_user_id));

  RETURN v_plain;
END
$fn$;

REVOKE ALL ON FUNCTION public.vault_store_tax_id(text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_decrypt_tax_id(uuid,text)        FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vault_store_tax_id(text,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_decrypt_tax_id(uuid,text)        TO authenticated, service_role;
ALTER FUNCTION public.vault_store_tax_id(text,text,text,text) OWNER TO postgres;
ALTER FUNCTION public.admin_decrypt_tax_id(uuid,text)        OWNER TO postgres;

-- ─── Self-test (round-trip with an ephemeral key) ────────────────────────────
DO $selftest$
DECLARE v_c bytea; v_p text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='pgp_sym_encrypt') THEN
    RAISE EXCEPTION 'SELFTEST: pgcrypto pgp_sym_encrypt unavailable';
  END IF;
  v_c := extensions.pgp_sym_encrypt('123-45-6789', 'selftest-key-0123456789');
  v_p := extensions.pgp_sym_decrypt(v_c, 'selftest-key-0123456789');
  IF v_p <> '123-45-6789' THEN RAISE EXCEPTION 'SELFTEST: pgcrypto round-trip mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='tax_profiles' AND column_name='tax_id_cipher') THEN
    RAISE EXCEPTION 'SELFTEST: tax_id_cipher column missing';
  END IF;
  RAISE NOTICE 'in-house tax vault ready (pgcrypto at rest; admin-only audited decrypt; key stays server-side).';
END
$selftest$;
