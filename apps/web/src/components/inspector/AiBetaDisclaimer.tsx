'use client';
// ─────────────────────────────────────────────────────────────────
//  components/inspector/AiBetaDisclaimer.tsx — mandatory Beta/Advisory
//  labelling for every AI Co-Inspector surface (owner release order,
//  2026-08-18): the AI ships ENABLED but advisory-only.
//
//  WEB PORT of src/shared-ui/ai/AiBetaDisclaimer.tsx (React Native). The
//  wording in AI_BETA_WARNING is byte-identical to Mobile on purpose — the
//  safety copy must not diverge by platform. Behaviour matches too:
//   • AiBetaDisclaimer — compact persistent warning, rendered beside every
//     AI result and in the findings card.
//   • AiBetaFirstUseNotice — one-time, NON-BLOCKING acknowledgement banner
//     (localStorage here, AsyncStorage on Mobile). It never gates the manual
//     inspection flow; dismissing it is purely an acknowledgement.
// ─────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';

export const AI_BETA_WARNING =
  'AI Co-Inspector (Beta): Results may be incomplete or incorrect. A qualified ' +
  'inspector must independently verify all findings. Do not use AI as the sole ' +
  'basis for safety, acceptance, rejection, or code-compliance decisions.';

const ACK_KEY = 'nexpec.ai_beta_ack.v1';

/** Compact persistent warning — render beside every AI result. */
export function AiBetaDisclaimer() {
  return (
    <div
      data-testid="ai-beta-disclaimer"
      className="my-2 rounded-xl border border-accent-amber/60 bg-accent-amber/[0.08] p-3"
    >
      <p className="text-[10px] font-extrabold tracking-widest text-accent-amber">
        BETA · ADVISORY ONLY
      </p>
      <p className="mt-1.5 text-[11px] leading-4 text-amber-100/80">
        {AI_BETA_WARNING}
      </p>
    </div>
  );
}

/** One-time first-use notice. Non-blocking: the AI panel and the manual flow
 *  render regardless; the button only records the acknowledgement. */
export function AiBetaFirstUseNotice() {
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setSeen(window.localStorage.getItem(ACK_KEY) === '1');
    } catch {
      // Storage unavailable (private mode / blocked): show the notice rather
      // than silently swallowing the safety message.
      setSeen(false);
    }
  }, []);

  if (seen !== false) return null; // unknown-yet or already acknowledged

  return (
    <div
      data-testid="ai-beta-first-use"
      className="my-2 rounded-xl border border-accent-red/60 bg-accent-red/[0.08] p-3"
    >
      <p className="text-[10px] font-extrabold tracking-widest text-accent-red">
        FIRST USE — PLEASE READ
      </p>
      <p className="mt-1.5 text-[11px] leading-4 text-amber-100/80">
        {AI_BETA_WARNING}
      </p>
      <button
        type="button"
        data-testid="ai-beta-ack"
        onClick={() => {
          setSeen(true);
          try {
            window.localStorage.setItem(ACK_KEY, '1');
          } catch {
            /* best-effort; the persistent per-result warning still renders */
          }
        }}
        className="mt-2 rounded-lg border border-accent-amber/70 px-2.5 py-1.5 text-[11px] font-bold text-accent-amber transition-colors hover:bg-accent-amber/10"
      >
        I understand — findings require my verification
      </button>
    </div>
  );
}
