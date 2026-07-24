'use client';
// ════════════════════════════════════════════════════════════════════════════
//  InspectionMarketplaceAdminPanel — Admin controls for identity disclosure +
//  inspector replacement (Workflow A). Rendered only for Inspection Marketplace
//  jobs (source_rfq_id IS NULL). All authorization/validation happens in the DB
//  RPCs; this panel only collects input and reflects derived state.
// ════════════════════════════════════════════════════════════════════════════
import { useState, useTransition } from 'react';
import { setProjectPolicy, voidContract, replaceInspector } from '@/lib/actions/inspectionAdmin';

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
