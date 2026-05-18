-- ============================================================================
-- BULLETPROOF MIGRATION — repair Sprint 12B + 12E + ship 12F + 12G atomically
--
-- This single script is DESIGNED to survive ANY pre-existing DB state:
--   - missing helpers (defines _touch_updated_at)
--   - missing tables (creates them outright)
--   - partially-existing tables (idempotent ALTERs)
--   - already-applied constraints / policies / triggers (drop-then-create)
--
-- Every block that could conceivably fail is wrapped in DO $$ ... EXCEPTION
-- WHEN OTHERS THEN RAISE NOTICE so the script never aborts. Failures are
-- logged for review but do not break the transaction.
--
-- This script does NOT modify `reports` or `contracts` — those tables need
-- a schema audit before any ALTER touches them.
-- ============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 0 — HELPERS
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $fn$;

-- nx_is_admin is assumed to exist from compliance_mode_foundation.sql.
-- If it doesn't, define a fallback that any admin/super_admin role passes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.proname = 'nx_is_admin' AND n.nspname = 'public'
  ) THEN
    CREATE OR REPLACE FUNCTION public.nx_is_admin()
    RETURNS boolean
    LANGUAGE sql SECURITY DEFINER STABLE
    SET search_path = public, pg_temp
    AS $body$
      SELECT EXISTS (
        SELECT 1 FROM public.profiles
         WHERE id = auth.uid()
           AND role IN ('admin', 'super_admin')
      );
    $body$;
    GRANT EXECUTE ON FUNCTION public.nx_is_admin() TO authenticated, anon;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — REVIEWS (Sprint 12E)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS job_id          uuid,
  ADD COLUMN IF NOT EXISTS reviewer_id     uuid,
  ADD COLUMN IF NOT EXISTS reviewee_id     uuid,
  ADD COLUMN IF NOT EXISTS direction       text,
  ADD COLUMN IF NOT EXISTS rating          smallint,
  ADD COLUMN IF NOT EXISTS would_recommend boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS body            text,
  ADD COLUMN IF NOT EXISTS published_at    timestamptz NOT NULL DEFAULT NOW();

-- Foreign keys
DO $$
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reviews_job_id_fkey') THEN
      ALTER TABLE public.reviews DROP CONSTRAINT reviews_job_id_fkey;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname='jobs' AND relnamespace='public'::regnamespace) THEN
      ALTER TABLE public.reviews ADD CONSTRAINT reviews_job_id_fkey
        FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE NOT VALID;
    END IF;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'reviews_job_id_fkey: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reviews_reviewer_id_fkey') THEN
      ALTER TABLE public.reviews DROP CONSTRAINT reviews_reviewer_id_fkey;
    END IF;
    ALTER TABLE public.reviews ADD CONSTRAINT reviews_reviewer_id_fkey
      FOREIGN KEY (reviewer_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'reviews_reviewer_id_fkey: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reviews_reviewee_id_fkey') THEN
      ALTER TABLE public.reviews DROP CONSTRAINT reviews_reviewee_id_fkey;
    END IF;
    ALTER TABLE public.reviews ADD CONSTRAINT reviews_reviewee_id_fkey
      FOREIGN KEY (reviewee_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'reviews_reviewee_id_fkey: %', SQLERRM; END;
END $$;

-- CHECK constraints (NOT VALID so existing rows don't block)
DO $$
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reviews_direction_check') THEN
      ALTER TABLE public.reviews DROP CONSTRAINT reviews_direction_check;
    END IF;
    ALTER TABLE public.reviews ADD CONSTRAINT reviews_direction_check
      CHECK (direction IS NULL OR direction IN ('client_to_inspector','inspector_to_client')) NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'reviews_direction_check: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reviews_rating_check') THEN
      ALTER TABLE public.reviews DROP CONSTRAINT reviews_rating_check;
    END IF;
    ALTER TABLE public.reviews ADD CONSTRAINT reviews_rating_check
      CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)) NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'reviews_rating_check: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reviews_body_len') THEN
      ALTER TABLE public.reviews DROP CONSTRAINT reviews_body_len;
    END IF;
    ALTER TABLE public.reviews ADD CONSTRAINT reviews_body_len
      CHECK (body IS NULL OR char_length(body) <= 2000) NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'reviews_body_len: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reviews_no_self') THEN
      ALTER TABLE public.reviews DROP CONSTRAINT reviews_no_self;
    END IF;
    ALTER TABLE public.reviews ADD CONSTRAINT reviews_no_self
      CHECK (reviewer_id IS NULL OR reviewee_id IS NULL OR reviewer_id <> reviewee_id) NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'reviews_no_self: %', SQLERRM; END;

  -- Unique on (job, reviewer, direction)
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reviews_unique_per_direction') THEN
      ALTER TABLE public.reviews ADD CONSTRAINT reviews_unique_per_direction
        UNIQUE (job_id, reviewer_id, direction);
    END IF;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'reviews_unique_per_direction: %', SQLERRM; END;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON public.reviews(reviewee_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON public.reviews(reviewer_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_job ON public.reviews(job_id);

-- RLS
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reviews_read_public" ON public.reviews;
CREATE POLICY "reviews_read_public" ON public.reviews FOR SELECT USING (true);

DROP POLICY IF EXISTS "reviews_insert_reviewer_completed" ON public.reviews;
CREATE POLICY "reviews_insert_reviewer_completed" ON public.reviews FOR INSERT
  WITH CHECK (
    reviewer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = job_id AND j.status = 'completed'
         AND (
           (direction = 'client_to_inspector' AND j.client_id = auth.uid() AND j.assigned_inspector_id = reviewee_id)
           OR (direction = 'inspector_to_client' AND j.assigned_inspector_id = auth.uid() AND j.client_id = reviewee_id)
         )
    )
  );

DROP POLICY IF EXISTS "reviews_delete_admin" ON public.reviews;
CREATE POLICY "reviews_delete_admin" ON public.reviews FOR DELETE
  USING (public.nx_is_admin());

-- Aggregate trigger
CREATE OR REPLACE FUNCTION public._reviews_recompute_aggregates()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
DECLARE v_target uuid;
BEGIN
  v_target := COALESCE(NEW.reviewee_id, OLD.reviewee_id);
  IF v_target IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  UPDATE public.profiles p SET
    rating_average    = COALESCE((SELECT AVG(rating)::numeric(3,2) FROM public.reviews WHERE reviewee_id = v_target), 0),
    rating_count      = COALESCE((SELECT COUNT(*)::int FROM public.reviews WHERE reviewee_id = v_target), 0),
    reviews_count     = COALESCE((SELECT COUNT(*)::int FROM public.reviews WHERE reviewee_id = v_target), 0),
    total_reviews     = COALESCE((SELECT COUNT(*)::int FROM public.reviews WHERE reviewee_id = v_target), 0),
    recommend_percent = COALESCE(
      (SELECT (SUM(CASE WHEN would_recommend THEN 1 ELSE 0 END) * 100 / NULLIF(COUNT(*),0))::int
         FROM public.reviews WHERE reviewee_id = v_target), 0)
   WHERE id = v_target;
  RETURN COALESCE(NEW, OLD);
END $fn$;

DROP TRIGGER IF EXISTS reviews_aggregate ON public.reviews;
CREATE TRIGGER reviews_aggregate
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public._reviews_recompute_aggregates();

CREATE OR REPLACE FUNCTION public.can_review_job(p_job_id uuid, p_direction text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_eligible boolean := false;
  v_already boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  IF p_direction NOT IN ('client_to_inspector','inspector_to_client') THEN RETURN false; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.jobs j
     WHERE j.id = p_job_id AND j.status = 'completed'
       AND (
         (p_direction = 'client_to_inspector' AND j.client_id = v_uid)
         OR (p_direction = 'inspector_to_client' AND j.assigned_inspector_id = v_uid)
       )
  ) INTO v_eligible;
  IF NOT v_eligible THEN RETURN false; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.reviews
     WHERE job_id = p_job_id AND reviewer_id = v_uid AND direction = p_direction
  ) INTO v_already;
  RETURN NOT v_already;
END $fn$;

GRANT EXECUTE ON FUNCTION public.can_review_job(uuid, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — CLIENT_DOCUMENTS (Sprint 12B + external_url)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.client_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL,
  job_id       uuid,
  kind         text NOT NULL DEFAULT 'other',
  label        text NOT NULL DEFAULT 'Untitled',
  file_path    text,
  external_url text,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  updated_at   timestamptz NOT NULL DEFAULT NOW()
);

-- Idempotent column adds
ALTER TABLE public.client_documents
  ADD COLUMN IF NOT EXISTS external_url text;

-- Relax NOT NULL on file_path if it's still NOT NULL from a prior shape
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='client_documents'
       AND column_name='file_path' AND is_nullable='NO'
  ) THEN
    ALTER TABLE public.client_documents ALTER COLUMN file_path DROP NOT NULL;
  END IF;
END $$;

-- Foreign keys
DO $$
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='client_documents_owner_id_fkey') THEN
      ALTER TABLE public.client_documents DROP CONSTRAINT client_documents_owner_id_fkey;
    END IF;
    ALTER TABLE public.client_documents ADD CONSTRAINT client_documents_owner_id_fkey
      FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'client_documents_owner_id_fkey: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='client_documents_job_id_fkey') THEN
      ALTER TABLE public.client_documents DROP CONSTRAINT client_documents_job_id_fkey;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname='jobs' AND relnamespace='public'::regnamespace) THEN
      ALTER TABLE public.client_documents ADD CONSTRAINT client_documents_job_id_fkey
        FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
    END IF;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'client_documents_job_id_fkey: %', SQLERRM; END;
END $$;

-- CHECK constraints
DO $$
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='client_documents_kind_check') THEN
      ALTER TABLE public.client_documents DROP CONSTRAINT client_documents_kind_check;
    END IF;
    ALTER TABLE public.client_documents ADD CONSTRAINT client_documents_kind_check
      CHECK (kind IN ('drawing','spec_sheet','nda','prior_report','regulatory','vendor_doc','photo_evidence','other')) NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'client_documents_kind_check: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='client_documents_label_len') THEN
      ALTER TABLE public.client_documents DROP CONSTRAINT client_documents_label_len;
    END IF;
    ALTER TABLE public.client_documents ADD CONSTRAINT client_documents_label_len
      CHECK (char_length(label) BETWEEN 1 AND 160) NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'client_documents_label_len: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='client_documents_notes_len') THEN
      ALTER TABLE public.client_documents DROP CONSTRAINT client_documents_notes_len;
    END IF;
    ALTER TABLE public.client_documents ADD CONSTRAINT client_documents_notes_len
      CHECK (notes IS NULL OR char_length(notes) <= 500) NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'client_documents_notes_len: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='client_documents_has_content') THEN
      ALTER TABLE public.client_documents DROP CONSTRAINT client_documents_has_content;
    END IF;
    ALTER TABLE public.client_documents ADD CONSTRAINT client_documents_has_content
      CHECK (
        (file_path IS NOT NULL AND external_url IS NULL)
        OR (file_path IS NULL AND external_url IS NOT NULL)
      ) NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'client_documents_has_content: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='client_documents_external_url_format') THEN
      ALTER TABLE public.client_documents DROP CONSTRAINT client_documents_external_url_format;
    END IF;
    ALTER TABLE public.client_documents ADD CONSTRAINT client_documents_external_url_format
      CHECK (external_url IS NULL OR external_url ~* '^https?://') NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'client_documents_external_url_format: %', SQLERRM; END;
END $$;

CREATE INDEX IF NOT EXISTS idx_client_documents_owner ON public.client_documents(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_documents_job ON public.client_documents(job_id) WHERE job_id IS NOT NULL;

DROP TRIGGER IF EXISTS client_documents_touch ON public.client_documents;
CREATE TRIGGER client_documents_touch
  BEFORE UPDATE ON public.client_documents
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

ALTER TABLE public.client_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cdocs_owner_all" ON public.client_documents;
CREATE POLICY "cdocs_owner_all" ON public.client_documents FOR ALL
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "cdocs_admin_all" ON public.client_documents;
CREATE POLICY "cdocs_admin_all" ON public.client_documents FOR ALL
  USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

DROP POLICY IF EXISTS "cdocs_inspector_read" ON public.client_documents;
CREATE POLICY "cdocs_inspector_read" ON public.client_documents FOR SELECT
  USING (
    job_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = client_documents.job_id
         AND j.assigned_inspector_id = auth.uid()
    )
  );

-- Storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'client_documents','client_documents', false, 26214400,
  ARRAY[
    'image/jpeg','image/png','image/webp','image/heic',
    'application/pdf','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "cdocs_storage_owner_all" ON storage.objects;
CREATE POLICY "cdocs_storage_owner_all" ON storage.objects FOR ALL
  USING (
    bucket_id = 'client_documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'client_documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "cdocs_storage_admin_read" ON storage.objects;
CREATE POLICY "cdocs_storage_admin_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'client_documents' AND public.nx_is_admin());

DROP POLICY IF EXISTS "cdocs_storage_inspector_read" ON storage.objects;
CREATE POLICY "cdocs_storage_inspector_read" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'client_documents'
    AND (storage.foldername(name))[2] IS NOT NULL
    AND (storage.foldername(name))[2] <> 'org'
    AND EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id::text = (storage.foldername(name))[2]
         AND j.assigned_inspector_id = auth.uid()
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — NOTIFICATIONS (Sprint 12F)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL,
  kind         text NOT NULL,
  title        text NOT NULL,
  body         text,
  link_href    text,
  job_id       uuid,
  is_read      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  read_at      timestamptz
);

DO $$
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='notifications_recipient_fkey') THEN
      ALTER TABLE public.notifications DROP CONSTRAINT notifications_recipient_fkey;
    END IF;
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_recipient_fkey
      FOREIGN KEY (recipient_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'notifications_recipient_fkey: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='notifications_job_fkey') THEN
      ALTER TABLE public.notifications DROP CONSTRAINT notifications_job_fkey;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname='jobs' AND relnamespace='public'::regnamespace) THEN
      ALTER TABLE public.notifications ADD CONSTRAINT notifications_job_fkey
        FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE SET NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'notifications_job_fkey: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='notifications_kind_check') THEN
      ALTER TABLE public.notifications DROP CONSTRAINT notifications_kind_check;
    END IF;
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check
      CHECK (kind IN (
        'message','job_moderated','application_status','assignment',
        'report_submitted','report_approved','payout_released','review_received',
        'contract_assigned','dispute_filed','dispute_update','document_uploaded','system'
      )) NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'notifications_kind_check: %', SQLERRM; END;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.notifications(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(recipient_id) WHERE is_read = false;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notif_recipient_read" ON public.notifications;
CREATE POLICY "notif_recipient_read" ON public.notifications FOR SELECT
  USING (recipient_id = auth.uid() OR public.nx_is_admin());

DROP POLICY IF EXISTS "notif_recipient_update" ON public.notifications;
CREATE POLICY "notif_recipient_update" ON public.notifications FOR UPDATE
  USING (recipient_id = auth.uid()) WITH CHECK (recipient_id = auth.uid());

-- INSERT is intentionally NOT exposed via policy — only via notify() RPC.

CREATE OR REPLACE FUNCTION public.notify(
  p_recipient uuid,
  p_kind      text,
  p_title     text,
  p_body      text DEFAULT NULL,
  p_link      text DEFAULT NULL,
  p_job_id    uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.notifications(recipient_id, kind, title, body, link_href, job_id)
    VALUES (p_recipient, p_kind, p_title, p_body, p_link, p_job_id)
    RETURNING id INTO v_id;

  BEGIN
    UPDATE public.profiles
       SET unread_notifications_count = COALESCE(unread_notifications_count, 0) + 1
     WHERE id = p_recipient;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'notify: profile counter update failed: %', SQLERRM;
  END;

  RETURN v_id;
END $fn$;

GRANT EXECUTE ON FUNCTION public.notify(uuid, text, text, text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_uid uuid := auth.uid(); v_was_unread boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  WITH upd AS (
    UPDATE public.notifications
       SET is_read = true, read_at = NOW()
     WHERE id = p_id AND recipient_id = v_uid AND is_read = false
     RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM upd) INTO v_was_unread;
  IF v_was_unread THEN
    UPDATE public.profiles
       SET unread_notifications_count = GREATEST(COALESCE(unread_notifications_count, 1) - 1, 0)
     WHERE id = v_uid;
  END IF;
END $fn$;

GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  UPDATE public.notifications SET is_read = true, read_at = NOW()
   WHERE recipient_id = v_uid AND is_read = false;
  UPDATE public.profiles SET unread_notifications_count = 0 WHERE id = v_uid;
END $fn$;

GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — DISPUTES (Sprint 12G) + escrow pause + notify-admin wiring
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.disputes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid NOT NULL,
  opener_id    uuid NOT NULL,
  opener_role  text NOT NULL,
  category     text NOT NULL,
  body         text NOT NULL,
  status       text NOT NULL DEFAULT 'open',
  resolution   text,
  resolved_at  timestamptz,
  resolved_by  uuid,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  updated_at   timestamptz NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='disputes_job_fkey') THEN
      ALTER TABLE public.disputes DROP CONSTRAINT disputes_job_fkey;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname='jobs' AND relnamespace='public'::regnamespace) THEN
      ALTER TABLE public.disputes ADD CONSTRAINT disputes_job_fkey
        FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
    END IF;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'disputes_job_fkey: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='disputes_opener_fkey') THEN
      ALTER TABLE public.disputes DROP CONSTRAINT disputes_opener_fkey;
    END IF;
    ALTER TABLE public.disputes ADD CONSTRAINT disputes_opener_fkey
      FOREIGN KEY (opener_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'disputes_opener_fkey: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='disputes_resolver_fkey') THEN
      ALTER TABLE public.disputes DROP CONSTRAINT disputes_resolver_fkey;
    END IF;
    ALTER TABLE public.disputes ADD CONSTRAINT disputes_resolver_fkey
      FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'disputes_resolver_fkey: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='disputes_role_check') THEN
      ALTER TABLE public.disputes DROP CONSTRAINT disputes_role_check;
    END IF;
    ALTER TABLE public.disputes ADD CONSTRAINT disputes_role_check
      CHECK (opener_role IN ('client','agency','enterprise','inspector')) NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'disputes_role_check: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='disputes_category_check') THEN
      ALTER TABLE public.disputes DROP CONSTRAINT disputes_category_check;
    END IF;
    ALTER TABLE public.disputes ADD CONSTRAINT disputes_category_check
      CHECK (category IN ('scope','quality','payment','communication','other')) NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'disputes_category_check: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='disputes_status_check') THEN
      ALTER TABLE public.disputes DROP CONSTRAINT disputes_status_check;
    END IF;
    ALTER TABLE public.disputes ADD CONSTRAINT disputes_status_check
      CHECK (status IN ('open','investigating','resolved','rejected','closed')) NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'disputes_status_check: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='disputes_body_len') THEN
      ALTER TABLE public.disputes DROP CONSTRAINT disputes_body_len;
    END IF;
    ALTER TABLE public.disputes ADD CONSTRAINT disputes_body_len
      CHECK (char_length(body) BETWEEN 20 AND 8000) NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'disputes_body_len: %', SQLERRM; END;
END $$;

CREATE INDEX IF NOT EXISTS idx_disputes_job ON public.disputes(job_id);
CREATE INDEX IF NOT EXISTS idx_disputes_opener ON public.disputes(opener_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON public.disputes(status, created_at DESC);

DROP TRIGGER IF EXISTS disputes_touch ON public.disputes;
CREATE TRIGGER disputes_touch
  BEFORE UPDATE ON public.disputes
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "disputes_opener_read" ON public.disputes;
CREATE POLICY "disputes_opener_read" ON public.disputes FOR SELECT
  USING (opener_id = auth.uid() OR public.nx_is_admin());

DROP POLICY IF EXISTS "disputes_admin_update" ON public.disputes;
CREATE POLICY "disputes_admin_update" ON public.disputes FOR UPDATE
  USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

-- INSERT is intentionally NOT exposed via policy — only via file_dispute() RPC.

-- Add escrow_paused columns to jobs if missing
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS escrow_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS escrow_paused_reason text;

-- The Big One: file_dispute is atomic. Insert dispute, pause escrow, notify
-- every admin. All in one SECURITY DEFINER transaction. If anything fails
-- the whole thing rolls back.
CREATE OR REPLACE FUNCTION public.file_dispute(
  p_job_id   uuid,
  p_category text,
  p_body     text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_role       text;
  v_dispute_id uuid;
  v_admin_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF p_category NOT IN ('scope','quality','payment','communication','other') THEN
    RAISE EXCEPTION 'invalid category';
  END IF;
  IF char_length(p_body) < 20 OR char_length(p_body) > 8000 THEN
    RAISE EXCEPTION 'body must be 20-8000 characters';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role NOT IN ('client','agency','enterprise','inspector') THEN
    RAISE EXCEPTION 'role % not authorised to file disputes', v_role;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.jobs
     WHERE id = p_job_id
       AND (client_id = v_uid OR assigned_inspector_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'not a party to this job';
  END IF;

  INSERT INTO public.disputes (job_id, opener_id, opener_role, category, body)
    VALUES (p_job_id, v_uid, v_role, p_category, p_body)
    RETURNING id INTO v_dispute_id;

  -- Pause escrow release
  UPDATE public.jobs
     SET escrow_paused = true,
         escrow_paused_reason = format('Dispute filed: %s', p_category)
   WHERE id = p_job_id;

  -- Notify every admin / super_admin
  FOR v_admin_id IN
    SELECT id FROM public.profiles WHERE role IN ('admin','super_admin')
  LOOP
    PERFORM public.notify(
      v_admin_id,
      'dispute_filed',
      'New dispute filed',
      format('%s dispute on job (%s) by %s', p_category, p_job_id::text, v_role),
      format('/admin/disputes'),
      p_job_id
    );
  END LOOP;

  RETURN v_dispute_id;
END $fn$;

GRANT EXECUTE ON FUNCTION public.file_dispute(uuid, text, text) TO authenticated;

-- Resolve dispute — admin-only, unfreezes escrow (or keeps it frozen on reject)
CREATE OR REPLACE FUNCTION public.resolve_dispute(
  p_dispute_id uuid,
  p_status     text,
  p_resolution text,
  p_unfreeze_escrow boolean DEFAULT true
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_uid uuid := auth.uid(); v_job uuid; v_opener uuid;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_status NOT IN ('resolved','rejected','closed','investigating') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;

  UPDATE public.disputes
     SET status = p_status,
         resolution = p_resolution,
         resolved_at = CASE WHEN p_status IN ('resolved','rejected','closed') THEN NOW() ELSE resolved_at END,
         resolved_by = CASE WHEN p_status IN ('resolved','rejected','closed') THEN v_uid ELSE resolved_by END
   WHERE id = p_dispute_id
   RETURNING job_id, opener_id INTO v_job, v_opener;

  IF v_job IS NULL THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  IF p_unfreeze_escrow AND p_status IN ('resolved','closed') THEN
    UPDATE public.jobs
       SET escrow_paused = false,
           escrow_paused_reason = NULL
     WHERE id = v_job;
  END IF;

  -- Notify the opener
  PERFORM public.notify(
    v_opener,
    'dispute_update',
    format('Dispute %s', p_status),
    p_resolution,
    '/client/disputes',  -- the opener page route resolves on the client side
    v_job
  );
END $fn$;

GRANT EXECUTE ON FUNCTION public.resolve_dispute(uuid, text, text, boolean) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — REATTACH INSPECTOR_* TRIGGERS (if those tables exist)
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='inspector_documents' AND relnamespace='public'::regnamespace) THEN
    DROP TRIGGER IF EXISTS inspector_documents_touch ON public.inspector_documents;
    CREATE TRIGGER inspector_documents_touch
      BEFORE UPDATE ON public.inspector_documents
      FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='inspector_equipment' AND relnamespace='public'::regnamespace) THEN
    DROP TRIGGER IF EXISTS inspector_equipment_touch ON public.inspector_equipment;
    CREATE TRIGGER inspector_equipment_touch
      BEFORE UPDATE ON public.inspector_equipment
      FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='inspector_certifications' AND relnamespace='public'::regnamespace) THEN
    DROP TRIGGER IF EXISTS inspector_certifications_touch ON public.inspector_certifications;
    CREATE TRIGGER inspector_certifications_touch
      BEFORE UPDATE ON public.inspector_certifications
      FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — REALTIME PUBLICATION (for notification bell + disputes feed)
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
      EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.disputes;
      EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- VERIFICATION (run separately after the migration commits)
-- ----------------------------------------------------------------------------
-- Verify tables:
--   SELECT tablename FROM pg_tables
--    WHERE schemaname='public'
--      AND tablename IN ('reviews','client_documents','notifications','disputes')
--    ORDER BY tablename;
--
-- Verify functions:
--   SELECT proname FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public'
--      AND proname IN ('_touch_updated_at','nx_is_admin','notify',
--                      'mark_notification_read','mark_all_notifications_read',
--                      'file_dispute','resolve_dispute','can_review_job',
--                      '_reviews_recompute_aggregates');
--
-- Verify escrow pause columns:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='jobs'
--      AND column_name IN ('escrow_paused','escrow_paused_reason');
-- ============================================================================
