// ════════════════════════════════════════════════════════════════════════════
//  app/client/dashboard/page.tsx — Client portal landing
//
//  Beyond the 4 metric tiles, the dashboard now surfaces:
//    - "What needs your attention" — actionable counters with deep links
//    - Recent jobs (last 5)
//    - Recent notifications (last 5)
//    - INLINE Help & Support composer — type-and-send without navigating
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import type { Metadata } from 'next';
import {
  Briefcase,
  PlusCircle,
  FileCheck2,
  ArrowUpRight,
  ShieldCheck,
  AlertTriangle,
  MessageCircle,
  Scale,
  Bell,
  Inbox,
} from 'lucide-react';
import { fetchClientDashboardMetrics } from '@/lib/data/clientDashboardMetrics';
import { fetchClientDashboardWidgets } from '@/lib/data/clientDashboardWidgets';
import { openHelpSupport } from '@/lib/actions/messages';
import { RichComposer } from '@/components/messaging/RichComposer';
import { PipelineSection } from '@/components/jobs/PipelineSection';
import { OnboardingChecklist } from '@/components/onboarding/OnboardingChecklist';

export const metadata: Metadata = { title: 'Client Dashboard' };
export const dynamic = 'force-dynamic';

async function ensureHelpRoom() {
  'use server';
  await openHelpSupport('/client/messages');
}

export default async function ClientDashboardPage() {
  const [metrics, widgets] = await Promise.all([
    fetchClientDashboardMetrics(),
    fetchClientDashboardWidgets(),
  ]);

  return (
    <div className="space-y-10">
      {/* Onboarding checklist, self-suppresses for completed +
          dismissed users and rows with no derivable steps. Mounted
          ABOVE the existing heading without altering any other element. */}
      <OnboardingChecklist
        kicker="Client Onboarding"
        title="Finish setting up your account"
      />

      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Client Portal
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Welcome.
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-sm text-zinc-400">
          Post inspections, review applications, fund payment holds, download signed
          reports. Everything you need to operate is on this one screen.
        </p>
      </header>

      {/*
        Pipeline — surfaces limbo-state work directly on the dashboard so
        clients don't have to navigate to /client/jobs to see what's
        waiting on them. Self-suppresses when empty. Strictly additive
        (2026-05-20 UX directive — no sidebar/nav changes).
      */}
      <PipelineSection tone="buyer" />

      {/* Metric tiles */}
      <section aria-label="Your workspace" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile label="Active jobs" value={formatCount(metrics.activeJobs)} sub="open + assigned + in_progress" />
        <MetricTile label="Held for payout" value={formatCurrency(metrics.escrowHeldCents)} sub="across your active jobs" tone="violet" />
        <MetricTile label="Pending review" value={formatCount(metrics.pendingApplications)} sub="applications awaiting your decision" tone="cyan" />
        <MetricTile label="Reports, last 30d" value={formatCount(metrics.reportsLast30d)} sub="admin-approved + handed off" />
      </section>

      {/* Pending actions */}
      <section aria-label="Action items" className="rounded-3xl border border-white/[0.06] bg-gradient-to-b from-ink-800/40 to-ink-900/20 p-6 sm:p-8">
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">What needs your attention</h2>
        <p className="mt-1 text-xs text-zinc-500">Live counts from your DB. Click any tile to jump straight to the surface.</p>
        <ul className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <ActionCounter label="Unsigned contracts" count={widgets.pending.unsignedContracts} href="/client/contracts" icon={<Scale className="h-4 w-4" strokeWidth={1.75} />} tone="amber" />
          <ActionCounter label="Open disputes" count={widgets.pending.openDisputesByMe} href="/client/disputes" icon={<AlertTriangle className="h-4 w-4" strokeWidth={1.75} />} tone="red" />
          <ActionCounter label="Jobs awaiting review" count={widgets.pending.jobsPendingMyReview} href="/client/jobs" icon={<FileCheck2 className="h-4 w-4" strokeWidth={1.75} />} tone="cyan" />
          <ActionCounter label="Unread messages" count={widgets.pending.unreadMessages} href="/client/messages" icon={<MessageCircle className="h-4 w-4" strokeWidth={1.75} />} tone="violet" />
          <ActionCounter label="Notifications" count={widgets.pending.unreadNotifications} href="/notifications" icon={<Bell className="h-4 w-4" strokeWidth={1.75} />} tone="violet" />
        </ul>
      </section>

      {/* Two-column: Recent jobs + Recent notifications */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-lg font-semibold tracking-tight text-white">Recent jobs</h2>
            <Link href="/client/jobs" className="text-[11px] font-semibold uppercase tracking-industrial text-violet-glow hover:text-white">See all →</Link>
          </div>
          {widgets.recentJobs.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-6 text-center">
              <Inbox className="mx-auto h-7 w-7 text-zinc-600" strokeWidth={1.5} />
              <p className="mt-2 text-xs text-zinc-500">No jobs yet. Post your first inspection below.</p>
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {widgets.recentJobs.map((j) => (
                <li key={j.id}>
                  <Link href={`/client/jobs/${j.id}`} className="group flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 transition-colors hover:border-violet/40 hover:bg-white/[0.04]">
                    <Briefcase className="h-4 w-4 shrink-0 text-violet-glow" strokeWidth={1.75} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white group-hover:text-violet-glow">{j.title}</p>
                      <p className="truncate text-[10px] text-zinc-500">{j.status}, {formatRelative(j.createdAt)}</p>
                    </div>
                    {j.escrowPaused && (
                      <span className="rounded-full border border-accent-red/40 bg-accent-red/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-industrial text-accent-red">hold paused</span>
                    )}
                    <ArrowUpRight className="h-3 w-3 shrink-0 text-zinc-500 group-hover:text-violet-glow" strokeWidth={1.75} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-lg font-semibold tracking-tight text-white">Recent activity</h2>
            <Link href="/notifications" className="text-[11px] font-semibold uppercase tracking-industrial text-violet-glow hover:text-white">See all →</Link>
          </div>
          {widgets.recentNotifications.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-6 text-center">
              <Bell className="mx-auto h-7 w-7 text-zinc-600" strokeWidth={1.5} />
              <p className="mt-2 text-xs text-zinc-500">No notifications yet. Cross-system events appear here.</p>
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {widgets.recentNotifications.map((n) => {
                const inner = (
                  <div className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 transition-colors hover:border-violet/40 hover:bg-white/[0.04]">
                    <span className={`mt-0.5 inline-flex h-2 w-2 shrink-0 rounded-full ${n.isRead ? 'bg-zinc-700' : 'bg-violet'}`} />
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm font-medium ${n.isRead ? 'text-zinc-400' : 'text-white'}`}>{n.title}</p>
                      {n.body && <p className="truncate text-[11px] text-zinc-500">{n.body}</p>}
                      <p className="mt-0.5 text-[10px] text-zinc-600">{formatRelative(n.createdAt)}</p>
                    </div>
                  </div>
                );
                return <li key={n.id}>{n.linkHref ? <Link href={n.linkHref}>{inner}</Link> : inner}</li>;
              })}
            </ul>
          )}
        </div>
      </section>

      {/* INLINE Help & Support quick-send — works without leaving the dashboard */}
      <section aria-label="Help & Support" className="overflow-hidden rounded-3xl border border-violet/30 bg-gradient-to-br from-violet/[0.10] to-cyan-glow/[0.06]">
        <div className="p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow">Need a hand?</p>
          <h2 className="mt-2 font-display text-xl font-semibold tracking-tight text-white">Send NEXPEC admin a message</h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            Type below and click Send.
          </p>
        </div>
        {widgets.helpSupportConversationId ? (
          <RichComposer conversationId={widgets.helpSupportConversationId} returnTo="/client/dashboard" placeholder="Ask anything, billing, dispatch, a specific job…" />
        ) : (
          <form action={ensureHelpRoom} className="p-6 sm:p-8 sm:pt-0">
            <button type="submit" className="inline-flex items-center gap-2 rounded-full bg-violet px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-violet/90">
              <ShieldCheck className="h-4 w-4" strokeWidth={1.75} />
              Open Help & Support room
            </button>
          </form>
        )}
      </section>

      {/* Quick-action rail */}
      <section className="overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-ink-800/60 to-ink-900/40 p-8 sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">Quick actions</p>
        <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-white">Get going.</h2>
        <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {NEXT_ACTIONS.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="group flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 transition-all hover:-translate-y-0.5 hover:border-violet/40 hover:bg-white/[0.04]">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
                  <item.icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-zinc-200 group-hover:text-white">{item.label}</span>
                  <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">{item.helper}</p>
                </div>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-zinc-500 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-violet-glow" strokeWidth={1.75} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ─── pieces ──────────────────────────────────────────────────────── */

const NEXT_ACTIONS = [
  { label: 'Post a new inspection', href: '/client/jobs/new', icon: PlusCircle, helper: 'Define scope, location, budget. Funds land in a payment hold.' },
  { label: 'My active jobs', href: '/client/jobs', icon: Briefcase, helper: 'Track applications, in-progress work, scheduled visits.' },
  { label: 'Download a completed report', href: '/client/reports', icon: FileCheck2, helper: 'Signed PDFs, photos, audit hash.' },
];

type Tone = 'default' | 'violet' | 'cyan' | 'amber' | 'red';

function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatCurrency(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(dollars >= 10_000 ? 0 : 1)}k`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(dollars);
}

function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d`;
  return d.toLocaleDateString();
}

function MetricTile({ label, value, sub, tone = 'default' }: { label: string; value: string; sub?: string; tone?: Tone }) {
  const valueColor =
    tone === 'violet' ? 'text-violet-glow'
      : tone === 'cyan' ? 'text-cyan-glow'
        : tone === 'amber' ? 'text-accent-amber'
          : tone === 'red' ? 'text-accent-red'
            : 'text-white';
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-5 backdrop-blur-xl">
      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">{label}</p>
      <p className={`mt-2 font-mono text-3xl font-semibold tracking-tight ${valueColor}`}>{value}</p>
      {sub && <p className="mt-1 text-[11px] text-zinc-500">{sub}</p>}
    </div>
  );
}

function ActionCounter({ label, count, href, icon, tone }: { label: string; count: number; href: string; icon: React.ReactNode; tone: Tone }) {
  const hot = count > 0;
  const toneRing =
    tone === 'amber' ? 'ring-accent-amber/30 bg-accent-amber/[0.06] text-accent-amber'
      : tone === 'red' ? 'ring-accent-red/30 bg-accent-red/[0.06] text-accent-red'
        : tone === 'cyan' ? 'ring-cyan-glow/30 bg-cyan-glow/[0.06] text-cyan-glow'
          : 'ring-violet/30 bg-violet/[0.06] text-violet-glow';
  return (
    <li>
      <Link href={href} className={`group block rounded-2xl border bg-white/[0.02] p-4 transition-all hover:-translate-y-0.5 hover:bg-white/[0.04] ${hot ? 'border-white/[0.12]' : 'border-white/[0.06]'}`}>
        <div className="flex items-center gap-2">
          <span className={`inline-flex h-6 w-6 items-center justify-center rounded-lg ring-1 ring-inset ${toneRing}`}>{icon}</span>
          <p className={`font-mono text-2xl font-semibold ${hot ? 'text-white' : 'text-zinc-600'}`}>{count}</p>
        </div>
        <p className={`mt-2 text-[11px] uppercase tracking-industrial ${hot ? 'text-zinc-300' : 'text-zinc-500'}`}>{label}</p>
      </Link>
    </li>
  );
}
