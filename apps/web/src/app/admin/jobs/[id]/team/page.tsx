// ════════════════════════════════════════════════════════════════════════════
//  app/admin/jobs/[id]/team/page.tsx — Admin inspection-team management
//
//  The usable surface for multi-inspector jobs (20260801376000). Reachable from
//  /admin/jobs, which is in the sidebar, so qa:admin-routes treats it as
//  navigable rather than orphaned.
//
//  ── BOUNDARIES THIS PAGE RESPECTS ──────────────────────────────────────────
//   • jobs.contractor_id — the CONTRACTED inspector and the anchor for
//     settlement, contracts and identity — is shown read-only and is never
//     written here. Team membership is operational, not financial.
//   • Nothing on this page moves money. Adding, removing, replacing or
//     promoting a team member has no payout effect; settlement stays manual.
//   • No pricing is rendered: the team RPC returns no money column.
//
//  A job with no explicit team shows its contracted inspector as a team of one
//  (fromFallback), which is exactly how every pre-existing job behaves.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  Users, Crown, ArrowLeft, UserMinus, UserPlus, ShieldCheck, AlertTriangle,
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchJobTeam, TEAM_ROLE_LABELS, type TeamRole } from '@/lib/data/jobTeam';
import { recommendInspectorsForJob } from '@/lib/actions/inspectionAdmin';
import { addTeamMember, removeTeamMember, setTeamLead } from '@/lib/actions/jobTeam';

export const metadata: Metadata = { title: 'Admin, Job team' };
export const dynamic = 'force-dynamic';

const ROLES: TeamRole[] = [
  'lead', 'inspector', 'mechanical', 'electrical',
  'welding_ndt', 'coating', 'civil', 'specialist', 'trainee', 'observer',
];

export default async function AdminJobTeamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: jobId } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(`/admin/jobs/${jobId}/team`));

  const { data: isAdminData } = await supabase.rpc('nx_is_admin');
  if (!isAdminData) redirect('/');

  const team = await fetchJobTeam(jobId);
  const isFallback = team.length > 0 && team[0].fromFallback;

  // Ranked candidates from the deterministic matcher, minus anyone already on.
  const onTeam = new Set(team.map((t) => t.inspectorId));
  const rec = await recommendInspectorsForJob(jobId, 12, false);
  const candidates = rec.ok ? rec.inspectors.filter((c) => !onTeam.has(c.id)) : [];

  async function addAction(formData: FormData) {
    'use server';
    const inspectorId = String(formData.get('inspectorId') ?? '');
    const role = String(formData.get('role') ?? 'inspector');
    const specialty = String(formData.get('specialty') ?? '');
    if (!inspectorId) return;
    await addTeamMember(jobId, inspectorId, role, specialty || null, role === 'lead');
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
          Inspection team
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          Who actually works this job, and in what discipline.
        </p>
        <p className="mt-3 max-w-3xl rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs leading-relaxed text-zinc-500">
          The <span className="text-zinc-300">contracted inspector</span> is set by
          dispatch and remains the anchor for settlement, contracts and identity
          disclosure. Team membership here is{' '}
          <span className="text-zinc-300">operational only</span> — adding or
          removing someone has no payout effect, and settlement stays manual.
        </p>
      </header>

      {isFallback && (
        <div className="flex items-start gap-3 rounded-2xl border border-sky-500/20 bg-sky-500/[0.06] px-4 py-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" strokeWidth={1.75} />
          <p className="text-xs leading-relaxed text-sky-200/90">
            This job has no explicit team yet, so it is shown as a team of one
            built from its contracted inspector — exactly how it behaves today.
            Adding a member creates the explicit team; nothing about the job
            changes until you do.
          </p>
        </div>
      )}

      {/* ── Current team ───────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <Users className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
          Current team ({team.length})
        </h2>

        {team.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center">
            <p className="text-sm text-zinc-400">
              No inspector is assigned to this job yet.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {team.map((m) => (
              <li
                key={m.inspectorId}
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {m.isLead && (
                      <Crown className="h-4 w-4 text-amber-300" strokeWidth={1.75} />
                    )}
                    <span className="truncate font-medium text-white">
                      {m.fullName ?? 'Unnamed inspector'}
                    </span>
                    {m.isContracted && (
                      <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-300 ring-1 ring-inset ring-violet-500/20">
                        contracted
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {TEAM_ROLE_LABELS[m.role as TeamRole] ?? m.role}
                    {m.specialtySlug ? ` · ${m.specialtySlug}` : ''}
                    {m.status ? ` · ${m.status}` : ''}
                  </p>
                </div>

                {!m.fromFallback && (
                  <div className="flex items-center gap-2">
                    {!m.isLead && (
                      <form
                        action={async () => {
                          'use server';
                          await setTeamLead(jobId, m.inspectorId);
                        }}
                      >
                        <button
                          type="submit"
                          className="rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 ring-1 ring-inset ring-amber-500/20 hover:bg-amber-500/20"
                        >
                          Make lead
                        </button>
                      </form>
                    )}
                    <form
                      action={async () => {
                        'use server';
                        await removeTeamMember(jobId, m.inspectorId, 'removed by admin');
                      }}
                    >
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-300 ring-1 ring-inset ring-white/[0.08] hover:bg-white/[0.06]"
                      >
                        <UserMinus className="h-3.5 w-3.5" strokeWidth={1.75} />
                        Remove
                      </button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Add a member, ranked by the matcher ────────────────────────── */}
      <section>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
          <UserPlus className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
          Add an inspector
        </h2>
        <p className="mb-3 text-xs text-zinc-500">
          Ranked by the deterministic matcher — discipline coverage, verified
          credentials and distance. Scores are match quality, never commercials.
        </p>

        {!rec.ok ? (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" strokeWidth={1.75} />
            <p className="text-xs text-amber-200/90">
              Could not load recommendations: {rec.error}
            </p>
          </div>
        ) : candidates.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-6 text-center">
            <p className="text-sm text-zinc-400">
              No further candidates — everyone recommended is already on the team.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {candidates.map((c) => (
              <li
                key={c.id}
                className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">
                      {c.fullName ?? 'Unnamed inspector'}
                      <span className="ml-2 text-xs text-zinc-500">
                        match {c.score}/100
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {c.reasons.length ? c.reasons.join(' · ') : 'no match detail'}
                      {c.workAuthorized ? '' : ' · not work-authorised here'}
                    </p>
                  </div>

                  <form action={addAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="inspectorId" value={c.id} />
                    <select
                      name="role"
                      defaultValue="inspector"
                      className="rounded-lg border border-white/[0.08] bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {TEAM_ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                    <input
                      name="specialty"
                      placeholder="specialty (optional)"
                      className="w-40 rounded-lg border border-white/[0.08] bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600"
                    />
                    <button
                      type="submit"
                      className="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/20 hover:bg-emerald-500/20"
                    >
                      Add
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
