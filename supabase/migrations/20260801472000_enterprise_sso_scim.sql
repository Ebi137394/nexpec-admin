-- ════════════════════════════════════════════════════════════════════════════
--  20260801472000_enterprise_sso_scim.sql
--
--  Enterprise SSO (SAML 2.0 / OIDC) + SCIM 2.0 provisioning.
--
--  ── WHAT ALREADY EXISTED AT THIS HEAD (read, not assumed) ──────────────────
--  This lane is NOT greenfield. The identity spine is already built:
--
--    auth.users                  GoTrue. The ROOT of identity.
--    public.profiles             baseline:17456. profiles.id is a FK to
--                                auth.users(id) ON DELETE CASCADE
--                                (baseline:28923). One row per human.
--    public.handle_new_user()    baseline:11997. Bootstraps profiles from
--                                auth.users on signup; whitelists role to
--                                {client, inspector, agency, supplier}.
--    public.organizations        baseline:23924. The tenant boundary.
--    public.org_members          baseline:23912. UNIQUE (org_id, user_id)
--                                (baseline:25697), user_id FK → profiles(id)
--                                ON DELETE CASCADE (baseline:28812), role is
--                                the org_member_role enum (baseline:333).
--    public.org_departments      baseline:23868  (+ org_department_members)
--    public.org_invitations      baseline:23895  (human invite path)
--    public.is_member_of_org()   baseline:13019. The canonical org predicate.
--    public.nx_is_admin()        baseline:14551.
--
--  and on the client side, app/(auth)/ already ships sign-in, sign-up,
--  mfa-challenge and oauth-callback, and apps/web ships (auth)/sign-in,
--  sign-up, forgot-password, reset-password and /auth/callback.
--
--  Everything above is LEFT EXACTLY AS IT WAS. Nothing here replaces it.
--
--  ── THE GAP THIS MIGRATION ACTUALLY FILLS ──────────────────────────────────
--  There is no way to say "this organization authenticates against that IdP",
--  no SCIM endpoint, no credential for an IdP to present, no IdP-group → role
--  map, and no provisioning audit trail. Those are the genuine gaps. Six
--  tables and a small set of RPCs close them.
--
--  ── THE ONE RULE THIS LANE EXISTS TO NOT BREAK ─────────────────────────────
--  NO SECOND USER DIRECTORY.
--
--  A SCIM implementation that stores userName / givenName / familyName /
--  emails / active in its own table has forked the user directory: two rows
--  claim to describe one human, they drift, and the question "who is this
--  person" stops having one answer. That is the failure mode of this lane.
--
--  So public.org_scim_identities stores NO identity attribute at all. It is a
--  CORRESPONDENCE TABLE and nothing else:
--
--        (connection_id, external_id)  ──▶  profiles.id
--
--  Every attribute SCIM exposes is READ THROUGH to the existing spine:
--
--        SCIM userName    →  public.profiles.email
--        SCIM name.*      →  public.profiles.first_name / last_name / full_name
--        SCIM active      →  membership in public.org_members for this org
--        SCIM groups      →  public.org_members.role, resolved through the
--                            explicit org_scim_group_mappings table
--        SCIM id          →  public.profiles.id (the auth.users id)
--
--  This is asserted mechanically in the self-test at the foot of the file: no
--  table created here may carry an identity-attribute column, and every
--  user reference must be a FK to public.profiles(id). If a later edit adds
--  `email text` to a SCIM table, this migration's self-test fails on re-run
--  and the QA suite fails, by construction.
--
--  Consequence, stated plainly because it is a real constraint and not an
--  oversight: SCIM userName MUST be the user's NEXPEC email. An IdP whose
--  userName is not the mail attribute cannot be matched. That is the price of
--  having one directory, and it is the right price.
--
--  ── THE SECOND RULE: NORMAL AUTHENTICATION IS UNTOUCHED ────────────────────
--  SSO is ADDITIVE. This migration adds no trigger to auth.users, alters no
--  auth object, changes no existing RLS policy, and drops nothing. Email and
--  password, OAuth, Apple and biometric sign-in all continue to run exactly
--  the path they ran before. Asserted below.
--
--  ── WHY NO SAML IMPLEMENTATION LIVES HERE ──────────────────────────────────
--  Supabase Auth (GoTrue) already implements SAML 2.0 natively and owns
--  auth.sso_providers / auth.sso_domains / auth.saml_providers. Writing a
--  second SAML stack — assertion parsing, signature verification, replay
--  defence — would be both a new attack surface and a second identity path.
--  So this lane REGISTERS the connection and lets GoTrue authenticate it:
--  org_sso_connections.auth_sso_provider_id carries the GoTrue provider id and
--  sign-in stays supabase.auth.signInWithSSO().
--
--  That column is deliberately a SOFT reference with NO foreign key. The auth
--  schema is not part of this repository's migration chain (the baseline dump
--  excludes it), so a FK to auth.sso_providers would either fail outright on a
--  project without SAML enabled, or bind this chain to an object no migration
--  here creates. Integrity is instead enforced at the point of use. This is a
--  deliberate, stated trade — not an omission.
--
--  ── TOKENS ─────────────────────────────────────────────────────────────────
--  SCIM bearer tokens are stored ONLY as sha256(raw). The raw value is
--  returned exactly once, by nx_scim_issue_token(), and is never persisted,
--  never logged and never recoverable — a lost token is rotated, not read
--  back. Same discipline the coordination bridge already uses
--  (coordination_bridges.token_sha256, baseline:5850). Tokens are
--  per-organization, bounded in lifetime, revocable, and rotatable with an
--  overlap window so an IdP can cut over without a provisioning outage.
--
--  The hash column is additionally withheld from `authenticated` by
--  COLUMN-LEVEL grant, so an org admin reading their own token roster through
--  PostgREST cannot select the digest at all.
--
--  ── IDEMPOTENCY ────────────────────────────────────────────────────────────
--  IdPs retry POST/PUT/PATCH by contract, so every write path here is
--  idempotent STRUCTURALLY rather than by a bolt-on replay cache:
--
--    • UNIQUE (connection_id, external_id) — a retried POST /Users resolves to
--      the same identity row instead of creating a second one.
--    • UNIQUE (connection_id, user_id) — one NEXPEC user maps to at most one
--      external id per connection, so two IdP records cannot both claim them.
--    • ON CONFLICT DO UPDATE on org_members (org_id, user_id) — the existing
--      baseline unique constraint carries the idempotency for membership.
--    • Deactivating an already-inactive identity is a no-op that returns
--      success, so a retried DELETE does not 404 or double-archive.
--
--  ── DEPROVISIONING: DEACTIVATE, NEVER DESTROY ──────────────────────────────
--  A SCIM `active:false` or DELETE removes the org_members row so that RLS
--  actually stops granting org access — but it FIRST copies that row into
--  public.org_scim_membership_archive, so the membership, its role and its
--  original grant date survive as evidence and the state is exactly
--  restorable on re-activation.
--
--  What deprovisioning explicitly does NOT do:
--    • it does not delete, suspend or otherwise touch public.profiles. A human
--      may be an inspector, a supplier and a member of three organizations;
--      one enterprise removing them must not disable them platform-wide.
--      profiles.status is therefore never written by any function here, and
--      the self-test enforces that.
--    • it does not delete the auth.users row.
--    • it does not touch jobs, reports, evidence or any other business record.
--      Those reference profiles.id, which survives, so nothing is orphaned.
--
--  ── PRIVILEGE ESCALATION, CLOSED IN TWO PLACES ─────────────────────────────
--  An IdP is an EXTERNAL system. If it could name a role, a compromised or
--  merely careless IdP group would mint platform admins. So:
--    • org_sso_connections.default_profile_role is CHECK-constrained to the
--      same four public-signup roles handle_new_user() whitelists. SCIM can
--      never produce a profiles.role of admin or super_admin.
--    • org_scim_group_mappings.org_role is CHECK-constrained to exclude
--      'owner'. Organization ownership is a human decision made in NEXPEC,
--      never an inherited consequence of IdP group membership.
--
--  ── DELIBERATELY NOT DONE ──────────────────────────────────────────────────
--   • NO new user table, NO new credential store, NO password material.
--   • NO change to any existing table, policy, function, trigger or grant.
--     This migration is purely additive. Asserted below.
--   • NO write to auth.* from SQL. Creating the auth user is GoTrue's job, via
--     the Admin API in the scim-v2 Edge Function; the RPCs here REFUSE a
--     user_id that has no profiles row rather than inventing one.
--   • NO sign-in surface change. Wiring an SSO button into the existing
--     sign-in screens belongs to whoever owns those files; this lane does not
--     touch them.
--   • NO third-party dependency and no paid middleware. SAML 2.0 / OIDC via
--     GoTrue, SCIM 2.0 (RFC 7643 / 7644) hand-rolled over standard HTTP.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
--  0. Ordering preconditions — fail loudly rather than half-apply
-- ════════════════════════════════════════════════════════════════════════════
DO $ordering$
BEGIN
  IF to_regclass('public.organizations') IS NULL
     OR to_regclass('public.org_members') IS NULL
     OR to_regclass('public.profiles')   IS NULL THEN
    RAISE EXCEPTION
      'ORDERING: organizations, org_members and profiles must all exist before 20260801472000 — this lane maps onto the EXISTING identity spine and creates no directory of its own';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_member_role') THEN
    RAISE EXCEPTION
      'ORDERING: the org_member_role enum is missing — SCIM role mapping targets it directly';
  END IF;

  -- The whole "one directory" claim rests on this FK. If profiles ever stops
  -- being keyed on auth.users, SCIM identities stop pointing at real users.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass
       AND contype  = 'f'
       AND conname  = 'profiles_id_fkey'
  ) THEN
    RAISE EXCEPTION
      'ORDERING: profiles.id is no longer a foreign key to auth.users — the single-directory guarantee this migration depends on is gone';
  END IF;
END
$ordering$;

-- ════════════════════════════════════════════════════════════════════════════
--  A. org_sso_connections — one row per organization per IdP connection
--
--  Registry only. NO secret material: an OIDC client secret and a SAML signing
--  key belong to GoTrue / the vault, never to an application table an org
--  admin can read. Enforced by the self-test.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.org_sso_connections (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  protocol               text NOT NULL,
  display_name           text NOT NULL,

  -- Soft reference to auth.sso_providers(id). No FK by design — see header.
  auth_sso_provider_id   uuid,

  -- SAML descriptors (all optional; GoTrue holds the authoritative copy)
  idp_entity_id          text,
  idp_metadata_url       text,

  -- OIDC descriptors. client_secret is ABSENT on purpose.
  oidc_issuer            text,
  oidc_client_id         text,

  status                 text NOT NULL DEFAULT 'draft',

  -- What a newly provisioned member gets when no group mapping matches.
  default_member_role    public.org_member_role NOT NULL DEFAULT 'viewer',
  default_profile_role   text NOT NULL DEFAULT 'client',

  -- Just-in-time provisioning on first SSO sign-in (distinct from SCIM push).
  jit_provisioning_enabled boolean NOT NULL DEFAULT false,

  created_by             uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT org_sso_connections_protocol_check
    CHECK (protocol = ANY (ARRAY['saml', 'oidc'])),
  CONSTRAINT org_sso_connections_status_check
    CHECK (status = ANY (ARRAY['draft', 'active', 'disabled'])),
  -- Escalation guard #1: the four public-signup roles handle_new_user()
  -- whitelists, and nothing else. SCIM can never mint an admin.
  CONSTRAINT org_sso_connections_default_profile_role_check
    CHECK (default_profile_role = ANY (ARRAY['client', 'inspector', 'agency', 'supplier'])),
  -- An active connection must actually identify an IdP.
  CONSTRAINT org_sso_connections_active_is_identified
    CHECK (
      status <> 'active'
      OR auth_sso_provider_id IS NOT NULL
      OR idp_entity_id IS NOT NULL
      OR oidc_issuer IS NOT NULL
    )
);

COMMENT ON TABLE public.org_sso_connections IS
  'Registry of enterprise IdP connections, one row per organization per connection. REGISTRY ONLY — authentication itself is performed by Supabase Auth (GoTrue), which owns auth.sso_providers/auth.saml_providers and the SAML 2.0 implementation; this table records WHICH GoTrue provider belongs to WHICH NEXPEC organization and what a provisioned member should get by default. Holds NO secret material: an OIDC client secret or SAML signing key must live in GoTrue or the vault, never here (asserted by the 20260801472000 self-test). auth_sso_provider_id is a deliberate soft reference with no FK — the auth schema is not part of this repository''s migration chain. SSO is ADDITIVE: email/password, OAuth, Apple and biometric sign-in are unchanged by this lane.';

COMMENT ON COLUMN public.org_sso_connections.auth_sso_provider_id IS
  'The GoTrue auth.sso_providers.id this connection maps to. SOFT reference, no foreign key, because the auth schema is outside this migration chain and SAML may not be enabled on a given project. Validate at the point of use, not by constraint.';

COMMENT ON COLUMN public.org_sso_connections.default_profile_role IS
  'profiles.role given to a user provisioned through this connection. CHECK-constrained to the same four roles handle_new_user() whitelists (client, inspector, agency, supplier) so that no IdP, compromised or merely misconfigured, can provision a platform admin.';

COMMENT ON COLUMN public.org_sso_connections.jit_provisioning_enabled IS
  'When TRUE, a successful SSO sign-in from a verified domain may create org membership on the fly. Distinct from SCIM, which is IdP-PUSHED and authoritative. Both paths converge on the same org_members row; neither creates a second user record.';

CREATE UNIQUE INDEX IF NOT EXISTS org_sso_connections_org_display_key
  ON public.org_sso_connections (org_id, lower(display_name));

-- One GoTrue provider belongs to exactly one organization. Without this, two
-- orgs could claim the same IdP and SCIM writes would cross the tenant line.
CREATE UNIQUE INDEX IF NOT EXISTS org_sso_connections_auth_provider_key
  ON public.org_sso_connections (auth_sso_provider_id)
  WHERE auth_sso_provider_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS org_sso_connections_org_idx
  ON public.org_sso_connections (org_id, status);

-- ════════════════════════════════════════════════════════════════════════════
--  B. org_sso_domains — which email domains route to which connection
--
--  domain is UNIQUE GLOBALLY, not per-org. If two organizations could both
--  claim example.com, whichever resolved first would capture the other's
--  users. Domain ownership is exclusive, and verification is explicit.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.org_sso_domains (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id  uuid NOT NULL REFERENCES public.org_sso_connections(id) ON DELETE CASCADE,
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  domain         text NOT NULL,
  verified_at    timestamptz,
  verified_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  verification_token text,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT org_sso_domains_domain_format
    CHECK (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  CONSTRAINT org_sso_domains_verified_pair
    CHECK ((verified_at IS NULL) = (verified_by IS NULL))
);

COMMENT ON TABLE public.org_sso_domains IS
  'Email domains that route to an enterprise SSO connection. domain is UNIQUE GLOBALLY and deliberately not scoped per-organization: if two tenants could both claim example.com, whichever matched first would capture the other tenant''s users. A domain only takes effect once verified_at is set — an unverified claim routes nobody. Domain claims never bypass authentication; they only select which IdP a sign-in is offered.';

COMMENT ON COLUMN public.org_sso_domains.verification_token IS
  'One-time DNS TXT challenge value proving control of the domain. Not a credential and not a bearer token — it authorises nothing on its own and is cleared once verified_at is stamped.';

CREATE UNIQUE INDEX IF NOT EXISTS org_sso_domains_domain_key
  ON public.org_sso_domains (lower(domain));

CREATE INDEX IF NOT EXISTS org_sso_domains_connection_idx
  ON public.org_sso_domains (connection_id);

-- ════════════════════════════════════════════════════════════════════════════
--  C. org_scim_tokens — hashed, per-org, expiring, revocable, rotatable
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.org_scim_tokens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id    uuid REFERENCES public.org_sso_connections(id) ON DELETE CASCADE,
  name             text NOT NULL,

  -- sha256(raw) hex. The raw token is returned once and never stored.
  token_sha256     text NOT NULL,
  -- Non-secret display fragment so an operator can tell two tokens apart.
  token_prefix     text NOT NULL,

  scopes           text[] NOT NULL DEFAULT ARRAY['users:read','users:write','groups:read'],

  created_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  revoked_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  revoked_reason   text,

  -- Rotation lineage: the token this one replaces.
  rotated_from_id  uuid REFERENCES public.org_scim_tokens(id) ON DELETE SET NULL,

  last_used_at     timestamptz,

  CONSTRAINT org_scim_tokens_sha_format
    CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT org_scim_tokens_expiry_sane
    CHECK (expires_at > created_at),
  -- Revocation attribution can only exist on a token that is actually
  -- revoked. (The converse is deliberately allowed: a service-role revoke has
  -- no auth.uid() to attribute.)
  CONSTRAINT org_scim_tokens_revoked_pair
    CHECK (revoked_at IS NOT NULL OR (revoked_by IS NULL AND revoked_reason IS NULL)),
  CONSTRAINT org_scim_tokens_no_self_rotation
    CHECK (rotated_from_id IS NULL OR rotated_from_id <> id)
);

COMMENT ON TABLE public.org_scim_tokens IS
  'Per-organization SCIM 2.0 bearer credentials, stored ONLY as sha256(raw) hex — the raw token is returned exactly once by nx_scim_issue_token() and is never persisted, never logged and never recoverable. Same discipline as coordination_bridges.token_sha256. Every token is scoped to one organization, carries a mandatory expiry (max 730 days), is revocable at any moment via nx_scim_revoke_token(), and is rotatable via nx_scim_issue_token(p_rotates_token_id => ...) which issues the replacement and gives the outgoing token a bounded overlap window so an IdP can cut over without a provisioning outage. token_sha256 is withheld from the `authenticated` role by column-level grant, so an org admin reading their own roster cannot select the digest.';

COMMENT ON COLUMN public.org_scim_tokens.token_prefix IS
  'Non-secret leading fragment of the raw token (scheme tag plus a few characters), stored so an operator can identify a token in a list without ever seeing it. Far too short to be brute-forced into the 256-bit secret.';

COMMENT ON COLUMN public.org_scim_tokens.rotated_from_id IS
  'The token this one replaces. Rotation issues a NEW row and shortens the OUTGOING token''s expiry to a grace window rather than revoking it instantly — an instant revoke would black-hole provisioning for however long the IdP takes to pick up the new secret.';

CREATE UNIQUE INDEX IF NOT EXISTS org_scim_tokens_sha256_key
  ON public.org_scim_tokens (token_sha256);

CREATE INDEX IF NOT EXISTS org_scim_tokens_org_idx
  ON public.org_scim_tokens (org_id, created_at DESC);

-- Partial index over live tokens — the hot path for resolve.
CREATE INDEX IF NOT EXISTS org_scim_tokens_live_idx
  ON public.org_scim_tokens (org_id)
  WHERE revoked_at IS NULL;

-- ════════════════════════════════════════════════════════════════════════════
--  D. org_scim_group_mappings — IdP group → org role, explicit and auditable
--
--  Authored by an organization administrator INSIDE NEXPEC. The IdP supplies
--  group names; it does not get to decide what they mean.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.org_scim_group_mappings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id     uuid NOT NULL REFERENCES public.org_sso_connections(id) ON DELETE CASCADE,

  -- As presented by the IdP. external_group_id is the stable handle;
  -- display name is kept because many IdPs only send displayName in groups[].
  external_group_id   text,
  external_group_name text NOT NULL,

  org_role          public.org_member_role NOT NULL,
  department_id     uuid REFERENCES public.org_departments(id) ON DELETE SET NULL,

  is_active         boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- Escalation guard #2: org ownership is never inherited from an IdP group.
  CONSTRAINT org_scim_group_mappings_no_owner
    CHECK (org_role <> 'owner'::public.org_member_role)
);

COMMENT ON TABLE public.org_scim_group_mappings IS
  'Explicit, auditable IdP-group → org_member_role map. The IdP supplies group NAMES; this table — authored by an organization administrator inside NEXPEC — decides what they MEAN. A group with no mapping grants nothing and falls through to org_sso_connections.default_member_role. org_role can never be ''owner'' (CHECK org_scim_group_mappings_no_owner): organization ownership is a human decision, never an inherited consequence of IdP group membership. When a user matches several mapped groups the MOST PRIVILEGED wins, resolved by org_member_role enum declaration order (owner < procurement_admin < project_lead < viewer) — see nx_scim_resolve_role().';

CREATE UNIQUE INDEX IF NOT EXISTS org_scim_group_mappings_conn_name_key
  ON public.org_scim_group_mappings (connection_id, lower(external_group_name));

CREATE UNIQUE INDEX IF NOT EXISTS org_scim_group_mappings_conn_extid_key
  ON public.org_scim_group_mappings (connection_id, external_group_id)
  WHERE external_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS org_scim_group_mappings_org_idx
  ON public.org_scim_group_mappings (org_id) WHERE is_active;

-- ════════════════════════════════════════════════════════════════════════════
--  E. org_scim_identities — THE CORRESPONDENCE TABLE
--
--  (connection_id, external_id) ──▶ profiles.id
--
--  No email. No name. No phone. No credential. No `userName`. Every attribute
--  is read through to public.profiles. This is what makes the claim "no second
--  user directory" mechanically true rather than merely asserted, and the
--  self-test at the foot of this file enforces it.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.org_scim_identities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id   uuid NOT NULL REFERENCES public.org_sso_connections(id) ON DELETE CASCADE,

  -- The IdP's opaque stable identifier for this person. NOT an attribute of
  -- the person — a handle for the correspondence.
  external_id     text NOT NULL,

  -- The ONE user directory.
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  is_active       boolean NOT NULL DEFAULT true,
  deactivated_at  timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_synced_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT org_scim_identities_external_id_nonblank
    CHECK (length(btrim(external_id)) > 0),
  CONSTRAINT org_scim_identities_active_pair
    CHECK ((is_active AND deactivated_at IS NULL) OR (NOT is_active AND deactivated_at IS NOT NULL))
);

COMMENT ON TABLE public.org_scim_identities IS
  'CORRESPONDENCE ONLY: (connection_id, external_id) → profiles.id. This table deliberately stores NO identity attribute — no email, no name, no phone, no credential, no SCIM userName — because a SCIM table that stores attributes IS a second user directory, and two rows describing one human always drift. Every SCIM attribute is read through to the existing spine: userName → profiles.email, name.* → profiles.first_name/last_name, active → membership in org_members, groups → org_members.role via org_scim_group_mappings, id → profiles.id (which is the auth.users id). Enforced mechanically by the 20260801472000 self-test, which fails if any column here looks like an identity attribute. Consequence, by design: SCIM userName must be the user''s NEXPEC email.';

COMMENT ON COLUMN public.org_scim_identities.external_id IS
  'The IdP''s opaque, stable identifier for this person (SCIM externalId / the IdP''s immutable id). A handle for the mapping, never an attribute OF the person. Once bound to a user_id it is never silently re-pointed: nx_scim_provision_user() raises rather than move an external id onto a different NEXPEC account, because silent re-pointing is account takeover by IdP misconfiguration.';

COMMENT ON COLUMN public.org_scim_identities.is_active IS
  'SCIM `active`. FALSE means deprovisioned by the IdP: the org_members row has been archived into org_scim_membership_archive and removed, so RLS genuinely stops granting org access. The profiles row, the auth.users row and every business record are untouched — one enterprise deprovisioning a person must never disable them platform-wide.';

CREATE UNIQUE INDEX IF NOT EXISTS org_scim_identities_conn_external_key
  ON public.org_scim_identities (connection_id, external_id);

-- One NEXPEC user maps to at most one external id per connection. Without
-- this, two IdP records could both claim the same person and fight over role.
CREATE UNIQUE INDEX IF NOT EXISTS org_scim_identities_conn_user_key
  ON public.org_scim_identities (connection_id, user_id);

CREATE INDEX IF NOT EXISTS org_scim_identities_org_active_idx
  ON public.org_scim_identities (org_id, is_active);

CREATE INDEX IF NOT EXISTS org_scim_identities_user_idx
  ON public.org_scim_identities (user_id);

-- ════════════════════════════════════════════════════════════════════════════
--  F. org_scim_membership_archive — deprovisioning keeps the evidence
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.org_scim_membership_archive (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  identity_id         uuid REFERENCES public.org_scim_identities(id) ON DELETE SET NULL,

  archived_role       public.org_member_role NOT NULL,
  membership_created_at timestamptz,

  reason              text NOT NULL DEFAULT 'scim_deprovision',
  archived_at         timestamptz NOT NULL DEFAULT now(),
  restored_at         timestamptz
);

COMMENT ON TABLE public.org_scim_membership_archive IS
  'Evidence that a membership existed, written the moment SCIM deprovisions someone and BEFORE the org_members row is removed. Deprovisioning must revoke access — leaving the row would leave is_member_of_org() true and RLS still granting — but destroying the record of who belonged to an organization and in what role is worse than a stale row, so the row is copied here first and the state is exactly restorable: re-activation reads archived_role back. Append-mostly; restored_at is stamped on re-activation and nothing else is ever rewritten.';

CREATE INDEX IF NOT EXISTS org_scim_membership_archive_org_idx
  ON public.org_scim_membership_archive (org_id, archived_at DESC);

CREATE INDEX IF NOT EXISTS org_scim_membership_archive_user_idx
  ON public.org_scim_membership_archive (user_id, archived_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
--  G. org_scim_events — the provisioning audit trail
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.org_scim_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id  uuid REFERENCES public.org_sso_connections(id) ON DELETE SET NULL,
  token_id       uuid REFERENCES public.org_scim_tokens(id) ON DELETE SET NULL,

  operation      text NOT NULL,
  resource_type  text NOT NULL DEFAULT 'User',
  external_id    text,
  target_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  outcome        text NOT NULL,
  http_status    integer,
  request_id     text,

  -- Non-attribute context only: counts, role names, error codes. NEVER the
  -- raw SCIM payload — that carries the very attributes this lane refuses to
  -- store. Enforced by nx_scim_redact_detail().
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT org_scim_events_outcome_check
    CHECK (outcome = ANY (ARRAY['success', 'noop', 'rejected', 'error'])),
  CONSTRAINT org_scim_events_resource_type_check
    CHECK (resource_type = ANY (ARRAY['User', 'Group', 'Token', 'Connection']))
);

COMMENT ON TABLE public.org_scim_events IS
  'Append-only audit trail of every provisioning and deprovisioning decision: which token, which connection, which external id, which NEXPEC user, what happened and why. Written by the SECURITY DEFINER provisioning RPCs and by the scim-v2 Edge Function (service_role). No UPDATE or DELETE policy exists at all, so no authenticated principal can rewrite or erase history through PostgREST — the ABSENCE of the policy is the control. detail is redacted by nx_scim_redact_detail() before storage: it may carry counts, role names and error codes, never the raw SCIM payload, because the payload carries exactly the identity attributes this lane refuses to duplicate.';

CREATE INDEX IF NOT EXISTS org_scim_events_org_created_idx
  ON public.org_scim_events (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS org_scim_events_external_idx
  ON public.org_scim_events (connection_id, external_id, created_at DESC);

CREATE INDEX IF NOT EXISTS org_scim_events_outcome_idx
  ON public.org_scim_events (outcome, created_at DESC)
  WHERE outcome <> 'success';

-- ════════════════════════════════════════════════════════════════════════════
--  H. Grants + RLS
--
--  House rules: RLS on every new table, no GRANT to anon, admin branch on
--  every policy (check-rls-admin-coverage enforces the last one).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.org_sso_connections        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_sso_domains            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_scim_tokens            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_scim_group_mappings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_scim_identities        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_scim_membership_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_scim_events            ENABLE ROW LEVEL SECURITY;

-- ⚠ NOT OPTIONAL, AND NOT BOILERPLATE. baseline:40930-40933 sets
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT ALL ON TABLES TO anon, authenticated, service_role;
-- so every table created here is born with ALL privileges already granted to
-- anon AND authenticated. Creating the table and adding an RLS policy is
-- therefore NOT enough: without these REVOKEs, anon would hold DELETE on the
-- SCIM token store from the moment of creation. Revoke everything first, then
-- grant back only what each role genuinely needs.
REVOKE ALL ON TABLE public.org_sso_connections         FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.org_sso_domains             FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.org_scim_tokens             FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.org_scim_group_mappings     FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.org_scim_identities         FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.org_scim_membership_archive FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.org_scim_events             FROM PUBLIC, anon, authenticated, service_role;

-- Read for org administrators (narrowed further by RLS below); writes go
-- through the SECURITY DEFINER RPCs, never straight at the table.
GRANT SELECT ON TABLE public.org_sso_connections         TO authenticated;
GRANT SELECT ON TABLE public.org_sso_domains             TO authenticated;
GRANT SELECT ON TABLE public.org_scim_group_mappings     TO authenticated;
GRANT SELECT ON TABLE public.org_scim_identities         TO authenticated;
GRANT SELECT ON TABLE public.org_scim_membership_archive TO authenticated;
GRANT SELECT ON TABLE public.org_scim_events             TO authenticated;

-- COLUMN-LEVEL grant on the token table: every column EXCEPT token_sha256.
-- An org admin can manage their token roster without the digest ever being
-- selectable. `select *` therefore fails for authenticated, by design.
GRANT SELECT (id, org_id, connection_id, name, token_prefix, scopes,
              created_by, created_at, expires_at, revoked_at, revoked_by,
              revoked_reason, rotated_from_id, last_used_at)
  ON TABLE public.org_scim_tokens TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.org_sso_connections         TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.org_sso_domains             TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.org_scim_tokens             TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.org_scim_group_mappings     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.org_scim_identities         TO service_role;

-- Evidence tables are deliberately NARROWER than the rest, service_role
-- included. The archive may be appended to and stamped restored_at, never
-- deleted; the audit trail may only be appended to. Since the REVOKE above
-- stripped the default-privilege ALL grant, these two omissions are real:
-- even a fully compromised Edge Function holding the service-role key cannot
-- erase the record of what it provisioned.
GRANT SELECT, INSERT, UPDATE         ON TABLE public.org_scim_membership_archive TO service_role;
GRANT SELECT, INSERT                 ON TABLE public.org_scim_events             TO service_role;

-- ── The org-administration predicate ────────────────────────────────────────
-- SSO and SCIM configuration is an ADMINISTRATIVE act, not an ordinary
-- membership act: a viewer who could read the token roster or rewrite a group
-- mapping would own the organization.
CREATE OR REPLACE FUNCTION public.nx_is_org_identity_admin(p_org_id uuid)
RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
  SELECT
    public.nx_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.org_members m
       WHERE m.org_id = p_org_id
         AND m.user_id = auth.uid()
         AND m.role IN ('owner'::public.org_member_role,
                        'procurement_admin'::public.org_member_role)
    )
    OR EXISTS (
      SELECT 1 FROM public.organizations o
       WHERE o.id = p_org_id
         AND o.owner_id = auth.uid()
    );
$fn$;

ALTER FUNCTION public.nx_is_org_identity_admin(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_is_org_identity_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_is_org_identity_admin(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_is_org_identity_admin(uuid) IS
  'TRUE when the caller may administer an organization''s identity configuration: a platform admin (nx_is_admin), an org_members row with role owner or procurement_admin, or the organizations.owner_id. Deliberately STRICTER than is_member_of_org() — SSO connections, SCIM tokens and group mappings are administrative surfaces, and a project_lead or viewer who could read the token roster or rewrite a group mapping would effectively own the tenant.';

-- ── Policies. Read-only for authenticated; every write path is an RPC. ──────
DROP POLICY IF EXISTS org_sso_connections_admin_read ON public.org_sso_connections;
CREATE POLICY org_sso_connections_admin_read
  ON public.org_sso_connections FOR SELECT TO authenticated
  USING (public.nx_is_admin() OR public.nx_is_org_identity_admin(org_id));

DROP POLICY IF EXISTS org_sso_domains_admin_read ON public.org_sso_domains;
CREATE POLICY org_sso_domains_admin_read
  ON public.org_sso_domains FOR SELECT TO authenticated
  USING (public.nx_is_admin() OR public.nx_is_org_identity_admin(org_id));

DROP POLICY IF EXISTS org_scim_tokens_admin_read ON public.org_scim_tokens;
CREATE POLICY org_scim_tokens_admin_read
  ON public.org_scim_tokens FOR SELECT TO authenticated
  USING (public.nx_is_admin() OR public.nx_is_org_identity_admin(org_id));

DROP POLICY IF EXISTS org_scim_group_mappings_admin_read ON public.org_scim_group_mappings;
CREATE POLICY org_scim_group_mappings_admin_read
  ON public.org_scim_group_mappings FOR SELECT TO authenticated
  USING (public.nx_is_admin() OR public.nx_is_org_identity_admin(org_id));

-- A member may see their OWN provisioning linkage (a person is entitled to
-- know they were provisioned by their employer's IdP); an org identity admin
-- sees the whole roster.
DROP POLICY IF EXISTS org_scim_identities_read ON public.org_scim_identities;
CREATE POLICY org_scim_identities_read
  ON public.org_scim_identities FOR SELECT TO authenticated
  USING (
    public.nx_is_admin()
    OR user_id = auth.uid()
    OR public.nx_is_org_identity_admin(org_id)
  );

DROP POLICY IF EXISTS org_scim_membership_archive_read ON public.org_scim_membership_archive;
CREATE POLICY org_scim_membership_archive_read
  ON public.org_scim_membership_archive FOR SELECT TO authenticated
  USING (
    public.nx_is_admin()
    OR user_id = auth.uid()
    OR public.nx_is_org_identity_admin(org_id)
  );

DROP POLICY IF EXISTS org_scim_events_admin_read ON public.org_scim_events;
CREATE POLICY org_scim_events_admin_read
  ON public.org_scim_events FOR SELECT TO authenticated
  USING (public.nx_is_admin() OR public.nx_is_org_identity_admin(org_id));

-- ════════════════════════════════════════════════════════════════════════════
--  I. Redaction helper — audit detail must never become an attribute store
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.nx_scim_redact_detail(p_detail jsonb)
RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path = public, pg_temp
    AS $fn$
  SELECT COALESCE(p_detail, '{}'::jsonb)
         - 'userName'   - 'user_name'  - 'email'      - 'emails'
         - 'name'       - 'givenName'  - 'familyName' - 'displayName'
         - 'password'   - 'token'      - 'phoneNumbers' - 'nickName'
         - 'raw'        - 'payload';
$fn$;

ALTER FUNCTION public.nx_scim_redact_detail(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_scim_redact_detail(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_scim_redact_detail(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_scim_redact_detail(jsonb) IS
  'Strips identity attributes and credentials out of an audit detail blob before it is stored on org_scim_events. Without it the audit trail would quietly become the second user directory this lane exists to prevent — an events table holding userName, emails and name for every provisioning call is an attribute store with a timestamp on it. Counts, role names, error codes and external ids survive; attributes and secrets do not.';

-- ════════════════════════════════════════════════════════════════════════════
--  J. Token lifecycle: issue / rotate / revoke / resolve
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.nx_scim_issue_token(
  p_org_id            uuid,
  p_name              text,
  p_connection_id     uuid DEFAULT NULL,
  p_expires_in_days   integer DEFAULT 365,
  p_rotates_token_id  uuid DEFAULT NULL,
  p_grace_hours       integer DEFAULT 24
)
RETURNS TABLE (
  token_id     uuid,
  raw_token    text,
  token_prefix text,
  expires_at   timestamptz
)
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path = public, extensions, pg_temp
    AS $fn$
DECLARE
  v_raw       text;
  v_hash      text;
  v_prefix    text;
  v_expires   timestamptz;
  v_id        uuid;
  v_actor     uuid := auth.uid();
  v_old       public.org_scim_tokens%ROWTYPE;
BEGIN
  IF NOT public.nx_is_org_identity_admin(p_org_id) THEN
    RAISE EXCEPTION
      'FORBIDDEN: only an organization identity administrator may issue a SCIM token'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'a SCIM token must be named so it can be told apart at rotation time'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Bounded lifetime. A non-expiring provisioning credential is a permanent
  -- key to the tenant's membership roster.
  IF p_expires_in_days IS NULL OR p_expires_in_days < 1 OR p_expires_in_days > 730 THEN
    RAISE EXCEPTION 'SCIM token lifetime must be between 1 and 730 days (got %)', p_expires_in_days
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_connection_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.org_sso_connections c
     WHERE c.id = p_connection_id AND c.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'the SSO connection does not belong to this organization'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF p_rotates_token_id IS NOT NULL THEN
    SELECT * INTO v_old FROM public.org_scim_tokens t
     WHERE t.id = p_rotates_token_id AND t.org_id = p_org_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'the token being rotated does not belong to this organization'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  -- 256 bits of CSPRNG. The scheme tag makes a leaked token greppable in logs
  -- and identifiable by secret scanners.
  v_raw     := 'nxscim_' || encode(extensions.gen_random_bytes(32), 'hex');
  v_hash    := encode(extensions.digest(v_raw, 'sha256'), 'hex');
  v_prefix  := left(v_raw, 14);
  v_expires := now() + make_interval(days => p_expires_in_days);

  INSERT INTO public.org_scim_tokens
    (org_id, connection_id, name, token_sha256, token_prefix,
     created_by, expires_at, rotated_from_id)
  VALUES
    (p_org_id, p_connection_id, btrim(p_name), v_hash, v_prefix,
     v_actor, v_expires, p_rotates_token_id)
  RETURNING id INTO v_id;

  -- Rotation overlap: the outgoing token keeps working for the grace window
  -- so the IdP can cut over without a provisioning outage. It is shortened,
  -- never extended.
  IF p_rotates_token_id IS NOT NULL THEN
    UPDATE public.org_scim_tokens t
       SET expires_at = LEAST(t.expires_at,
                              now() + make_interval(hours => GREATEST(COALESCE(p_grace_hours, 24), 0)))
     WHERE t.id = p_rotates_token_id;
  END IF;

  INSERT INTO public.org_scim_events
    (org_id, connection_id, token_id, operation, resource_type, outcome, detail)
  VALUES
    (p_org_id, p_connection_id, v_id,
     CASE WHEN p_rotates_token_id IS NULL THEN 'token.issue' ELSE 'token.rotate' END,
     'Token', 'success',
     public.nx_scim_redact_detail(jsonb_build_object(
       'rotated_from', p_rotates_token_id,
       'grace_hours',  CASE WHEN p_rotates_token_id IS NULL THEN NULL ELSE p_grace_hours END,
       'expires_in_days', p_expires_in_days,
       'actor', v_actor
     )));

  -- The ONLY moment the raw token exists outside the caller's request.
  RETURN QUERY SELECT v_id, v_raw, v_prefix, v_expires;
END
$fn$;

ALTER FUNCTION public.nx_scim_issue_token(uuid, text, uuid, integer, uuid, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_scim_issue_token(uuid, text, uuid, integer, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_scim_issue_token(uuid, text, uuid, integer, uuid, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_scim_issue_token(uuid, text, uuid, integer, uuid, integer) IS
  'Mints a SCIM bearer token for one organization and returns the RAW value exactly once — it is stored only as sha256 and can never be read back. Org identity administrators only. Lifetime is mandatory and bounded to 730 days. Passing p_rotates_token_id performs a ROTATION: the replacement is issued immediately and the outgoing token''s expiry is SHORTENED to a grace window (default 24h) rather than revoked outright, so the IdP can cut over without a provisioning outage; pass nx_scim_revoke_token() instead when the old secret is believed compromised and the outage is the point.';

-- ── Revoke ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_scim_revoke_token(
  p_token_id uuid,
  p_reason   text DEFAULT 'manual revocation'
)
RETURNS boolean
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
DECLARE
  v_tok   public.org_scim_tokens%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  SELECT * INTO v_tok FROM public.org_scim_tokens WHERE id = p_token_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCIM token not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT public.nx_is_org_identity_admin(v_tok.org_id) THEN
    RAISE EXCEPTION
      'FORBIDDEN: only an organization identity administrator may revoke a SCIM token'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Idempotent: revoking an already-revoked token is a no-op, not an error.
  IF v_tok.revoked_at IS NOT NULL THEN
    RETURN false;
  END IF;

  UPDATE public.org_scim_tokens
     SET revoked_at = now(), revoked_by = v_actor, revoked_reason = p_reason
   WHERE id = p_token_id;

  INSERT INTO public.org_scim_events
    (org_id, connection_id, token_id, operation, resource_type, outcome, detail)
  VALUES
    (v_tok.org_id, v_tok.connection_id, p_token_id, 'token.revoke', 'Token', 'success',
     public.nx_scim_redact_detail(jsonb_build_object('reason', p_reason, 'actor', v_actor)));

  RETURN true;
END
$fn$;

ALTER FUNCTION public.nx_scim_revoke_token(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_scim_revoke_token(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_scim_revoke_token(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_scim_revoke_token(uuid, text) IS
  'Immediately and irreversibly revokes a SCIM bearer token. Org identity administrators only. Idempotent — re-revoking returns false rather than raising. Unlike rotation there is no grace window: this is the control to reach for when a secret is believed compromised, and the provisioning outage it causes is the intended effect.';

-- ── Resolve (the SCIM request hot path) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_scim_resolve_token(p_raw_token text)
RETURNS TABLE (
  token_id      uuid,
  org_id        uuid,
  connection_id uuid,
  scopes        text[]
)
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path = public, extensions, pg_temp
    AS $fn$
DECLARE
  v_hash text;
  v_row  public.org_scim_tokens%ROWTYPE;
BEGIN
  -- Uniform rejection: never reveal WHICH check failed to an unauthenticated
  -- caller. Length is checked first so a trivially short string costs nothing.
  IF p_raw_token IS NULL OR length(p_raw_token) < 32 THEN
    RAISE EXCEPTION 'invalid SCIM token' USING ERRCODE = '42501';
  END IF;

  v_hash := encode(extensions.digest(p_raw_token, 'sha256'), 'hex');

  SELECT * INTO v_row FROM public.org_scim_tokens t WHERE t.token_sha256 = v_hash;

  IF NOT FOUND
     OR v_row.revoked_at IS NOT NULL
     OR v_row.expires_at <= now() THEN
    RAISE EXCEPTION 'invalid SCIM token' USING ERRCODE = '42501';
  END IF;

  -- Last-use telemetry, throttled to at most one write a minute per token so
  -- a busy IdP sync does not serialise every request behind one row lock.
  IF v_row.last_used_at IS NULL OR v_row.last_used_at < now() - interval '1 minute' THEN
    UPDATE public.org_scim_tokens SET last_used_at = now() WHERE id = v_row.id;
  END IF;

  RETURN QUERY SELECT v_row.id, v_row.org_id, v_row.connection_id, v_row.scopes;
END
$fn$;

ALTER FUNCTION public.nx_scim_resolve_token(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_scim_resolve_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_scim_resolve_token(text) TO service_role;

COMMENT ON FUNCTION public.nx_scim_resolve_token(text) IS
  'Hashes a presented SCIM bearer token and resolves it to its organization, connection and scopes, rejecting unknown, revoked and expired tokens with an identical error so a caller cannot distinguish the cases. service_role ONLY — reachable by authenticated it would become a token oracle. Records last_used_at, throttled to one write per token per minute so a large IdP sync does not serialise on a single row.';

-- ════════════════════════════════════════════════════════════════════════════
--  K. Role resolution — IdP groups → org_member_role, most privileged wins
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.nx_scim_resolve_role(
  p_connection_id uuid,
  p_groups        text[]
)
RETURNS public.org_member_role
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
DECLARE
  v_role    public.org_member_role;
  v_default public.org_member_role;
BEGIN
  SELECT c.default_member_role INTO v_default
    FROM public.org_sso_connections c WHERE c.id = p_connection_id;

  IF p_groups IS NULL OR array_length(p_groups, 1) IS NULL THEN
    RETURN COALESCE(v_default, 'viewer'::public.org_member_role);
  END IF;

  -- Most privileged mapped group wins. This relies on org_member_role's
  -- DECLARATION ORDER (owner, procurement_admin, project_lead, viewer):
  -- Postgres orders enums by declaration, so ASC is most-privileged-first.
  -- The self-test asserts that order still holds.
  SELECT gm.org_role INTO v_role
    FROM public.org_scim_group_mappings gm
   WHERE gm.connection_id = p_connection_id
     AND gm.is_active
     AND lower(gm.external_group_name) = ANY (
           SELECT lower(g) FROM unnest(p_groups) AS g
         )
   ORDER BY gm.org_role ASC
   LIMIT 1;

  RETURN COALESCE(v_role, v_default, 'viewer'::public.org_member_role);
END
$fn$;

ALTER FUNCTION public.nx_scim_resolve_role(uuid, text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_scim_resolve_role(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_scim_resolve_role(uuid, text[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_scim_resolve_role(uuid, text[]) IS
  'Resolves the IdP group names carried on a SCIM payload to an org_member_role through the explicit org_scim_group_mappings table. An unmapped group grants NOTHING and falls through to the connection default, so adding a group at the IdP can never silently grant NEXPEC privilege. When several mapped groups match, the most privileged wins — which depends on org_member_role''s enum DECLARATION ORDER (owner, procurement_admin, project_lead, viewer); the 20260801472000 self-test asserts that order has not changed. ''owner'' is unreachable here because org_scim_group_mappings forbids it.';

-- ════════════════════════════════════════════════════════════════════════════
--  L. Provisioning — idempotent, mapped onto the EXISTING org_members
--
--  p_user_id must ALREADY exist in public.profiles. This function will not
--  invent a user: creating the auth.users row is GoTrue's job (the Admin API,
--  called from the scim-v2 Edge Function), which then fires handle_new_user()
--  and produces the profiles row. The database never forks the directory.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.nx_scim_provision_user(
  p_raw_token   text,
  p_external_id text,
  p_user_id     uuid,
  p_active      boolean DEFAULT true,
  p_groups      text[] DEFAULT NULL,
  p_request_id  text DEFAULT NULL
)
RETURNS TABLE (
  identity_id  uuid,
  user_id      uuid,
  org_id       uuid,
  was_created  boolean,
  role_applied public.org_member_role,
  is_active    boolean
)
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path = public, extensions, pg_temp
    AS $fn$
DECLARE
  v_tok      record;
  v_existing public.org_scim_identities%ROWTYPE;
  v_ident_id uuid;
  v_created  boolean := false;
  v_role     public.org_member_role;
BEGIN
  SELECT * INTO v_tok FROM public.nx_scim_resolve_token(p_raw_token);

  IF p_external_id IS NULL OR length(btrim(p_external_id)) = 0 THEN
    RAISE EXCEPTION 'SCIM externalId is required' USING ERRCODE = 'check_violation';
  END IF;

  IF v_tok.connection_id IS NULL THEN
    RAISE EXCEPTION 'this SCIM token is not bound to an SSO connection — provisioning needs one for group mapping'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The directory guard: we link to an EXISTING user or we refuse. No branch
  -- of this function can create one.
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION
      'no such NEXPEC user — SCIM links to an existing profile, it never creates one (create the auth user via GoTrue first)'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Takeover guard. If this external id is already bound to a DIFFERENT
  -- NEXPEC account, silently re-pointing it would hand that account to
  -- whoever the IdP now says owns the external id.
  SELECT * INTO v_existing
    FROM public.org_scim_identities i
   WHERE i.connection_id = v_tok.connection_id
     AND i.external_id   = btrim(p_external_id);

  IF FOUND AND v_existing.user_id <> p_user_id THEN
    INSERT INTO public.org_scim_events
      (org_id, connection_id, token_id, operation, resource_type,
       external_id, target_user_id, outcome, http_status, request_id, detail)
    VALUES
      (v_tok.org_id, v_tok.connection_id, v_tok.token_id, 'user.provision', 'User',
       btrim(p_external_id), p_user_id, 'rejected', 409, p_request_id,
       public.nx_scim_redact_detail(jsonb_build_object(
         'reason', 'external_id_already_bound_to_another_user',
         'bound_user_id', v_existing.user_id)));

    RAISE EXCEPTION
      'CONFLICT: externalId % is already bound to a different NEXPEC user — refusing to re-point it (this would be an account takeover)',
      btrim(p_external_id)
      USING ERRCODE = 'unique_violation';
  END IF;

  v_role := public.nx_scim_resolve_role(v_tok.connection_id, p_groups);

  -- Idempotent upsert on (connection_id, external_id): a retried POST resolves
  -- to the same row rather than creating a second one.
  INSERT INTO public.org_scim_identities
    (org_id, connection_id, external_id, user_id, is_active, deactivated_at, last_synced_at)
  VALUES
    (v_tok.org_id, v_tok.connection_id, btrim(p_external_id), p_user_id,
     COALESCE(p_active, true),
     CASE WHEN COALESCE(p_active, true) THEN NULL ELSE now() END,
     now())
  ON CONFLICT (connection_id, external_id) DO UPDATE
     SET is_active      = COALESCE(p_active, true),
         deactivated_at = CASE WHEN COALESCE(p_active, true) THEN NULL ELSE now() END,
         last_synced_at = now(),
         updated_at     = now()
  RETURNING id, (xmax = 0) INTO v_ident_id, v_created;

  IF COALESCE(p_active, true) THEN
    -- Map onto the EXISTING membership table. ON CONFLICT uses the baseline
    -- UNIQUE (org_id, user_id), so a retry updates rather than duplicates.
    INSERT INTO public.org_members (org_id, user_id, role)
    VALUES (v_tok.org_id, p_user_id, v_role)
    ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role;

    -- Re-activation closes any open archive record.
    UPDATE public.org_scim_membership_archive a
       SET restored_at = now()
     WHERE a.org_id = v_tok.org_id
       AND a.user_id = p_user_id
       AND a.restored_at IS NULL;
  ELSE
    PERFORM public.nx_scim_deactivate_membership(
      v_tok.org_id, p_user_id, v_ident_id, 'scim_provision_inactive');
  END IF;

  INSERT INTO public.org_scim_events
    (org_id, connection_id, token_id, operation, resource_type,
     external_id, target_user_id, outcome, http_status, request_id, detail)
  VALUES
    (v_tok.org_id, v_tok.connection_id, v_tok.token_id, 'user.provision', 'User',
     btrim(p_external_id), p_user_id, 'success',
     CASE WHEN v_created THEN 201 ELSE 200 END, p_request_id,
     public.nx_scim_redact_detail(jsonb_build_object(
       'created', v_created,
       'active',  COALESCE(p_active, true),
       'role',    v_role::text,
       'group_count', COALESCE(array_length(p_groups, 1), 0))));

  RETURN QUERY
    SELECT v_ident_id, p_user_id, v_tok.org_id, v_created, v_role, COALESCE(p_active, true);
END
$fn$;

ALTER FUNCTION public.nx_scim_provision_user(text, text, uuid, boolean, text[], text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_scim_provision_user(text, text, uuid, boolean, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_scim_provision_user(text, text, uuid, boolean, text[], text) TO service_role;

COMMENT ON FUNCTION public.nx_scim_provision_user(text, text, uuid, boolean, text[], text) IS
  'The idempotent SCIM provisioning core. Links an IdP externalId to an EXISTING public.profiles row and grants the mapped role in the EXISTING public.org_members table — it creates no user and no directory of its own, and RAISES if the profile does not exist (the auth.users row is GoTrue''s to create, via the Admin API in the scim-v2 Edge Function). Idempotent by construction: UNIQUE (connection_id, external_id) turns a retried POST into an update, and the baseline UNIQUE (org_id, user_id) does the same for membership. REFUSES to re-point an externalId already bound to a different NEXPEC user — that would be account takeover by IdP misconfiguration — and records the refusal. active:false routes to nx_scim_deactivate_membership(), which archives before it removes. service_role only.';

-- ── Deactivation: archive first, then remove. Never destroy. ────────────────
CREATE OR REPLACE FUNCTION public.nx_scim_deactivate_membership(
  p_org_id      uuid,
  p_user_id     uuid,
  p_identity_id uuid DEFAULT NULL,
  p_reason      text DEFAULT 'scim_deprovision'
)
RETURNS boolean
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
DECLARE
  v_member public.org_members%ROWTYPE;
BEGIN
  SELECT * INTO v_member
    FROM public.org_members m
   WHERE m.org_id = p_org_id AND m.user_id = p_user_id;

  -- Idempotent: a retried DELETE on an already-deprovisioned user is a no-op.
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- EVIDENCE FIRST. The membership, its role and its original grant date are
  -- preserved before the row is removed, so the state is exactly restorable.
  INSERT INTO public.org_scim_membership_archive
    (org_id, user_id, identity_id, archived_role, membership_created_at, reason)
  VALUES
    (p_org_id, p_user_id, p_identity_id, v_member.role, v_member.created_at, p_reason);

  -- Only NOW is access revoked. Leaving the row would leave is_member_of_org()
  -- true and RLS still granting — deprovisioning has to actually deprovision.
  DELETE FROM public.org_members m
   WHERE m.org_id = p_org_id AND m.user_id = p_user_id;

  -- Deliberately NOT done: public.profiles is not touched, not suspended and
  -- not deleted; auth.users is not touched; no job, report or evidence row is
  -- touched. They reference profiles.id, which survives, so nothing orphans.

  RETURN true;
END
$fn$;

ALTER FUNCTION public.nx_scim_deactivate_membership(uuid, uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_scim_deactivate_membership(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_scim_deactivate_membership(uuid, uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.nx_scim_deactivate_membership(uuid, uuid, uuid, text) IS
  'Deprovisions one user from one organization: copies the org_members row into org_scim_membership_archive FIRST, then removes it so that is_member_of_org() and every RLS policy built on it genuinely stop granting access. Idempotent — already-removed membership returns false rather than raising or double-archiving. Explicitly does NOT touch public.profiles (no suspension: a person may be an inspector, a supplier and a member of three organizations, and one enterprise removing them must not disable them platform-wide), does NOT touch auth.users, and does NOT touch any business record — those reference profiles.id, which survives, so nothing is orphaned. service_role only.';

-- ── The SCIM DELETE / PATCH active:false entry point ────────────────────────
CREATE OR REPLACE FUNCTION public.nx_scim_deprovision_user(
  p_raw_token   text,
  p_external_id text,
  p_request_id  text DEFAULT NULL
)
RETURNS TABLE (
  identity_id     uuid,
  user_id         uuid,
  membership_removed boolean
)
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path = public, extensions, pg_temp
    AS $fn$
DECLARE
  v_tok     record;
  v_ident   public.org_scim_identities%ROWTYPE;
  v_removed boolean := false;
BEGIN
  SELECT * INTO v_tok FROM public.nx_scim_resolve_token(p_raw_token);

  SELECT * INTO v_ident
    FROM public.org_scim_identities i
   WHERE i.connection_id = v_tok.connection_id
     AND i.external_id   = btrim(COALESCE(p_external_id, ''));

  IF NOT FOUND THEN
    -- SCIM DELETE on an unknown id is a 404 at the HTTP layer; surfaced here
    -- as a no-row return so a retried delete after success stays quiet.
    RETURN;
  END IF;

  v_removed := public.nx_scim_deactivate_membership(
                 v_ident.org_id, v_ident.user_id, v_ident.id, 'scim_deprovision');

  UPDATE public.org_scim_identities
     SET is_active = false, deactivated_at = COALESCE(deactivated_at, now()),
         updated_at = now(), last_synced_at = now()
   WHERE id = v_ident.id;

  INSERT INTO public.org_scim_events
    (org_id, connection_id, token_id, operation, resource_type,
     external_id, target_user_id, outcome, http_status, request_id, detail)
  VALUES
    (v_ident.org_id, v_tok.connection_id, v_tok.token_id, 'user.deprovision', 'User',
     v_ident.external_id, v_ident.user_id,
     CASE WHEN v_removed THEN 'success' ELSE 'noop' END, 204, p_request_id,
     public.nx_scim_redact_detail(jsonb_build_object('membership_removed', v_removed)));

  RETURN QUERY SELECT v_ident.id, v_ident.user_id, v_removed;
END
$fn$;

ALTER FUNCTION public.nx_scim_deprovision_user(text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_scim_deprovision_user(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_scim_deprovision_user(text, text, text) TO service_role;

COMMENT ON FUNCTION public.nx_scim_deprovision_user(text, text, text) IS
  'SCIM DELETE /Users/{id} and PATCH active:false entry point. Archives and removes org membership via nx_scim_deactivate_membership(), marks the identity inactive, and writes an audit row. Fully idempotent: an unknown externalId returns no rows (the Edge Function renders 404), and a repeat delete records a ''noop'' outcome instead of double-archiving. Never deletes the user — see nx_scim_deactivate_membership() for what is deliberately left untouched. service_role only.';

-- ════════════════════════════════════════════════════════════════════════════
--  M. Self-test — the invariants this lane exists to hold
-- ════════════════════════════════════════════════════════════════════════════
DO $selftest$
DECLARE
  v_tbl        text;
  v_new_tables text[] := ARRAY[
    'org_sso_connections', 'org_sso_domains', 'org_scim_tokens',
    'org_scim_group_mappings', 'org_scim_identities',
    'org_scim_membership_archive', 'org_scim_events'
  ];
  v_attr_cols  text[] := ARRAY[
    'email', 'emails', 'user_name', 'username', 'password', 'password_hash',
    'encrypted_password', 'full_name', 'first_name', 'last_name',
    'given_name', 'family_name', 'phone', 'phone_number', 'avatar_url',
    'display_name_scim', 'nick_name', 'locale', 'title'
  ];
  v_bad        text;
  v_provision  text := pg_get_functiondef('public.nx_scim_provision_user(text,text,uuid,boolean,text[],text)'::regprocedure);
  v_deact      text := pg_get_functiondef('public.nx_scim_deactivate_membership(uuid,uuid,uuid,text)'::regprocedure);
  v_issue      text := pg_get_functiondef('public.nx_scim_issue_token(uuid,text,uuid,integer,uuid,integer)'::regprocedure);
  v_enum       text[];
BEGIN
  -- ── 1. Every table this lane promises actually exists.
  FOREACH v_tbl IN ARRAY v_new_tables LOOP
    IF to_regclass('public.' || v_tbl) IS NULL THEN
      RAISE EXCEPTION 'SELFTEST: % was not created', v_tbl;
    END IF;
  END LOOP;

  -- ── 2. NO SECOND USER DIRECTORY. This is the invariant the whole lane is
  --    built around, so it is checked mechanically rather than trusted.
  --
  --    (a) No table created here may carry an identity-attribute column.
  SELECT c.table_name || '.' || c.column_name INTO v_bad
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name = ANY (v_new_tables)
     AND lower(c.column_name) = ANY (v_attr_cols)
   LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'SELFTEST: % is an identity attribute on a SCIM table — this is the second user directory this lane exists to prevent. Read the attribute through public.profiles instead.',
      v_bad;
  END IF;

  --    (b) Every user reference must be a FK to public.profiles(id). A user
  --        column with no FK is a directory in waiting.
  SELECT c.table_name || '.' || c.column_name INTO v_bad
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name = ANY (v_new_tables)
     AND c.column_name IN ('user_id', 'target_user_id', 'created_by',
                           'verified_by', 'revoked_by')
     AND NOT EXISTS (
       SELECT 1
         FROM pg_constraint con
         JOIN pg_attribute att
           ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
        WHERE con.conrelid = ('public.' || c.table_name)::regclass
          AND con.contype = 'f'
          AND con.confrelid = 'public.profiles'::regclass
          AND att.attname = c.column_name
     )
   LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'SELFTEST: % references a user without a foreign key to public.profiles — every SCIM user reference must resolve to the ONE directory',
      v_bad;
  END IF;

  --    (c) The correspondence table must hold exactly the correspondence.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'org_scim_identities'
       AND column_name = 'external_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'org_scim_identities'
       AND column_name = 'user_id'
  ) THEN
    RAISE EXCEPTION 'SELFTEST: org_scim_identities is not a correspondence table any more';
  END IF;

  --    (d) No new table may claim to be a user table by name.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('scim_users', 'sso_users', 'enterprise_users',
                          'idp_users', 'directory_users', 'scim_user_directory')
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: a parallel user table exists — SCIM must map onto public.profiles and public.org_members, never onto a directory of its own';
  END IF;

  -- ── 3. NORMAL AUTHENTICATION PRESERVED. This lane is additive: it must not
  --    have put a trigger on the auth spine or rewritten the profile
  --    bootstrap that every existing sign-in path depends on.
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE NOT t.tgisinternal
       AND t.tgname LIKE '%scim%'
       AND t.tgrelid IN ('public.profiles'::regclass, 'public.org_members'::regclass)
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: this lane attached a SCIM trigger to profiles or org_members — SSO is additive and must not sit in the path of ordinary sign-in';
  END IF;

  IF to_regprocedure('public.handle_new_user()') IS NULL THEN
    RAISE EXCEPTION
      'SELFTEST: handle_new_user() is missing — the ordinary signup path that produces profiles rows was disturbed';
  END IF;

  -- Deprovisioning must never reach profiles.status. A person deprovisioned
  -- by one employer must stay able to sign in and work elsewhere.
  IF v_deact ~* 'profiles' AND v_deact ~* '\mstatus\M' THEN
    RAISE EXCEPTION
      'SELFTEST: deprovisioning writes profiles.status — one organization removing a member must not suspend them platform-wide';
  END IF;
  IF v_deact ~* '\mDELETE\s+FROM\s+public\.profiles\M'
     OR v_provision ~* '\mDELETE\s+FROM\s+public\.profiles\M' THEN
    RAISE EXCEPTION 'SELFTEST: a SCIM function deletes profiles — deprovisioning deactivates, it never destroys';
  END IF;

  -- ── 4. Deprovisioning archives BEFORE it removes.
  IF v_deact !~* 'INSERT INTO public\.org_scim_membership_archive' THEN
    RAISE EXCEPTION 'SELFTEST: deprovisioning no longer archives the membership — history would be destroyed';
  END IF;
  IF position('org_scim_membership_archive' in v_deact)
       > position('DELETE FROM public.org_members' in v_deact)
     AND position('DELETE FROM public.org_members' in v_deact) > 0 THEN
    RAISE EXCEPTION 'SELFTEST: the membership is deleted before it is archived — evidence must be written first';
  END IF;

  -- ── 5. The database never invents a user.
  IF v_provision !~* 'EXISTS \(SELECT 1 FROM public\.profiles' THEN
    RAISE EXCEPTION
      'SELFTEST: provisioning no longer verifies the profile exists — it could fabricate a directory entry';
  END IF;
  IF v_provision ~* '\mINSERT\s+INTO\s+(public\.)?profiles\M'
     OR v_provision ~* '\mINSERT\s+INTO\s+auth\.' THEN
    RAISE EXCEPTION
      'SELFTEST: provisioning writes the user directory directly — creating the auth user is GoTrue''s job';
  END IF;

  -- ── 6. Tokens are hashed, bounded and never stored raw.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'org_scim_tokens'
       AND lower(column_name) IN ('token', 'raw_token', 'secret', 'token_plain', 'client_secret')
  ) THEN
    RAISE EXCEPTION 'SELFTEST: org_scim_tokens holds a raw secret column — only sha256(raw) may be stored';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'org_scim_tokens'
       AND indexname = 'org_scim_tokens_sha256_key'
  ) THEN
    RAISE EXCEPTION 'SELFTEST: the SCIM token hash is not uniquely indexed — resolve would be ambiguous';
  END IF;
  IF v_issue !~* 'gen_random_bytes' THEN
    RAISE EXCEPTION 'SELFTEST: SCIM tokens are not minted from a CSPRNG';
  END IF;
  IF v_issue !~* 'digest' THEN
    RAISE EXCEPTION 'SELFTEST: the issuing function does not hash the token before storing it';
  END IF;
  -- Rotation must exist and must not be a synonym for instant revocation.
  IF v_issue !~* 'rotated_from_id' THEN
    RAISE EXCEPTION 'SELFTEST: token rotation was removed';
  END IF;

  -- No SSO/SCIM table may store IdP secret material.
  SELECT c.table_name || '.' || c.column_name INTO v_bad
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name = ANY (v_new_tables)
     AND lower(c.column_name) ~ '(client_secret|private_key|signing_key|certificate_key|idp_secret)'
   LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'SELFTEST: % stores IdP secret material — signing keys and client secrets belong to GoTrue or the vault, never an application table', v_bad;
  END IF;

  -- ── 7. Idempotency is structural.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'org_scim_identities'
       AND indexname = 'org_scim_identities_conn_external_key'
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: UNIQUE (connection_id, external_id) is gone — a retried SCIM POST would create a duplicate identity';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'org_scim_identities'
       AND indexname = 'org_scim_identities_conn_user_key'
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: UNIQUE (connection_id, user_id) is gone — two IdP records could claim the same NEXPEC user';
  END IF;
  IF v_provision !~* 'ON CONFLICT' THEN
    RAISE EXCEPTION 'SELFTEST: provisioning is no longer an upsert — IdPs retry writes by contract';
  END IF;
  -- Domain exclusivity: without this one tenant could capture another's users.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'org_sso_domains'
       AND indexname = 'org_sso_domains_domain_key'
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: SSO domains are no longer globally unique — two organizations could claim the same domain and capture each other''s users';
  END IF;

  -- ── 8. Privilege escalation stays closed in both places.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.org_scim_group_mappings'::regclass
       AND conname  = 'org_scim_group_mappings_no_owner'
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: an IdP group can now map to org owner — organization ownership must never be inherited from a directory group';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.org_sso_connections'::regclass
       AND conname  = 'org_sso_connections_default_profile_role_check'
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: the provisioned profile role is unconstrained — SCIM could mint a platform admin';
  END IF;

  -- Role precedence depends on enum DECLARATION ORDER, so pin it.
  SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) INTO v_enum
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'org_member_role';
  IF v_enum IS DISTINCT FROM
     ARRAY['owner', 'procurement_admin', 'project_lead', 'viewer'] THEN
    RAISE EXCEPTION
      'SELFTEST: org_member_role declaration order changed (now %) — nx_scim_resolve_role() picks the most privileged mapped group by enum order and would now pick the wrong one', v_enum;
  END IF;

  -- ── 9. RLS on every new table, admin branch on every policy, nothing to anon.
  FOREACH v_tbl IN ARRAY v_new_tables LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_tbl)::regclass) THEN
      RAISE EXCEPTION 'SELFTEST: RLS is not enabled on %', v_tbl;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = v_tbl) THEN
      RAISE EXCEPTION 'SELFTEST: % has RLS enabled but no policy — it is silently unreadable', v_tbl;
    END IF;
    IF has_table_privilege('anon', 'public.' || v_tbl, 'SELECT')
       OR has_table_privilege('anon', 'public.' || v_tbl, 'INSERT')
       OR has_table_privilege('anon', 'public.' || v_tbl, 'UPDATE')
       OR has_table_privilege('anon', 'public.' || v_tbl, 'DELETE') THEN
      RAISE EXCEPTION 'SELFTEST: anon has reach on % — no GRANT to anon in this lane', v_tbl;
    END IF;
    -- History and configuration are never rewritable through PostgREST.
    IF has_table_privilege('authenticated', 'public.' || v_tbl, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || v_tbl, 'DELETE')
       OR has_table_privilege('authenticated', 'public.' || v_tbl, 'INSERT') THEN
      RAISE EXCEPTION
        'SELFTEST: authenticated can write % directly — every write path in this lane must go through a SECURITY DEFINER RPC', v_tbl;
    END IF;
  END LOOP;

  -- The token digest must not be selectable by authenticated even though the
  -- rest of the row is.
  IF has_column_privilege('authenticated', 'public.org_scim_tokens', 'token_sha256', 'SELECT') THEN
    RAISE EXCEPTION
      'SELFTEST: authenticated can select org_scim_tokens.token_sha256 — the digest is withheld by column-level grant';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.org_scim_tokens', 'token_prefix', 'SELECT') THEN
    RAISE EXCEPTION
      'SELFTEST: the token roster is unreadable by its own organization admin — column grants were over-tightened';
  END IF;

  -- ── 10. The token oracle stays shut, and service_role can still work.
  IF has_function_privilege('authenticated', 'public.nx_scim_resolve_token(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.nx_scim_resolve_token(text)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'SELFTEST: nx_scim_resolve_token is reachable by an end user — it would be a token oracle';
  END IF;
  IF has_function_privilege('authenticated', 'public.nx_scim_provision_user(text,text,uuid,boolean,text[],text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.nx_scim_provision_user(text,text,uuid,boolean,text[],text)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'SELFTEST: provisioning is reachable by an end user — an authenticated caller could grant themselves org membership';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.org_scim_events', 'INSERT') THEN
    RAISE EXCEPTION 'SELFTEST: service_role cannot write the audit trail — provisioning would run unlogged';
  END IF;

  -- ── 11. search_path pinned on every function this lane adds.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('nx_is_org_identity_admin', 'nx_scim_redact_detail',
                         'nx_scim_issue_token', 'nx_scim_revoke_token',
                         'nx_scim_resolve_token', 'nx_scim_resolve_role',
                         'nx_scim_provision_user', 'nx_scim_deactivate_membership',
                         'nx_scim_deprovision_user')
       AND (
         array_to_string(COALESCE(p.proconfig, '{}'::text[]), ',') !~ '^search_path='
         OR array_to_string(COALESCE(p.proconfig, '{}'::text[]), ',') !~ '\mpublic\M'
         OR array_to_string(COALESCE(p.proconfig, '{}'::text[]), ',') !~ '\mpg_temp\M'
       )
  ) THEN
    RAISE EXCEPTION 'SELFTEST: a function added here does not pin search_path to public, pg_temp';
  END IF;

  -- ── 12. The audit trail is append-only and cannot become an attribute store.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'org_scim_events'
       AND cmd IN ('UPDATE', 'DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: org_scim_events gained an UPDATE/DELETE policy — provisioning history must be immutable';
  END IF;
  IF v_provision !~* 'nx_scim_redact_detail' THEN
    RAISE EXCEPTION
      'SELFTEST: provisioning writes unredacted audit detail — the events table would become the second directory by the back door';
  END IF;

  -- ── 13. This lane changed nothing that already existed.
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'org_members') THEN
    RAISE EXCEPTION 'SELFTEST: org_members lost its policies — this lane must not reshape existing RLS';
  END IF;
  IF to_regprocedure('public.is_member_of_org(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'SELFTEST: is_member_of_org() is gone — the canonical org predicate must survive untouched (deprovisioning depends on it meaning what it always meant)';
  END IF;

  RAISE NOTICE 'enterprise SSO + SCIM: 7 tables, 9 functions, RLS everywhere, no second user directory (SCIM maps onto profiles + org_members), tokens sha256-only with bounded lifetime and rotation, deprovisioning archives before it removes, normal authentication untouched.';
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
