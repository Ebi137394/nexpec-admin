// ════════════════════════════════════════════════════════════════════════════
//  app/admin/diagnostics/page.tsx — system-state probe
//
//  Runs notification_smoke_test() + a series of cheap reads against the
//  current tenant. Shows pass/fail for every critical wire: notifications
//  trigger, profile counter, RLS, recent jobs, recent notifications.
//
//  Stash one of these for every project. Saves hours of "is X actually
//  installed in prod?" detective work.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Database,
  Bell,
  Users,
  Briefcase,
  Send,
  Zap,
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { pingAllAdmins, pingAllInspectors } from '@/lib/actions/diagnostics';

export const metadata: Metadata = { title: 'System Diagnostics' };
export const dynamic = 'force-dynamic';

interface SmokeReport {
  job_trigger_installed?: boolean;
  admin_count?: number;
  total_notifications?: number;
  my_unread_count?: number;
}

interface PageProps {
  searchParams?: Promise<{ ok?: string; error?: string }>;
}

export default async function AdminDiagnosticsPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/admin/diagnostics');

  // 1) Smoke test RPC
  let smoke: SmokeReport | null = null;
  let smokeError: string | null = null;
  try {
    const { data, error } = await supabase.rpc('notification_smoke_test');
    if (error) smokeError = error.message;
    else smoke = (data ?? {}) as SmokeReport;
  } catch (e) {
    smokeError = e instanceof Error ? e.message : 'unknown';
  }

  // 2) Recent jobs (last 5)
  let recentJobs: Array<{ id: string; title: string | null; created_at: string | null }> = [];
  let jobsError: string | null = null;
  try {
    const { data, error } = await supabase
      .from('jobs')
      .select('id, title, created_at')
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) jobsError = error.message;
    else
      recentJobs = (data ?? []).map((r) => ({
        id: String((r as { id?: unknown }).id ?? ''),
        title: ((r as { title?: unknown }).title as string | null) ?? null,
        created_at:
          ((r as { created_at?: unknown }).created_at as string | null) ?? null,
      }));
  } catch (e) {
    jobsError = e instanceof Error ? e.message : 'unknown';
  }

  // 3) My recent notifications (last 5)
  let recentNotifs: Array<{
    id: string;
    title: string;
    kind: string;
    created_at: string | null;
  }> = [];
  let notifError: string | null = null;
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('id, title, kind, created_at')
      .eq('recipient_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) notifError = error.message;
    else
      recentNotifs = (data ?? []).map((r) => ({
        id: String((r as { id?: unknown }).id ?? ''),
        title: String((r as { title?: unknown }).title ?? ''),
        kind: String((r as { kind?: unknown }).kind ?? ''),
        created_at:
          ((r as { created_at?: unknown }).created_at as string | null) ?? null,
      }));
  } catch (e) {
    notifError = e instanceof Error ? e.message : 'unknown';
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Command Console, Diagnostics
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          System health
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Live probe of triggers, notification pipeline, and recent activity.
          Use this to verify migrations landed and triggers fire.
        </p>
      </header>

      {/* Action banners */}
      {sp.ok && (
        <div className="rounded-2xl border border-accent-green/30 bg-accent-green/10 p-4 text-sm text-accent-green">
          ✅ Action complete: <span className="font-mono">{sp.ok}</span>. Check
          your bell within the next 5 seconds.
        </div>
      )}
      {sp.error && (
        <div className="rounded-2xl border border-accent-red/30 bg-accent-red/10 p-4 text-sm text-accent-red">
          ❌ {decodeURIComponent(sp.error)}
        </div>
      )}

      {/* One-click test actions */}
      <section className="rounded-3xl border border-violet/25 bg-gradient-to-br from-violet/[0.08] to-transparent p-6 sm:p-8">
        <header className="mb-5">
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            One-click tests
          </h2>
          <p className="mt-1 text-xs text-zinc-400">
            Fire a notification right now without leaving the browser. If your
            bell badge increments within a few seconds, the pipeline is healthy.
          </p>
        </header>
        <div className="flex flex-wrap gap-3">
          <form action={pingAllAdmins}>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-full bg-violet px-5 py-2.5 text-xs font-semibold uppercase tracking-industrial text-white shadow-sm transition-colors hover:bg-violet/90"
            >
              <Send className="h-3 w-3" strokeWidth={2} />
              Ping all admins
            </button>
          </form>
          <form action={pingAllInspectors}>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-full border border-cyan-glow/40 bg-cyan-glow/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-industrial text-cyan-glow hover:bg-cyan-glow/20"
            >
              <Zap className="h-3 w-3" strokeWidth={2} />
              Notify inspectors about every open job
            </button>
          </form>
        </div>
      </section>

      {/* Smoke probe */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <header className="mb-5 flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
            <Database className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="font-display text-lg font-semibold tracking-tight text-white">
              Notification pipeline
            </h2>
            <p className="text-[11px] text-zinc-500">
              RPC: <code className="font-mono">notification_smoke_test()</code>
            </p>
          </div>
        </header>

        {smokeError ? (
          <div className="rounded-xl border border-accent-red/30 bg-accent-red/10 p-4">
            <p className="text-sm font-semibold text-accent-red">
              Smoke test RPC failed
            </p>
            <p className="mt-1 font-mono text-[11px] text-accent-red/80">
              {smokeError}
            </p>
            <p className="mt-2 text-xs text-zinc-400">
              You probably haven&rsquo;t run migration{' '}
              <code className="font-mono">20260518330000</code> yet. Apply it in
              the Supabase SQL editor.
            </p>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Probe
              label="Job trigger installed"
              value={smoke?.job_trigger_installed ? 'YES' : 'NO'}
              ok={!!smoke?.job_trigger_installed}
              icon={Briefcase}
            />
            <Probe
              label="Admin profiles"
              value={String(smoke?.admin_count ?? 0)}
              ok={(smoke?.admin_count ?? 0) > 0}
              icon={Users}
            />
            <Probe
              label="Total notifications"
              value={String(smoke?.total_notifications ?? 0)}
              ok={(smoke?.total_notifications ?? 0) > 0}
              icon={Bell}
            />
            <Probe
              label="My unread count"
              value={String(smoke?.my_unread_count ?? 0)}
              ok={(smoke?.my_unread_count ?? 0) >= 0}
              icon={Bell}
            />
          </dl>
        )}
      </section>

      {/* Recent jobs */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <h2 className="mb-4 font-display text-lg font-semibold tracking-tight text-white">
          Recent jobs ({recentJobs.length})
        </h2>
        {jobsError ? (
          <p className="text-xs text-accent-red">{jobsError}</p>
        ) : recentJobs.length === 0 ? (
          <p className="text-xs text-zinc-500">No jobs in DB.</p>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {recentJobs.map((j) => (
              <li
                key={j.id}
                className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-white/[0.01] px-3 py-2"
              >
                <Link
                  href={`/admin/jobs?inspect=${j.id}`}
                  className="truncate text-violet-glow hover:text-white"
                >
                  {j.title ?? '(untitled)'}
                </Link>
                <span className="text-zinc-500">{j.created_at}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recent notifications */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <h2 className="mb-4 font-display text-lg font-semibold tracking-tight text-white">
          My recent notifications ({recentNotifs.length})
        </h2>
        {notifError ? (
          <p className="text-xs text-accent-red">{notifError}</p>
        ) : recentNotifs.length === 0 ? (
          <div className="rounded-xl border border-accent-amber/30 bg-accent-amber/5 p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 text-accent-amber" />
              <div>
                <p className="text-sm font-semibold text-accent-amber">
                  No notifications for your user.
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  Run migration <code className="font-mono">20260518330000</code>{' '}
                  — it inserts a smoke-test notification for every admin so you
                  can verify the bell renders.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {recentNotifs.map((n) => (
              <li
                key={n.id}
                className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-white/[0.01] px-3 py-2"
              >
                <span className="truncate text-zinc-200">{n.title}</span>
                <span className="shrink-0 text-zinc-500">
                  {n.kind}, {n.created_at}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Probe({
  label,
  value,
  ok,
  icon: Icon,
}: {
  label: string;
  value: string;
  ok: boolean;
  icon: typeof Bell;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center justify-between">
        <Icon className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
        {ok ? (
          <CheckCircle2 className="h-4 w-4 text-accent-green" strokeWidth={2} />
        ) : (
          <XCircle className="h-4 w-4 text-accent-red" strokeWidth={2} />
        )}
      </div>
      <p
        className={`mt-2 font-mono text-2xl font-semibold ${ok ? 'text-white' : 'text-accent-red'}`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[10px] uppercase tracking-industrial text-zinc-500">
        {label}
      </p>
    </div>
  );
}
