# Web Sprint 12 — Critical Client Operations Parity

**Scope:** Nine feature gaps in the Client + Admin + Inspector portals that block real B2B operational use. Plus footer-404 cleanup and a hero-image hotfix already shipped.

**Status as of 2026-05-18:**
- ✅ 12.0 Hero + footer — SHIPPED
- ✅ 12A Messaging — SHIPPED (Help & Support + job-scoped)
- ⏳ 12B Client documents — pending
- ⏳ 12C Job clauses + acceptances — pending
- ⏳ 12D Contracts + e-sign MVP — pending
- ⏳ **12E Two-way reviews + ratings — ADDED (5 columns on profiles already exist)**
- ⏳ **12F Notifications center — ADDED (`unread_notifications_count` already on profiles)**
- ⏳ **12G Disputes filing UI (client + inspector) — ADDED (admin surface exists, no party submit)**
- ⏳ **12H Invoices + payout statement PDFs — ADDED (finance shows numbers, no download)**
- ⏳ **12I Organization member management — ADDED (`organizations` table already shipped)**

**Sequencing:** Recommended order is 12B → 12E → 12F → 12G → 12H → 12C → 12I → 12D. Reviews + notifications + disputes are the highest user-facing impact; contracts is the largest single lift and ships last.

**Affects:** Client (client/agency/enterprise), Admin, Inspector (read-only on some surfaces).

---

## Sprint 12.0 — Footer + Hero hotfix (~30 min)

Already partially shipped: Hero src → `/hero/hero-wide.jpg`. Remaining: cull the 4 dead footer links.

### Patches

**`apps/web/src/components/marketing/Footer.tsx`** — Remove the Company column entries that 404 (`About`, `Careers`, `Status`) and the `Pricing` Platform entry. Keep Contact (already exists). Re-add the missing legal links only if those pages exist; otherwise drop.

```tsx
// Before — Platform column
{ label: 'Pricing', href: '/pricing' },     // ← remove
// Before — Company column
{ label: 'About', href: '/about' },          // ← remove
{ label: 'Careers', href: '/careers' },      // ← remove
{ label: 'Status', href: 'https://status.nexpecapp.com' }, // ← remove
// Before — Legal column
{ label: 'Security', href: '/legal/security' },                       // ← keep ONLY if file exists
{ label: 'Responsible disclosure', href: '/legal/responsible-disclosure' }, // ← same
```

If the legal pages don't exist yet, the cleanest move is two new 30-line files:
- `apps/web/src/app/legal/security/page.tsx` — generic security-controls statement
- `apps/web/src/app/legal/responsible-disclosure/page.tsx` — vuln-disclosure mailto + scope

Use the existing `app/legal/layout.tsx` shell so they inherit the legal-doc styling automatically.

**Sign-off criteria:** every link in the footer returns 200.

---

## Sprint 12A — Admin ↔ Client Messaging (1.5–2 days)

**Why first:** Without this, clients can't ask admin a question about a job or escalate a dispute. It's the single biggest operational blocker.

### Schema audit

`messages` table already exists per earlier grep (referenced in `20250316125100_create_messages_table.sql` and `20250321121900_create_support_messages_table.sql`). Audit step:

```sql
\d+ public.messages
\d+ public.support_messages
-- Confirm columns: id, sender_id, recipient_id (or room_id), room_kind, body, created_at, read_at
-- Confirm RLS policies partition by room_kind ('client_admin' vs 'inspector_admin')
```

If the existing schema is workable: no new migration. If `room_kind` doesn't exist, add it:

```sql
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS room_kind TEXT NOT NULL DEFAULT 'client_admin'
    CHECK (room_kind IN ('client_admin', 'inspector_admin'));

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_messages_room
  ON public.messages (room_kind, job_id, created_at DESC);
```

RLS verification:

```sql
-- Client can SELECT messages where they are sender OR recipient AND room_kind='client_admin'
-- Admin can SELECT all messages (via nx_is_admin())
-- Inspector can SELECT messages where room_kind='inspector_admin' AND they are sender/recipient
-- INSERT: client can write only to client_admin; inspector only to inspector_admin; admin to either
```

### File manifest

```
NEW (Types)
  apps/web/src/lib/data/messages.types.ts
    - Message, MessageRoom, RoomKind

NEW (Fetchers)
  apps/web/src/lib/data/clientMessages.ts
    - fetchClientRooms()         → list of {job_id, last_message, unread_count}
    - fetchRoomMessages(jobId)   → ordered messages within a client_admin room
  apps/web/src/lib/data/adminMessages.ts
    - fetchAdminRooms()          → all rooms across all jobs, both kinds
    - fetchRoomMessagesAdmin()   → admin can view any room

NEW (Actions)
  apps/web/src/lib/actions/messages.ts
    - sendMessage({jobId, body, roomKind}) — Zod-validated, RLS-enforced
    - markRoomRead({jobId, roomKind})

NEW (Components — both client + admin)
  apps/web/src/components/messaging/RoomList.tsx        ← server component
  apps/web/src/components/messaging/Thread.tsx          ← realtime client component
  apps/web/src/components/messaging/Composer.tsx        ← textarea + send

NEW (Pages)
  apps/web/src/app/client/messages/page.tsx             ← room list (global)
  apps/web/src/app/client/jobs/[id]/chat/page.tsx       ← job-scoped chat
  apps/web/src/app/admin/messages/page.tsx              ← all rooms queue
  apps/web/src/app/admin/messages/[jobId]/[kind]/page.tsx
                                                        ← specific room
EDIT
  apps/web/src/components/client/Sidebar.tsx            ← +Messages link
  apps/web/src/components/admin/Sidebar.tsx             ← +Messages link
  apps/web/src/components/inspector/Sidebar.tsx         ← +Messages link (inspector_admin only)
```

### Key design decisions

- **Realtime via Supabase Realtime.** Subscribe to `messages` table inserts filtered by `room_kind` + `job_id`. Update the thread without full page reload.
- **No inspector-client crossover (GR4, GR7).** Client room list shows ONLY `client_admin` rooms. Inspector room list shows ONLY `inspector_admin` rooms. RLS enforces the same on the data layer.
- **Job scope optional.** A message can be global (`job_id=NULL`, "How do I post a CCI job?") or job-scoped (`job_id=<uuid>`, "Status on job 4A?"). UI surfaces both in the same room list.
- **Unread counter on sidebar.** `profiles.unread_notifications_count` already exists; reuse it or add `unread_messages_count`. Sidebar badge reflects the count.

---

## Sprint 12B — Client Documents Section (1 day)

**Why:** Clients need to attach P&IDs, drawings, vendor specs, prior reports, NDAs, regulatory paperwork to a job. Currently no surface.

### SQL migration

Mirrors the inspector_documents pattern from Sprint 10.

```sql
CREATE TABLE IF NOT EXISTS public.client_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id        UUID REFERENCES public.jobs(id) ON DELETE CASCADE,  -- nullable: org-wide doc vs job-scoped
  kind          TEXT NOT NULL CHECK (kind IN (
    'drawing', 'spec_sheet', 'nda', 'prior_report', 'regulatory',
    'vendor_doc', 'photo_evidence', 'other'
  )),
  label         TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 160),
  file_path     TEXT NOT NULL,
  notes         TEXT CHECK (notes IS NULL OR char_length(notes) <= 500),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_documents_owner
  ON public.client_documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_client_documents_job
  ON public.client_documents(job_id) WHERE job_id IS NOT NULL;

ALTER TABLE public.client_documents ENABLE ROW LEVEL SECURITY;

-- Owner full CRUD
CREATE POLICY "client_docs_owner_all" ON public.client_documents FOR ALL
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- Admin read (oversight)
CREATE POLICY "client_docs_admin_read" ON public.client_documents FOR SELECT
  USING (public.nx_is_admin());

-- Assigned inspector read (for job-scoped docs only)
CREATE POLICY "client_docs_inspector_read" ON public.client_documents FOR SELECT
  USING (
    job_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = client_documents.job_id
        AND j.assigned_inspector_id = auth.uid()
    )
  );

-- Bucket: client_documents (private, 25 MB, image+PDF+spreadsheet)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'client_documents', 'client_documents', false, 26214400,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
) ON CONFLICT (id) DO NOTHING;

-- Storage RLS: owner own folder; admin read all; assigned inspector read job-scoped only
-- (path layout: {owner_id}/{job_id or 'org'}/{filename})
```

### File manifest

```
NEW
  apps/web/src/lib/data/clientDocuments.types.ts
  apps/web/src/lib/data/clientDocuments.ts          ← fetcher (own + job-scoped)
  apps/web/src/lib/actions/clientDocuments.ts       ← create / delete (rollback-safe upload)
  apps/web/src/app/client/documents/page.tsx        ← org-wide dossier list
  apps/web/src/app/client/jobs/[id]/documents/page.tsx
                                                     ← job-scoped view (or inline in [id]/page.tsx)
EDIT
  apps/web/src/components/client/Sidebar.tsx        ← +Documents under Overview
  apps/web/src/app/client/jobs/[id]/page.tsx        ← link to job-scoped docs OR inline section
```

### Inspector visibility

On `/inspector/jobs/[id]`, inspectors see a "Client-supplied documents" section listing docs where `job_id=<this job>` AND inspector is assigned. RLS allows the SELECT. No inspector mutation. New fetcher: `lib/data/inspectorJobClientDocs.ts`.

---

## Sprint 12C — Job-specific Legal Clauses (1 day)

**Why:** B2B clients want to attach NDAs, exclusivity clauses, indemnification terms to specific jobs. Inspector must explicitly accept before applying.

### SQL migration

```sql
CREATE TABLE IF NOT EXISTS public.job_clauses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN (
    'nda', 'exclusivity', 'safety', 'indemnification',
    'data_handling', 'compliance', 'other'
  )),
  title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  body          TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  is_required   BOOLEAN NOT NULL DEFAULT true,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_clauses_job
  ON public.job_clauses(job_id, sort_order);

CREATE TABLE IF NOT EXISTS public.clause_acceptances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clause_id     UUID NOT NULL REFERENCES public.job_clauses(id) ON DELETE CASCADE,
  acceptor_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accepted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address    INET,
  user_agent    TEXT,
  UNIQUE (clause_id, acceptor_id)
);

ALTER TABLE public.job_clauses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clause_acceptances ENABLE ROW LEVEL SECURITY;

-- Clauses: client of the job CRUD; admin all; inspectors who can see the job can read
CREATE POLICY "clauses_client_all" ON public.job_clauses FOR ALL
  USING (EXISTS (SELECT 1 FROM jobs j WHERE j.id = job_id AND j.client_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM jobs j WHERE j.id = job_id AND j.client_id = auth.uid()));

CREATE POLICY "clauses_inspector_read" ON public.job_clauses FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM jobs j WHERE j.id = job_id AND j.moderation_status = 'approved'
  ));

CREATE POLICY "clauses_admin_all" ON public.job_clauses FOR ALL
  USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

-- Acceptances: self full CRUD; admin read all
CREATE POLICY "acceptances_self_all" ON public.clause_acceptances FOR ALL
  USING (acceptor_id = auth.uid()) WITH CHECK (acceptor_id = auth.uid());

CREATE POLICY "acceptances_admin_read" ON public.clause_acceptances FOR SELECT
  USING (public.nx_is_admin());
```

### Gate in inspector apply flow

Block `applications` INSERT unless inspector has `clause_acceptances` row for every `is_required=true` clause on the job. Enforced two ways:

1. **UI:** the apply form lists all required clauses with checkboxes. Submit disabled until all checked.
2. **Server action:** before INSERT into applications, count `is_required` clauses vs the inspector's acceptances. If short, return error.
3. **Optional DB trigger** (defence in depth): `BEFORE INSERT ON applications` checks the same.

### File manifest

```
NEW (SQL)
  supabase/migrations/<ts>_job_clauses_and_acceptances.sql

NEW (Types + Fetchers + Actions)
  apps/web/src/lib/data/jobClauses.types.ts
  apps/web/src/lib/data/jobClauses.ts                  ← fetch clauses + my acceptances
  apps/web/src/lib/actions/jobClauses.ts               ← create/update/delete (client side)
  apps/web/src/lib/actions/clauseAcceptances.ts        ← record acceptance (inspector side)

NEW (UI)
  apps/web/src/app/client/jobs/[id]/clauses/page.tsx   ← CRUD list (client view)
  apps/web/src/components/jobs/ClauseList.tsx          ← read-only display (inspector + admin)

EDIT
  apps/web/src/app/client/jobs/new/page.tsx            ← optional inline clause builder OR redirect to [id]/clauses after creation
  apps/web/src/app/inspector/jobs/[id]/page.tsx        ← embed ClauseList
  apps/web/src/app/inspector/jobs/[id]/apply/page.tsx  ← acceptance checkboxes + server-side gate
  apps/web/src/lib/actions/inspectorApply.ts           ← acceptance verification before INSERT
  apps/web/src/app/admin/jobs/[id]/page.tsx            ← ClauseList + acceptance audit trail
```

---

## Sprint 12D — Contracts Management (2 days)

**Why:** Clients need to view/sign the Master Services Agreement at onboarding, plus any platform-issued contract amendments. Different from job-specific clauses — these are between the client org and NEXPEC the platform.

### SQL migration

```sql
CREATE TYPE public.contract_kind AS ENUM (
  'msa', 'dpa', 'amendment', 'order_form', 'nda', 'other'
);

CREATE TABLE IF NOT EXISTS public.contracts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            public.contract_kind NOT NULL,
  title           TEXT NOT NULL,
  body_md         TEXT NOT NULL,                          -- canonical text
  pdf_path        TEXT,                                   -- rendered PDF in contracts bucket
  version         INT NOT NULL DEFAULT 1,
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID NOT NULL REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.contract_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  party_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  required        BOOLEAN NOT NULL DEFAULT true,
  signed_at       TIMESTAMPTZ,
  signed_pdf_path TEXT,                                   -- counter-signed copy
  ip_address      INET,
  user_agent      TEXT,
  signer_typed_name TEXT,
  UNIQUE (contract_id, party_id)
);

CREATE INDEX IF NOT EXISTS idx_contract_assignments_party
  ON public.contract_assignments(party_id);

ALTER TABLE public.contracts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_assignments ENABLE ROW LEVEL SECURITY;

-- Contracts: read by anyone authenticated (so we can render the latest MSA);
-- write admin only.
CREATE POLICY "contracts_read_active" ON public.contracts FOR SELECT
  USING (is_active OR public.nx_is_admin());
CREATE POLICY "contracts_admin_write" ON public.contracts FOR ALL
  USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

-- Assignments: party reads + signs own row; admin all
CREATE POLICY "contract_assignments_self" ON public.contract_assignments FOR ALL
  USING (party_id = auth.uid()) WITH CHECK (party_id = auth.uid());
CREATE POLICY "contract_assignments_admin" ON public.contract_assignments FOR ALL
  USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

-- Bucket: contracts (private, 25 MB, PDF only)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('contracts', 'contracts', false, 26214400, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;
```

### E-sign MVP

Real e-signature (Adobe Sign / DocuSign integration) is a separate sprint. For MVP:

- Client clicks "Sign" → modal asks for typed full name
- Action: insert `contract_assignments` row with `signed_at=NOW()`, `signer_typed_name=<typed>`, `ip_address`, `user_agent`
- Server-side renders a "Signed by <name> on <date>" footer onto the canonical PDF (using `pdf-lib` server-side) and writes to `signed_pdf_path`
- Client can download their signed copy from the contracts page

### File manifest

```
NEW (SQL)
  supabase/migrations/<ts>_contracts_and_assignments.sql

NEW (Types + Fetchers + Actions)
  apps/web/src/lib/data/contracts.types.ts
  apps/web/src/lib/data/contracts.ts                   ← list my assignments + the canonical text
  apps/web/src/lib/actions/contracts.ts                ← signContract({contractId, typedName})
  apps/web/src/lib/actions/contractsAdmin.ts           ← admin create / publish / assign
  apps/web/src/lib/pdf/renderSignedCopy.ts             ← pdf-lib: stamp the signature block onto the canonical PDF

NEW (UI)
  apps/web/src/app/client/contracts/page.tsx           ← assignment list + sign flow
  apps/web/src/app/client/contracts/[id]/page.tsx      ← read the full text + sign affordance
  apps/web/src/app/admin/contracts/page.tsx            ← list all contracts + assignments overview
  apps/web/src/app/admin/contracts/new/page.tsx        ← create + assign

EDIT
  apps/web/src/components/client/Sidebar.tsx           ← +Contracts under System
  apps/web/src/components/admin/Sidebar.tsx            ← +Contracts under Platform
  apps/web/src/app/sign-up/page.tsx                    ← post-signup: redirect to /client/contracts if any required+unsigned
```

### Onboarding gate (optional, recommended for B2B)

Middleware checks: if user role ∈ {client, agency, enterprise} and has any `required=true AND signed_at IS NULL` row, redirect to `/client/contracts` on every navigation until signed. Same pattern as the existing `terms_accepted` flag on profiles, but stricter.

---

## Cross-cutting concerns (apply to ALL 4 features)

1. **Golden Rule audit per surface.** Each new fetcher must enforce GR2-style projection allowlists. No payout columns on client surfaces, no budget columns on inspector surfaces.
2. **Bucket discipline.** Two new private buckets: `client_documents` (Sprint 12B) and `contracts` (Sprint 12D). Both 25 MB cap, MIME-locked, RLS-gated.
3. **Audit events.** Every contract signature + every clause acceptance emits an `audit_events` row. Admin compliance surface can trace consent.
4. **Multi-role coverage.** `client@test.com`, `agency@test.com`, `test@acme.com` all share `/client/*`. Sprint 12 features must work for all three.
5. **Type-cast hygiene.** Supabase v2 projections via `as unknown as Record<string, unknown>`. No `select('*')`.
6. **Sidebar updates batched.** Don't touch the sidebar 4 times; batch all new nav items in one edit per role.

---

## Sprint 12E — Two-way Reviews & Ratings (1–1.5 days)

**Why critical:** Trust foundation for the marketplace. `profiles` already has
`rating_average`, `rating_count`, `total_reviews`, `reviews_count`,
`recommend_percent`, `completed_jobs_count` — the data layer was provisioned
but no UI ever wrote to it.

### SQL migration

```sql
CREATE TABLE IF NOT EXISTS public.reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  reviewer_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewee_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction     TEXT NOT NULL CHECK (direction IN ('client_to_inspector','inspector_to_client')),
  rating        SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  would_recommend BOOLEAN NOT NULL DEFAULT true,
  body          TEXT CHECK (body IS NULL OR char_length(body) <= 2000),
  published_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Each direction can only be written once per job (prevents double-reviewing).
  UNIQUE (job_id, reviewer_id, direction)
);

CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON public.reviews(reviewee_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_job ON public.reviews(job_id);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user (reviews are public on profiles)
CREATE POLICY "reviews_read_all" ON public.reviews FOR SELECT USING (true);

-- Write: only the reviewer themselves, AND only after job is completed,
-- AND only on the role-correct direction. Enforce via a CHECK + trigger.
CREATE POLICY "reviews_write_reviewer" ON public.reviews FOR INSERT
  WITH CHECK (
    reviewer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.jobs j WHERE j.id = job_id
        AND j.status = 'completed'
        AND (
          (direction = 'client_to_inspector' AND j.client_id = auth.uid() AND j.assigned_inspector_id = reviewee_id)
          OR
          (direction = 'inspector_to_client' AND j.assigned_inspector_id = auth.uid() AND j.client_id = reviewee_id)
        )
    )
  );

-- Aggregate trigger: roll up to profiles.rating_average etc.
CREATE OR REPLACE FUNCTION public._reviews_recompute_aggregates()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_target uuid;
BEGIN
  v_target := COALESCE(NEW.reviewee_id, OLD.reviewee_id);
  UPDATE public.profiles p SET
    rating_average = COALESCE((SELECT AVG(rating)::numeric(3,2) FROM public.reviews WHERE reviewee_id = v_target), 0),
    rating_count   = COALESCE((SELECT COUNT(*) FROM public.reviews WHERE reviewee_id = v_target), 0),
    reviews_count  = COALESCE((SELECT COUNT(*) FROM public.reviews WHERE reviewee_id = v_target), 0),
    total_reviews  = COALESCE((SELECT COUNT(*) FROM public.reviews WHERE reviewee_id = v_target), 0),
    recommend_percent = COALESCE(
      (SELECT (SUM(CASE WHEN would_recommend THEN 1 ELSE 0 END) * 100 / NULLIF(COUNT(*),0))::int
         FROM public.reviews WHERE reviewee_id = v_target), 0)
   WHERE id = v_target;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS reviews_aggregate ON public.reviews;
CREATE TRIGGER reviews_aggregate
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public._reviews_recompute_aggregates();
```

### File manifest

```
NEW
  apps/web/src/lib/data/reviews.types.ts
  apps/web/src/lib/data/reviews.ts                    ← fetch reviews for a user / for a job
  apps/web/src/lib/actions/reviews.ts                 ← submitReview() (Zod + RLS-gated)
  apps/web/src/components/reviews/StarRating.tsx      ← 1–5 star input + display
  apps/web/src/components/reviews/ReviewCard.tsx      ← read-only review row
  apps/web/src/components/reviews/ReviewForm.tsx      ← submit form (modal-friendly)
  apps/web/src/app/client/jobs/[id]/review/page.tsx   ← post-completion prompt
  apps/web/src/app/inspector/jobs/[id]/review/page.tsx
  apps/web/src/app/p/[userId]/page.tsx                ← public profile page with reviews list

EDIT
  apps/web/src/app/client/jobs/[id]/page.tsx          ← "Leave a review" CTA after status=completed
  apps/web/src/app/inspector/jobs/[id]/page.tsx       ← same
  apps/web/src/app/client/reports/page.tsx            ← review-prompt banner on signed reports
```

### Key decisions

- **One review per direction per job.** Unique key `(job_id, reviewer_id, direction)`. No double-rating, no editing after submission (v1).
- **Post-completion only.** RLS + form gate. Reviewer must be a party to the completed job.
- **Aggregates kept on profiles via trigger.** No app-side recomputation drift. Atomic.
- **Public reviews.** Anyone can SELECT (anonymous landing-page social proof later).

---

## Sprint 12F — Notifications Center (~1 day)

**Why critical:** Every user-facing event (new message, job moderated, application status changed, payout released, review received) should produce a feed item. `unread_notifications_count` is already on profiles.

### SQL migration

```sql
CREATE TABLE IF NOT EXISTS public.notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN (
    'message','job_moderated','application_status','assignment',
    'report_submitted','report_approved','payout_released','review_received',
    'contract_assigned','dispute_update','system'
  )),
  title        TEXT NOT NULL,
  body         TEXT,
  link_href    TEXT,
  job_id       UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  is_read      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.notifications(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(recipient_id) WHERE is_read = false;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_recipient_read" ON public.notifications FOR SELECT
  USING (recipient_id = auth.uid() OR public.nx_is_admin());
CREATE POLICY "notif_recipient_update" ON public.notifications FOR UPDATE
  USING (recipient_id = auth.uid()) WITH CHECK (recipient_id = auth.uid());
-- INSERT: SECURITY DEFINER RPCs only. No direct INSERT policy.

CREATE OR REPLACE FUNCTION public.notify(
  p_recipient uuid, p_kind text, p_title text,
  p_body text DEFAULT NULL, p_link text DEFAULT NULL, p_job_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.notifications(recipient_id, kind, title, body, link_href, job_id)
    VALUES (p_recipient, p_kind, p_title, p_body, p_link, p_job_id)
    RETURNING id INTO v_id;
  UPDATE public.profiles SET unread_notifications_count = unread_notifications_count + 1
   WHERE id = p_recipient;
  RETURN v_id;
END $$;
```

### File manifest

```
NEW
  apps/web/src/lib/data/notifications.types.ts
  apps/web/src/lib/data/notifications.ts              ← fetchMyNotifications, fetchUnreadCount
  apps/web/src/lib/actions/notifications.ts           ← markRead, markAllRead
  apps/web/src/components/NotificationBell.tsx        ← header bell with unread badge (realtime)
  apps/web/src/app/(notifications)/notifications/page.tsx  ← full feed page

EDIT (wire notify() calls)
  apps/web/src/lib/actions/jobs.ts                    ← on moderate
  apps/web/src/lib/actions/inspectorApply.ts          ← on apply
  apps/web/src/lib/actions/dispatch.ts                ← on assign
  apps/web/src/lib/actions/submitReport.ts            ← on submit
  apps/web/src/lib/actions/clientReport.ts            ← on approve
  apps/web/src/lib/actions/payouts.ts                 ← on release
  apps/web/src/lib/actions/reviews.ts                 ← on new review
  apps/web/src/lib/actions/messages.ts                ← on new message
  apps/web/src/components/{client,inspector,admin}/Header.tsx
                                                       ← mount <NotificationBell />
```

---

## Sprint 12G — Disputes Filing UI (~1 day)

**Why critical:** `/admin/disputes` reads from a disputes table; parties currently have no way to *file* one through the web. They have to use Contact.

### SQL audit + extension

Audit step:
```sql
\d+ public.disputes
-- Expected columns: id, job_id, opener_id, opener_role, body, status, resolution, created_at, resolved_at
-- If missing: ALTER TABLE / CREATE TABLE accordingly.
```

If the table doesn't yet exist:
```sql
CREATE TABLE IF NOT EXISTS public.disputes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  opener_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opener_role  TEXT NOT NULL CHECK (opener_role IN ('client','agency','enterprise','inspector')),
  category     TEXT NOT NULL CHECK (category IN ('scope','quality','payment','communication','other')),
  body         TEXT NOT NULL CHECK (char_length(body) BETWEEN 20 AND 8000),
  status       TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','investigating','resolved','rejected','closed')),
  resolution   TEXT,
  resolved_at  TIMESTAMPTZ,
  resolved_by  UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- RLS: opener can read/file own, admin all. Counterparty read once status != 'open' (admin shares).
```

### File manifest

```
NEW
  apps/web/src/lib/data/disputes.types.ts
  apps/web/src/lib/data/disputes.ts                     ← fetcher (own + admin queue)
  apps/web/src/lib/actions/disputes.ts                  ← openDispute() server action
  apps/web/src/app/client/disputes/page.tsx             ← list my disputes
  apps/web/src/app/client/disputes/new/page.tsx         ← file new dispute
  apps/web/src/app/inspector/disputes/page.tsx          ← same for inspector
  apps/web/src/app/inspector/disputes/new/page.tsx

EDIT
  apps/web/src/components/client/Sidebar.tsx            ← +Disputes
  apps/web/src/components/inspector/Sidebar.tsx         ← +Disputes
  apps/web/src/app/admin/disputes/page.tsx              ← extend with status filter + ack flow
```

---

## Sprint 12H — Invoices + Payout Statement PDFs (~1.5 days)

**Why critical:** Accounting. Clients need per-job invoices for AP/AR; inspectors need quarterly/annual payout statements for tax.

### Approach (no new tables)

Server-side render PDFs from existing `jobs` + `transactions` + `profiles` data using `pdf-lib`. No additional schema needed.

### File manifest

```
NEW
  apps/web/src/lib/pdf/renderInvoice.ts                 ← per-job invoice PDF
  apps/web/src/lib/pdf/renderPayoutStatement.ts         ← inspector quarterly statement PDF
  apps/web/src/app/client/finance/invoice/[jobId]/route.ts
                                                         ← Route Handler returning the PDF
  apps/web/src/app/inspector/wallet/statement/[period]/route.ts
                                                         ← /Q1-2026, /Q2-2026, or /2026 annual

EDIT
  apps/web/src/app/client/finance/page.tsx              ← per-row "Download invoice" link
  apps/web/src/app/inspector/wallet/page.tsx            ← "Download Q1 2026 statement" CTA
```

### Design

- Client invoices: line items per job (title, completion date, escrow amount, fees, total).
- Inspector statements: aggregate by period; show gross + platform fee + net + Stripe Connect transfer IDs.
- Client branding applied (uses Sprint 9 branding settings — logo + header/footer).
- Stamped with audit hash (sha256 of the rendered PDF) for tamper detection.

---

## Sprint 12I — Organization Member Management (~1.5 days)

**Why critical:** Agencies and enterprise clients need teammates. `organizations` + `organization_members` tables already exist (Sprint at 20260521120000); just no UI.

### Schema audit (no new migration assumed)

```sql
\d+ public.organizations
\d+ public.organization_members
-- Confirm: org_id, user_id, role (owner/admin/member), invited_at, accepted_at
```

### File manifest

```
NEW
  apps/web/src/lib/data/orgMembers.types.ts
  apps/web/src/lib/data/orgMembers.ts                   ← list members + pending invites
  apps/web/src/lib/actions/orgMembers.ts                ← inviteMember, revokeMember, changeRole
  apps/web/src/lib/actions/orgInviteAccept.ts           ← accept invite (called from email link)
  apps/web/src/app/client/team/page.tsx                 ← members + invites table
  apps/web/src/app/client/team/invite/page.tsx          ← invite form
  apps/web/src/app/orgs/accept/[token]/page.tsx         ← invite landing page (public)

EDIT
  apps/web/src/components/client/Sidebar.tsx            ← +Team under System
```

### Key decisions

- Invite via email-tokenised link (server action mints a single-use token).
- Roles: owner (one per org), admin (manage members), member (operate jobs).
- Owner cannot be removed without ownership transfer flow.

---

## Sequencing + estimates (updated)

| Sub-sprint | Days | Risk | Notes |
|---|---|---|---|
| 12.0 — Hero + footer | 0.25 | low | ✅ SHIPPED |
| 12A — Messaging | 1.5–2 | medium (realtime) | ✅ SHIPPED |
| 12B — Client documents | 1 | low | next |
| **12E — Reviews + ratings** | **1–1.5** | **low** | **highest user-trust impact** |
| **12F — Notifications** | **1** | **low** | unblocks 12A engagement |
| **12G — Disputes filing** | **1** | **low** | unblocks ops escalation |
| **12H — Invoices + statements PDF** | **1.5** | **medium (pdf-lib)** | accounting requirement |
| 12C — Job clauses | 1 | low | extends inspector apply flow |
| **12I — Org member management** | **1.5** | **low** | agencies + enterprise unblock |
| 12D — Contracts + e-sign | 2 | medium (PDF stamp) | client onboarding gate |
| **Total remaining (12B–12I + 12C + 12D)** | **~10–11 days** | | |

After 12D + 12I ship and the E2E test plan reruns clean, mobile is unblocked.

---

## Post-launch backlog (Sprint 13+)

Parked from the launch path — important but not blockers:

- 13A — Email infrastructure (transactional)
- 13B — 2FA / TOTP
- 13C — Public inspector profile pages (`/p/[userId]` exists as part of 12E but expand to SEO-friendly directory)
- 13D — Onboarding checklist
- 13E — Formal scope-change request flow (currently handled via 12A admin chat)
- 13F — Bulk job posting (CSV upload, enterprise tier)
- 13G — Inspector availability calendar (granular dates beyond `is_available` boolean)
- 13H — Webhooks / API for enterprise integrations
- 13I — Global search bar
- 13J — Job_messages / admin_direct_messages / helpdesk_messages / support_messages — consolidation OR formal deprecation

---

## Open questions for ebi before I start building

1. **Footer dead links** — option A (build stub pages) or option B (remove the links)?
2. **Messaging scope** — global rooms only, or job-scoped only, or both?
3. **Clauses authorship** — client writes them inline at job-post time, or pick from an admin-curated library, or both?
4. **Contracts onboarding gate** — strict (redirect until signed) or soft (show banner)?
5. **E-sign MVP** — typed-name + IP/UA capture is enough for v1, or do you want DocuSign integration in scope?

Pick on each and I'll start with Sprint 12.0 + 12A.
