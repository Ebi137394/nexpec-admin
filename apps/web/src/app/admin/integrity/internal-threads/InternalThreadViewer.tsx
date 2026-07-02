'use client';
// ════════════════════════════════════════════════════════════════════════════
//  InternalThreadViewer — read-only two-pane Ghost-Mode reader.
//
//  Left: every internal team thread. Right: the selected thread's messages, fetched
//  through the server action (openInternalThread → admin_open_internal_thread).
//  Ghost reads are ZERO-TRACE — no audit write. There is deliberately NO composer:
//  the admin watches, never posts.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useTransition } from 'react';
import { EyeOff, Lock, Loader2, MessageSquare, Briefcase, Clock } from 'lucide-react';
import { openInternalThread } from '@/lib/actions/integrityMonitor';
import type { InternalThreadRow, InternalMessageRow } from '@/lib/data/integrityMonitor';

function fmt(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export function InternalThreadViewer({ threads }: { threads: InternalThreadRow[] }) {
  const [selected, setSelected] = useState<InternalThreadRow | null>(null);
  const [messages, setMessages] = useState<InternalMessageRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const open = (t: InternalThreadRow) => {
    setSelected(t);
    setError(null);
    setMessages([]);
    start(async () => {
      try {
        setMessages(await openInternalThread(t.conversationId));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load thread.');
      }
    });
  };

  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-white/[0.02] py-16 ring-1 ring-white/10">
        <MessageSquare className="h-6 w-6 text-violet-300" strokeWidth={1.8} />
        <p className="text-sm font-medium text-white">No internal team threads yet</p>
        <p className="text-xs text-zinc-500">Private team rooms will appear here as agencies use them.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
      {/* Thread list */}
      <ul className="space-y-2">
        {threads.map((t) => {
          const active = selected?.conversationId === t.conversationId;
          return (
            <li key={t.conversationId}>
              <button
                type="button"
                onClick={() => open(t)}
                className={[
                  'w-full rounded-2xl px-4 py-3 text-left ring-1 transition',
                  active
                    ? 'bg-violet-500/10 ring-violet-400/40'
                    : 'bg-white/[0.02] ring-white/10 hover:bg-white/[0.04]',
                ].join(' ')}
              >
                <div className="flex items-center gap-2">
                  <Briefcase className="h-3.5 w-3.5 shrink-0 text-violet-300" strokeWidth={2} />
                  <span className="truncate text-sm font-semibold text-white">
                    {t.jobTitle || 'Untitled mission'}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-zinc-400">{t.principalLabel || 'Principal'}</p>
                <div className="mt-2 flex items-center gap-3 text-[11px] text-zinc-500">
                  <span className="flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" strokeWidth={2} /> {t.messageCount}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" strokeWidth={2} /> {fmt(t.lastMessageAt)}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Reader (read-only) */}
      <div className="flex min-h-[420px] flex-col rounded-2xl bg-white/[0.02] ring-1 ring-white/10">
        {!selected ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <EyeOff className="h-6 w-6 text-violet-300" strokeWidth={1.8} />
            <p className="text-sm font-medium text-white">Select a thread to monitor</p>
            <p className="text-xs text-zinc-500">Read-only · your monitoring leaves no trace.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">
                  {selected.jobTitle || 'Untitled mission'}
                </p>
                <p className="truncate text-xs text-zinc-400">{selected.principalLabel || 'Principal'}</p>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-300 ring-1 ring-amber-400/30">
                <Lock className="h-3 w-3" strokeWidth={2.4} /> Ghost · silent
              </span>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {pending ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> Loading thread…
                </div>
              ) : error ? (
                <p className="py-10 text-center text-sm text-rose-300">{error}</p>
              ) : messages.length === 0 ? (
                <p className="py-10 text-center text-sm text-zinc-500">No messages in this thread.</p>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className="rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/5">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-violet-200">{m.senderLabel || 'Teammate'}</span>
                      <span className="text-[10px] text-zinc-500">{fmt(m.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-zinc-200">{m.content}</p>
                  </div>
                ))
              )}
            </div>

            {/* No composer — the admin can never post into an internal thread. */}
            <div className="border-t border-white/10 px-5 py-3 text-center text-[11px] text-zinc-500">
              Read-only · posting is blocked at the database (RESTRICTIVE policy)
            </div>
          </>
        )}
      </div>
    </div>
  );
}
