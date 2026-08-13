// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/scim-v2/index.ts
//
//  SCIM 2.0 provisioning endpoint (RFC 7643 schema / RFC 7644 protocol).
//
//  The IdP-facing half of the enterprise SSO lane. Its schema, RPCs, RLS and
//  audit trail live in supabase/migrations/20260801472000_enterprise_sso_scim.sql
//  — read that file's header first; it explains why this endpoint stores no
//  user attributes of its own.
//
//  ── THE ONE RULE ───────────────────────────────────────────────────────────
//  NO SECOND USER DIRECTORY. Every SCIM attribute is read through to, and
//  written through to, the EXISTING spine:
//
//      SCIM id        → public.profiles.id (which IS the auth.users id)
//      SCIM userName  → public.profiles.email          (UNIQUE, baseline:25783)
//      SCIM name.*    → public.profiles.first_name / last_name / full_name
//      SCIM active    → membership in public.org_members
//      SCIM externalId→ public.org_scim_identities (correspondence ONLY)
//
//  This function never invents a user. When userName does not resolve to an
//  existing profile it asks GoTrue to create the auth user through the Admin
//  API, and GoTrue's handle_new_user() trigger produces the profiles row. The
//  provisioning RPC then links the IdP's externalId to that profile and grants
//  the mapped role in org_members. There is exactly one directory throughout.
//
//  ── AUTH ───────────────────────────────────────────────────────────────────
//  Authorization: Bearer <SCIM token>. The token is NOT a Supabase JWT — it is
//  the per-organization credential minted by nx_scim_issue_token(), stored only
//  as sha256, and resolved here through nx_scim_resolve_token(), which rejects
//  unknown, revoked and expired tokens with an identical error so a caller
//  cannot tell the cases apart. The token determines the organization; nothing
//  in the request body can widen that scope, so one tenant's IdP can never
//  write into another tenant.
//
//  ⚠ REQUIRED DEPLOY STEP, NOT DONE BY THIS LANE
//    supabase/config.toml needs:
//
//        [functions.scim-v2]
//        enabled = true
//        verify_jwt = false   # IdPs present a SCIM bearer token, not a JWT
//
//    That file belongs to another owner, so this lane does not edit it. Until
//    it is added, every IdP request 401s at the platform edge before reaching
//    this code. This is a hard blocker for go-live and is reported as one.
//
//  ── IDEMPOTENCY ────────────────────────────────────────────────────────────
//  IdPs retry writes by contract. Idempotency here is structural, not a replay
//  cache: UNIQUE (connection_id, external_id) collapses a retried POST onto the
//  same identity, the baseline UNIQUE (org_id, user_id) does the same for
//  membership, and a repeated DELETE is a recorded no-op rather than a 404.
//
//  ── WHAT IS DELIBERATELY NOT IMPLEMENTED ───────────────────────────────────
//  Group WRITE (PATCH /Groups/{id} with members add/remove) returns 501. Role
//  assignment is driven by the `groups` attribute on the User resource, mapped
//  through the explicit, admin-authored org_scim_group_mappings table. Pushing
//  group membership as a separate mutable resource would mean this endpoint
//  storing group state — a second directory for groups, with the same drift
//  problem. Entra ID deployments must therefore assign roles via the user's
//  groups attribute or via the NEXPEC admin console. Advertised honestly in
//  /ServiceProviderConfig rather than half-implemented.
//
//  ⚠ UNTESTED AGAINST A REAL IdP. No IdP tenant and no credentials were
//    available while writing this. The wire format follows RFC 7643/7644 and
//    is exercised by fixtures, but no Okta, Entra ID or OneLogin sync has ever
//    run against it. Treat first connection as integration work, not smoke
//    testing.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const SCIM_CONTENT_TYPE = 'application/scim+json';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

// ── SCIM envelopes ──────────────────────────────────────────────────────────

const SCHEMA_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCHEMA_GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const SCHEMA_LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCHEMA_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';
const SCHEMA_PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

function scimJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': SCIM_CONTENT_TYPE },
  });
}

/** RFC 7644 §3.12 error envelope. `scimType` is omitted when not applicable. */
function scimError(status: number, detail: string, scimType?: string): Response {
  const body: Record<string, unknown> = {
    schemas: [SCHEMA_ERROR],
    status: String(status),
    detail,
  };
  if (scimType) body.scimType = scimType;
  return scimJson(status, body);
}

// ── Types ───────────────────────────────────────────────────────────────────

interface TokenContext {
  token_id: string;
  org_id: string;
  connection_id: string | null;
  scopes: string[];
  /**
   * The raw presented token, carried ON THE REQUEST CONTEXT and never in a
   * module-level variable. Deno reuses one isolate across concurrent requests,
   * so a module-scoped "current token" would be overwritten by whichever
   * request ran last — and since the token is what determines the ORGANIZATION,
   * that is cross-tenant contamination: request A could provision into
   * request B's tenant. Threading it through the context makes that
   * structurally impossible.
   */
  rawToken: string;
}

interface ProfileRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
}

interface IdentityRow {
  id: string;
  external_id: string;
  user_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Resource rendering — every field read through from the ONE directory ────

function renderUser(
  profile: ProfileRow,
  identity: IdentityRow | null,
  active: boolean,
  role: string | null,
): Record<string, unknown> {
  const given = profile.first_name ?? '';
  const family = profile.last_name ?? '';
  const display =
    profile.full_name ?? [given, family].filter(Boolean).join(' ') ?? profile.email;

  return {
    schemas: [SCHEMA_USER],
    id: profile.id,
    externalId: identity?.external_id ?? undefined,
    userName: profile.email,
    name: {
      givenName: given || undefined,
      familyName: family || undefined,
      formatted: display || undefined,
    },
    displayName: display || undefined,
    emails: [{ value: profile.email, primary: true, type: 'work' }],
    active,
    // The mapped org role, surfaced read-only so an IdP admin can confirm what
    // their group mapping actually produced.
    roles: role ? [{ value: role, primary: true }] : [],
    meta: {
      resourceType: 'User',
      created: identity?.created_at ?? undefined,
      lastModified: identity?.updated_at ?? undefined,
      location: `/scim-v2/Users/${profile.id}`,
    },
  };
}

function listResponse(resources: unknown[], startIndex: number, total: number) {
  return {
    schemas: [SCHEMA_LIST],
    totalResults: total,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse the narrow slice of SCIM filter grammar an IdP actually sends for
 * user lookup: `userName eq "x"` / `externalId eq "x"`. Anything else is
 * rejected rather than guessed at — a filter we silently mis-parse would
 * return the WRONG user to an IdP that then overwrites them.
 */
function parseEqFilter(
  filter: string | null,
): { attr: 'userName' | 'externalId'; value: string } | null {
  if (!filter) return null;
  const m = filter.match(/^\s*(userName|externalId)\s+eq\s+"([^"]*)"\s*$/i);
  if (!m) return null;
  const attr = m[1].toLowerCase() === 'username' ? 'userName' : 'externalId';
  return { attr, value: m[2] };
}

function normaliseEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return s.length > 3 && s.includes('@') ? s : null;
}

/** SCIM `groups` may be strings or {value,display} objects depending on IdP. */
function extractGroups(body: Record<string, unknown>): string[] {
  const raw = body.groups;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const g of raw) {
    if (typeof g === 'string') out.push(g);
    else if (g && typeof g === 'object') {
      const o = g as Record<string, unknown>;
      const v = o.display ?? o.value;
      if (typeof v === 'string') out.push(v);
    }
  }
  return out.filter(Boolean);
}

async function resolveToken(req: Request): Promise<TokenContext | null> {
  const header = req.headers.get('authorization') ?? '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  const raw = m[1].trim();
  const { data, error } = await admin.rpc('nx_scim_resolve_token', {
    p_raw_token: raw,
  });
  if (error || !data || (Array.isArray(data) && data.length === 0)) return null;

  const row = Array.isArray(data) ? data[0] : data;
  return {
    token_id: row.token_id,
    org_id: row.org_id,
    connection_id: row.connection_id ?? null,
    scopes: row.scopes ?? [],
    rawToken: raw,
  };
}

async function getProfileByEmail(email: string): Promise<ProfileRow | null> {
  const { data } = await admin
    .from('profiles')
    .select('id, email, first_name, last_name, full_name')
    .eq('email', email)
    .maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

async function getProfileById(id: string): Promise<ProfileRow | null> {
  const { data } = await admin
    .from('profiles')
    .select('id, email, first_name, last_name, full_name')
    .eq('id', id)
    .maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

async function getIdentityByExternalId(
  connectionId: string,
  externalId: string,
): Promise<IdentityRow | null> {
  const { data } = await admin
    .from('org_scim_identities')
    .select('id, external_id, user_id, is_active, created_at, updated_at')
    .eq('connection_id', connectionId)
    .eq('external_id', externalId)
    .maybeSingle();
  return (data as IdentityRow | null) ?? null;
}

async function getIdentityByUserId(
  connectionId: string,
  userId: string,
): Promise<IdentityRow | null> {
  const { data } = await admin
    .from('org_scim_identities')
    .select('id, external_id, user_id, is_active, created_at, updated_at')
    .eq('connection_id', connectionId)
    .eq('user_id', userId)
    .maybeSingle();
  return (data as IdentityRow | null) ?? null;
}

async function getMemberRole(orgId: string, userId: string): Promise<string | null> {
  const { data } = await admin
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  return (data as { role: string } | null)?.role ?? null;
}

/**
 * Ask GoTrue to create the auth user. The profiles row is produced by the
 * handle_new_user() trigger on auth.users. That trigger is managed in the auth
 * schema and is not part of this repository's migration chain, so we verify
 * the row landed and, only if it did not, write it ourselves — into
 * public.profiles, THE directory, keyed on the auth user id. Under no
 * circumstance is a separate identity record created.
 */
async function ensureUser(
  email: string,
  givenName: string | null,
  familyName: string | null,
  profileRole: string,
): Promise<{ profile: ProfileRow | null; error: string | null }> {
  const existing = await getProfileByEmail(email);
  if (existing) return { profile: existing, error: null };

  const fullName = [givenName, familyName].filter(Boolean).join(' ') || null;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { role: profileRole, full_name: fullName },
  });

  if (createErr || !created?.user) {
    return { profile: null, error: createErr?.message ?? 'could not create the user' };
  }

  const viaTrigger = await getProfileById(created.user.id);
  if (viaTrigger) return { profile: viaTrigger, error: null };

  // Trigger absent — write the ONE directory row directly.
  const { error: insErr } = await admin.from('profiles').insert({
    id: created.user.id,
    email,
    role: profileRole,
    full_name: fullName,
    first_name: givenName,
    last_name: familyName,
  });
  if (insErr) return { profile: null, error: insErr.message };

  return { profile: await getProfileById(created.user.id), error: null };
}

/** Write name changes through to the directory. Never stored locally. */
async function applyNameToProfile(
  userId: string,
  givenName: string | null,
  familyName: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (givenName !== null) patch.first_name = givenName;
  if (familyName !== null) patch.last_name = familyName;
  if (givenName !== null || familyName !== null) {
    const full = [givenName, familyName].filter(Boolean).join(' ');
    if (full) patch.full_name = full;
  }
  if (Object.keys(patch).length === 0) return;
  await admin.from('profiles').update(patch).eq('id', userId);
}

async function logEvent(
  ctx: TokenContext,
  operation: string,
  outcome: 'success' | 'noop' | 'rejected' | 'error',
  httpStatus: number,
  detail: Record<string, unknown>,
  externalId?: string | null,
  targetUserId?: string | null,
  requestId?: string | null,
): Promise<void> {
  // Best effort: an audit write must never turn a successful provisioning call
  // into a failed one, but a silent failure is how audit trails rot, so the
  // reason is surfaced in the function logs.
  const { error } = await admin.from('org_scim_events').insert({
    org_id: ctx.org_id,
    connection_id: ctx.connection_id,
    token_id: ctx.token_id,
    operation,
    resource_type: 'User',
    external_id: externalId ?? null,
    target_user_id: targetUserId ?? null,
    outcome,
    http_status: httpStatus,
    request_id: requestId ?? null,
    detail,
  });
  if (error) console.error('scim-v2 audit write failed', operation, error.message);
}

// ── Discovery endpoints (RFC 7644 §4) ───────────────────────────────────────

function serviceProviderConfig() {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: 'https://nexpec.com/docs/scim',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    // Only `userName eq` / `externalId eq` are parsed; see parseEqFilter.
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description:
          'Per-organization SCIM token issued in the NEXPEC admin console. Stored hashed; rotatable with an overlap window.',
        primary: true,
      },
    ],
  };
}

function resourceTypes() {
  return listResponse(
    [
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'User',
        name: 'User',
        endpoint: '/Users',
        schema: SCHEMA_USER,
        meta: { resourceType: 'ResourceType', location: '/scim-v2/ResourceTypes/User' },
      },
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'Group',
        name: 'Group',
        endpoint: '/Groups',
        schema: SCHEMA_GROUP,
        meta: { resourceType: 'ResourceType', location: '/scim-v2/ResourceTypes/Group' },
      },
    ],
    1,
    2,
  );
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleGetUsers(ctx: TokenContext, url: URL): Promise<Response> {
  if (!ctx.connection_id) {
    return scimError(400, 'this SCIM token is not bound to an SSO connection');
  }

  const filter = parseEqFilter(url.searchParams.get('filter'));
  const startIndex = Math.max(1, Number(url.searchParams.get('startIndex') ?? '1') || 1);
  const count = Math.min(200, Math.max(0, Number(url.searchParams.get('count') ?? '100') || 100));

  if (url.searchParams.get('filter') && !filter) {
    return scimError(
      400,
      'only `userName eq "..."` and `externalId eq "..."` filters are supported',
      'invalidFilter',
    );
  }

  // Filtered lookup — the path an IdP uses before every create.
  if (filter) {
    let identity: IdentityRow | null = null;
    let profile: ProfileRow | null = null;

    if (filter.attr === 'externalId') {
      identity = await getIdentityByExternalId(ctx.connection_id, filter.value);
      if (identity) profile = await getProfileById(identity.user_id);
    } else {
      const email = normaliseEmail(filter.value);
      if (email) {
        profile = await getProfileByEmail(email);
        if (profile) identity = await getIdentityByUserId(ctx.connection_id, profile.id);
      }
    }

    // A profile that exists but has no identity in THIS connection is not a
    // member of this tenant's directory view — return empty rather than leak
    // the existence of a NEXPEC account belonging to someone else.
    if (!profile || !identity) return scimJson(200, listResponse([], startIndex, 0));

    const role = await getMemberRole(ctx.org_id, profile.id);
    return scimJson(
      200,
      listResponse([renderUser(profile, identity, identity.is_active, role)], startIndex, 1),
    );
  }

  // Unfiltered list, scoped to this connection only.
  const { data: idents, count: total } = await admin
    .from('org_scim_identities')
    .select('id, external_id, user_id, is_active, created_at, updated_at', { count: 'exact' })
    .eq('connection_id', ctx.connection_id)
    .order('created_at', { ascending: true })
    .range(startIndex - 1, startIndex - 2 + Math.max(count, 1));

  const rows = (idents as IdentityRow[] | null) ?? [];
  const resources: unknown[] = [];
  for (const ident of rows) {
    const profile = await getProfileById(ident.user_id);
    if (!profile) continue;
    const role = await getMemberRole(ctx.org_id, ident.user_id);
    resources.push(renderUser(profile, ident, ident.is_active, role));
  }

  return scimJson(200, listResponse(resources, startIndex, total ?? resources.length));
}

async function handleGetUser(ctx: TokenContext, id: string): Promise<Response> {
  if (!ctx.connection_id) {
    return scimError(400, 'this SCIM token is not bound to an SSO connection');
  }
  const identity = await getIdentityByUserId(ctx.connection_id, id);
  if (!identity) return scimError(404, `no such user: ${id}`);

  const profile = await getProfileById(identity.user_id);
  if (!profile) return scimError(404, `no such user: ${id}`);

  const role = await getMemberRole(ctx.org_id, profile.id);
  return scimJson(200, renderUser(profile, identity, identity.is_active, role));
}

async function handleCreateUser(
  ctx: TokenContext,
  body: Record<string, unknown>,
  requestId: string | null,
): Promise<Response> {
  if (!ctx.connection_id) {
    return scimError(400, 'this SCIM token is not bound to an SSO connection');
  }

  const email = normaliseEmail(body.userName ?? (body.emails as unknown));
  if (!email) {
    return scimError(400, 'userName must be the user’s email address', 'invalidValue');
  }

  const externalId =
    typeof body.externalId === 'string' && body.externalId.trim()
      ? body.externalId.trim()
      : email;

  const name = (body.name ?? {}) as Record<string, unknown>;
  const givenName = typeof name.givenName === 'string' ? name.givenName : null;
  const familyName = typeof name.familyName === 'string' ? name.familyName : null;
  const active = body.active === undefined ? true : Boolean(body.active);

  // Which profiles.role a user provisioned through this connection gets. The
  // column is CHECK-constrained to the four public-signup roles, so no IdP can
  // steer this to admin.
  const { data: conn } = await admin
    .from('org_sso_connections')
    .select('default_profile_role')
    .eq('id', ctx.connection_id)
    .maybeSingle();
  const profileRole =
    (conn as { default_profile_role: string } | null)?.default_profile_role ?? 'client';

  const { profile, error: ensureErr } = await ensureUser(
    email,
    givenName,
    familyName,
    profileRole,
  );
  if (!profile) {
    await logEvent(ctx, 'user.create', 'error', 500, { reason: 'user_create_failed' }, externalId, null, requestId);
    return scimError(500, ensureErr ?? 'could not resolve the user');
  }

  await applyNameToProfile(profile.id, givenName, familyName);

  const { data, error } = await admin.rpc('nx_scim_provision_user', {
    p_raw_token: ctx.rawToken,
    p_external_id: externalId,
    p_user_id: profile.id,
    p_active: active,
    p_groups: extractGroups(body),
    p_request_id: requestId,
  });

  if (error) {
    // 23505 is the takeover guard: this externalId already belongs to someone
    // else. RFC 7644 §3.3 calls for 409 uniqueness.
    const conflict = error.code === '23505' || /already bound/i.test(error.message);
    return scimError(
      conflict ? 409 : 400,
      error.message,
      conflict ? 'uniqueness' : 'invalidValue',
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  const identity = await getIdentityByUserId(ctx.connection_id, profile.id);
  const fresh = (await getProfileById(profile.id)) ?? profile;

  return scimJson(
    row?.was_created ? 201 : 200,
    renderUser(fresh, identity, Boolean(row?.is_active ?? active), row?.role_applied ?? null),
  );
}

async function handleReplaceUser(
  ctx: TokenContext,
  id: string,
  body: Record<string, unknown>,
  requestId: string | null,
): Promise<Response> {
  if (!ctx.connection_id) {
    return scimError(400, 'this SCIM token is not bound to an SSO connection');
  }
  const identity = await getIdentityByUserId(ctx.connection_id, id);
  if (!identity) return scimError(404, `no such user: ${id}`);

  const name = (body.name ?? {}) as Record<string, unknown>;
  const givenName = typeof name.givenName === 'string' ? name.givenName : null;
  const familyName = typeof name.familyName === 'string' ? name.familyName : null;
  const active = body.active === undefined ? identity.is_active : Boolean(body.active);

  await applyNameToProfile(identity.user_id, givenName, familyName);

  const { data, error } = await admin.rpc('nx_scim_provision_user', {
    p_raw_token: ctx.rawToken,
    p_external_id: identity.external_id,
    p_user_id: identity.user_id,
    p_active: active,
    p_groups: extractGroups(body),
    p_request_id: requestId,
  });
  if (error) return scimError(400, error.message, 'invalidValue');

  const row = Array.isArray(data) ? data[0] : data;
  const profile = await getProfileById(identity.user_id);
  if (!profile) return scimError(404, `no such user: ${id}`);

  const refreshed = await getIdentityByUserId(ctx.connection_id, id);
  return scimJson(200, renderUser(profile, refreshed, Boolean(row?.is_active ?? active), row?.role_applied ?? null));
}

/**
 * PATCH. The operations an IdP actually sends are `active` toggles and name
 * updates; both are applied. `path` may be absent with a value object (Okta's
 * shape) or present as a plain attribute name (Entra ID's shape) — both are
 * handled. Unrecognised paths are ignored rather than rejected, because a
 * hard failure on an attribute we do not model would stall the whole sync.
 */
async function handlePatchUser(
  ctx: TokenContext,
  id: string,
  body: Record<string, unknown>,
  requestId: string | null,
): Promise<Response> {
  if (!ctx.connection_id) {
    return scimError(400, 'this SCIM token is not bound to an SSO connection');
  }
  const identity = await getIdentityByUserId(ctx.connection_id, id);
  if (!identity) return scimError(404, `no such user: ${id}`);

  const ops = Array.isArray(body.Operations) ? body.Operations : [];
  if (ops.length === 0) return scimError(400, 'PatchOp requires at least one operation', 'invalidValue');

  let active: boolean | null = null;
  let givenName: string | null = null;
  let familyName: string | null = null;
  let groups: string[] | null = null;

  for (const raw of ops) {
    const op = (raw ?? {}) as Record<string, unknown>;
    const verb = String(op.op ?? '').toLowerCase();
    if (verb !== 'replace' && verb !== 'add') continue;

    const path = typeof op.path === 'string' ? op.path.toLowerCase() : null;
    const value = op.value;

    if (path === 'active') {
      active = typeof value === 'string' ? value.toLowerCase() === 'true' : Boolean(value);
    } else if (path === 'name.givenname' && typeof value === 'string') {
      givenName = value;
    } else if (path === 'name.familyname' && typeof value === 'string') {
      familyName = value;
    } else if (!path && value && typeof value === 'object') {
      // Okta shape: {op:'replace', value:{active:false, ...}}
      const v = value as Record<string, unknown>;
      if (v.active !== undefined) {
        active = typeof v.active === 'string' ? v.active.toLowerCase() === 'true' : Boolean(v.active);
      }
      const n = (v.name ?? {}) as Record<string, unknown>;
      if (typeof n.givenName === 'string') givenName = n.givenName;
      if (typeof n.familyName === 'string') familyName = n.familyName;
      if (Array.isArray(v.groups)) groups = extractGroups(v);
    }
  }

  await applyNameToProfile(identity.user_id, givenName, familyName);

  // Deactivation takes the archive-then-remove path; anything else re-runs the
  // idempotent provisioning upsert.
  if (active === false) {
    const { error } = await admin.rpc('nx_scim_deprovision_user', {
      p_raw_token: ctx.rawToken,
      p_external_id: identity.external_id,
      p_request_id: requestId,
    });
    if (error) return scimError(400, error.message);
  } else {
    const { error } = await admin.rpc('nx_scim_provision_user', {
      p_raw_token: ctx.rawToken,
      p_external_id: identity.external_id,
      p_user_id: identity.user_id,
      p_active: active === null ? identity.is_active : active,
      p_groups: groups,
      p_request_id: requestId,
    });
    if (error) return scimError(400, error.message, 'invalidValue');
  }

  const profile = await getProfileById(identity.user_id);
  if (!profile) return scimError(404, `no such user: ${id}`);
  const refreshed = await getIdentityByUserId(ctx.connection_id, id);
  const role = await getMemberRole(ctx.org_id, identity.user_id);
  return scimJson(200, renderUser(profile, refreshed, refreshed?.is_active ?? false, role));
}

async function handleDeleteUser(
  ctx: TokenContext,
  id: string,
  requestId: string | null,
): Promise<Response> {
  if (!ctx.connection_id) {
    return scimError(400, 'this SCIM token is not bound to an SSO connection');
  }
  const identity = await getIdentityByUserId(ctx.connection_id, id);
  // Idempotent: a repeated DELETE after success must not 500.
  if (!identity) return scimError(404, `no such user: ${id}`);

  const { error } = await admin.rpc('nx_scim_deprovision_user', {
    p_raw_token: ctx.rawToken,
    p_external_id: identity.external_id,
    p_request_id: requestId,
  });
  if (error) return scimError(400, error.message);

  // 204 No Content. The NEXPEC account itself still exists and is untouched —
  // SCIM DELETE removes org membership, it does not delete a human.
  return new Response(null, { status: 204, headers: cors });
}

async function handleGetGroups(ctx: TokenContext, startIndex: number): Promise<Response> {
  if (!ctx.connection_id) {
    return scimError(400, 'this SCIM token is not bound to an SSO connection');
  }
  const { data } = await admin
    .from('org_scim_group_mappings')
    .select('id, external_group_id, external_group_name, org_role')
    .eq('connection_id', ctx.connection_id)
    .eq('is_active', true);

  const rows =
    (data as
      | { id: string; external_group_id: string | null; external_group_name: string; org_role: string }[]
      | null) ?? [];

  const resources = rows.map((g) => ({
    schemas: [SCHEMA_GROUP],
    id: g.id,
    externalId: g.external_group_id ?? undefined,
    displayName: g.external_group_name,
    // Members are deliberately not enumerated — see the header note on why
    // Groups is read-only here.
    members: [],
    meta: { resourceType: 'Group', location: `/scim-v2/Groups/${g.id}` },
  }));

  return scimJson(200, listResponse(resources, startIndex, resources.length));
}

// ── Router ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = new URL(req.url);
  const requestId = req.headers.get('x-request-id');

  // Strip the function mount point so both /scim-v2/Users and /Users work.
  const path = url.pathname.replace(/^\/functions\/v1/, '').replace(/^\/scim-v2/, '') || '/';
  const segments = path.split('/').filter(Boolean);
  const resource = segments[0] ?? '';
  const resourceId = segments[1] ?? null;

  // Discovery is unauthenticated by RFC 7644 §4 convention and reveals nothing
  // tenant-specific.
  if (req.method === 'GET' && resource === 'ServiceProviderConfig') {
    return scimJson(200, serviceProviderConfig());
  }
  if (req.method === 'GET' && resource === 'ResourceTypes') {
    return scimJson(200, resourceTypes());
  }

  // resolveToken() returns the raw token ON the context, so nothing about the
  // caller's credential is ever held in module scope where a concurrent
  // request in the same isolate could read or overwrite it.
  const ctx = await resolveToken(req);
  if (!ctx) {
    return scimError(401, 'invalid or expired SCIM bearer token');
  }

  let body: Record<string, unknown> = {};
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return scimError(400, 'request body is not valid JSON', 'invalidSyntax');
    }
    if (req.method === 'PATCH') {
      const schemas = Array.isArray(body.schemas) ? body.schemas : [];
      if (schemas.length && !schemas.includes(SCHEMA_PATCH)) {
        return scimError(400, `PATCH requires the ${SCHEMA_PATCH} schema`, 'invalidSyntax');
      }
    }
  }

  try {
    if (resource === 'Users') {
      if (req.method === 'GET' && !resourceId) return await handleGetUsers(ctx, url);
      if (req.method === 'GET' && resourceId) return await handleGetUser(ctx, resourceId);
      if (req.method === 'POST' && !resourceId) return await handleCreateUser(ctx, body, requestId);
      if (req.method === 'PUT' && resourceId) return await handleReplaceUser(ctx, resourceId, body, requestId);
      if (req.method === 'PATCH' && resourceId) return await handlePatchUser(ctx, resourceId, body, requestId);
      if (req.method === 'DELETE' && resourceId) return await handleDeleteUser(ctx, resourceId, requestId);
      return scimError(405, `${req.method} is not supported on /Users`);
    }

    if (resource === 'Groups') {
      const startIndex = Math.max(1, Number(url.searchParams.get('startIndex') ?? '1') || 1);
      if (req.method === 'GET') return await handleGetGroups(ctx, startIndex);
      // Honest 501 rather than a half-working group writer — see the header.
      return scimError(
        501,
        'group write is not implemented: assign roles through the user’s groups attribute, mapped in the NEXPEC admin console',
      );
    }

    return scimError(404, `unknown SCIM resource: /${resource}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('scim-v2 unhandled', message);
    await logEvent(ctx, `${req.method.toLowerCase()}.${resource}`, 'error', 500, {
      reason: 'unhandled_exception',
    }, null, null, requestId);
    return scimError(500, 'internal error');
  }
});
