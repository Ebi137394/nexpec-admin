'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/compliance/EvidencePackReceiptDialog.tsx
//
//  The chain-of-custody receipt. Orchestrates the assembly flow:
//
//    1. Open with "Assembling" state — animated shield, copy about
//       what's being captured.
//    2. Call assembleEvidencePackAction — returns the full pack.
//    3. Switch to "Ready" state — render the bill of materials with
//       per-artifact SHA-256 fingerprints, root hash banner, and
//       Download .json button.
//    4. On error — render the failure state with the raw RPC message.
//
//  Strict UI: bg #020420, primary #7C3AED. Monospace everywhere we
//  display hashes — the auditor's eye expects fingerprints to LOOK
//  like fingerprints.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState, useTransition } from 'react';
import {
  X,
  Shield,
  Fingerprint,
  Loader2,
  Download,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Hash,
  Clock,
  ScrollText,
  Building2,
  Receipt,
  Users,
  Folder,
  ShieldCheck,
  FileSignature,
} from 'lucide-react';

import type {
  EvidencePack,
  EvidenceManifestEntry,
} from '@nexpec/shared-core';
import {
  assembleEvidencePackAction,
  filenameForEvidencePack,
  serializeEvidencePackForDownload,
} from '@/lib/actions/compliance';
import { cn } from '@/lib/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  jobId: string;
  jobTitle: string;
}

type DialogState =
  | { kind: 'idle' }
  | { kind: 'assembling' }
  | { kind: 'ready'; pack: EvidencePack; filename: string; fileText: string }
  | { kind: 'error'; message: string };

export function EvidencePackReceiptDialog({
  open,
  onClose,
  jobId,
  jobTitle,
}: Props) {
  const [state, setState] = useState<DialogState>({ kind: 'idle' });
  const [, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  // Kick off assembly when the dialog opens.
  useEffect(() => {
    if (!open) {
      setState({ kind: 'idle' });
      setCopied(false);
      return;
    }
    setState({ kind: 'assembling' });
    startTransition(async () => {
      const res = await assembleEvidencePackAction({ jobId });
      if (!res.ok || !res.payload) {
        setState({
          kind: 'error',
          message: res.error ?? 'Could not assemble the evidence pack.',
        });
        return;
      }
      const pack = res.payload;
      const [filename, fileText] = await Promise.all([
        filenameForEvidencePack(pack),
        serializeEvidencePackForDownload(pack),
      ]);
      setState({ kind: 'ready', pack, filename, fileText });
    });
  }, [open, jobId]);

  // Esc + body scroll lock.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleDownload = () => {
    if (state.kind !== 'ready') return;
    const blob = new Blob([state.fileText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleCopyRoot = async () => {
    if (state.kind !== 'ready') return;
    try {
      await navigator.clipboard.writeText(state.pack.manifest.root_hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Compliance evidence pack"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink-950/85 backdrop-blur-sm"
      />

      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-violet/40 bg-ink-900/97 shadow-[0_24px_72px_-12px_rgba(124,58,237,0.45)]">
        {/* ── Header — military-grade tone ─────────────────────── */}
        <header className="relative border-b border-violet/30 bg-gradient-to-r from-violet/[0.10] via-violet/[0.04] to-cyan-glow/[0.04] px-5 py-4">
          <div
            aria-hidden
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                'repeating-linear-gradient(45deg, transparent 0 12px, rgba(124,58,237,0.04) 12px 13px)',
            }}
          />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
                <Shield className="h-3 w-3" strokeWidth={2} />
                COMPLIANCE EVIDENCE LOCKER · CEL/1.0
              </p>
              <h3 className="mt-1.5 font-display text-base font-semibold text-white">
                Audit pack for {jobTitle}
              </h3>
              <p className="mt-0.5 font-mono text-[10px] text-zinc-500">
                JOB · {jobId.slice(0, 8).toUpperCase()}…
                {jobId.slice(-4).toUpperCase()}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-1 text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-100"
              aria-label="Close"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </header>

        {/* ── Body (scrollable) ────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {state.kind === 'assembling' && <AssemblingState />}
          {state.kind === 'error' && <ErrorState message={state.message} />}
          {state.kind === 'ready' && (
            <ReadyState
              pack={state.pack}
              filename={state.filename}
              onCopyRoot={handleCopyRoot}
              copied={copied}
            />
          )}
        </div>

        {/* ── Footer actions ───────────────────────────────────── */}
        <footer className="border-t border-white/[0.06] bg-white/[0.01] px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[9px] uppercase tracking-industrial text-zinc-600">
              {state.kind === 'ready'
                ? 'SHA-256 · CHAIN-OF-CUSTODY VERIFIED · RE-EXPORT TO RE-VERIFY'
                : 'ASSEMBLING…'}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-industrial text-zinc-300 transition-colors hover:bg-white/[0.04] hover:text-white"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={state.kind !== 'ready'}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-industrial transition-colors',
                  state.kind === 'ready'
                    ? 'bg-violet/25 text-violet-glow ring-1 ring-inset ring-violet/50 hover:bg-violet/35'
                    : 'cursor-not-allowed bg-white/[0.03] text-zinc-600',
                )}
              >
                <Download className="h-3.5 w-3.5" strokeWidth={2} />
                Download .json
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ─── states ──────────────────────────────────────────────────────── */

function AssemblingState() {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="relative">
        <div
          aria-hidden
          className="absolute -inset-3 animate-pulse rounded-full bg-violet/15 blur-2xl"
        />
        <div className="relative inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-violet/40 bg-violet/15">
          <Shield className="h-7 w-7 text-violet-glow" strokeWidth={1.5} />
        </div>
      </div>
      <p className="mt-5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-industrial text-violet-glow">
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
        Assembling chain-of-custody…
      </p>
      <ul className="mt-5 space-y-1.5 text-center text-[11px] text-zinc-400">
        <li>Snapshotting job + parties</li>
        <li>Walking contract revisions + signature evidence</li>
        <li>Pulling approval workflow + decisions</li>
        <li>Capturing invoices + cost-center attribution</li>
        <li>Sealing audit-event trail</li>
        <li>Computing SHA-256 fingerprints</li>
      </ul>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-rose-400/40 bg-rose-500/10">
        <AlertTriangle className="h-7 w-7 text-rose-300" strokeWidth={1.5} />
      </div>
      <p className="mt-5 font-display text-base font-semibold text-white">
        Could not assemble the pack
      </p>
      <p className="mt-2 max-w-md text-center text-xs text-zinc-400">
        {message}
      </p>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-industrial text-zinc-600">
        No partial export written · no audit row created
      </p>
    </div>
  );
}

function ReadyState({
  pack,
  filename,
  onCopyRoot,
  copied,
}: {
  pack: EvidencePack;
  filename: string;
  onCopyRoot: () => void;
  copied: boolean;
}) {
  return (
    <div className="space-y-5">
      {/* Root-hash banner — the headline number */}
      <section className="rounded-2xl border border-violet/40 bg-gradient-to-br from-violet/15 via-violet/[0.06] to-transparent p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
            <Fingerprint className="h-3 w-3" strokeWidth={2} />
            ROOT HASH · SHA-256
          </p>
          <button
            type="button"
            onClick={onCopyRoot}
            className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-1 font-mono text-[9px] uppercase tracking-industrial text-zinc-300 transition-colors hover:border-violet/40 hover:text-violet-glow"
          >
            {copied ? (
              <>
                <CheckCircle2 className="h-3 w-3 text-emerald-300" strokeWidth={2} />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" strokeWidth={2} />
                Copy
              </>
            )}
          </button>
        </div>
        <p
          className="mt-3 break-all font-mono text-[12px] leading-relaxed text-white"
          title={pack.manifest.root_hash}
        >
          {formatHashGroups(pack.manifest.root_hash)}
        </p>
        <p className="mt-2 text-[10px] text-zinc-500">
          The auditor's verification target. Two exports of the same job
          against unchanged DB state must produce the same root hash.
        </p>
      </section>

      {/* Bill of materials */}
      <section>
        <header className="mb-2 flex items-center justify-between">
          <p className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
            <ScrollText className="h-3 w-3 text-violet-glow" strokeWidth={2} />
            BILL OF MATERIALS
          </p>
          <p className="font-mono text-[10px] uppercase tracking-industrial text-zinc-600">
            {pack.manifest.artifacts.length} ARTIFACTS
          </p>
        </header>
        <ul className="space-y-1.5">
          {pack.manifest.artifacts.map((entry) => (
            <ArtifactRow key={entry.name} entry={entry} />
          ))}
        </ul>
      </section>

      {/* Envelope metadata */}
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <p className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
          <FileSignature className="h-3 w-3 text-violet-glow" strokeWidth={2} />
          EXPORT ENVELOPE
        </p>
        <dl className="mt-3 grid grid-cols-1 gap-y-1.5 text-[11px] sm:grid-cols-2 sm:gap-x-6">
          <EnvelopeRow
            icon={<Hash className="h-3 w-3" strokeWidth={2} />}
            label="Export ID"
            value={pack.envelope.export_id}
            mono
          />
          <EnvelopeRow
            icon={<Clock className="h-3 w-3" strokeWidth={2} />}
            label="Exported at"
            value={pack.envelope.exported_at}
            mono
          />
          <EnvelopeRow
            icon={<Users className="h-3 w-3" strokeWidth={2} />}
            label="Exported by"
            value={`${pack.envelope.exported_by_label} · ${pack.envelope.exported_by_role}`}
          />
          <EnvelopeRow
            icon={<Building2 className="h-3 w-3" strokeWidth={2} />}
            label="Platform"
            value={`${pack.envelope.platform} · v${pack.envelope.generator_version}`}
            mono
          />
          <EnvelopeRow
            icon={<ShieldCheck className="h-3 w-3" strokeWidth={2} />}
            label="Correlation ID"
            value={pack.envelope.correlation_id || '—'}
            mono
          />
          <EnvelopeRow
            icon={<Download className="h-3 w-3" strokeWidth={2} />}
            label="Filename"
            value={filename}
            mono
          />
        </dl>
      </section>

      {/* SOX-grade hint */}
      <p className="rounded-lg border border-emerald-400/25 bg-emerald-500/[0.06] px-4 py-3 text-[11px] text-emerald-100">
        <span className="font-semibold">Verification protocol:</span> the
        auditor parses the JSON, recomputes the SHA-256 of each artifact
        via canonical-JSON serialisation, and verifies each hash matches
        the manifest entry. They then recompute the root hash over the
        manifest's artifacts array and compare to the value above. Any
        modification of any artifact breaks at least one hash — and
        therefore the root hash.
      </p>
    </div>
  );
}

/* ─── small subcomponents ─────────────────────────────────────────── */

function ArtifactRow({ entry }: { entry: EvidenceManifestEntry }) {
  const Icon = iconForArtifact(entry.name);
  return (
    <li className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-industrial text-white">
            {entry.name}
          </span>
          <span className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-px font-mono text-[9px] text-zinc-400">
            n={entry.count}
          </span>
        </p>
        <p
          className="mt-1 truncate font-mono text-[10px] text-zinc-500"
          title={entry.hash}
        >
          {entry.hash}
        </p>
      </div>
    </li>
  );
}

function EnvelopeRow({
  icon,
  label,
  value,
  mono = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-industrial text-zinc-500">
        <span className="text-violet-glow/70">{icon}</span>
        {label}
      </dt>
      <dd
        className={cn(
          'truncate text-[11px] text-zinc-200',
          mono && 'font-mono',
        )}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function iconForArtifact(name: string) {
  switch (name) {
    case 'job':
      return Folder;
    case 'parties':
      return Users;
    case 'department':
      return Building2;
    case 'contracts':
      return FileSignature;
    case 'approvals':
      return ShieldCheck;
    case 'invoices':
      return Receipt;
    case 'audit_events':
      return ScrollText;
    default:
      return Folder;
  }
}

/** Pretty-print a 64-char hex hash as four 16-char groups. */
function formatHashGroups(hash: string): string {
  const cleaned = hash.toUpperCase().replace(/[^0-9A-F]/g, '');
  return cleaned.match(/.{1,16}/g)?.join(' ') ?? hash;
}
