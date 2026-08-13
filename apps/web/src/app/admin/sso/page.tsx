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
import { revokeScimToken } from './actions';

export const metadata: Metadata = { title: 'SSO & SCIM' };
export const dynamic = 'force-dynamic';

interface OrgRow {
  id: string;
  name: string;
}

interface ConnectionRow {
  id: string;
  org_id: string;
  protocol: string;
  display_name: string;
  status: string;
  default_member_role: string;
  jit_provisioning_enabled: boolean;
  auth_sso_provider_id: string | null;
}

interface DomainRow {
  connection_id: string;
  domain: string;
  verified_at: string | null;
}

interface TokenRow {
  id: string;
  org_id: string;
  connection_id: string | null;
  name: string;
  token_prefix: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  rotated_from_id: string | null;
}

interface EventRow {
  id: string;
  operation: string;
  outcome: string;
  external_id: string | null;
  http_status: number | null;
  created_at: string;
}

function tokenState(t: TokenRow): { label: string; tone: string } {
  if (t.revoked_at) return { label: 'Revoked', tone: 'text-rose-300 border-rose-400/30 bg-rose-500/10' };
  if (new Date(t.expires_at) <= new Date())
    return { label: 'Expired', tone: 'text-zinc-400 border-white/10 bg-white/5' };
  return { label: 'Active', tone: 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10' };
}

export default async function SsoPage() {
  const supabase = await createSupabaseServerClient();

  const [orgsRes, connRes, domainRes, tokenRes, eventRes] = await Promise.all([
    supabase.from('organizations').select('id, name').order('name').limit(200),
    supabase
      .from('org_sso_connections')
      .select(
        'id, org_id, protocol, display_name, status, default_member_role, jit_provisioning_enabled, auth_sso_provider_id',
      )
      .order('created_at', { ascending: false }),
    supabase.from('org_sso_domains').select('connection_id, domain, verified_at'),
    // Explicit columns — see the header note on the column-level grant.
    supabase
      .from('org_scim_tokens')
      .select(
        'id, org_id, connection_id, name, token_prefix, created_at, expires_at, revoked_at, last_used_at, rotated_from_id',
      )
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('org_scim_events')
      .select('id, operation, outcome, external_id, http_status, created_at')
      .order('created_at', { ascending: false })
      .limit(25),
  ]);

  // The migration may not be applied yet on this environment. Degrade to an
  // explanatory panel rather than a 500.
  const schemaMissing = Boolean(connRes.error || tokenRes.error);

  const orgs = (orgsRes.data as OrgRow[] | null) ?? [];
  const connections = (connRes.data as ConnectionRow[] | null) ?? [];
  const domains = (domainRes.data as DomainRow[] | null) ?? [];
  const tokens = (tokenRes.data as TokenRow[] | null) ?? [];
  const events = (eventRes.data as EventRow[] | null) ?? [];

  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
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

      {/* ── Connections ─────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="font-display text-lg font-semibold text-white">Connections</h2>
        {connections.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            No IdP connections registered yet.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="pb-2 pr-4">Organization</th>
                  <th className="pb-2 pr-4">Connection</th>
                  <th className="pb-2 pr-4">Protocol</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Default role</th>
                  <th className="pb-2">Domains</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {connections.map((c) => {
                  const mine = domains.filter((d) => d.connection_id === c.id);
                  return (
                    <tr key={c.id} className="border-t border-white/5">
                      <td className="py-2.5 pr-4">{orgName.get(c.org_id) ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-white">{c.display_name}</td>
                      <td className="py-2.5 pr-4 uppercase">{c.protocol}</td>
                      <td className="py-2.5 pr-4">
                        {c.status === 'active' ? (
                          <span className="text-emerald-300">active</span>
                        ) : (
                          <span className="text-zinc-500">{c.status}</span>
                        )}
                        {c.status === 'active' && !c.auth_sso_provider_id ? (
                          <span
                            className="ml-2 text-amber-300"
                            title="No GoTrue provider id — sign-in will not route to this IdP"
                          >
                            unlinked
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-4">{c.default_member_role}</td>
                      <td className="py-2.5">
                        {mine.length === 0 ? (
                          <span className="text-zinc-600">none</span>
                        ) : (
                          mine.map((d) => (
                            <span
                              key={d.domain}
                              className={
                                d.verified_at ? 'mr-2 text-zinc-300' : 'mr-2 text-amber-300/80'
                              }
                              title={d.verified_at ? 'verified' : 'unverified — routes nobody'}
                            >
                              {d.domain}
                            </span>
                          ))
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Token issuance ──────────────────────────────────────────────── */}
      <IssueTokenForm
        orgs={orgs}
        connections={connections.map((c) => ({
          id: c.id,
          org_id: c.org_id,
          display_name: c.display_name,
        }))}
      />

      {/* ── Token roster ────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="font-display text-lg font-semibold text-white">SCIM tokens</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Stored as SHA-256 only. Revoking is immediate and causes a provisioning
          outage until the IdP is given a new secret; to swap without an outage,
          issue a replacement that rotates this one and keep both live for the
          24-hour overlap.
        </p>
        {tokens.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No tokens issued yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="pb-2 pr-4">Organization</th>
                  <th className="pb-2 pr-4">Label</th>
                  <th className="pb-2 pr-4">Prefix</th>
                  <th className="pb-2 pr-4">State</th>
                  <th className="pb-2 pr-4">Expires</th>
                  <th className="pb-2 pr-4">Last used</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {tokens.map((t) => {
                  const st = tokenState(t);
                  return (
                    <tr key={t.id} className="border-t border-white/5">
                      <td className="py-2.5 pr-4">{orgName.get(t.org_id) ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-white">
                        {t.name}
                        {t.rotated_from_id ? (
                          <span className="ml-2 text-xs text-zinc-500">(rotated)</span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-zinc-400">
                        {t.token_prefix}…
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${st.tone}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-xs">
                        {new Date(t.expires_at).toLocaleDateString()}
                      </td>
                      <td className="py-2.5 pr-4 text-xs">
                        {t.last_used_at
                          ? new Date(t.last_used_at).toLocaleString()
                          : <span className="text-zinc-600">never</span>}
                      </td>
                      <td className="py-2.5">
                        {t.revoked_at ? null : (
                          <form action={revokeScimToken}>
                            <input type="hidden" name="tokenId" value={t.id} />
                            <button
                              type="submit"
                              className="rounded-lg border border-rose-400/30 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/10"
                            >
                              Revoke
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Audit ───────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="font-display text-lg font-semibold text-white">
          Recent provisioning activity
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          Append-only. No policy grants UPDATE or DELETE on this table to any
          authenticated principal, so history here cannot be rewritten.
        </p>
        {events.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/5 pt-2 text-sm"
              >
                <span className="font-mono text-xs text-zinc-500">
                  {new Date(e.created_at).toLocaleString()}
                </span>
                <span className="text-white">{e.operation}</span>
                <span
                  className={
                    e.outcome === 'success'
                      ? 'text-emerald-300'
                      : e.outcome === 'noop'
                        ? 'text-zinc-500'
                        : 'text-rose-300'
                  }
                >
                  {e.outcome}
                </span>
                {e.external_id ? (
                  <span className="font-mono text-xs text-zinc-500">{e.external_id}</span>
                ) : null}
                {e.http_status ? (
                  <span className="text-xs text-zinc-600">{e.http_status}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
