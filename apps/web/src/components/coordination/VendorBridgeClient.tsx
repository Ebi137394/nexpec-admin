// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/components/coordination/VendorBridgeClient.tsx
//
//  COORDINATION BRIDGE — vendor-side interactive surface.
//
//  Single client component that:
//    1. Calls vendor-bridge-auth (action: get_state) on mount.
//    2. Renders the bridge's slots, documents, and call-to-action surface.
//    3. Submits vendor actions (accept schedule, counter, upload, sign
//       arrival, declare site access) through the same Edge Function.
//
//  Uploads use a two-step pattern:
//    a) Ask the Edge Function for a signed-upload URL.
//    b) Vendor's browser PUTs the file directly to Supabase Storage.
//    c) Vendor's browser computes SHA-256 of the file via SubtleCrypto
//       and calls back to register_uploaded_document with the path + hash.
//
//  Dark/purple, single-column, mobile-friendly. No NEXPEC chrome.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { alertDialog } from '@/components/ui/AppDialog';

interface BridgeState {
  bridge: {
    id: string;
    status: string;
    token_expires_at: string;
    token_revoked_at: string | null;
    created_at: string;
    completed_at: string | null;
    cancelled_at: string | null;
  };
  job: {
    id: string;
    title: string;
    location_city: string | null;
    scheduled_date: string | null;
  };
  inspector: { display_name: string };
  vendor: {
    id: string;
    company_name: string;
    contact_name: string | null;
    contact_email: string;
    language_code: string;
    timezone: string | null;
  };
  slots: BridgeSlot[];
  documents: BridgeDocument[];
}

interface BridgeSlot {
  id: string;
  kind: 'schedule' | 'document_request' | 'site_access' | 'pre_inspection_ack' | 'arrival_ack';
  status: 'pending' | 'awaiting_vendor' | 'awaiting_inspector' | 'completed' | 'rejected';
  title: string;
  description: string | null;
  required: boolean;
  sort_order: number;
  payload: Record<string, unknown>;
  created_at: string;
  last_action_at: string | null;
  completed_at: string | null;
}

interface BridgeDocument {
  id: string;
  slot_id: string | null;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string;
  created_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
  rejected_reason: string | null;
}

function getAuthUrl(): string {
  // Production: derive from NEXT_PUBLIC_SUPABASE_URL. Fallback works for local dev.
  // deno-lint-ignore no-explicit-any
  const url = (typeof process !== 'undefined' ? (process as any).env?.NEXT_PUBLIC_SUPABASE_URL : '') || '';
  if (!url) return '/functions/v1/vendor-bridge-auth';
  return `${url.replace(/\/+$/, '')}/functions/v1/vendor-bridge-auth`;
}

async function callBridge(
  token: string,
  action: string,
  payload?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(getAuthUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, action, payload: payload ?? {} }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = typeof body.error === 'string' ? body.error : `http_${res.status}`;
    throw new Error(err);
  }
  return body;
}

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function VendorBridgeClient({ token }: { token: string }) {
  const [state, setState] = useState<BridgeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await callBridge(token, 'get_state');
      setState(res.state as BridgeState);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-10 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-violet-300">LOADING</p>
        <p className="mt-3 text-sm text-zinc-400">Opening your Coordination Bridge…</p>
      </div>
    );
  }

  if (error) {
    return <ErrorPanel error={error} />;
  }

  if (!state) return null;

  const isTerminal =
    state.bridge.status === 'completed' || state.bridge.status === 'cancelled';

  return (
    <div className="space-y-5">
      <HeaderCard state={state} />
      {isTerminal && <TerminalNotice status={state.bridge.status} />}

      <div className="space-y-4">
        {state.slots
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((slot) => (
            <SlotCard
              key={slot.id}
              slot={slot}
              documents={state.documents}
              token={token}
              disabled={isTerminal}
              onMutate={refresh}
            />
          ))}
      </div>
    </div>
  );
}

function HeaderCard({ state }: { state: BridgeState }) {
  const expires = formatDate(state.bridge.token_expires_at);
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-violet-300">
        INSPECTION
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
        {state.job.title}
      </h1>
      <p className="mt-3 text-sm text-zinc-400">
        Inspector <strong className="text-zinc-200">{state.inspector.display_name}</strong> is
        coordinating with <strong className="text-zinc-200">{state.vendor.company_name}</strong>.
      </p>
      <p className="mt-3 text-[11px] text-zinc-500">
        Your private link is valid until <span className="text-zinc-300">{expires}</span>.
      </p>
    </div>
  );
}

function TerminalNotice({ status }: { status: string }) {
  const isCompleted = status === 'completed';
  return (
    <div
      className={`rounded-2xl border p-4 text-sm ${
        isCompleted
          ? 'border-emerald-500/30 bg-emerald-500/[0.05] text-emerald-200'
          : 'border-rose-500/30 bg-rose-500/[0.05] text-rose-200'
      }`}
    >
      {isCompleted
        ? 'This Coordination Bridge has been marked complete. View-only.'
        : 'This Coordination Bridge has been cancelled. View-only.'}
    </div>
  );
}

function ErrorPanel({ error }: { error: string }) {
  const friendly =
    error === 'token_expired'
      ? 'This invitation link has expired. Please ask the inspector to send you a new one.'
      : error === 'token_revoked'
      ? 'This invitation link has been revoked. Please ask the inspector to send you a new one.'
      : error === 'unknown_token' || error === 'invalid_token'
      ? 'This invitation link is not recognised. Please verify you opened the most recent email from the inspector.'
      : `Something went wrong: ${error}`;

  return (
    <div className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.05] p-6 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-rose-300">
        UNABLE TO OPEN BRIDGE
      </p>
      <p className="mt-3 text-sm text-zinc-200">{friendly}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Slot renderers
// ─────────────────────────────────────────────────────────────────────

function SlotCard({
  slot,
  documents,
  token,
  disabled,
  onMutate,
}: {
  slot: BridgeSlot;
  documents: BridgeDocument[];
  token: string;
  disabled: boolean;
  onMutate: () => void;
}) {
  const slotDocs = useMemo(
    () => documents.filter((d) => d.slot_id === slot.id),
    [documents, slot.id],
  );

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-violet-300">
            {labelForKind(slot.kind)}
          </p>
          <h2 className="mt-1 text-base font-semibold text-white">{slot.title}</h2>
          {slot.description && (
            <p className="mt-1 text-sm text-zinc-400">{slot.description}</p>
          )}
        </div>
        <StatusPill status={slot.status} required={slot.required} />
      </div>

      <div className="mt-4">
        {slot.kind === 'schedule' && (
          <ScheduleSlot slot={slot} token={token} disabled={disabled} onMutate={onMutate} />
        )}
        {slot.kind === 'document_request' && (
          <DocumentSlot
            slot={slot}
            slotDocs={slotDocs}
            token={token}
            disabled={disabled}
            onMutate={onMutate}
          />
        )}
        {slot.kind === 'site_access' && (
          <SiteAccessSlot slot={slot} token={token} disabled={disabled} onMutate={onMutate} />
        )}
        {slot.kind === 'arrival_ack' && (
          <ArrivalSlot slot={slot} token={token} disabled={disabled} onMutate={onMutate} />
        )}
        {slot.kind === 'pre_inspection_ack' && (
          <PreInspectionAckSlot slot={slot} token={token} disabled={disabled} onMutate={onMutate} />
        )}
      </div>
    </section>
  );
}

function StatusPill({ status, required }: { status: string; required: boolean }) {
  const tone =
    status === 'completed'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      : status === 'rejected'
      ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
      : status === 'awaiting_vendor'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
      : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300';
  const label =
    status === 'awaiting_vendor'
      ? 'YOUR TURN'
      : status === 'awaiting_inspector'
      ? 'AWAITING INSPECTOR'
      : status.toUpperCase().replace(/_/g, ' ');
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] ${tone}`}
    >
      {label}{required ? '' : ', OPT'}
    </span>
  );
}

function labelForKind(kind: BridgeSlot['kind']): string {
  switch (kind) {
    case 'schedule': return 'INSPECTION DATE';
    case 'document_request': return 'DOCUMENT REQUEST';
    case 'site_access': return 'SITE ACCESS';
    case 'pre_inspection_ack': return 'PRE-INSPECTION';
    case 'arrival_ack': return 'ARRIVAL SIGN-OFF';
    default: return 'SLOT';
  }
}

function ScheduleSlot({
  slot,
  token,
  disabled,
  onMutate,
}: {
  slot: BridgeSlot;
  token: string;
  disabled: boolean;
  onMutate: () => void;
}) {
  const proposedAt = slot.payload?.['proposed_at'];
  const timezone = (slot.payload?.['timezone'] as string) ?? 'UTC';
  const [counterDate, setCounterDate] = useState('');
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    setBusy(true);
    try {
      await callBridge(token, 'accept_schedule', { slot_id: slot.id });
      onMutate();
    } catch (e) {
      void alertDialog(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const counter = async () => {
    if (!counterDate) {
      void alertDialog('Pick a date and time first.');
      return;
    }
    setBusy(true);
    try {
      await callBridge(token, 'counter_schedule', {
        slot_id: slot.id,
        proposed_at: new Date(counterDate).toISOString(),
        timezone,
      });
      onMutate();
    } catch (e) {
      void alertDialog(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {proposedAt ? (
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-violet-300">
            INSPECTOR PROPOSED
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {formatDate(String(proposedAt))} <span className="font-normal text-zinc-400">({timezone})</span>
          </p>
        </div>
      ) : (
        <p className="text-xs text-zinc-500">No date proposed yet.</p>
      )}

      {slot.status === 'completed' ? (
        <p className="text-sm text-emerald-300">
          ✓ Scheduled for {formatDate(String(slot.payload?.['agreed_at'] ?? proposedAt))}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={disabled || busy || !proposedAt}
              onClick={accept}
              className="flex-1 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
            >
              Accept proposed date
            </button>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              OR PROPOSE A DIFFERENT DATE
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                type="datetime-local"
                value={counterDate}
                onChange={(e) => setCounterDate(e.target.value)}
                disabled={disabled || busy}
                className="flex-1 rounded-md border border-white/[0.08] bg-[#020420] px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
              />
              <button
                type="button"
                disabled={disabled || busy || !counterDate}
                onClick={counter}
                className="rounded-md border border-violet-500/40 bg-violet-500/[0.12] px-4 py-2 text-sm font-medium text-violet-200 transition hover:bg-violet-500/[0.2] disabled:opacity-50"
              >
                Propose
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentSlot({
  slot,
  slotDocs,
  token,
  disabled,
  onMutate,
}: {
  slot: BridgeSlot;
  slotDocs: BridgeDocument[];
  token: string;
  disabled: boolean;
  onMutate: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setStage('Hashing file…');
    try {
      const sha256 = await sha256Hex(file);

      setStage('Requesting upload URL…');
      const urlResp = (await callBridge(token, 'create_upload_url', {
        slot_id: slot.id,
        filename: file.name,
        size_bytes: file.size,
      })) as { upload: { signed_url: string; storage_path: string } };

      setStage('Uploading to secure storage…');
      const putRes = await fetch(urlResp.upload.signed_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error(`upload_failed_${putRes.status}`);
      }

      setStage('Registering document…');
      await callBridge(token, 'register_uploaded_document', {
        slot_id: slot.id,
        storage_path: urlResp.upload.storage_path,
        filename: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        sha256,
      });

      onMutate();
    } catch (err) {
      void alertDialog(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setStage(null);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-3">
      {slotDocs.length === 0 ? (
        <p className="text-xs text-zinc-500">No file uploaded yet.</p>
      ) : (
        <ul className="space-y-2">
          {slotDocs.map((d) => (
            <li
              key={d.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{d.filename}</p>
                <p className="font-mono text-[10px] text-zinc-500">SHA-256 {d.sha256.slice(0, 16)}…</p>
              </div>
              <div className="shrink-0">
                {d.accepted_at ? (
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-300">
                    ACCEPTED
                  </span>
                ) : d.rejected_at ? (
                  <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-rose-300">
                    REJECTED
                  </span>
                ) : (
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-amber-300">
                    AWAITING REVIEW
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {slot.status !== 'completed' && (
        <label
          className={`flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-violet-500/40 bg-violet-500/[0.04] px-4 py-3 text-sm text-violet-200 transition hover:bg-violet-500/[0.08] ${
            disabled || busy ? 'cursor-not-allowed opacity-50' : ''
          }`}
        >
          {busy ? stage ?? 'Uploading…' : 'Upload document'}
          <input
            type="file"
            className="sr-only"
            onChange={upload}
            disabled={disabled || busy}
          />
        </label>
      )}
    </div>
  );
}

function SiteAccessSlot({
  slot,
  token,
  disabled,
  onMutate,
}: {
  slot: BridgeSlot;
  token: string;
  disabled: boolean;
  onMutate: () => void;
}) {
  const declared = !!slot.payload?.['declared_at'];
  const [ppe, setPpe] = useState((slot.payload?.['ppe'] as string[] | undefined)?.join(', ') ?? '');
  const [escort, setEscort] = useState(Boolean(slot.payload?.['escort_required']));
  const [badge, setBadge] = useState(Boolean(slot.payload?.['badge_required']));
  const [hours, setHours] = useState((slot.payload?.['entry_hours'] as string) ?? '');
  const [contact, setContact] = useState((slot.payload?.['contact_on_arrival'] as string) ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await callBridge(token, 'declare_site_access', {
        slot_id: slot.id,
        site_access: {
          ppe: ppe.split(',').map((s) => s.trim()).filter(Boolean),
          escort_required: escort,
          badge_required: badge,
          entry_hours: hours,
          contact_on_arrival: contact,
        },
      });
      onMutate();
    } catch (e) {
      void alertDialog(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="PPE required (comma-separated)" value={ppe} onChange={setPpe} disabled={disabled || busy} />
        <Field label="Entry hours" value={hours} onChange={setHours} disabled={disabled || busy} placeholder="08:00–17:00" />
        <Field label="Contact on arrival" value={contact} onChange={setContact} disabled={disabled || busy} placeholder="Name + phone" />
        <div className="flex items-center gap-4 pt-5">
          <Toggle label="Escort required" checked={escort} onChange={setEscort} disabled={disabled || busy} />
          <Toggle label="Badge required" checked={badge} onChange={setBadge} disabled={disabled || busy} />
        </div>
      </div>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={submit}
        className="w-full rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50 sm:w-auto"
      >
        {declared ? 'Update site access' : 'Submit site access'}
      </button>
    </div>
  );
}

function ArrivalSlot({
  slot,
  token,
  disabled,
  onMutate,
}: {
  slot: BridgeSlot;
  token: string;
  disabled: boolean;
  onMutate: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  if (slot.status === 'completed') {
    const signedName = String(slot.payload?.['typed_name'] ?? '');
    const signedAt = formatDate(String(slot.payload?.['signed_at'] ?? slot.completed_at ?? ''));
    return (
      <p className="text-sm text-emerald-300">
        ✓ Signed by <strong>{signedName}</strong> at {signedAt}
      </p>
    );
  }

  const sign = async () => {
    if (!name.trim()) {
      void alertDialog('Please type your full name to sign.');
      return;
    }
    setBusy(true);
    try {
      await callBridge(token, 'sign_arrival', {
        slot_id: slot.id,
        typed_name: name.trim(),
      });
      onMutate();
    } catch (e) {
      void alertDialog(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Sign on the day of the inspection to confirm the inspector arrived. Your typed name is
        cryptographically anchored into the inspection record.
      </p>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Type your full name"
        disabled={disabled || busy}
        className="w-full rounded-md border border-white/[0.08] bg-[#020420] px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
      />
      <button
        type="button"
        disabled={disabled || busy || !name.trim()}
        onClick={sign}
        className="w-full rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
      >
        Sign arrival
      </button>
    </div>
  );
}

function PreInspectionAckSlot({
  slot,
  token,
  disabled,
  onMutate,
}: {
  slot: BridgeSlot;
  token: string;
  disabled: boolean;
  onMutate: () => void;
}) {
  const [busy, setBusy] = useState(false);

  if (slot.status === 'completed') {
    return (
      <p className="text-sm text-emerald-300">
        ✓ Scope acknowledged{slot.payload?.['acknowledged_at']
          ? ` on ${formatDate(String(slot.payload['acknowledged_at']))}`
          : ''}.
      </p>
    );
  }

  const acknowledge = async () => {
    setBusy(true);
    try {
      await callBridge(token, 'acknowledge_scope', { slot_id: slot.id, scope: {} });
      onMutate();
    } catch (e) {
      void alertDialog(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Confirm you understand the inspection scope and your site is ready to host the inspection.
      </p>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={acknowledge}
        className="w-full rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50 sm:w-auto"
      >
        {busy ? 'Submitting…' : 'Acknowledge scope & confirm readiness'}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Small atoms
// ─────────────────────────────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="rounded-md border border-white/[0.08] bg-[#020420] px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
      />
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-zinc-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-4 w-4 rounded border-white/20 bg-[#020420] text-violet-500 focus:ring-violet-500"
      />
      {label}
    </label>
  );
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
