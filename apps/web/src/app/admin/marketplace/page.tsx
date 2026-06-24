// ════════════════════════════════════════════════════════════════════════════
//  app/(admin)/marketplace/page.tsx — Teaser Marketplace curation console
//
//  The admin "display window" control. Lists every opted-in inspector + agency
//  with eligibility + current featured state, and lets the admin feature /
//  unfeature them onto the public feed. Admin-only (admin RPC + admin layout).
// ════════════════════════════════════════════════════════════════════════════
import type { Metadata } from 'next';
import { Sparkles } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { CurationToggle } from '@/components/admin/marketplace/CurationToggle';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Marketplace Curation, NEXPEC Admin' };

interface Candidate {
  target_id: string;
  kind: 'inspector' | 'agency';
  name: string;
  handle: string;
  opted_in: boolean;
  featured: boolean;
  eligible: boolean;
  detail: string;
}

export default async function MarketplaceCurationPage() {
  const sb = await createSupabaseServerClient();
  const { data } = await sb.rpc('admin_list_listing_candidates');
  const rows = (data ?? []) as Candidate[];
  const live = rows.filter((r) => r.featured).length;
  const waiting = rows.filter((r) => !r.featured && r.eligible).length;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet to-cyan-glow shadow-glow">
          <Sparkles className="h-5 w-5 text-white" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
            Marketplace Curation
          </h1>
          <p className="text-sm text-zinc-400">
            Opted-in talent &amp; agencies. Feature them to publish onto the public teaser feed.
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3 text-sm">
        <Stat n={live} label="live on feed" tone="text-accent-green" />
        <Stat n={waiting} label="eligible, awaiting feature" tone="text-violet-glow" />
        <Stat n={rows.length} label="total opted in" tone="text-zinc-300" />
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-white/[0.06] bg-ink-900/40">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">
            No one has opted in to public listing yet.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-industrial text-zinc-500">
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Handle</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Detail</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kind}-${r.target_id}`} className="border-b border-white/[0.04] last:border-0">
                  <td className="px-4 py-3 font-medium text-white">{r.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-400">{r.handle}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
                      {r.kind}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{r.detail}</td>
                  <td className="px-4 py-3">
                    {r.featured ? (
                      <span className="text-accent-green">Live</span>
                    ) : r.eligible ? (
                      <span className="text-violet-glow">Eligible</span>
                    ) : (
                      <span className="text-zinc-500">Not eligible</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <CurationToggle
                      targetId={r.target_id}
                      kind={r.kind}
                      featured={r.featured}
                      eligible={r.eligible}
                    />
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
