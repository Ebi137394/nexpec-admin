// ════════════════════════════════════════════════════════════════════════════
//  app/admin/jobs/[id]/visits/page.tsx — Admin site-visit management
//
//  Extends the existing Admin job architecture, following the conventions of
//  /admin/jobs/[id]/team. Reachable from /admin/jobs, which is in the sidebar,
//  so qa:admin-routes treats it as navigable rather than orphaned.
//
//  ── THE LEGACY FALLBACK IS SHOWN, NOT MATERIALISED ─────────────────────────
//  A job with no explicit visits renders ONE synthetic row (visitId === null)
//  built from jobs.scheduled_date, clearly labelled as a schedule fallback.
//  Opening this page writes NOTHING. Because the synthetic row has no database
//  identity it offers no reschedule, cancel or crew controls — those appear
//  only once a real visit exists, which is exactly the point at which the job
//  opts into the multi-visit model.
//
//  ── BOUNDARIES ─────────────────────────────────────────────────────────────
//   • Every mutation goes through a canonical RPC. Nothing here writes
//     job_visits or job_visit_assignments directly.
//   • Crew comes from the job team: the RPC refuses a non-member, so this page
//     only offers active job_inspectors.
//   • Conflicts are ADVISORY — shown, never enforced.
//   • No pricing is rendered, and cancelling a visit triggers no refund.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  CalendarDays, ArrowLeft, Plus, Repeat, CalendarClock, Ban, Crown,
  Users, ShieldCheck, History,
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  fetchJobVisits, fetchVisitConflicts,
  VISIT_KIND_LABELS, VISIT_STATUS_LABELS,
  type VisitKind, type VisitStatus, type VisitConflict,
} from '@/lib/data/jobVisits';
import { fetchJobTeam } from '@/lib/data/jobTeam';
import {
  addVisit, addRecurringVisits, rescheduleVisit, cancelVisit, assignVisitInspector,
} from '@/lib/actions/jobVisits';

export const metadata: Metadata = { title: 'Admin, Job visits' };
export const dynamic = 'force-dynamic';

const KINDS: VisitKind[] = ['single', 'recurring', 'surveillance', 'resident', 'repeat', 'followup'];

function fmt(iso: string | null): string {
  if (!iso) return 'no date set';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const input =
  'rounded-lg border border-white/[0.08] bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600';

export default async function AdminJobVisitsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: jobId } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(`/admin/jobs/${jobId}/visits`));

  const { data: isAdminData } = await supabase.rpc('nx_is_admin');
  if (!isAdminData) redirect('/');

  const visits = await fetchJobVisits(jobId);
  const team = await fetchJobTeam(jobId);
  // Only real team members can be allocated; the RPC enforces this too. The
  // synthetic team-of-one fallback is not an assignable membership.
  const crew = team.filter((m) => !m.fromFallback);

  // Indexed access is unchecked under the shared tsconfig, so the length test
  // alone does not narrow visits[0]. Read it once and test the value.
  const firstVisit = visits[0];
  const legacyOnly = visits.length === 1 && firstVisit != null && firstVisit.fromFallback;

  // Advisory clash preview per (real visit × crew member), same predicate the
  // assignment uses, so the hint cannot disagree with the outcome.
  const realVisits = visits.filter((v) => v.visitId);
  const conflictKey = (v: string, i: string) => `${v}:${i}`;
  const conflicts = new Map<string, VisitConflict>(
    await Promise.all(
      realVisits.flatMap((v) =>
        crew.map(async (m) =>
          [conflictKey(v.visitId!, m.inspectorId), await fetchVisitConflicts(v.visitId!, m.inspectorId)] as const,
        ),
      ),
    ),
  );

  async function createVisitAction(formData: FormData) {
    'use server';
    const start = String(formData.get('start') ?? '');
    const kind = String(formData.get('kind') ?? 'single');
    const title = String(formData.get('title') ?? '');
    const tz = String(formData.get('tz') ?? '');
    await addVisit(jobId, start || null, kind, title || null, tz || null);
  }

  async function createRecurringAction(formData: FormData) {
    'use server';
    const start = String(formData.get('start') ?? '');
    const count = Number(formData.get('count') ?? 0);
    const every = Number(formData.get('every') ?? 7);
    const kind = String(formData.get('kind') ?? 'surveillance');
    const title = String(formData.get('title') ?? '');
    const tz = String(formData.get('tz') ?? '');
    if (!start || !Number.isFinite(count) || count < 1) return;
    await addRecurringVisits(jobId, start, count, every, kind, title || null, tz || null);
  }

  return (
    <div className="space-y-8">
      <header>
        <Link
          href="/admin/jobs"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Back to jobs
        </Link>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Site visits
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          When the work happens on site, and who attends each time.
        </p>
        <p className="mt-3 max-w-3xl rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs leading-relaxed text-zinc-500">
          Visits are <span className="text-zinc-300">operational</span>. Creating,
          rescheduling or cancelling one has no payout effect and triggers no
          refund — settlement stays manual. Crew is drawn from the{' '}
          <Link href={`/admin/jobs/${jobId}/team`} className="text-zinc-300 underline">
            job team
          </Link>
          ; add someone there first to make them assignable here.
        </p>
      </header>

      {legacyOnly && (
        <div className="flex items-start gap-3 rounded-2xl border border-sky-500/20 bg-sky-500/[0.06] px-4 py-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" strokeWidth={1.75} />
          <p className="text-xs leading-relaxed text-sky-200/90">
            This job has <span className="font-medium">no explicit visit records</span>.
            What you see below is its existing schedule date shown as a single
            visit — a read-only fallback, not a stored row. Opening this page
            changed nothing. Create a visit to move this job onto the
            multi-visit model.
          </p>
        </div>
      )}

      {/* ── Visits ─────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <CalendarDays className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
          Visits ({visits.length})
        </h2>

        <ul className="space-y-4">
          {visits.map((v) => {
            const isSynthetic = v.visitId === null;
            const terminal = v.status === 'cancelled' || v.status === 'completed';
            return (
              <li
                key={v.visitId ?? 'fallback'}
                className={
                  'rounded-2xl border px-5 py-4 ' +
                  (isSynthetic
                    ? 'border-dashed border-sky-500/25 bg-sky-500/[0.03]'
                    : 'border-white/[0.06] bg-white/[0.02]')
                }
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-white">
                        Visit {v.visitNumber}
                        {v.title ? ` · ${v.title}` : ''}
                      </span>
                      {isSynthetic ? (
                        <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-300 ring-1 ring-inset ring-sky-500/20">
                          schedule fallback — not a stored visit
                        </span>
                      ) : (
                        <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[11px] text-zinc-300 ring-1 ring-inset ring-white/[0.08]">
                          {VISIT_STATUS_LABELS[v.status as VisitStatus] ?? v.status}
                        </span>
                      )}
                      {v.recurrenceGroupId && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-300 ring-1 ring-inset ring-violet-500/20">
                          <Repeat className="h-3 w-3" strokeWidth={1.75} />
                          series
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      {fmt(v.scheduledStart)}
                      {v.timezone ? ` · ${v.timezone}` : ''}
                      {` · ${VISIT_KIND_LABELS[v.visitKind as VisitKind] ?? v.visitKind}`}
                      {!isSynthetic ? ` · ${v.assignedCount} assigned` : ''}
                    </p>
                  </div>

                  {!isSynthetic && !terminal && (
                    <div className="flex flex-wrap items-center gap-2">
                      <form
                        action={async (fd: FormData) => {
                          'use server';
                          const when = String(fd.get('when') ?? '');
                          if (!when) return;
                          await rescheduleVisit(jobId, v.visitId!, when, 'rescheduled by admin');
                        }}
                        className="flex items-center gap-2"
                      >
                        <input type="datetime-local" name="when" className={input} required />
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 ring-1 ring-inset ring-amber-500/20 hover:bg-amber-500/20"
                        >
                          <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.75} />
                          Reschedule
                        </button>
                      </form>
                      <form
                        action={async () => {
                          'use server';
                          await cancelVisit(jobId, v.visitId!, 'cancelled by admin');
                        }}
                      >
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-300 ring-1 ring-inset ring-white/[0.08] hover:bg-white/[0.06]"
                        >
                          <Ban className="h-3.5 w-3.5" strokeWidth={1.75} />
                          Cancel
                        </button>
                      </form>
                    </div>
                  )}
                </div>

                {/* crew allocation — real visits only */}
                {!isSynthetic && !terminal && (
                  <div className="mt-4 border-t border-white/[0.05] pt-4">
                    <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                      <Users className="h-3.5 w-3.5" strokeWidth={1.75} />
                      Assign from the job team
                    </p>
                    {crew.length === 0 ? (
                      <p className="text-xs text-zinc-500">
                        No operational team members yet — add them on the{' '}
                        <Link href={`/admin/jobs/${jobId}/team`} className="underline">
                          job team
                        </Link>{' '}
                        page first.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {crew.map((m) => {
                          const k = conflicts.get(conflictKey(v.visitId!, m.inspectorId));
                          const clash = k && k.visitHasDate && k.conflictCount > 0;
                          return (
                            <form
                              key={m.inspectorId}
                              action={async () => {
                                'use server';
                                await assignVisitInspector(jobId, v.visitId!, m.inspectorId, false);
                              }}
                            >
                              <button
                                type="submit"
                                title={
                                  clash
                                    ? `${k!.conflictCount} other commitment(s) that day — you can still assign`
                                    : 'Assign to this visit'
                                }
                                className={
                                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-inset ' +
                                  (clash
                                    ? 'bg-amber-500/10 text-amber-300 ring-amber-500/20 hover:bg-amber-500/20'
                                    : 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20 hover:bg-emerald-500/20')
                                }
                              >
                                {m.isLead && <Crown className="h-3 w-3" strokeWidth={1.75} />}
                                {m.fullName ?? 'Inspector'}
                                {clash ? ` · ${k!.conflictCount} clash` : ''}
                              </button>
                            </form>
                          );
                        })}
                      </div>
                    )}
                    <p className="mt-2 text-[11px] text-zinc-600">
                      A clash marker is advisory — an inspector may legitimately
                      cover more than one site in a day.
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-zinc-600">
          <History className="h-3.5 w-3.5" strokeWidth={1.75} />
          Rescheduled visits are superseded, not deleted — the replacement keeps
          the crew and the original stays in the record.
        </p>
      </section>

      {/* ── Create ─────────────────────────────────────────────────────── */}
      <section className="grid gap-4 md:grid-cols-2">
        <form
          action={createVisitAction}
          className="space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Plus className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
            Add a visit
          </h2>
          <input type="datetime-local" name="start" className={`${input} w-full`} />
          <input name="title" placeholder="title (optional)" className={`${input} w-full`} />
          <input name="tz" placeholder="timezone e.g. Asia/Riyadh (optional)" className={`${input} w-full`} />
          <select name="kind" defaultValue="single" className={`${input} w-full`}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{VISIT_KIND_LABELS[k]}</option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/20 hover:bg-emerald-500/20"
          >
            Create visit
          </button>
          <p className="text-[11px] text-zinc-600">
            Leave the date empty to record a planned visit with no date yet.
          </p>
        </form>

        <form
          action={createRecurringAction}
          className="space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Repeat className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
            Add a recurring series
          </h2>
          <input type="datetime-local" name="start" className={`${input} w-full`} required />
          <div className="flex gap-2">
            <input
              type="number" name="count" min={1} max={365} defaultValue={4}
              className={`${input} w-full`} placeholder="occurrences" required
            />
            <input
              type="number" name="every" min={1} defaultValue={7}
              className={`${input} w-full`} placeholder="every N days" required
            />
          </div>
          <input name="title" placeholder="title prefix (optional)" className={`${input} w-full`} />
          <input name="tz" placeholder="timezone (optional)" className={`${input} w-full`} />
          <select name="kind" defaultValue="surveillance" className={`${input} w-full`}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{VISIT_KIND_LABELS[k]}</option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-300 ring-1 ring-inset ring-violet-500/20 hover:bg-violet-500/20"
          >
            Create series
          </button>
          <p className="text-[11px] text-zinc-600">
            Fixed interval, 1–365 occurrences, sharing one series id — enough for
            weekly surveillance, resident schedules and repeat vendor visits.
          </p>
        </form>
      </section>
    </div>
  );
}
