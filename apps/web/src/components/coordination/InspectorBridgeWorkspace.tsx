// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/components/coordination/InspectorBridgeWorkspace.tsx
//
//  Interactive inspector-side Coordination Bridge workspace (web). Drives the
//  same SECURITY DEFINER RPCs as the mobile screen via the browser Supabase
//  client (the caller's JWT authorises every call; RLS + the RPCs enforce that
//  only the assigned inspector / admin can act).
//
//  RPCs used: bridge_create, bridge_send_invitation, bridge_fetch_for_inspector,
//  bridge_propose_schedule, bridge_accept_counter_schedule, bridge_add_document_request,
//  bridge_accept_document, bridge_reject_document, bridge_rotate_token,
//  bridge_cancel, bridge_complete.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

const PORTAL_BASE =
  process.env.NEXT_PUBLIC_BRIDGE_PORTAL_BASE_URL ?? 'https://app.nexpec.com/bridge';

interface Slot {
  id: string;
  kind: 'schedule' | 'document_request' | 'site_access' | 'pre_inspection_ack' | 'arrival_ack';
  status: 'pending' | 'awaiting_vendor' | 'awaiting_inspector' | 'completed' | 'rejected';
  title: string;
  description: string | null;
  required: boolean;
  sort_order: number;
  payload_json: Record<string, unknown>;
  completed_at: string | null;
  rejected_reason: string | null;
}
interface BridgeDoc {
  id: string;
  slot_id: string | null;
  original_filename: string;
  file_size_bytes: number | null;
  sha256_client_computed: string;
  accepted_at: string | null;
  rejected_at: string | null;
  rejected_reason: string | null;
}
interface BridgeView {
  bridge: {
    id: string; job_id: string; status: string;
    token_expires_at: string; token_revoked_at: string | null;
    vendor_session_count: number; vendor_last_seen_at: string | null;
  };
  vendor: { company_name: string; contact_name: string | null; contact_email: string };
  slots: Slot[];
  documents: BridgeDoc[];
}

const sb = () => createSupabaseBrowserClient();

export function InspectorBridgeWorkspace({ bridgeId, jobId }: { bridgeId: string; jobId: string }) {
  const [resolvedId, setResolvedId] = useState<string>(bridgeId);
  const [view, setView] = useState<BridgeView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      let id = bridgeId;
      if (!id && jobId) {
        const { data } = await sb().from('coordination_bridges').select('id').eq('job_id', jobId).maybeSingle();
        id = (data?.id as string | undefined) ?? '';
      }
      setResolvedId(id);
      if (!id) { setView(null); return; }
      const { data, error } = await sb().rpc('bridge_fetch_for_inspector', { p_bridge_id: id });
      if (error) throw error;
      setView(data as BridgeView);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [bridgeId, jobId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Panel>Loading…</Panel>;
  if (error) return <Panel tone="error">{error}</Panel>;
  if (!resolvedId && jobId) return <CreateForm jobId={jobId} onCreated={(id) => { setResolvedId(id); void load(); }} />;
  if (!resolvedId) {
    return (
      <Panel tone="warn">
        Open this from a job (<code>?job_id=…</code>) to start coordinating, or
        <code> ?bridge_id=…</code> to open an existing bridge.
      </Panel>
    );
  }
  if (!view) return <Panel>Loading bridge…</Panel>;

  const terminal = view.bridge.status === 'completed' || view.bridge.status === 'cancelled';

  return (
    <div className="space-y-4">
      <HeaderCard view={view} onReload={load} />
      {view.slots.slice().sort((a, b) => a.sort_order - b.sort_order).map((slot) => (
        <SlotCard
          key={slot.id}
          slot={slot}
          docs={view.documents.filter((d) => d.slot_id === slot.id)}
          bridgeId={resolvedId}
          disabled={terminal}
          onMutate={load}
        />
      ))}
      {!terminal && <AddDocRequest bridgeId={resolvedId} onMutate={load} />}
      {!terminal && <ControlsCard view={view} onMutate={load} />}
    </div>
  );
}

/* ── Create ─────────────────────────────────────────────────────────── */
function CreateForm({ jobId, onCreated }: { jobId: string; onCreated: (id: string) => void }) {
  const [company, setCompany] = useState('');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const { data, error } = await sb().rpc('bridge_create', {
        p_job_id: jobId, p_company_name: company.trim(), p_contact_name: contact.trim() || null,
        p_contact_email: email.trim(), p_contact_phone: null, p_country_code: null,
        p_timezone: null, p_language_code: 'en', p_token_ttl_days: 60,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const token = row.raw_token as string;
      try {
        await sb().rpc('bridge_send_invitation', { p_bridge_id: row.bridge_id, p_raw_token: token, p_portal_base: PORTAL_BASE });
      } catch { /* invitation queue failed — link can be copied below */ }
      setCreatedUrl(`${PORTAL_BASE}/${token}`);
      onCreated(row.bridge_id as string);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (createdUrl) {
    return (
      <Panel tone="ok">
        <p className="font-semibold text-emerald-300">Bridge created — invitation queued.</p>
        <p className="mt-2 text-xs text-zinc-400">One-time link (we store only its hash):</p>
        <code className="mt-1 block break-all rounded bg-black/30 p-2 text-[11px] text-violet-200">{createdUrl}</code>
      </Panel>
    );
  }

  return (
    <Panel>
      <h2 className="text-base font-semibold text-white">Open a Coordination Bridge</h2>
      <p className="mt-1 text-sm text-zinc-400">We email the vendor a private link — no NEXPEC account needed.</p>
      <div className="mt-4 space-y-3">
        <Input label="Company name" value={company} onChange={setCompany} placeholder="ACME Manufacturing GmbH" />
        <Input label="Contact name (optional)" value={contact} onChange={setContact} placeholder="Anna Schmidt" />
        <Input label="Contact email" value={email} onChange={setEmail} placeholder="anna@acme-mfg.de" />
        <button
          type="button"
          disabled={busy || !company.trim() || !email.trim()}
          onClick={create}
          className="w-full rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Send invitation'}
        </button>
      </div>
    </Panel>
  );
}

/* ── Header + slots ─────────────────────────────────────────────────── */
function HeaderCard({ view, onReload }: { view: BridgeView; onReload: () => void }) {
  return (
    <Panel>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">{view.vendor.company_name}</h2>
          <p className="text-sm text-zinc-400">
            {view.vendor.contact_name ? `${view.vendor.contact_name} · ` : ''}{view.vendor.contact_email}
          </p>
        </div>
        <button onClick={onReload} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/5">
          Reload
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Row k="Status" v={view.bridge.status} />
        <Row k="Token expires" v={fmt(view.bridge.token_expires_at)} />
        <Row k="Vendor sessions" v={String(view.bridge.vendor_session_count)} />
        {view.bridge.vendor_last_seen_at && <Row k="Last seen" v={fmt(view.bridge.vendor_last_seen_at)} />}
      </dl>
    </Panel>
  );
}

function SlotCard({ slot, docs, bridgeId, disabled, onMutate }: {
  slot: Slot; docs: BridgeDoc[]; bridgeId: string; disabled: boolean; onMutate: () => void;
}) {
  return (
    <Panel>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-violet-300">{label(slot.kind)}</p>
          <h3 className="mt-0.5 text-sm font-semibold text-white">{slot.title}</h3>
        </div>
        <StatusPill status={slot.status} required={slot.required} />
      </div>

      {slot.kind === 'schedule' && (
        <ScheduleSlot slot={slot} bridgeId={bridgeId} disabled={disabled} onMutate={onMutate} />
      )}

      {slot.kind === 'document_request' && (
        <div className="mt-3 space-y-2">
          {docs.length === 0 ? (
            <p className="text-xs text-zinc-500">No file uploaded yet.</p>
          ) : docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm text-white">{d.original_filename}</p>
                <p className="font-mono text-[10px] text-zinc-500">SHA-256 {d.sha256_client_computed.slice(0, 14)}…</p>
                {d.rejected_reason && <p className="text-[11px] text-rose-300">Rejected: {d.rejected_reason}</p>}
              </div>
              {d.accepted_at ? <Tag tone="ok">ACCEPTED</Tag>
                : d.rejected_at ? <Tag tone="bad">REJECTED</Tag>
                : disabled ? null
                : <DocActions docId={d.id} onMutate={onMutate} />}
            </div>
          ))}
        </div>
      )}

      {slot.kind === 'site_access' && slot.payload_json?.declared_at ? (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Row k="PPE" v={joinList(slot.payload_json?.ppe)} />
          <Row k="Escort" v={slot.payload_json?.escort_required ? 'Required' : 'Not required'} />
          <Row k="Entry hours" v={String(slot.payload_json?.entry_hours ?? '—')} />
          <Row k="Contact" v={String(slot.payload_json?.contact_on_arrival ?? '—')} />
        </dl>
      ) : null}

      {slot.kind === 'pre_inspection_ack' && slot.status === 'completed' ? (
        <p className="mt-3 text-sm text-emerald-300">✓ Vendor acknowledged scope.</p>
      ) : null}

      {slot.kind === 'arrival_ack' && slot.status === 'completed' ? (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Row k="Signed by" v={String(slot.payload_json?.typed_name ?? '—')} />
          <Row k="Signed at" v={fmt(String(slot.payload_json?.signed_at ?? ''))} />
        </dl>
      ) : null}
    </Panel>
  );
}

function ScheduleSlot({ slot, bridgeId, disabled, onMutate }: {
  slot: Slot; bridgeId: string; disabled: boolean; onMutate: () => void;
}) {
  const [iso, setIso] = useState('');
  const [busy, setBusy] = useState(false);
  const proposed = slot.payload_json?.proposed_at ? fmt(String(slot.payload_json.proposed_at)) : null;
  const proposedBy = String(slot.payload_json?.proposed_by_kind ?? '');
  const vendorCountered = slot.status === 'awaiting_inspector' && proposedBy === 'vendor';

  const run = async (fn: () => PromiseLike<{ error: unknown }>) => {
    setBusy(true);
    try { const { error } = await fn(); if (error) throw error; setIso(''); onMutate(); }
    catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  if (slot.status === 'completed') {
    return <p className="mt-3 text-sm text-emerald-300">✓ Scheduled for {fmt(String(slot.payload_json?.agreed_at ?? slot.payload_json?.proposed_at ?? ''))}</p>;
  }

  return (
    <div className="mt-3 space-y-3">
      {proposed && (
        <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.04] p-2.5 text-sm">
          <span className="text-zinc-400">{vendorCountered ? 'Vendor counter-proposed' : 'Proposed'}: </span>
          <span className="font-medium text-white">{proposed}</span>
        </div>
      )}
      {/* Inspector locks the vendor's counter in one action (new RPC). */}
      {vendorCountered && (
        <button
          type="button" disabled={disabled || busy}
          onClick={() => run(() => sb().rpc('bridge_accept_counter_schedule', { p_bridge_id: bridgeId, p_slot_id: slot.id }))}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? 'Locking…' : 'Accept vendor’s date & lock'}
        </button>
      )}
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          {proposed ? 'Propose a different date' : 'Propose inspection date'}
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            type="datetime-local" value={iso} onChange={(e) => setIso(e.target.value)} disabled={disabled || busy}
            className="flex-1 rounded-md border border-white/[0.08] bg-[#020420] px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
          />
          <button
            type="button" disabled={disabled || busy || !iso}
            onClick={() => run(() => sb().rpc('bridge_propose_schedule', { p_bridge_id: bridgeId, p_proposed_at: new Date(iso).toISOString(), p_timezone: 'UTC', p_notes: null }))}
            className="rounded-md border border-violet-500/40 bg-violet-500/[0.12] px-4 py-2 text-sm font-medium text-violet-200 hover:bg-violet-500/[0.2] disabled:opacity-50"
          >
            Propose
          </button>
        </div>
      </div>
    </div>
  );
}

function DocActions({ docId, onMutate }: { docId: string; onMutate: () => void }) {
  const [busy, setBusy] = useState(false);
  const act = async (accept: boolean) => {
    setBusy(true);
    try {
      if (accept) {
        const { error } = await sb().rpc('bridge_accept_document', { p_document_id: docId });
        if (error) throw error;
      } else {
        const reason = prompt('Reason for rejecting (≥ 3 chars):')?.trim();
        if (!reason || reason.length < 3) { setBusy(false); return; }
        const { error } = await sb().rpc('bridge_reject_document', { p_document_id: docId, p_reason: reason });
        if (error) throw error;
      }
      onMutate();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex shrink-0 gap-1.5">
      <button disabled={busy} onClick={() => act(true)} className="rounded-md border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50">Accept</button>
      <button disabled={busy} onClick={() => act(false)} className="rounded-md border border-rose-500/40 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">Reject</button>
    </div>
  );
}

function AddDocRequest({ bridgeId, onMutate }: { bridgeId: string; onMutate: () => void }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      const { error } = await sb().rpc('bridge_add_document_request', {
        p_bridge_id: bridgeId, p_title: title.trim(), p_description: null, p_required: true, p_max_size_mb: 50,
      });
      if (error) throw error;
      setTitle(''); onMutate();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <Panel>
      <h3 className="text-sm font-semibold text-white">Request a document</h3>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bill of Materials, latest revision"
          className="flex-1 rounded-md border border-white/[0.08] bg-[#020420] px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
        />
        <button type="button" disabled={busy || !title.trim()} onClick={add}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50">
          Add request
        </button>
      </div>
    </Panel>
  );
}

function ControlsCard({ view, onMutate }: { view: BridgeView; onMutate: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => PromiseLike<{ error: unknown }>, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true);
    try { const { error } = await fn(); if (error) throw error; onMutate(); }
    catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const rotate = async () => {
    setBusy(true);
    try {
      const { data, error } = await sb().rpc('bridge_rotate_token', { p_bridge_id: view.bridge.id, p_token_ttl_days: 60 });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      await sb().rpc('bridge_send_invitation', { p_bridge_id: view.bridge.id, p_raw_token: String(row.raw_token), p_portal_base: PORTAL_BASE });
      onMutate();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <Panel>
      <h3 className="text-sm font-semibold text-white">Bridge controls</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        <button disabled={busy} onClick={rotate} className="rounded-md border border-violet-500/40 px-3 py-1.5 text-xs text-violet-200 hover:bg-violet-500/10 disabled:opacity-50">Rotate link &amp; resend</button>
        <button disabled={busy} onClick={() => run(() => sb().rpc('bridge_complete', { p_bridge_id: view.bridge.id }), 'Mark this bridge complete? The vendor link is revoked.')} className="rounded-md border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50">Mark complete</button>
        <button disabled={busy} onClick={() => run(() => sb().rpc('bridge_cancel', { p_bridge_id: view.bridge.id, p_reason: prompt('Reason for cancelling?') ?? '' }), 'Cancel this bridge? The vendor link is revoked.')} className="rounded-md border border-rose-500/40 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">Cancel bridge</button>
      </div>
    </Panel>
  );
}

/* ── Atoms ──────────────────────────────────────────────────────────── */
function Panel({ children, tone }: { children: React.ReactNode; tone?: 'error' | 'warn' | 'ok' }) {
  const border = tone === 'error' ? 'border-rose-500/30' : tone === 'warn' ? 'border-amber-500/30' : tone === 'ok' ? 'border-emerald-500/30' : 'border-white/[0.06]';
  return <section className={`rounded-2xl border ${border} bg-white/[0.02] p-5 text-sm text-zinc-300`}>{children}</section>;
}
function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex flex-col"><dt className="text-[11px] uppercase tracking-wide text-zinc-500">{k}</dt><dd className="text-white">{v}</dd></div>;
}
function StatusPill({ status, required }: { status: string; required: boolean }) {
  const tone = status === 'completed' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    : status === 'rejected' ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
    : status === 'awaiting_inspector' ? 'border-violet-500/30 bg-violet-500/10 text-violet-300'
    : status === 'awaiting_vendor' ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
    : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300';
  const text = status === 'awaiting_inspector' ? 'YOUR TURN' : status === 'awaiting_vendor' ? 'AWAITING VENDOR' : status.toUpperCase().replace(/_/g, ' ');
  return <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] ${tone}`}>{text}{required ? '' : ' · OPT'}</span>;
}
function Tag({ children, tone }: { children: React.ReactNode; tone: 'ok' | 'bad' }) {
  const c = tone === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300';
  return <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${c}`}>{children}</span>;
}
function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-md border border-white/[0.08] bg-[#020420] px-3 py-2 text-sm text-white outline-none focus:border-violet-500" />
    </label>
  );
}
function joinList(v: unknown): string { return Array.isArray(v) ? (v.map(String).join(', ') || '—') : (typeof v === 'string' ? v || '—' : '—'); }
function label(kind: Slot['kind']): string {
  return ({ schedule: 'INSPECTION DATE', document_request: 'DOCUMENT REQUEST', site_access: 'SITE ACCESS', pre_inspection_ack: 'PRE-INSPECTION', arrival_ack: 'ARRIVAL SIGN-OFF' } as const)[kind] ?? 'SLOT';
}
function fmt(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
