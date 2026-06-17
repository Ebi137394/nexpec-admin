-- ════════════════════════════════════════════════════════════════════════════
--  contact_submissions — public inbox for the marketing /contact form
--
--  RLS contract:
--    INSERT: anyone (anon role) — the form is publicly accessible
--    SELECT: super_admin only — submissions are PII, only operators read them
--    UPDATE / DELETE: super_admin only (status transitions + GDPR erasure)
--
--  Indexed for the admin operator view: newest-first by created_at,
--  filterable by channel and status.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.contact_submissions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL    DEFAULT NOW(),

  -- Submitter-provided fields. Validated server-side before insert; the
  -- check constraints here are belt-and-braces.
  name        TEXT        NOT NULL    CHECK (char_length(name) BETWEEN 2 AND 80),
  email       TEXT        NOT NULL    CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  channel     TEXT        NOT NULL    CHECK (channel IN ('sales', 'support', 'security')),
  message     TEXT        NOT NULL    CHECK (char_length(message) BETWEEN 10 AND 2000),

  -- Operator workflow: new → read → resolved. Default 'new' so the unread
  -- count is trivial to query.
  status      TEXT        NOT NULL    DEFAULT 'new'
                CHECK (status IN ('new', 'read', 'resolved')),

  -- Light audit metadata. user_agent is voluntary, IP captured by the
  -- server action if available (Vercel x-forwarded-for).
  user_agent  TEXT,
  ip_address  INET
);

CREATE INDEX IF NOT EXISTS contact_submissions_created_at_idx
  ON public.contact_submissions (created_at DESC);

CREATE INDEX IF NOT EXISTS contact_submissions_channel_status_idx
  ON public.contact_submissions (channel, status);

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;

-- Public insert: the marketing form runs as an anonymous user via the
-- server action (which itself uses the anon key — the action is in a
-- Server Component but doesn't escalate privilege).
CREATE POLICY contact_submissions_anon_insert
  ON public.contact_submissions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Super-admin-only read.
CREATE POLICY contact_submissions_admin_select
  ON public.contact_submissions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role = 'super_admin'
    )
  );

-- Super-admin-only update (status workflow).
CREATE POLICY contact_submissions_admin_update
  ON public.contact_submissions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role = 'super_admin'
    )
  );

-- Super-admin-only delete (GDPR / cleanup).
CREATE POLICY contact_submissions_admin_delete
  ON public.contact_submissions
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role = 'super_admin'
    )
  );

COMMENT ON TABLE public.contact_submissions IS
  'Public-facing contact form inbox. RLS: anyone may INSERT; only super_admin may SELECT/UPDATE/DELETE.';
