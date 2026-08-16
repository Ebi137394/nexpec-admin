-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/storage_buckets_test.sql
--
--  Regression proof for 20260801532000_storage_buckets_and_write_policies.
--
--  RUN:  supabase test db
--        psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--          -f supabase/tests/storage_buckets_test.sql
--
--  WHAT WENT WRONG
--  storage.buckets held exactly ONE row — `avatars` — on Staging and on a
--  freshly reset local database. No migration had ever created a bucket; the
--  originals were made by hand in the dashboard. Every other upload path in the
--  product returned `NoSuchBucket`: Document Vault, client documents, inspector
--  credentials and certificates, resumes, chat attachments, inspection photos,
--  signatures, flash-report evidence and company branding.
--
--  Underneath it, storage.objects had RLS on with exactly one INSERT, one
--  UPDATE and one DELETE policy — all three for `avatars` — so even with the
--  buckets present every other bucket would have stayed read-only.
--
--  WHAT THIS SUITE PROVES
--    A  every bucket the application names exists
--    B  only `avatars` is public — a private document bucket flipped public
--       would publish every resume and certificate on the internet
--    C  every private bucket has a size cap
--    D  every private bucket has INSERT, UPDATE, DELETE and SELECT policies
--
--  This is a catalogue suite by design: the property is "the environment this
--  repository builds is complete", which is exactly what went missing. The
--  behavioural half — real upload, signed-URL download with byte comparison,
--  cross-tenant denial, MIME and size rejection — runs against Staging through
--  the storage HTTP API, which pgTAP cannot reach.
-- ════════════════════════════════════════════════════════════════════════════
begin;
create extension if not exists pgtap;

select plan(6);

-- The authoritative list, traced to the bucket ids in the application source.
create temporary table _expected_buckets(id text primary key, is_public boolean) on commit drop;
insert into _expected_buckets values
  ('avatars', true),
  ('resumes', false),
  ('inspector_certificates', false),
  ('inspector_credentials', false),
  ('client_documents', false),
  ('vendor_documents', false),
  ('inspection-photos', false),
  ('inspection_signatures', false),
  ('flash-report-attachments', false),
  ('chat_attachments', false),
  ('branding_assets', false),
  ('ai-dataset', false);

-- 1 — nothing the code names is missing
select is(
  (select coalesce(string_agg(e.id, ', ' order by e.id), '')
     from _expected_buckets e
    where not exists (select 1 from storage.buckets b where b.id = e.id)),
  '',
  'every storage bucket the application names exists'
);

-- 2 — and none has drifted to a different visibility than intended
select is(
  (select coalesce(string_agg(b.id || '=' || b.public, ', ' order by b.id), '')
     from storage.buckets b
     join _expected_buckets e on e.id = b.id
    where b.public is distinct from e.is_public),
  '',
  'bucket visibility matches intent — only avatars is public'
);

-- 3 — stated the blunt way, because this is the one that leaks resumes
select is(
  (select coalesce(string_agg(id, ', ' order by id), '')
     from storage.buckets where public and id <> 'avatars'),
  '',
  'NO private document bucket is public'
);

-- 4 — an uncapped bucket is an unbounded upload
select is(
  (select coalesce(string_agg(b.id, ', ' order by b.id), '')
     from storage.buckets b
     join _expected_buckets e on e.id = b.id
    where e.is_public = false and b.file_size_limit is null),
  '',
  'every private bucket carries a file size cap'
);

-- 5 — the second half of the defect: buckets with no way to write to them.
--     Checked per bucket and per command so a single missing triple fails.
select is(
  (select coalesce(string_agg(e.id || ':' || c.cmd, ', ' order by e.id, c.cmd), '')
     from _expected_buckets e
     cross join (values ('INSERT'),('UPDATE'),('DELETE')) as c(cmd)
    where not exists (
      select 1 from pg_policies p
       where p.schemaname='storage' and p.tablename='objects'
         and p.cmd = c.cmd
         and (coalesce(p.qual,'') || coalesce(p.with_check,'')) like '%''' || e.id || '''%')),
  '',
  'every bucket has INSERT, UPDATE and DELETE policies'
);

-- 6 — and a read path, so an upload is not write-only
select is(
  (select coalesce(string_agg(e.id, ', ' order by e.id), '')
     from _expected_buckets e
    where not exists (
      select 1 from pg_policies p
       where p.schemaname='storage' and p.tablename='objects'
         and p.cmd in ('SELECT','ALL')
         and coalesce(p.qual,'') like '%''' || e.id || '''%')),
  '',
  'every bucket has a SELECT policy'
);

select * from finish();
rollback;
