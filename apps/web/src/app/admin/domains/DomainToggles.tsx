// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/app/admin/domains/DomainToggles.tsx
//
//  Client island — two toggles per domain card. Wires user clicks to
//  the server actions in `apps/web/src/lib/actions/inspectionDomains.ts`.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useState, useTransition } from 'react';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  setInspectionDomainLaunched,
  setInspectionDomainActive,
} from '@/lib/actions/inspectionDomains';

interface Props {
  slug: string;
  isLaunched: boolean;
  isActive: boolean;
}

type ToggleStatus = 'idle' | 'pending' | 'success' | 'error';

export function DomainToggles({
  slug,
  isLaunched: initialLaunched,
  isActive: initialActive,
}: Props) {
  const [launched, setLaunched] = useState(initialLaunched);
  const [active, setActive] = useState(initialActive);
  const [launchedStatus, setLaunchedStatus] = useState<ToggleStatus>('idle');
  const [activeStatus, setActiveStatus] = useState<ToggleStatus>('idle');
  const [launchedErr, setLaunchedErr] = useState<string | null>(null);
  const [activeErr, setActiveErr] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const onToggleLaunched = (next: boolean) => {
    setLaunchedStatus('pending');
    setLaunchedErr(null);
    startTransition(async () => {
      const result = await setInspectionDomainLaunched(slug, next);
      if (result.ok) {
        setLaunched(next);
        setLaunchedStatus('success');
        // fade success indicator after a moment
        setTimeout(() => setLaunchedStatus('idle'), 1800);
      } else {
        setLaunchedStatus('error');
        setLaunchedErr(result.error ?? 'Toggle failed.');
      }
    });
  };

  const onToggleActive = (next: boolean) => {
    setActiveStatus('pending');
    setActiveErr(null);
    startTransition(async () => {
      const result = await setInspectionDomainActive(slug, next);
      if (result.ok) {
        setActive(next);
        setActiveStatus('success');
        setTimeout(() => setActiveStatus('idle'), 1800);
      } else {
        setActiveStatus('error');
        setActiveErr(result.error ?? 'Toggle failed.');
      }
    });
  };

  return (
    <div className="space-y-3 rounded-xl border border-white/[0.06] bg-ink-950/40 p-3">
      <ToggleRow
        label="Launched"
        helpText="Publicly visible in the marketplace."
        value={launched}
        onChange={onToggleLaunched}
        status={launchedStatus}
        error={launchedErr}
      />
      <div className="h-px bg-white/[0.04]" />
      <ToggleRow
        label="Active"
        helpText="Kill-switch. Off = hidden from every surface immediately."
        value={active}
        onChange={onToggleActive}
        status={activeStatus}
        error={activeErr}
      />
    </div>
  );
}

function ToggleRow({
  label,
  helpText,
  value,
  onChange,
  status,
  error,
}: {
  label: string;
  helpText: string;
  value: boolean;
  onChange: (next: boolean) => void;
  status: ToggleStatus;
  error: string | null;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-zinc-100">{label}</p>
          <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">
            {helpText}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(!value)}
          disabled={status === 'pending'}
          aria-pressed={value}
          aria-label={`${label} — ${value ? 'on' : 'off'}`}
          className={
            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ' +
            (value
              ? 'bg-violet-500/80 ring-1 ring-violet-400/30'
              : 'bg-white/[0.08] ring-1 ring-white/[0.06]') +
            (status === 'pending' ? ' opacity-60' : '')
          }
        >
          <span
            className={
              'inline-block h-5 w-5 transform rounded-full bg-white shadow-[0_4px_12px_-2px_rgba(124,58,237,0.55)] transition-transform ' +
              (value ? 'translate-x-5' : 'translate-x-0.5')
            }
          />
        </button>
      </div>

      {/* Status line */}
      <div className="mt-1.5 flex h-4 items-center text-[10px]">
        {status === 'pending' && (
          <span className="flex items-center gap-1 text-zinc-500">
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            Saving…
          </span>
        )}
        {status === 'success' && (
          <span className="flex items-center gap-1 text-emerald-400">
            <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
            Saved
          </span>
        )}
        {status === 'error' && (
          <span className="flex items-center gap-1 text-red-400">
            <AlertCircle className="h-3 w-3" strokeWidth={2} />
            {error ?? 'Failed'}
          </span>
        )}
      </div>
    </div>
  );
}
