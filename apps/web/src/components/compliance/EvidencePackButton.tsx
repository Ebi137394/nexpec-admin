'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/compliance/EvidencePackButton.tsx
//
//  The headline CTA: "Generate SOX Audit Pack". Sleek violet button with
//  a Shield icon. On click → opens the receipt dialog which orchestrates
//  the assembly + download flow.
//
//  Strict visual tokens — bg #020420, primary #7C3AED. Military-grade
//  copy: chain-of-custody, audit-stamped, SHA-256, hash fingerprint.
//  Designed to make a customer's Internal Audit lead actually smile.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { FileCheck, Shield } from 'lucide-react';

import { cn } from '@/lib/cn';
import { EvidencePackReceiptDialog } from './EvidencePackReceiptDialog';

interface Props {
  jobId: string;
  jobTitle: string;
  /** Compact pill variant for tight headers. Default false. */
  compact?: boolean;
}

export function EvidencePackButton({ jobId, jobTitle, compact = false }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'group inline-flex items-center gap-2 rounded-xl border bg-gradient-to-b text-violet-glow ring-1 ring-inset transition-all',
          'from-violet/[0.18] to-violet/[0.05] border-violet/40 ring-violet/40',
          'hover:from-violet/25 hover:to-violet/10 hover:border-violet/60',
          'shadow-[0_0_0_1px_rgba(124,58,237,0.15),0_8px_24px_-8px_rgba(124,58,237,0.30)]',
          compact ? 'px-3 py-1.5 text-[11px]' : 'px-4 py-2.5 text-xs',
        )}
        aria-label="Generate SOX audit pack"
      >
        <span className="relative">
          <Shield
            className={cn('text-violet-glow', compact ? 'h-3.5 w-3.5' : 'h-4 w-4')}
            strokeWidth={1.75}
          />
          <FileCheck
            className={cn(
              'absolute -bottom-0.5 -right-0.5 text-cyan-glow opacity-90',
              compact ? 'h-2 w-2' : 'h-2.5 w-2.5',
            )}
            strokeWidth={2.5}
          />
        </span>
        <span className="font-semibold uppercase tracking-industrial">
          Generate SOX Audit Pack
        </span>
        <span
          aria-hidden
          className={cn(
            'hidden font-mono uppercase tracking-industrial text-violet-glow/70 group-hover:text-violet-glow sm:inline',
            compact ? 'text-[8px]' : 'text-[9px]',
          )}
        >
          SHA-256
        </span>
      </button>

      <EvidencePackReceiptDialog
        open={open}
        onClose={() => setOpen(false)}
        jobId={jobId}
        jobTitle={jobTitle}
      />
    </>
  );
}
