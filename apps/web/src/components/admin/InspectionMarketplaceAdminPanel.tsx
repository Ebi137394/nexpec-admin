'use client';
// ════════════════════════════════════════════════════════════════════════════
//  InspectionMarketplaceAdminPanel — Admin controls for identity disclosure +
//  inspector replacement (Workflow A). Rendered only for Inspection Marketplace
//  jobs (source_rfq_id IS NULL). All authorization/validation happens in the DB
//  RPCs; this panel only collects input and reflects derived state.
// ════════════════════════════════════════════════════════════════════════════
import { useState, useTransition } from 'react';
import {
  setProjectPolicy,
  voidContract,
  replaceInspector,
  searchAssignableInspectors,
  assignInspectorDirectly,
  type AssignableInspector,
} from '@/lib/actions/inspectionAdmin';

type IdentityMode = 'protected' | 'professional' | 'full';
type ReplacementMode = 'client_reapproval' | 'admin_authorized';

export interface AppOption {
  id: string;
  applicantLabel: string;
  status: string;
}
export interface ActiveContract {
  id: string;
  status: string;
  clientApprovalType: string;
}

export function InspectionMarketplaceAdminPanel(props: {
  jobId: string;
  jobStatus: string;
  identityMode: IdentityMode;
  replacementMode: ReplacementMode;
  clientPriceCents: number;
  activeContract: ActiveContract | null;
  applications: AppOption[];
}) {
  const { jobId, jobStatus, activeContract, applications, clientPriceCents } = props;
  const [identityMode, setIdentityMode] = useState<IdentityMode>(props.identityMode);
  const [replacementMode, setReplacementMode] = useState<ReplacementMode>(props.replacementMode);
  const [voidReason, setVoidReason] = useState('');
  const [replAppId, setReplAppId] = useState('');
  const [replPayout, setReplPayout] = useState('');
  const [replReason, setReplReason] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pending, start] = useTransition();

  // Direct assignment — book a known inspector who never applied.
  const [dirQuery, setDirQuery] = useState('');
  const [dirResults, setDirResults] = useState<AssignableInspector[] | null>(null);
  const [dirPicked, setDirPicked] = useState<AssignableInspector | null>(null);
  const [dirPayout, setDirPayout] = useState('');
  const [dirPrice, setDirPrice] = useState(
    clientPriceCents > 0 ? String(clientPriceCents / 100) : '',
  );
  const [dirReason, setDirReason] = useState('');
  const [dirSearching, setDirSearching] = useState(false);
  // ADMIN-ONLY override state. None of this is ever sent to a client surface.
  const [dirIncludeUnverified, setDirIncludeUnverified] = useState(false);

  // Derived replacement progress (never a new Job status; derived from contract state).
  const awaitingReplacement = jobStatus === 'in_progress' && !activeContract;
  const awaitingClientSig = activeContract?.status === 'pending_client_signature';
  const awaitingInspectorSig = activeContract?.status === 'pending_inspector_signature';
  const isAdminAuthorized = activeContract?.clientApprovalType === 'admin_authorized';

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) =>
    start(async () => {
      setMsg(null);
      const res = await fn();
      setMsg(res.ok ? { kind: 'ok', text: okText } : { kind: 'err', text: res.error ?? 'Failed' });
    });

  // Direct assignment is offered only where the DB will actually accept it:
  // an open job with no live contract, or a job awaiting replacement.
  const canAssignDirectly = !activeContract && (jobStatus === 'open' || awaitingReplacement);

  const runSearch = () =>
    start(async () => {
      setDirSearching(true);
      setMsg(null);
      const res = await searchAssignableInspectors(dirQuery, dirIncludeUnverified);
      setDirSearching(false);
      if (!res.ok) {
        setDirResults([]);
        setMsg({ kind: 'err', text: res.error });
        return;
      }
      setDirResults(res.inspectors);
    });

  const field = 'w-full rounded-lg border border-ink-600 bg-ink-900/60 px-3 py-2 text-sm text-white';
  const btn = 'rounded-lg border border-ink-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/5 disabled:opacity-50';

  return (
    <section className="space-y-5 rounded-2xl border border-ink-600 bg-ink-900/40 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-white">Inspection controls</h2>
        <span className="text-[10px] font-extrabold uppercase tracking-industrial text-violet-glow">Admin only</span>
      </div>

      {/* Derived replacement-progress banner */}
      {awaitingReplacement && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Awaiting replacement — the previous contract was voided and no inspector is currently assigned.
        </p>
      )}
      {awaitingClientSig && (
        <p className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
          Awaiting client signature on the {isAdminAuthorized ? 'admin-authorized ' : ''}contract.
        </p>
      )}
      {awaitingInspectorSig && (
        <p className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
          {isAdminAuthorized
            ? 'Admin-authorized replacement — awaiting inspector acceptance (client approval was authorized by admin).'
            : 'Awaiting inspector acceptance.'}
        </p>
      )}

      {msg && (
        <p className={`rounded-lg px-3 py-2 text-xs ${msg.kind === 'ok' ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border border-red-500/40 bg-red-500/10 text-red-200'}`}>
          {msg.text}
        </p>
      )}

      {/* ── Direct assignment ──────────────────────────────────────────────
          Book a trusted inspector who never applied. The RPC manufactures the
          ordinary applications row the hire pipeline already expects and then
          delegates to admin_dispatch_job / admin_replace_inspector, so the
          client's workflow, wording and notifications are exactly the ones
          they would see for a normal applicant. Provenance is recorded in an
          admin-only table; nothing about this route is client-visible. */}
      {canAssignDirectly && (
        <div className="space-y-3 rounded-xl border border-violet/30 bg-violet/[0.06] p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-glow">
              Assign a known inspector
            </p>
            <span className="text-[10px] text-white/40">Internal — invisible to the client</span>
          </div>
          <p className="text-xs leading-relaxed text-white/50">
            For an inspector you already trust who never applied here. They still
            have to accept the contract before becoming active, and the client
            sees the standard flow throughout.
          </p>

          <div className="flex gap-2">
            <input
              className={field}
              placeholder="Search by name, email, city, user id or NX handle"
              value={dirQuery}
              onChange={(e) => setDirQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  runSearch();
                }
              }}
            />
            <button type="button" className={btn} disabled={pending} onClick={runSearch}>
              {dirSearching ? 'Searching…' : 'Search'}
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs text-white/60">
            <input
              type="checkbox"
              checked={dirIncludeUnverified}
              onChange={(e) => {
                setDirIncludeUnverified(e.target.checked);
                setDirResults(null);
                setDirPicked(null);
              }}
            />
            Include inspectors who are not yet platform-verified
          </label>

          {dirResults !== null && dirResults.length === 0 && !dirSearching && (
            <p className="text-xs text-white/40">No verified inspectors matched.</p>
          )}

          {dirResults !== null && dirResults.length > 0 && (
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {dirResults.map((ins) => {
                const picked = dirPicked?.id === ins.id;
                return (
                  <li key={ins.id}>
                    <button
                      type="button"
                      onClick={() => setDirPicked(picked ? null : ins)}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                        picked
                          ? 'border-violet/60 bg-violet/15'
                          : 'border-ink-600 hover:border-violet/40 hover:bg-white/[0.03]'
                      }`}
                    >
                      <span className="block text-sm font-semibold text-white">
                        {ins.fullName ?? `Inspector ${ins.id.slice(0, 8)}`}
                      </span>
                      <span className="block text-[11px] text-white/50">
                        {[ins.headline, ins.locationCity, ins.email].filter(Boolean).join(' · ') ||
                          'Inspector'}
                      </span>
                      {/* ADMIN-ONLY markers. Deliberately not persisted to any
                          client-visible field and not shown on any client surface. */}
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        {ins.isSelf && (
                          <span className="rounded-full bg-violet/20 px-2 py-0.5 text-[10px] font-semibold text-violet-glow">
                            You
                          </span>
                        )}
                        {(ins.role === 'admin' || ins.role === 'super_admin') && (
                          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/70">
                            Platform admin
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            ins.isVerified
                              ? 'bg-accent-green/15 text-accent-green'
                              : 'bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          {ins.isVerified ? 'Verified' : 'Not verified'}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {dirPicked && (
            <div className="space-y-3 border-t border-white/10 pt-3">
              <p className="text-xs text-white/60">
                Assigning <span className="font-semibold text-white">{dirPicked.fullName ?? dirPicked.id.slice(0, 8)}</span>
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs text-white/60">Client price (USD)</span>
                  <input
                    className={field}
                    inputMode="decimal"
                    value={dirPrice}
                    onChange={(e) => setDirPrice(e.target.value)}
                    placeholder="2300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-white/60">Inspector payout (USD)</span>
                  <input
                    className={field}
                    inputMode="decimal"
                    value={dirPayout}
                    onChange={(e) => setDirPayout(e.target.value)}
                    placeholder="1200"
                  />
                </label>
              </div>
              {/* ADMIN-ONLY override warning. Never rendered on a client surface,
                  never persisted to a client-readable field. */}
              {(!dirPicked.isVerified || dirPicked.isSelf) && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {!dirPicked.isVerified && dirPicked.isSelf
                    ? 'Override: you are assigning yourself, and this account is not platform-verified.'
                    : !dirPicked.isVerified
                      ? 'Override: this inspector has not completed platform verification. You are vouching for their qualifications.'
                      : 'Override: you are assigning yourself as the inspector for this job.'}
                  {' '}A written internal reason is required. The client will not
                  see this, or that the assignment was made directly.
                </p>
              )}
              <label className="block space-y-1">
                <span className="text-xs text-white/60">
                  Reason (audit trail, internal)
                  {(!dirPicked.isVerified || dirPicked.isSelf) && (
                    <span className="ml-1 text-amber-300">required — min 10 characters</span>
                  )}
                </span>
                <input
                  className={field}
                  value={dirReason}
                  onChange={(e) => setDirReason(e.target.value)}
                  placeholder="e.g. Agreed directly with the inspector for this site"
                />
              </label>
              <button
                type="button"
                className={btn}
                disabled={
                  pending || !dirPayout.trim() || !dirPrice.trim() ||
                  // Mirrors the DB rule exactly; the RPC remains the real gate.
                  (((!dirPicked.isVerified || dirPicked.isSelf)
                    ? dirReason.trim().length < 10
                    : dirReason.trim().length === 0))
                }
                onClick={() =>
                  run(
                    () =>
                      assignInspectorDirectly(
                        jobId,
                        dirPicked.id,
                        Math.round(Number(dirPrice) * 100),
                        Math.round(Number(dirPayout) * 100),
                        dirReason,
                      ),
                    'Inspector assigned. Generate the contract from Contracts; they must still accept it.',
                  )
                }
              >
                Assign inspector
              </button>
            </div>
          )}
        </div>
      )}

      {/* Project policies */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/50">Project policy</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs text-white/60">Identity disclosure</span>
            <select className={field} value={identityMode} onChange={(e) => setIdentityMode(e.target.value as IdentityMode)}>
              <option value="protected">Protected — no identity shown</option>
              <option value="professional">Professional — name, résumé, certifications</option>
              <option value="full">Full — professional + email &amp; phone</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-white/60">Replacement mode</span>
            <select className={field} value={replacementMode} onChange={(e) => setReplacementMode(e.target.value as ReplacementMode)}>
              <option value="client_reapproval">Client re-approval (client signs)</option>
              <option value="admin_authorized">Admin-authorized (inspector still signs)</option>
            </select>
          </label>
        </div>
        <button
          className={btn}
          disabled={pending}
          onClick={() => run(() => setProjectPolicy(jobId, identityMode, replacementMode), 'Policy updated.')}
        >
          Save policy
        </button>
      </div>

      {/* Void current contract */}
      {activeContract && (
        <div className="space-y-2 border-t border-ink-600 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/50">Void current contract</p>
          <input
            className={field}
            placeholder="Reason (required)"
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
          />
          <button
            className={`${btn} border-red-500/40 text-red-200 hover:bg-red-500/10`}
            disabled={pending || voidReason.trim().length === 0}
            onClick={() => run(() => voidContract(jobId, activeContract.id, voidReason), 'Contract voided.')}
          >
            Void contract
          </button>
        </div>
      )}

      {/* Replace inspector */}
      <div className="space-y-2 border-t border-ink-600 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/50">Replace inspector</p>
        {applications.length === 0 ? (
          <p className="text-xs text-white/50">No other applications available for this job.</p>
        ) : (
          <>
            <label className="space-y-1">
              <span className="text-xs text-white/60">Replacement application</span>
              <select className={field} value={replAppId} onChange={(e) => setReplAppId(e.target.value)}>
                <option value="">Select an applicant…</option>
                {applications.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.applicantLabel} · {a.status}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs text-white/60">Client price (preserved)</span>
                <input className={`${field} opacity-70`} value={(clientPriceCents / 100).toFixed(2)} readOnly />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-white/60">New inspector payout (USD)</span>
                <input
                  className={field}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={replPayout}
                  onChange={(e) => setReplPayout(e.target.value)}
                />
              </label>
            </div>
            <input
              className={field}
              placeholder="Reason (required)"
              value={replReason}
              onChange={(e) => setReplReason(e.target.value)}
            />
            <button
              className={btn}
              disabled={pending || !replAppId || replReason.trim().length === 0}
              onClick={() =>
                run(
                  () =>
                    replaceInspector(
                      jobId,
                      replAppId,
                      clientPriceCents,
                      Math.round(parseFloat(replPayout || '0') * 100),
                      replReason,
                    ),
                  'Inspector replaced.',
                )
              }
            >
              Replace inspector ({replacementMode === 'admin_authorized' ? 'admin-authorized' : 'client re-approval'})
            </button>
          </>
        )}
      </div>
    </section>
  );
}
