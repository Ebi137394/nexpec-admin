// ════════════════════════════════════════════════════════════════════════════
//  app/admin/sso/OneTimeSecret.tsx — the once-and-only-once secret panel
//
//  Shared by issuance and rotation so there is exactly ONE piece of code in
//  this route that can put a raw SCIM bearer token on screen. That matters: a
//  second copy of this markup is a second place for the rule to be broken.
//
//  The rule: the raw token exists in the server action's response body, is
//  held in React state for the life of this component, and is never persisted.
//  Only sha256(raw) reaches the database (20260801472000), so there is no
//  "show it again" — not because the button is hidden, but because nothing on
//  the server can reproduce the value. Dismissing it is final.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useState } from 'react';

export function OneTimeSecret({
  secret,
  expiresAt,
  retiredPrefix,
  warning,
}: {
  secret: string;
  expiresAt?: string;
  /** Set on rotation: the non-secret prefix of the credential just retired. */
  retiredPrefix?: string;
  warning?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return (
      <div
        role="status"
        className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-zinc-400"
      >
        The credential was dismissed. It cannot be shown again — only its
        SHA-256 digest is stored. If it was not captured, rotate the token to
        mint a fresh one.
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-label="One-time SCIM credential"
      className="mt-5 rounded-xl border border-amber-400/30 bg-amber-500/10 p-4"
    >
      <p className="text-sm font-semibold text-amber-200">
        Copy this now — it is shown once and cannot be recovered.
      </p>
      <p className="mt-1 text-xs text-amber-200/70">
        Only its SHA-256 digest is stored. If it is lost, rotate the token;
        nothing on the server can read it back.
      </p>

      {retiredPrefix ? (
        <p className="mt-2 text-xs text-amber-200/70">
          The credential it replaces (
          <span className="font-mono">{retiredPrefix}…</span>) has been retired
          and no longer authenticates. Point the IdP at this value now.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code
          aria-label="SCIM bearer token, shown once"
          className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-ink-950 px-3 py-2 font-mono text-xs text-emerald-300"
        >
          {secret}
        </code>
        <button
          type="button"
          aria-label="Copy the SCIM credential to the clipboard"
          onClick={() => {
            void navigator.clipboard.writeText(secret);
            setCopied(true);
          }}
          className="rounded-lg border border-white/15 px-3 py-2 text-xs text-zinc-200 hover:bg-white/5"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          aria-label="Dismiss the credential permanently"
          onClick={() => setDismissed(true)}
          className="rounded-lg border border-white/15 px-3 py-2 text-xs text-zinc-400 hover:bg-white/5"
        >
          Dismiss
        </button>
      </div>

      {expiresAt ? (
        <p className="mt-2 text-xs text-amber-200/70">
          Expires {new Date(expiresAt).toLocaleString()}.
        </p>
      ) : null}

      {warning ? (
        <p className="mt-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {warning}
        </p>
      ) : null}
    </div>
  );
}
