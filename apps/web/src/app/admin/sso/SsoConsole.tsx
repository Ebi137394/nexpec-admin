// ════════════════════════════════════════════════════════════════════════════
//  app/admin/sso/SsoConsole.tsx — the operator surface for enterprise identity
//
//  Five views over 20260801472000_enterprise_sso_scim.sql, one organization at
//  a time:
//
//    Connections     which IdP authenticates which organization, and what a
//                    provisioned member gets by default
//    Credentials     the SCIM token lifecycle — issue, rotate, revoke
//    Role mapping    IdP group → org role, and the ceiling that mapping can
//                    never break through
//    History         every provisioning decision, including the refused ones
//    Deactivations   who the IdP removed — and the fact that removal is a
//                    deactivation, not a deletion
//
//  ── WHY THE CONFIGURATION VIEWS ARE READ-ONLY ──────────────────────────────
//  Not an omission, and not "coming soon". The migration grants `authenticated`
//  SELECT and nothing else on all seven tables in this lane, and its self-test
//  fails the build if that changes: "every write path in this lane must go
//  through a SECURITY DEFINER RPC". The RPCs it exposes to an org identity
//  administrator are nx_scim_issue_token and nx_scim_revoke_token — the token
//  lifecycle. There is no RPC for connection, domain or group-mapping writes,
//  so this console shows those as configuration and says who can change them,
//  rather than rendering an editor whose save the server would refuse.
//
//  ── SCOPING ────────────────────────────────────────────────────────────────
//  The organization picker is a convenience, NOT the security boundary. Every
//  row reaching this component already passed RLS as the signed-in caller
//  (nx_is_org_identity_admin), so an organization the operator does not
//  administer produces no rows to filter in the first place.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useMemo, useState } from 'react';
import type {
  ArchiveRow,
  ConnectionRow,
  DepartmentRow,
  DomainRow,
  EventRow,
  IdentityRow,
  MappingRow,
  OrgRow,
  PersonRow,
  TokenRow,
} from './types';
import { IssueTokenForm } from './IssueTokenForm';
import { TokenRoster } from './TokenRoster';
import { utcStamp } from './format';

type TabId =
  | 'connections'
  | 'credentials'
  | 'mappings'
  | 'history'
  | 'deactivations';

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'connections', label: 'Connections' },
  { id: 'credentials', label: 'Credentials' },
  { id: 'mappings', label: 'Role mapping' },
  { id: 'history', label: 'Provisioning history' },
  { id: 'deactivations', label: 'Deactivations' },
];

const OUTCOME_TONE: Record<string, string> = {
  success: 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10',
  noop: 'text-zinc-400 border-white/10 bg-white/5',
  rejected: 'text-amber-300 border-amber-400/30 bg-amber-500/10',
  error: 'text-rose-300 border-rose-400/30 bg-rose-500/10',
};

function Pill({ value, tone }: { value: string; tone?: string }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        tone ?? 'border-white/10 bg-white/5 text-zinc-300'
      }`}
    >
      {value.replace(/_/g, ' ')}
    </span>
  );
}

function Field({
  label,
  value,
  mono,
  muted,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  muted?: string;
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd
        className={`mt-0.5 break-words text-sm ${
          value ? 'text-zinc-200' : 'text-zinc-600'
        } ${mono && value ? 'font-mono text-xs' : ''}`}
      >
        {value || muted || 'not set'}
      </dd>
    </div>
  );
}

/** Renders redacted audit detail. The payload was stripped of identity
 *  attributes by nx_scim_redact_detail() before storage, so what survives is
 *  counts, role names and error reasons — safe to show, and the only place an
 *  operator can read WHY something was refused. */
function DetailList({ detail }: { detail: Record<string, unknown> | null }) {
  const entries = Object.entries(detail ?? {}).filter(
    ([, v]) => v !== null && v !== undefined && v !== '',
  );
  if (entries.length === 0) return null;
  return (
    <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-1 text-[11px]">
          <dt className="text-zinc-600">{k}</dt>
          <dd className="font-mono text-zinc-400">
            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SsoConsole({
  orgs,
  connections,
  domains,
  tokens,
  mappings,
  identities,
  archive,
  events,
  people,
  departments,
  nowIso,
  isPlatformAdmin,
}: {
  orgs: OrgRow[];
  connections: ConnectionRow[];
  domains: DomainRow[];
  tokens: TokenRow[];
  mappings: MappingRow[];
  identities: IdentityRow[];
  archive: ArchiveRow[];
  events: EventRow[];
  people: PersonRow[];
  departments: DepartmentRow[];
  nowIso: string;
  isPlatformAdmin: boolean;
}) {
  const [tab, setTab] = useState<TabId>('connections');
  const [scope, setScope] = useState<string>('all');
  const [failuresOnly, setFailuresOnly] = useState(false);

  const orgNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of orgs) m[o.id] = o.name;
    return m;
  }, [orgs]);

  const connectionNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of connections) m[c.id] = c.display_name;
    return m;
  }, [connections]);

  const departmentNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of departments) m[d.id] = d.name;
    return m;
  }, [departments]);

  const personById = useMemo(() => {
    const m: Record<string, PersonRow> = {};
    for (const p of people) m[p.id] = p;
    return m;
  }, [people]);

  const inScope = <T extends { org_id: string }>(rows: T[]): T[] =>
    scope === 'all' ? rows : rows.filter((r) => r.org_id === scope);

  const scopedConnections = inScope(connections);
  const scopedDomains = inScope(domains);
  const scopedTokens = inScope(tokens);
  const scopedMappings = inScope(mappings);
  const scopedIdentities = inScope(identities);
  const scopedArchive = inScope(archive);
  const scopedEvents = inScope(events);

  const nowMs = new Date(nowIso).getTime();
  const liveTokens = scopedTokens.filter(
    (t) => !t.revoked_at && new Date(t.expires_at).getTime() > nowMs,
  );
  const failures = scopedEvents.filter(
    (e) => e.outcome === 'rejected' || e.outcome === 'error',
  );
  const deactivated = scopedIdentities.filter((i) => !i.is_active);

  /** The name of a provisioned person, read through to the ONE directory. The
   *  SCIM tables store no attributes, so an unresolvable id is shown as an id
   *  rather than invented. */
  function personLabel(userId: string | null): string {
    if (!userId) return '—';
    const p = personById[userId];
    if (!p) return userId;
    return p.full_name || p.email || userId;
  }

  const visibleEvents = failuresOnly ? failures : scopedEvents;

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
          console records which IdP belongs to which organization, issues the
          SCIM 2.0 credentials that provision its people, and keeps the evidence
          of what those credentials did. Provisioning maps onto the existing
          profiles and org_members tables — there is no separate user directory,
          and deprovisioning archives a membership before it removes it.
        </p>
      </header>

      {/* ── Scope ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            Organization
          </span>
          <select
            aria-label="Filter the console to one organization"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="min-w-[240px] rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white"
          >
            <option value="all">
              All organizations you administer ({orgs.length})
            </option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>

        <dl className="grid flex-1 gap-3 sm:grid-cols-4">
          {[
            { label: 'Connections', value: scopedConnections.length },
            { label: 'Live credentials', value: liveTokens.length },
            { label: 'Provisioned', value: scopedIdentities.filter((i) => i.is_active).length },
            { label: 'Failed operations', value: failures.length },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-2xl border border-white/10 bg-white/[0.02] p-4"
            >
              <dt className="text-[11px] uppercase tracking-wide text-zinc-500">
                {s.label}
              </dt>
              <dd className="mt-1 font-display text-2xl text-white">
                {s.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Enterprise identity views"
        className="flex flex-wrap gap-2 border-b border-white/10 pb-3"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition ${
              tab === t.id
                ? 'border-violet-400/40 bg-violet-500/10 text-white'
                : 'border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Connections ──────────────────────────────────────────────────── */}
      {tab === 'connections' ? (
        <section
          role="tabpanel"
          id="panel-connections"
          aria-labelledby="tab-connections"
          className="space-y-4"
        >
          <p className="max-w-3xl text-sm text-zinc-400">
            Registry only. Supabase Auth (GoTrue) performs the SAML/OIDC
            handshake and holds the signing key and client secret; these rows
            record which of its providers belongs to which organization and what
            a person provisioned through it should get. No secret material is
            stored here, and none can be —{' '}
            <span className="text-zinc-300">
              the migration&rsquo;s self-test fails if any column in this lane
              looks like a client secret or signing key.
            </span>
          </p>

          {scopedConnections.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-6">
              <p className="text-sm text-zinc-300">
                No IdP connection is registered
                {scope === 'all' ? '' : ' for this organization'}.
              </p>
              <p className="mt-1 max-w-2xl text-xs text-zinc-500">
                Until one exists, enterprise sign-in and SCIM provisioning have
                nothing to attach to. Ordinary email, OAuth and biometric
                sign-in are unaffected — this lane is additive.
              </p>
            </div>
          ) : (
            scopedConnections.map((c) => {
              const mine = scopedDomains.filter((d) => d.connection_id === c.id);
              const unlinked = c.status === 'active' && !c.auth_sso_provider_id;
              return (
                <article
                  key={c.id}
                  aria-label={`Connection ${c.display_name}`}
                  className="rounded-2xl border border-white/10 bg-white/[0.02] p-6"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="font-display text-lg font-semibold text-white">
                      {c.display_name}
                    </h2>
                    <Pill value={c.protocol.toUpperCase()} />
                    <Pill
                      value={c.status}
                      tone={
                        c.status === 'active'
                          ? 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10'
                          : c.status === 'disabled'
                            ? 'text-rose-300 border-rose-400/30 bg-rose-500/10'
                            : undefined
                      }
                    />
                    <span className="text-xs text-zinc-500">
                      {orgNames[c.org_id] ?? c.org_id}
                    </span>
                  </div>

                  {unlinked ? (
                    <p
                      role="alert"
                      className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
                    >
                      Marked active but carries no GoTrue provider id. Sign-in
                      will not route to this IdP until{' '}
                      <code>auth_sso_provider_id</code> is set — the column is a
                      deliberate soft reference, so nothing enforces it for you.
                    </p>
                  ) : null}

                  <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Field
                      label={c.protocol === 'oidc' ? 'Issuer' : 'IdP entity id'}
                      value={
                        c.protocol === 'oidc' ? c.oidc_issuer : c.idp_entity_id
                      }
                      mono
                    />
                    <Field
                      label={
                        c.protocol === 'oidc' ? 'Client id' : 'Metadata URL'
                      }
                      value={
                        c.protocol === 'oidc'
                          ? c.oidc_client_id
                          : c.idp_metadata_url
                      }
                      mono
                    />
                    <Field
                      label="GoTrue provider"
                      value={c.auth_sso_provider_id}
                      mono
                      muted="not linked"
                    />
                    <Field
                      label="Default org role"
                      value={c.default_member_role}
                    />
                    <Field
                      label="Platform role on provision"
                      value={c.default_profile_role}
                    />
                    <Field
                      label="Just-in-time provisioning"
                      value={
                        c.jit_provisioning_enabled
                          ? 'enabled — first SSO sign-in may create membership'
                          : 'disabled — SCIM push only'
                      }
                    />
                    <Field label="Registered" value={utcStamp(c.created_at)} />
                    <Field label="Last changed" value={utcStamp(c.updated_at)} />
                  </dl>

                  <div className="mt-5 border-t border-white/5 pt-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                      Email domains
                    </h3>
                    {mine.length === 0 ? (
                      <p className="mt-1 text-xs text-zinc-500">
                        None claimed. No sign-in is routed to this IdP by
                        domain.
                      </p>
                    ) : (
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {mine.map((d) => (
                          <li
                            key={d.id}
                            className={`rounded-lg border px-2.5 py-1 text-xs ${
                              d.verified_at
                                ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                                : 'border-amber-400/30 bg-amber-500/10 text-amber-200'
                            }`}
                          >
                            <span className="font-mono">{d.domain}</span>
                            <span className="ml-2 opacity-70">
                              {d.verified_at
                                ? `verified ${utcStamp(d.verified_at)}`
                                : 'unverified — routes nobody'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-2 text-[11px] text-zinc-600">
                      A domain is globally exclusive: two organizations cannot
                      both claim one, or whichever matched first would capture
                      the other&rsquo;s users.
                    </p>
                  </div>
                </article>
              );
            })
          )}

          <ReadOnlyNote what="connections and their domains" />
        </section>
      ) : null}

      {/* ── Credentials ──────────────────────────────────────────────────── */}
      {tab === 'credentials' ? (
        <section
          role="tabpanel"
          id="panel-credentials"
          aria-labelledby="tab-credentials"
          className="space-y-6"
        >
          <IssueTokenForm
            orgs={scope === 'all' ? orgs : orgs.filter((o) => o.id === scope)}
            connections={connections.map((c) => ({
              id: c.id,
              org_id: c.org_id,
              display_name: c.display_name,
            }))}
          />
          <TokenRoster
            tokens={scopedTokens}
            orgNames={orgNames}
            connectionNames={connectionNames}
            nowIso={nowIso}
          />
        </section>
      ) : null}

      {/* ── Role mapping ─────────────────────────────────────────────────── */}
      {tab === 'mappings' ? (
        <section
          role="tabpanel"
          id="panel-mappings"
          aria-labelledby="tab-mappings"
          className="space-y-4"
        >
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.06] p-5">
            <h2 className="font-display text-base font-semibold text-white">
              What an IdP can never grant
            </h2>
            <ul className="mt-2 space-y-1.5 text-sm text-zinc-300">
              <li>
                <span className="text-emerald-300">Platform admin.</span> The
                roles an IdP can produce are the four org roles below plus a
                platform role fixed to{' '}
                <code className="text-xs">
                  client / inspector / agency / supplier
                </code>{' '}
                by CHECK constraint. There is no path from an IdP claim to{' '}
                <code className="text-xs">admin</code> or{' '}
                <code className="text-xs">super_admin</code> — those values are
                not reachable, so this console does not offer them.
              </li>
              <li>
                <span className="text-emerald-300">Organization ownership.</span>{' '}
                <code className="text-xs">org_scim_group_mappings_no_owner</code>{' '}
                forbids mapping any group to <code className="text-xs">owner</code>.
                Ownership is a decision made by a human inside NEXPEC, never
                inherited from directory membership.
              </li>
              <li>
                <span className="text-emerald-300">Anything unmapped.</span> A
                group with no row here grants nothing at all; the member falls
                through to the connection&rsquo;s default role. Adding a group
                at the IdP cannot silently grant NEXPEC privilege.
              </li>
            </ul>
          </div>

          {scopedConnections.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-6 text-sm text-zinc-400">
              No connection in scope, so there is nothing to map groups onto.
            </div>
          ) : (
            scopedConnections.map((c) => {
              const rows = scopedMappings.filter((m) => m.connection_id === c.id);
              return (
                <article
                  key={c.id}
                  aria-label={`Group mappings for ${c.display_name}`}
                  className="rounded-2xl border border-white/10 bg-white/[0.02] p-6"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="font-display text-base font-semibold text-white">
                      {c.display_name}
                    </h2>
                    <span className="text-xs text-zinc-500">
                      unmapped groups fall through to{' '}
                      <span className="text-zinc-300">
                        {c.default_member_role}
                      </span>
                    </span>
                  </div>

                  {rows.length === 0 ? (
                    <p className="mt-3 text-sm text-zinc-500">
                      No group is mapped. Every member provisioned through this
                      connection receives{' '}
                      <span className="text-zinc-300">
                        {c.default_member_role}
                      </span>
                      , whatever groups the IdP sends.
                    </p>
                  ) : (
                    <div className="mt-4 overflow-x-auto">
                      <table
                        aria-label={`IdP group to role mappings for ${c.display_name}`}
                        className="w-full min-w-[680px] text-left text-sm"
                      >
                        <thead className="text-xs uppercase tracking-wide text-zinc-500">
                          <tr>
                            <th scope="col" className="pb-2 pr-4">IdP group</th>
                            <th scope="col" className="pb-2 pr-4">External id</th>
                            <th scope="col" className="pb-2 pr-4">Org role</th>
                            <th scope="col" className="pb-2 pr-4">Department</th>
                            <th scope="col" className="pb-2">State</th>
                          </tr>
                        </thead>
                        <tbody className="text-zinc-300">
                          {rows.map((m) => (
                            <tr key={m.id} className="border-t border-white/5">
                              <td className="py-2.5 pr-4 text-white">
                                {m.external_group_name}
                              </td>
                              <td className="py-2.5 pr-4 font-mono text-xs text-zinc-500">
                                {m.external_group_id ?? '—'}
                              </td>
                              <td className="py-2.5 pr-4">
                                <Pill value={m.org_role} />
                              </td>
                              <td className="py-2.5 pr-4 text-xs">
                                {m.department_id
                                  ? departmentNames[m.department_id] ??
                                    'outside your scope'
                                  : '—'}
                              </td>
                              <td className="py-2.5">
                                {m.is_active ? (
                                  <span className="text-xs text-emerald-300">
                                    active
                                  </span>
                                ) : (
                                  <span className="text-xs text-zinc-500">
                                    inactive — grants nothing
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="mt-2 text-[11px] text-zinc-600">
                        When a person matches several mapped groups the most
                        privileged wins.
                      </p>
                    </div>
                  )}
                </article>
              );
            })
          )}

          <ReadOnlyNote what="group mappings" />
        </section>
      ) : null}

      {/* ── Provisioning history ─────────────────────────────────────────── */}
      {tab === 'history' ? (
        <section
          role="tabpanel"
          id="panel-history"
          aria-labelledby="tab-history"
          className="space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-sm text-zinc-400">
              Append-only. No policy grants UPDATE or DELETE on this table to
              any authenticated principal — the absence of the policy is the
              control — so nothing here can be rewritten from the application,
              including by this console.
            </p>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={failuresOnly}
                onChange={(e) => setFailuresOnly(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-ink-950"
              />
              Failures only ({failures.length})
            </label>
          </div>

          {visibleEvents.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-6">
              <p className="text-sm text-zinc-300">
                {failuresOnly
                  ? 'No failed or refused operation has been recorded.'
                  : 'No provisioning events recorded yet.'}
              </p>
              <p className="mt-1 max-w-2xl text-xs text-zinc-500">
                {failuresOnly
                  ? 'Every recorded operation succeeded or was a no-op.'
                  : 'Events appear the first time an IdP calls /functions/v1/scim-v2 with a live credential, and whenever a credential is issued, rotated or revoked here. This is an empty history, not a failure to load it.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
              <table
                aria-label="SCIM provisioning history"
                className="w-full min-w-[940px] text-left text-sm"
              >
                <thead className="text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th scope="col" className="px-4 pb-2 pt-4">When</th>
                    <th scope="col" className="px-4 pb-2 pt-4">Operation</th>
                    <th scope="col" className="px-4 pb-2 pt-4">Outcome</th>
                    <th scope="col" className="px-4 pb-2 pt-4">Subject</th>
                    <th scope="col" className="px-4 pb-2 pt-4">Connection</th>
                    <th scope="col" className="px-4 pb-2 pt-4">Detail</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-300">
                  {visibleEvents.map((e) => (
                    <tr key={e.id} className="border-t border-white/5 align-top">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-zinc-500">
                        {utcStamp(e.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-white">{e.operation}</span>
                        <div className="mt-0.5 text-[11px] text-zinc-500">
                          {e.resource_type}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Pill value={e.outcome} tone={OUTCOME_TONE[e.outcome]} />
                        {e.http_status ? (
                          <div className="mt-0.5 font-mono text-[11px] text-zinc-500">
                            HTTP {e.http_status}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className="text-zinc-200">
                          {personLabel(e.target_user_id)}
                        </div>
                        {e.external_id ? (
                          <div className="mt-0.5 font-mono text-[11px] text-zinc-500">
                            {e.external_id}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-400">
                        {e.connection_id
                          ? connectionNames[e.connection_id] ?? '—'
                          : '—'}
                        {e.request_id ? (
                          <div className="mt-0.5 font-mono text-[11px] text-zinc-600">
                            req {e.request_id}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {typeof e.detail?.reason === 'string' ? (
                          <div
                            className={`text-xs ${
                              e.outcome === 'success' || e.outcome === 'noop'
                                ? 'text-zinc-400'
                                : 'text-rose-200'
                            }`}
                          >
                            {String(e.detail.reason).replace(/_/g, ' ')}
                          </div>
                        ) : null}
                        <DetailList detail={e.detail} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-zinc-600">
            Detail is redacted before storage: counts, role names and error
            codes survive, identity attributes and secrets do not. That is why
            you will never see an email or a raw payload in this table.
          </p>
        </section>
      ) : null}

      {/* ── Deactivations ────────────────────────────────────────────────── */}
      {tab === 'deactivations' ? (
        <section
          role="tabpanel"
          id="panel-deactivations"
          aria-labelledby="tab-deactivations"
          className="space-y-6"
        >
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/[0.06] p-5">
            <h2 className="font-display text-base font-semibold text-white">
              Deprovisioning deactivates. It never deletes.
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-zinc-300">
              When an IdP sends <code className="text-xs">active:false</code> or
              a DELETE, the membership row is copied into the archive and then
              removed, so org access genuinely stops. What is deliberately left
              untouched: the person&rsquo;s profile, their sign-in, and every
              job, report and evidence record they are attached to. A person may
              be an inspector, a supplier, and a member of three organizations —
              one employer removing them must not disable them platform-wide.
              Re-activation reads the archived role back, so the state is
              exactly restorable.
            </p>
          </div>

          <article aria-label="Currently deprovisioned people" className="space-y-3">
            <h3 className="font-display text-base font-semibold text-white">
              Currently deprovisioned ({deactivated.length})
            </h3>
            {deactivated.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-6">
                <p className="text-sm text-zinc-300">
                  No one has been deprovisioned by an IdP.
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Every SCIM identity in scope is still active.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
                <table
                  aria-label="People deprovisioned through SCIM"
                  className="w-full min-w-[760px] text-left text-sm"
                >
                  <thead className="text-xs uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th scope="col" className="px-4 pb-2 pt-4">Person</th>
                      <th scope="col" className="px-4 pb-2 pt-4">Organization</th>
                      <th scope="col" className="px-4 pb-2 pt-4">External id</th>
                      <th scope="col" className="px-4 pb-2 pt-4">Deactivated</th>
                      <th scope="col" className="px-4 pb-2 pt-4">Account</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-300">
                    {deactivated.map((i) => (
                      <tr key={i.id} className="border-t border-white/5">
                        <td className="px-4 py-3 text-white">
                          {personLabel(i.user_id)}
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-400">
                          {orgNames[i.org_id] ?? i.org_id}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                          {i.external_id}
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-400">
                          {utcStamp(i.deactivated_at)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-emerald-300">
                            retained — sign-in unaffected
                          </span>
                          <div className="mt-0.5 text-[11px] text-zinc-500">
                            org access removed only
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <article aria-label="Membership archive" className="space-y-3">
            <h3 className="font-display text-base font-semibold text-white">
              Membership archive ({scopedArchive.length})
            </h3>
            <p className="max-w-3xl text-sm text-zinc-400">
              Written the moment a membership is withdrawn and before the row is
              removed. This is the evidence that someone belonged, and in what
              role.
            </p>
            {scopedArchive.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-6 text-sm text-zinc-400">
                Nothing archived. No membership has been withdrawn by SCIM.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
                <table
                  aria-label="Archived organization memberships"
                  className="w-full min-w-[820px] text-left text-sm"
                >
                  <thead className="text-xs uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th scope="col" className="px-4 pb-2 pt-4">Person</th>
                      <th scope="col" className="px-4 pb-2 pt-4">Organization</th>
                      <th scope="col" className="px-4 pb-2 pt-4">Role held</th>
                      <th scope="col" className="px-4 pb-2 pt-4">Granted</th>
                      <th scope="col" className="px-4 pb-2 pt-4">Withdrawn</th>
                      <th scope="col" className="px-4 pb-2 pt-4">Reason</th>
                      <th scope="col" className="px-4 pb-2 pt-4">State</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-300">
                    {scopedArchive.map((a) => (
                      <tr key={a.id} className="border-t border-white/5">
                        <td className="px-4 py-3 text-white">
                          {personLabel(a.user_id)}
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-400">
                          {orgNames[a.org_id] ?? a.org_id}
                        </td>
                        <td className="px-4 py-3">
                          <Pill value={a.archived_role} />
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-400">
                          {utcStamp(a.membership_created_at)}
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-400">
                          {utcStamp(a.archived_at)}
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-400">
                          {a.reason.replace(/_/g, ' ')}
                        </td>
                        <td className="px-4 py-3">
                          {a.restored_at ? (
                            <span className="text-xs text-emerald-300">
                              reinstated {utcStamp(a.restored_at)}
                            </span>
                          ) : (
                            <span className="text-xs text-amber-300">
                              withdrawn
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </section>
      ) : null}

      {!isPlatformAdmin ? (
        <p className="text-[11px] text-zinc-600">
          You are seeing only organizations you administer. Visibility is
          decided by the database, not by this page.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Says plainly why a configuration surface has no editor, and who can change
 * it instead. This is a real constraint of the shipped schema, not a stub: the
 * server would refuse the write, and a control that looks live but cannot save
 * is worse than an honest read-only view.
 */
function ReadOnlyNote({ what }: { what: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <h3 className="text-sm font-semibold text-white">
        Why {what} cannot be edited here
      </h3>
      <p className="mt-1.5 max-w-3xl text-sm text-zinc-400">
        Every write in this lane must go through a SECURITY DEFINER RPC — the
        migration grants an authenticated session SELECT and nothing else on all
        seven SSO/SCIM tables, and its self-test fails the build if that ever
        changes. The RPCs it exposes to an organization identity administrator
        are the credential lifecycle only:{' '}
        <code className="text-xs">nx_scim_issue_token</code> and{' '}
        <code className="text-xs">nx_scim_revoke_token</code>. No RPC exists for{' '}
        {what}, so this console reads them and stops there rather than offering
        a save the database would reject. Changes are applied by a platform
        operator with service-role access, and every provisioning consequence
        shows up in the history above.
      </p>
    </div>
  );
}
