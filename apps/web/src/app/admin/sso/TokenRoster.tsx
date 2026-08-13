// ════════════════════════════════════════════════════════════════════════════
//  app/admin/sso/TokenRoster.tsx — SCIM credential lifecycle
//
//  Issue lives in IssueTokenForm; this is everything that happens afterwards:
//  the roster, ROTATION and REVOCATION.
//
//  ── WHAT THIS SURFACE CAN AND CANNOT SHOW ──────────────────────────────────
//  Never the credential. org_scim_tokens stores sha256(raw) and the migration
//  withholds even that digest from `authenticated` by column-level grant, so
//  the strongest thing this table can render is token_prefix — a deliberately
//  non-secret leading fragment kept so two credentials can be told apart.
//  Everything else here is metadata: created, rotated, revoked, last used.
//
//  ── ROTATE vs REVOKE ───────────────────────────────────────────────────────
//  Rotate mints the replacement and THEN retires this credential, so the
//  organization is never left without a working one. Revoke kills it with no
//  replacement — provisioning stops until a new credential is issued and the
//  IdP is reconfigured, which is exactly what you want if the secret leaked.
//  Neither leaves two live credentials behind.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';
import type { TokenRow } from './types';
import { rotateScimToken, revokeScimToken, type IssueTokenState } from './actions';
import { OneTimeSecret } from './OneTimeSecret';
import { utcStamp } from './format';

const INITIAL: IssueTokenState = {};

type TokenState = 'active' | 'expiring' | 'expired' | 'revoked';

const STATE_TONE: Record<TokenState, string> = {
  active: 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10',
  expiring: 'text-amber-300 border-amber-400/30 bg-amber-500/10',
  expired: 'text-zinc-400 border-white/10 bg-white/5',
  revoked: 'text-rose-300 border-rose-400/30 bg-rose-500/10',
};

const STATE_LABEL: Record<TokenState, string> = {
  active: 'Active',
  expiring: 'Expiring',
  expired: 'Expired',
  revoked: 'Revoked',
};

/**
 * Derived from `nowIso`, which is stamped once on the server and passed in, so
 * the first client render is byte-identical to the server render. Deriving it
 * from Date.now() here would make a token that expires between render and
 * hydration produce a mismatch.
 */
function tokenState(t: TokenRow, nowMs: number): TokenState {
  if (t.revoked_at) return 'revoked';
  const expiry = new Date(t.expires_at).getTime();
  if (expiry <= nowMs) return 'expired';
  if (expiry - nowMs <= 14 * 24 * 60 * 60 * 1000) return 'expiring';
  return 'active';
}

export function TokenRoster({
  tokens,
  orgNames,
  connectionNames,
  nowIso,
}: {
  tokens: TokenRow[];
  orgNames: Record<string, string>;
  connectionNames: Record<string, string>;
  nowIso: string;
}) {
  const [rotateState, rotateAction, rotatePending] = useActionState(
    rotateScimToken,
    INITIAL,
  );
  const [rotating, setRotating] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [revokePending, startRevoke] = useTransition();
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revokeNotice, setRevokeNotice] = useState<string | null>(null);

  const nowMs = new Date(nowIso).getTime();

  /** id → the credential that was minted to replace it. */
  const supersededBy = useMemo(() => {
    const m = new Map<string, TokenRow>();
    for (const t of tokens) {
      if (t.rotated_from_id) m.set(t.rotated_from_id, t);
    }
    return m;
  }, [tokens]);

  const byId = useMemo(() => {
    const m = new Map<string, TokenRow>();
    for (const t of tokens) m.set(t.id, t);
    return m;
  }, [tokens]);

  const rotatingToken = rotating ? byId.get(rotating) ?? null : null;

  function doRevoke(tokenId: string) {
    setRevokeError(null);
    setRevokeNotice(null);
    startRevoke(async () => {
      const r = await revokeScimToken(tokenId, reason.trim() || undefined);
      if (r.ok) {
        setRevokeNotice(
          'Credential revoked. Provisioning through it stops immediately — the IdP will start failing until it is given a new one.',
        );
        setConfirming(null);
        setReason('');
      } else {
        setRevokeError(r.error ?? 'Could not revoke the credential.');
      }
    });
  }

  return (
    <section
      aria-labelledby="scim-tokens-heading"
      className="rounded-2xl border border-white/10 bg-white/[0.02] p-6"
    >
      <h2
        id="scim-tokens-heading"
        className="font-display text-lg font-semibold text-white"
      >
        SCIM credentials
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-zinc-400">
        Stored as SHA-256 only — this roster can show a credential&rsquo;s
        prefix and its lifecycle, never the secret itself. Rotating mints the
        replacement first and then retires this credential, so there is never a
        moment without a working one and never two live at once. Revoking has
        no replacement: provisioning stops until a new credential is issued.
      </p>

      {revokeNotice ? (
        <p
          role="status"
          className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200"
        >
          {revokeNotice}
        </p>
      ) : null}
      {revokeError ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
        >
          {revokeError}
        </p>
      ) : null}

      {/* ── Rotation ───────────────────────────────────────────────────── */}
      {rotatingToken ? (
        <div className="mt-5 rounded-xl border border-violet-400/30 bg-violet-500/[0.07] p-4">
          <h3 className="text-sm font-semibold text-white">
            Rotate{' '}
            <span className="font-mono text-violet-200">
              {rotatingToken.token_prefix}…
            </span>{' '}
            <span className="font-normal text-zinc-400">
              ({rotatingToken.name})
            </span>
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-zinc-400">
            The replacement is issued first, then this credential is retired:
            its lifetime is cut to zero and it is stamped revoked, so it stops
            authenticating the moment the replacement exists. Re-point the IdP
            straight away — provisioning fails in between.
          </p>

          <form action={rotateAction} className="mt-4 grid gap-4 sm:grid-cols-3">
            <input type="hidden" name="tokenId" value={rotatingToken.id} />
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                Replacement label
              </span>
              <input
                name="name"
                required
                minLength={2}
                maxLength={80}
                defaultValue={`${rotatingToken.name} (rotated)`}
                className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white"
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
            <div className="flex items-center gap-2 sm:col-span-3">
              <button
                type="submit"
                disabled={rotatePending}
                className="rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {rotatePending ? 'Rotating…' : 'Rotate credential'}
              </button>
              <button
                type="button"
                onClick={() => setRotating(null)}
                className="rounded-lg border border-white/15 px-3 py-2 text-sm text-zinc-300 hover:bg-white/5"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {rotateState.error ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
        >
          {rotateState.error}
        </p>
      ) : null}

      {rotateState.rawToken ? (
        <OneTimeSecret
          secret={rotateState.rawToken}
          expiresAt={rotateState.expiresAt}
          retiredPrefix={rotateState.retiredPrefix}
          warning={rotateState.warning}
        />
      ) : null}

      {/* ── Roster ─────────────────────────────────────────────────────── */}
      {tokens.length === 0 ? (
        <div className="mt-5 rounded-xl border border-white/[0.06] bg-ink-900/40 p-6">
          <p className="text-sm text-zinc-300">No SCIM credentials issued.</p>
          <p className="mt-1 text-xs text-zinc-500">
            An IdP cannot provision anyone until one exists. Issue one above and
            bind it to the connection whose groups should map to roles.
          </p>
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table
            aria-label="SCIM credentials"
            className="w-full min-w-[900px] text-left text-sm"
          >
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th scope="col" className="pb-2 pr-4">Organization</th>
                <th scope="col" className="pb-2 pr-4">Label</th>
                <th scope="col" className="pb-2 pr-4">Prefix</th>
                <th scope="col" className="pb-2 pr-4">State</th>
                <th scope="col" className="pb-2 pr-4">Created</th>
                <th scope="col" className="pb-2 pr-4">Expires</th>
                <th scope="col" className="pb-2 pr-4">Last used</th>
                <th scope="col" className="pb-2">Lifecycle</th>
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              {tokens.map((t) => {
                const st = tokenState(t, nowMs);
                const replacement = supersededBy.get(t.id);
                const predecessor = t.rotated_from_id
                  ? byId.get(t.rotated_from_id)
                  : null;
                const dead = st === 'revoked' || st === 'expired';

                return (
                  <tr key={t.id} className="border-t border-white/5 align-top">
                    <td className="py-3 pr-4">
                      {orgNames[t.org_id] ?? (
                        <span className="font-mono text-xs text-zinc-500">
                          {t.org_id}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-white">
                      {t.name}
                      <div className="mt-0.5 text-[11px] text-zinc-500">
                        {t.connection_id
                          ? connectionNames[t.connection_id] ??
                            'connection outside your scope'
                          : 'no connection — cannot provision'}
                      </div>
                      {t.scopes && t.scopes.length > 0 ? (
                        <div className="mt-0.5 font-mono text-[11px] text-zinc-600">
                          {t.scopes.join(' ')}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-zinc-400">
                      {t.token_prefix}…
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATE_TONE[st]}`}
                      >
                        {STATE_LABEL[st]}
                      </span>
                      {t.revoked_reason ? (
                        <div className="mt-1 max-w-[200px] text-[11px] text-rose-200/70">
                          {t.revoked_reason}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 text-xs text-zinc-400">
                      {utcStamp(t.created_at)}
                    </td>
                    <td className="py-3 pr-4 text-xs text-zinc-400">
                      {t.revoked_at ? (
                        <span className="text-rose-300/80">
                          revoked {utcStamp(t.revoked_at)}
                        </span>
                      ) : (
                        utcStamp(t.expires_at)
                      )}
                    </td>
                    <td className="py-3 pr-4 text-xs text-zinc-400">
                      {t.last_used_at ? (
                        utcStamp(t.last_used_at)
                      ) : (
                        <span className="text-zinc-600">never</span>
                      )}
                    </td>
                    <td className="py-3">
                      {predecessor ? (
                        <div className="mb-1 text-[11px] text-zinc-500">
                          replaced{' '}
                          <span className="font-mono">
                            {predecessor.token_prefix}…
                          </span>
                        </div>
                      ) : null}
                      {replacement ? (
                        <div className="mb-1 text-[11px] text-zinc-500">
                          superseded by{' '}
                          <span className="font-mono">
                            {replacement.token_prefix}…
                          </span>
                        </div>
                      ) : null}

                      {dead ? (
                        <span className="text-[11px] text-zinc-600">
                          no longer authenticates
                        </span>
                      ) : confirming === t.id ? (
                        <div className="space-y-2">
                          <label className="block">
                            <span className="sr-only">Revocation reason</span>
                            <input
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              maxLength={200}
                              placeholder="Reason (recorded in history)"
                              className="w-full rounded-lg border border-white/10 bg-ink-950 px-2 py-1 text-xs text-white placeholder:text-zinc-600"
                            />
                          </label>
                          <p className="text-[11px] text-rose-200/80">
                            Revoking is immediate and cannot be undone.
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={revokePending}
                              onClick={() => doRevoke(t.id)}
                              className="rounded-lg border border-rose-400/40 bg-rose-500/20 px-2.5 py-1 text-xs text-rose-100 disabled:opacity-50"
                            >
                              {revokePending ? 'Revoking…' : 'Confirm revoke'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirming(null);
                                setReason('');
                              }}
                              className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-zinc-300"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            aria-label={`Rotate the credential labelled ${t.name}`}
                            onClick={() => {
                              setRotating(t.id);
                              setConfirming(null);
                            }}
                            className="rounded-lg border border-violet-400/30 px-2.5 py-1 text-xs text-violet-200 hover:bg-violet-500/10"
                          >
                            Rotate
                          </button>
                          <button
                            type="button"
                            aria-label={`Revoke the credential labelled ${t.name}`}
                            onClick={() => {
                              setConfirming(t.id);
                              setRotating(null);
                            }}
                            className="rounded-lg border border-rose-400/30 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/10"
                          >
                            Revoke
                          </button>
                        </div>
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
  );
}
