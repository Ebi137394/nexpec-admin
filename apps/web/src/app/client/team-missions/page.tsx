// ════════════════════════════════════════════════════════════════════════════
//  app/client/team-missions/page.tsx — Team Missions (Agency/Enterprise)
//
//  Every mission owned by the caller's organization, visible to the whole team
//  (members invited via /client/team). Row access to detail/report/chat is
//  enforced by the team RLS; this list is price-free by construction. Manage vs
//  view follows the member's org role.
// ════════════════════════════════════════════════════════════════════════════
import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarDays, ClipboardList, MapPin, Users } from 'lucide-react';
import { fetchTeamJobs } from '@/lib/data/teamWorkspace';
import { domainLabel } from '@/lib/data/teaser';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Team Missions, NEXPEC' };

function humanizeStatus(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusTone(s: string): string {
  if (s === 'completed' || s === 'paid') return 'border-accent-green/40 bg-accent-green/10 text-accent-green';
  if (s === 'in_progress' || s === 'assigned') return 'border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow';
  if (s === 'disputed' || s === 'cancelled') return 'border-accent-red/40 bg-accent-red/10 text-accent-red';
  return 'border-white/15 bg-white/[0.04] text-zinc-300';
}

export default async function TeamMissionsPage() {
  const jobs = await fetchTeamJobs();
  const manageable = jobs.filter((j) => j.can_manage).length;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet to-cyan-glow shadow-glow">
          <ClipboardList className="h-5 w-5 text-white" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-white">Team Missions</h1>
          <p className="text-sm text-zinc-400">
            Inspections owned by your organization — shared with your whole team. Manage your roster
            in{' '}
            <Link href="/client/team" className="text-violet-glow hover:text-white">
              Team
            </Link>
            .
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3 text-sm">
        <Stat n={jobs.length} label="missions" tone="text-white" />
        <Stat n={manageable} label="you can manage" tone="text-violet-glow" />
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-white/[0.06] bg-ink-900/40">
        {jobs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <Users className="h-6 w-6 text-zinc-600" aria-hidden />
            <p className="text-sm text-zinc-400">No team missions yet.</p>
            <p className="max-w-md text-xs text-zinc-500">
              Missions posted by your organization appear here for every team member. Invite
              colleagues in Team, and post work from My jobs.
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-industrial text-zinc-500">
                <th className="px-4 py-3 font-semibold">Mission</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Discipline</th>
                <th className="px-4 py-3 font-semibold">Location</th>
                <th className="px-4 py-3 font-semibold">Scheduled</th>
                <th className="px-4 py-3 text-right font-semibold">Access</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-white/[0.04] last:border-0">
                  <td className="px-4 py-3 font-medium text-white">
                    <Link href={`/client/jobs/${j.id}`} className="transition-colors hover:text-violet-glow">
                      {j.title || 'Untitled mission'}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${statusTone(j.status)}`}
                    >
                      {humanizeStatus(j.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{domainLabel(j.domain)}</td>
                  <td className="px-4 py-3 text-zinc-400">
                    {j.location_city ? (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-violet-glow/70" aria-hidden />
                        {j.location_city}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {j.scheduled_date ? (
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarDays className="h-3.5 w-3.5 text-violet-glow/70" aria-hidden />
                        {new Date(j.scheduled_date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-3">
                      <Link
                        href={`/client/jobs/${j.id}/chat`}
                        className="text-violet-glow transition-colors hover:text-white"
                      >
                        Chat
                      </Link>
                      <Link
                        href={`/client/jobs/${j.id}/internal`}
                        className="text-zinc-300 transition-colors hover:text-white"
                      >
                        Internal
                      </Link>
                      <span className={j.can_manage ? 'text-zinc-300' : 'text-zinc-500'}>
                        {j.can_manage ? 'Manage' : 'View'}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className="inline-flex items-baseline gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-2">
      <span className={`font-display text-lg font-semibold ${tone}`}>{n}</span>
      <span className="text-zinc-400">{label}</span>
    </div>
  );
}
