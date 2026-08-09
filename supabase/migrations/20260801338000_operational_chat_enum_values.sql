-- ════════════════════════════════════════════════════════════════════════════
--  20260801338000_operational_chat_enum_values.sql
--
--  Three enum values, nothing else. PostgreSQL forbids USING a new enum value
--  in the transaction that added it, and the Supabase CLI wraps each migration
--  in one, so every ADD VALUE must land in its own file. 20260801340000
--  consumes these.
--
--  job_supplier_inspector — operational inspection coordination between the
--      inspected supplier facility and the assigned inspector. NOT gated on the
--      buyer's identity_mode: scheduling a site visit is not identity
--      disclosure, and blocking it when the buyer chose Protected would stop
--      the inspection happening at all.
--
--  buyer_supplier — ordinary procurement/business communication between the
--      buyer principal and a supplier they already have a real commercial
--      relationship with (presented/accepted quote, or a live supplier
--      contract). Also independent of identity_mode, which is an INSPECTOR
--      disclosure policy and has nothing to say about buyer↔vendor commerce.
--
--  job_supplier_admin — the admin-mediated supplier channel. This value is
--      ALREADY referenced by shipped web code (apps/web/src/lib/actions/
--      messages.ts zod enum and conversations.types.ts CONVERSATION_KINDS) but
--      was never added to the type, so ensure_job_conversation() would have
--      raised 22P02 on a supplier support thread. Adding it here closes a
--      pre-existing web/DB drift found while auditing platform parity.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TYPE public.conversation_kind ADD VALUE IF NOT EXISTS 'job_supplier_admin';
ALTER TYPE public.conversation_kind ADD VALUE IF NOT EXISTS 'job_supplier_inspector';
ALTER TYPE public.conversation_kind ADD VALUE IF NOT EXISTS 'buyer_supplier';

COMMENT ON TYPE public.conversation_kind IS
  'Conversation channel discriminator. Admin-mediated: help_support, job_client_admin, job_inspector_admin, job_supplier_admin. Internal: job_team_internal. Two-party exceptions, each with its own authorization function: job_client_inspector (nx_direct_chat_authorized — requires live identity_mode = full), job_supplier_inspector (nx_supplier_inspector_chat_authorized — operational, identity-mode independent), buyer_supplier (nx_buyer_supplier_chat_authorized — commercial, identity-mode independent). No kind is authorized by profiles.role; every one keys on the actual relationship.';
