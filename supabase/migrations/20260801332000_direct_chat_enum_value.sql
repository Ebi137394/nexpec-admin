-- ════════════════════════════════════════════════════════════════════════════
--  20260801332000_direct_chat_enum_value.sql
--
--  Adds ONE enum value and nothing else. This migration is deliberately tiny.
--
--  ── WHY IT IS SEPARATE ─────────────────────────────────────────────────────
--  PostgreSQL forbids USING a newly added enum value in the same transaction
--  that added it ("unsafe use of new value of enum type"). The Supabase CLI
--  runs each migration file inside a transaction, so any migration that both
--  adds 'job_client_inspector' AND writes a policy/function referencing it
--  would fail on a clean `supabase db reset`. Splitting the ADD VALUE into its
--  own file is the standard, safe pattern — 20260801334000 then consumes it.
--
--  Existing kinds are untouched:
--      help_support | job_client_admin | job_inspector_admin | job_team_internal
--  Every existing conversation keeps its kind, and no existing policy, view or
--  RPC changes behaviour as a result of this file.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TYPE public.conversation_kind ADD VALUE IF NOT EXISTS 'job_client_inspector';

COMMENT ON TYPE public.conversation_kind IS
  'Conversation channel discriminator. job_client_inspector (20260801332000) is the ONLY two-party client↔inspector channel and is authorized exclusively by nx_direct_chat_authorized() — live identity_mode=full, active contract relationship, non-terminal job. Every other kind remains admin-mediated.';
