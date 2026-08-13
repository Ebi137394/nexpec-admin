// ════════════════════════════════════════════════════════════════════════════
//  app/admin/sso/page.tsx — Enterprise SSO & SCIM console
//
//  Read surface for 20260801472000_enterprise_sso_scim.sql. Gated twice: the
//  admin layout requires super_admin/admin, and every table below is
//  additionally RLS-scoped to nx_is_org_identity_admin().
//
//  ⚠ org_scim_tokens is queried with an EXPLICIT column list, never `*`. The
//    migration withholds token_sha256 from `authenticated` by column-level
//    grant, so `select *` would fail for anyone but service_role. That is the
//    intended design — the digest is not readable from the console at all.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { IssueTokenForm } from './IssueTokenForm';
import { SsoConsole } from './SsoConsole';

export const metadata: Metadata = { title: 'SSO & SCIM' };
export const dynamic = 'force-dynamic';

import type {
  OrgRow,
  ConnectionRow,
  DomainRow,
  TokenRow,
  EventRow,
  MappingRow,
  IdentityRow,
  ArchiveRow,
  PersonRow,
  DepartmentRow,
} from './types';


export default async function SsoPage() {
  const supabase = await createSupabaseServerClient();

  // Every column named here is required by ./types.ts, which mirrors
  // 20260801472000. Do not narrow a select without narrowing the type: the
  // console reads these fields and a dropped column would surface as
  // `undefined` in the UI rather than as a compile error.
  const [
    orgsRes,
    connRes,
    domainRes,
    tokenRes,
    eventRes,
    mappingRes,
    identityRes,
    archiveRes,
    peopleRes,
    deptRes,
    adminRes,
  ] = await Promise.all([
    supabase.from('organizations').select('id, name').order('name').limit(200),
    supabase
      .from('org_sso_connections')
      .select(
        'id, org_id, protocol, display_name, status, default_member_role, default_profile_role, jit_provisioning_enabled, auth_sso_provider_id, idp_entity_id, idp_metadata_url, oidc_issuer, oidc_client_id, created_at, updated_at',
      )
      .order('created_at', { ascending: false }),
    supabase
      .from('org_sso_domains')
      .select('id, connection_id, org_id, domain, verified_at'),
    // Explicit columns — see the header note on the column-level grant. The
    // token secret is never selected; only token_prefix. OneTimeSecret renders
    // the raw value once, from the mint response.
    supabase
      .from('org_scim_tokens')
      .select(
        'id, org_id, connection_id, name, token_prefix, scopes, created_at, expires_at, revoked_at, revoked_reason, last_used_at, rotated_from_id',
      )
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('org_scim_events')
      .select(
        'id, org_id, connection_id, operation, resource_type, external_id, target_user_id, outcome, http_status, request_id, detail, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('org_scim_group_mappings')
      .select(
        'id, org_id, connection_id, external_group_id, external_group_name, org_role, department_id, is_active',
      ),
    supabase
      .from('org_scim_identities')
      .select(
        'id, org_id, connection_id, external_id, user_id, is_active, deactivated_at',
      )
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('org_scim_membership_archive')
      .select(
        'id, org_id, user_id, archived_role, membership_created_at, reason, archived_at, restored_at',
      )
      .order('archived_at', { ascending: false })
      .limit(200),
    // Narrowed deliberately: a name and an email are all the console needs to
    // label a person. No role, no credential, nothing commercial.
    supabase.from('profiles').select('id, email, full_name').limit(2000),
    supabase.from('org_departments').select('id, name').order('name'),
    supabase.rpc('nx_is_admin'),
  ]);

  // The migration may not be applied yet on this environment. Degrade to an
  // explanatory panel rather than a 500.
  const schemaMissing = Boolean(connRes.error || tokenRes.error);

  const orgs = (orgsRes.data as OrgRow[] | null) ?? [];
  const connections = (connRes.data as ConnectionRow[] | null) ?? [];
  const domains = (domainRes.data as DomainRow[] | null) ?? [];
  const tokens = (tokenRes.data as TokenRow[] | null) ?? [];
  const events = (eventRes.data as EventRow[] | null) ?? [];
  const mappings = (mappingRes.data as MappingRow[] | null) ?? [];
  const identities = (identityRes.data as IdentityRow[] | null) ?? [];
  const archive = (archiveRes.data as ArchiveRow[] | null) ?? [];
  const people = (peopleRes.data as PersonRow[] | null) ?? [];
  const departments = (deptRes.data as DepartmentRow[] | null) ?? [];

  // Read, never assumed. An unreadable predicate is treated as NOT admin, so a
  // failure closes the console's privileged affordances rather than opening them.
  const isPlatformAdmin = adminRes.error ? false : adminRes.data === true;

  const nowIso = new Date().toISOString();
  const liveTokens = tokens.filter(
    (t) => !t.revoked_at && new Date(t.expires_at) > new Date(),
  ).length;

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Command Console, Identity
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Enterprise SSO &amp; SCIM
        </h1>
        <p className="mt-2 max-w-3xl text-pretty text-sm text-zinc-400">
          SAML 2.0 and OIDC connections are authenticated by Supabase Auth; this
          console records which IdP belongs to which organization and issues the
          SCIM 2.0 credentials that provision its people. Provisioning maps onto
          the existing profiles and org_members tables — there is no separate
          user directory, and deprovisioning archives a membership before it
          removes it.
        </p>
      </header>

      {schemaMissing ? (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          The SSO/SCIM schema is not present on this environment. Apply
          <code className="mx-1 rounded bg-black/30 px-1 text-xs">
            20260801472000_enterprise_sso_scim.sql
          </code>
          and reload.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Connections', value: connections.length },
          { label: 'Live SCIM tokens', value: liveTokens },
          { label: 'Verified domains', value: domains.filter((d) => d.verified_at).length },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <p className="text-xs uppercase tracking-wide text-zinc-500">{s.label}</p>
            <p className="mt-1 font-display text-2xl text-white">{s.value}</p>
          </div>
        ))}
      </div>

      {/* ── Token issuance ──────────────────────────────────────────────── */}
      <IssueTokenForm
        orgs={orgs}
        connections={connections.map((c) => ({
          id: c.id,
          org_id: c.org_id,
          display_name: c.display_name,
        }))}
      />


      {/* ── The console ─────────────────────────────────────────────────────
          SsoConsole owns connections, domains, tokens (via TokenRoster),
          group mappings, SCIM identities, the deprovision archive and the
          audit trail. The inline tables that used to live here rendered a
          strict subset of the same data and are removed rather than left to
          drift against it. */}
      {schemaMissing ? null : (
        <SsoConsole
          orgs={orgs}
          connections={connections}
          domains={domains}
          tokens={tokens}
          mappings={mappings}
          identities={identities}
          archive={archive}
          events={events}
          people={people}
          departments={departments}
          nowIso={nowIso}
          isPlatformAdmin={isPlatformAdmin}
        />
      )}

    </div>
  );
}
