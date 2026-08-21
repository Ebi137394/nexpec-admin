// ════════════════════════════════════════════════════════════════════════════
//  ReportConversationControl — web UGC report entry point.
//  Mirrors the mobile ReportConversationButton: flag → pick a reason → the
//  report lands in the reporter's staffed NEXPEC support lane.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useState, useTransition } from 'react';
import { Flag } from 'lucide-react';
import { reportConversation } from '@/lib/actions/moderation';

const REASONS = [
  'Inappropriate or offensive content',
  'Harassment or abusive behaviour',
  'Spam or misleading content',
];

export function ReportConversationControl({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const file = (reason: string) =>
    start(async () => {
      const res = await reportConversation(conversationId, reason);
      setDone(res.ok ? 'Report sent — our moderation team will follow up in Support.' : res.error ?? 'Could not send report.');
      setOpen(false);
    });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Report this conversation"
        title="Report this conversation"
        className="rounded-lg p-2 text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
      >
        <Flag className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-white/10 bg-slate-900 p-2 shadow-xl">
          <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Report this conversation
          </p>
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              disabled={pending}
              onClick={() => file(r)}
              className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
            >
              {r}
            </button>
          ))}
        </div>
      )}
      {done && (
        <p role="status" className="absolute right-0 z-20 mt-1 w-64 rounded-lg bg-slate-800 p-2 text-xs text-slate-200 shadow-lg">
          {done}
        </p>
      )}
    </div>
  );
}
