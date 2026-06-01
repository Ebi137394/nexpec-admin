'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { X, Link2, Copy } from 'lucide-react';
import type { AuditEvent } from '@/lib/data/audit.types';
import { EventTypeBadge, SeverityBadge } from './EventBadge';
import { JsonDiff } from './JsonDiff';

interface AuditDetailDrawerProps {
  /** Server-fetched event, or null when no `?inspect=` is set. */
  event: AuditEvent | null;
}

/**
 * Slide-out drawer for inspecting a single audit event. Open / closed
 * state is driven by the `?inspect=<id>` query param, so it survives
 * back / forward navigation and shareable URLs.
 */
export function AuditDetailDrawer({ event }: AuditDetailDrawerProps) {
  const router = useRouter();
  // Next 15.0.x types usePathname() as string | null. The ?? '/' fallback
  // makes pathname always a string so it can be passed directly to
  // router.replace() and used in template literals without coercion.
  const pathname = usePathname() ?? '/';
  const searchParams = useSearchParams();
  const open = !!event;

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function close() {
    // Next 15.0.x types useSearchParams() as ReadonlyURLSearchParams | null
    // (vs. non-null in 15.5+). Defensive default for first paint before the
    // params hydrate.
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    next.delete('inspect');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <AnimatePresence>
      {open && event && (
        <>
          {/* backdrop */}
          <motion.button
            type="button"
            aria-label="Close detail drawer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={close}
            className="fixed inset-0 z-40 bg-ink-950/70 backdrop-blur-sm"
          />

          {/* drawer */}
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="audit-drawer-title"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 280, damping: 30 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-white/[0.06] bg-ink-950 shadow-[-30px_0_60px_-30px_rgba(0,0,0,0.8)]"
          >
            {/* header */}
            <header className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-6 py-5">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
                  Audit Event
                </p>
                <h2
                  id="audit-drawer-title"
                  className="mt-1 truncate font-display text-lg font-semibold tracking-tight text-white"
                >
                  {event.summary}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <EventTypeBadge type={event.event_type} />
                  <SeverityBadge severity={event.severity} />
                </div>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="rounded-lg border border-white/10 bg-white/[0.03] p-2 text-zinc-400 transition-colors hover:border-white/30 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            {/* body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <Section heading="When">
                <p className="font-mono text-sm text-zinc-200">
                  {new Date(event.created_at).toUTCString()}
                </p>
              </Section>

              <Section heading="Actor">
                <p className="font-mono text-sm text-zinc-200">
                  {event.actor_label ?? '—'}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Role: {event.actor_role ?? 'unknown'} ·{' '}
                  {event.actor_id ? (
                    <span className="font-mono">{event.actor_id}</span>
                  ) : (
                    'no id'
                  )}
                </p>
              </Section>

              <Section heading="Subject">
                <p className="font-mono text-sm text-zinc-200">
                  {event.subject_table}/{event.subject_id}
                </p>
                {event.job_id && (
                  <p className="mt-1 text-xs text-zinc-500">
                    Job: <span className="font-mono">{event.job_id}</span>
                  </p>
                )}
              </Section>

              {event.metadata && Object.keys(event.metadata).length > 0 && (
                <Section heading="Intent & metadata">
                  <pre className="overflow-auto rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 font-mono text-xs text-zinc-300">
                    {JSON.stringify(event.metadata, null, 2)}
                  </pre>
                </Section>
              )}

              <Section heading="Diff">
                <JsonDiff
                  before={event.delta?.before ?? null}
                  after={event.delta?.after ?? null}
                />
              </Section>

              {event.correlation_id && (
                <Section heading="Correlation">
                  <CorrelationLink id={event.correlation_id} />
                </Section>
              )}
            </div>

            {/* footer */}
            <footer className="border-t border-white/[0.06] px-6 py-4">
              <div className="flex items-center justify-between gap-4">
                <p className="font-mono text-[10px] tracking-wider text-zinc-600">
                  id · {event.id}
                </p>
                <CopyIdButton id={event.id} />
              </div>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/* ───────────────────────────────────────────────────────────────────── */

function Section({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {heading}
      </p>
      {children}
    </section>
  );
}

function CorrelationLink({ id }: { id: string }) {
  const pathname = usePathname() ?? '/';
  const params = useSearchParams();
  const next = new URLSearchParams(params?.toString() ?? '');
  next.set('correlationId', id);
  next.delete('page');
  next.delete('inspect');

  return (
    <a
      href={`${pathname}?${next.toString()}`}
      className="inline-flex items-center gap-2 rounded-lg border border-violet/30 bg-violet/10 px-3 py-1.5 text-xs font-medium text-violet-glow transition-colors hover:bg-violet/20"
    >
      <Link2 className="h-3.5 w-3.5" />
      Show all events in this correlation
    </a>
  );
}

function CopyIdButton({ id }: { id: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          void navigator.clipboard.writeText(id);
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:border-white/30 hover:text-white"
    >
      <Copy className="h-3 w-3" />
      Copy id
    </button>
  );
}
