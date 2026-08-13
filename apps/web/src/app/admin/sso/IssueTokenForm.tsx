// ════════════════════════════════════════════════════════════════════════════
//  app/admin/sso/IssueTokenForm.tsx
//
//  Client half of SCIM token issuance. useActionState (React 19) so the raw
//  token comes back in the action RESPONSE and is rendered from component
//  state — never through a redirect, a query string or a cookie. See the note
//  at the top of actions.ts for why that distinction matters.
//
//  The token is shown once. There is no "show again": only sha256(raw) is
//  stored, so nothing on the server can reproduce it. Losing it means rotating.
//  The reveal itself lives in OneTimeSecret, shared with rotation so exactly
//  one component in this route is able to render a raw credential.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useActionState, useState } from 'react';
import { issueScimToken, type IssueTokenState } from './actions';
import { OneTimeSecret } from './OneTimeSecret';

interface OrgOption {
  id: string;
  name: string;
}

interface ConnectionOption {
  id: string;
  org_id: string;
  display_name: string;
}

const INITIAL: IssueTokenState = {};

export function IssueTokenForm({
  orgs,
  connections,
}: {
  orgs: OrgOption[];
  connections: ConnectionOption[];
}) {
  const [state, formAction, pending] = useActionState(issueScimToken, INITIAL);
  const [orgId, setOrgId] = useState<string>(orgs[0]?.id ?? '');

  const scopedConnections = connections.filter((c) => c.org_id === orgId);

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <h2 className="font-display text-lg font-semibold text-white">
        Issue a SCIM token
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-zinc-400">
        The IdP presents this as{' '}
        <code className="rounded bg-white/5 px-1 py-0.5 text-xs text-zinc-300">
          Authorization: Bearer …
        </code>{' '}
        against <code className="text-xs text-zinc-300">/functions/v1/scim-v2</code>. It
        is stored hashed and shown once.
      </p>

      <form action={formAction} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            Organization
          </span>
          <select
            name="orgId"
            required
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white"
          >
            {orgs.length === 0 ? <option value="">No organizations</option> : null}
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            SSO connection
          </span>
          <select
            name="connectionId"
            className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white"
          >
            <option value="">— none (token cannot provision) —</option>
            {scopedConnections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-zinc-500">
            Provisioning needs a connection: it is what resolves IdP groups to
            roles.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            Label
          </span>
          <input
            name="name"
            required
            minLength={2}
            maxLength={80}
            placeholder="Okta production"
            className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            Lifetime (days)
          </span>
          <input
            name="expiresInDays"
            type="number"
            min={1}
            max={730}
            defaultValue={365}
            className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white"
          />
        </label>

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={pending || orgs.length === 0}
            className="rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
          >
            {pending ? 'Issuing…' : 'Issue token'}
          </button>
        </div>
      </form>

      {state.error ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300"
        >
          {state.error}
        </p>
      ) : null}

      {state.rawToken ? (
        <OneTimeSecret secret={state.rawToken} expiresAt={state.expiresAt} />
      ) : null}
    </section>
  );
}
