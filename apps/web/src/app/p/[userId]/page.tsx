// ════════════════════════════════════════════════════════════════════════════
//  app/p/[userId]/page.tsx — public profile page (reviews + aggregates)
//
//  Accessible to anyone (anonymous + authenticated). Renders the public
//  trust card: avatar, name, headline, aggregate rating, recommend %,
//  completed-jobs count, and the latest reviews.
//
//  GOLDEN_RULE_2 — strict projection. Public surface CANNOT leak:
//    - hourly_rate_cents, travel_rate_cents
//    - balance_cents, stripe_*
//    - country_of_residence, work_authorized_countries, sponsored_countries
//    - resume_path
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Star, ThumbsUp, Briefcase, ShieldCheck } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchReviewsForUser } from '@/lib/data/reviews';
import { StarRating } from '@/components/reviews/StarRating';
import { ReviewCard } from '@/components/reviews/ReviewCard';
import { BackButton } from '@/components/BackButton';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ userId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { userId } = await params;
  const supabase = await createSupabaseServerClient();

  // Anon-safe path: read the public view first. Falls back to profiles
  // for the auth-only case (non-inspector own profile).
  let name: string | null = null;
  let headline: string | null = null;
  {
    const { data } = await supabase
      .from('inspectors_directory')
      .select('full_name, headline')
      .eq('id', userId)
      .maybeSingle();
    if (data) {
      const row = data as { full_name?: string | null; headline?: string | null };
      name = row.full_name ?? null;
      headline = row.headline ?? null;
    }
  }
  if (name == null) {
    const { data } = await supabase
      .from('profiles')
      .select('full_name, headline')
      .eq('id', userId)
      .maybeSingle();
    if (data) {
      const row = data as { full_name?: string | null; headline?: string | null };
      name = row.full_name ?? null;
      headline = row.headline ?? null;
    }
  }

  const displayName = name?.trim() || 'Profile';
  const description =
    headline?.trim() ||
    'Verified inspection professional on NEXPEC — ratings, reviews, and recent work.';

  return {
    title: `${displayName} · NEXPEC`,
    description,
    alternates: { canonical: `/p/${userId}` },
    openGraph: {
      title: `${displayName} · NEXPEC`,
      description,
      type: 'profile',
    },
    robots: { index: true, follow: true },
  };
}

export default async function PublicProfilePage({ params }: PageProps) {
  const { userId } = await params;

  const supabase = await createSupabaseServerClient();

  // Sprint 13.2 anon-safe path: try the public.inspectors_directory view
  // FIRST. That view is the column-whitelisted public surface granted to
  // anon + authenticated; it returns rich inspector cards regardless of
  // whether the viewer is signed in. If it returns a row, we use it.
  //
  // If the user is NOT an inspector (or is suspended / nameless), the
  // view returns nothing and we fall back to the cascading-projection
  // read against profiles. That path requires auth (self-read) or admin,
  // which is correct: only inspectors are publicly browsable; client /
  // agency / enterprise profiles are still members-only.
  let data: Record<string, unknown> | null = null;

  {
    const res = await supabase
      .from('inspectors_directory')
      .select(
        'id, full_name, headline, bio, avatar_url, location_city, location_province, ' +
          'verification_status, rating_average, rating_count, recommend_percent, ' +
          'completed_jobs_count, total_jobs, created_at',
      )
      .eq('id', userId)
      .maybeSingle();
    if (!res.error && res.data) {
      // Synthesise `role` so the existing render path keeps its shape.
      data = { ...(res.data as Record<string, unknown>), role: 'inspector' };
    }
  }

  // CASCADING PROJECTION fallback — if the directory view didn't return
  // this user (non-inspector, suspended, etc.), try the underlying
  // profiles table. RLS gates this to self + admin reads.
  //
  //   WIDE  → all known public columns
  //   MID   → minus the optional/newer ones
  //   NARROW → bare minimum that exists on every install
  if (!data) {
    const WIDE =
      'id, full_name, headline, bio, avatar_url, role, company_name, location_city, location_province, verification_status, rating_average, rating_count, recommend_percent, completed_jobs_count, total_jobs, created_at';
    const MID =
      'id, full_name, headline, bio, avatar_url, role, location_city, verification_status, rating_average, rating_count, completed_jobs_count, created_at';
    const NARROW = 'id, full_name, avatar_url, role, created_at';

    for (const proj of [WIDE, MID, NARROW]) {
      const res = await supabase
        .from('profiles')
        .select(proj)
        .eq('id', userId)
        .maybeSingle();
      if (!res.error && res.data) {
        data = res.data as unknown as Record<string, unknown>;
        break;
      }
      if (res.error && typeof console !== 'undefined') {
        console.warn('[public profile] projection failed:', res.error.message);
      }
    }
  }

  if (!data) {
    return (
      <main className="container-narrow py-24">
        <h1 className="font-display text-3xl text-white">Profile not found</h1>
        <p className="mt-3 text-sm text-zinc-400">
          That profile doesn&apos;t exist, or RLS hasn&apos;t been opened for
          cross-role profile reads. Ask an admin to apply the latest
          profiles-RLS migration.
        </p>
        <p className="mt-2 text-[11px] text-zinc-600">
          User id: <span className="font-mono">{userId}</span>
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-zinc-200 hover:border-violet/40 hover:text-white"
        >
          Return home
        </Link>
      </main>
    );
  }

  const r = data as unknown as Record<string, unknown>;
  const reviews = await fetchReviewsForUser(userId, 50);

  const ratingAvg = Number(r.rating_average ?? 0);
  const ratingCount = Number(r.rating_count ?? 0);
  const recommendPct = Number(r.recommend_percent ?? 0);
  const completedJobs = Number(r.completed_jobs_count ?? 0);
  const role = String(r.role ?? '');
  const isInspector = role === 'inspector';
  const isVerified = String(r.verification_status ?? '') === 'verified';

  return (
    <main className="container-narrow py-12 sm:py-16">
      {/* Back to the previous page (applications list, admin drawer, etc.) */}
      <div className="mb-6">
        <BackButton fallbackHref="/" label="Back" />
      </div>

      {/* Profile header */}
      <section className="rounded-3xl border border-white/[0.08] bg-gradient-to-b from-ink-800/60 to-ink-900/40 p-6 sm:p-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="relative inline-flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-violet to-cyan-glow ring-2 ring-white/[0.06]">
            {r.avatar_url ? (
              <Image
                src={String(r.avatar_url)}
                alt={(r.full_name as string | null) ?? 'Profile'}
                width={96}
                height={96}
                className="h-full w-full object-cover"
                unoptimized
              />
            ) : (
              <span className="font-display text-3xl font-semibold text-white">
                {((r.full_name as string | null) ?? '?').slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                {(r.full_name as string | null) ?? 'Anonymous'}
              </h1>
              {isVerified && (
                <span className="inline-flex items-center gap-1 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-cyan-glow">
                  <ShieldCheck className="h-3 w-3" strokeWidth={1.75} />
                  Verified
                </span>
              )}
            </div>
            {(r.headline as string | null) && (
              <p className="mt-1 text-sm text-zinc-300">{r.headline as string}</p>
            )}
            <p className="mt-1 text-[11px] uppercase tracking-industrial text-zinc-500">
              {isInspector ? 'Inspector' : role || 'Member'}
              {r.company_name ? ` · ${r.company_name as string}` : ''}
              {r.location_city || r.location_province
                ? ` · ${[r.location_city, r.location_province].filter(Boolean).join(', ')}`
                : ''}
            </p>

            {(r.bio as string | null) && (
              <p className="mt-4 max-w-2xl text-sm text-zinc-400 whitespace-pre-wrap">
                {r.bio as string}
              </p>
            )}
          </div>
        </div>

        {/* Aggregate tiles */}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile
            label="Average rating"
            value={ratingCount > 0 ? ratingAvg.toFixed(2) : '—'}
            sub={ratingCount > 0 ? `${ratingCount} review${ratingCount === 1 ? '' : 's'}` : 'No reviews yet'}
            icon={<Star className="h-4 w-4" strokeWidth={1.75} />}
            tone="amber"
          />
          <Tile
            label="Recommend"
            value={ratingCount > 0 ? `${recommendPct}%` : '—'}
            sub="of reviewers"
            icon={<ThumbsUp className="h-4 w-4" strokeWidth={1.75} />}
            tone="green"
          />
          <Tile
            label="Completed jobs"
            value={String(completedJobs)}
            sub="successfully closed"
            icon={<Briefcase className="h-4 w-4" strokeWidth={1.75} />}
            tone="violet"
          />
          <Tile
            label="Member since"
            value={formatYear(r.created_at as string | null)}
            sub="on NEXPEC"
            icon={<ShieldCheck className="h-4 w-4" strokeWidth={1.75} />}
            tone="cyan"
          />
        </div>
      </section>

      {/* Reviews list */}
      <section className="mt-10">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-xl font-semibold tracking-tight text-white">
            Reviews
          </h2>
          <div className="flex items-center gap-2">
            <StarRating defaultValue={Math.round(ratingAvg)} readOnly size={4} />
            <span className="text-xs text-zinc-400">
              {ratingCount === 0
                ? 'No reviews yet'
                : `${ratingAvg.toFixed(2)} · ${ratingCount} review${ratingCount === 1 ? '' : 's'}`}
            </span>
          </div>
        </div>

        {reviews.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center text-sm text-zinc-500">
            No reviews yet. Once a job completes, the counterparty can leave one.
          </p>
        ) : (
          <ul className="mt-6 space-y-3">
            {reviews.map((review) => (
              <li key={review.id}>
                <ReviewCard review={review} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/* ─── pieces ─────────────────────────────────────────────────────────── */

type Tone = 'violet' | 'cyan' | 'amber' | 'green';

function Tile({
  label,
  value,
  sub,
  icon,
  tone = 'violet',
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  tone?: Tone;
}) {
  const toneClass =
    tone === 'amber'
      ? 'text-accent-amber'
      : tone === 'green'
        ? 'text-accent-green'
        : tone === 'cyan'
          ? 'text-cyan-glow'
          : 'text-violet-glow';
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        <span className={toneClass}>{icon}</span>
        {label}
      </p>
      <p className={`mt-2 font-mono text-2xl font-semibold ${toneClass}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-zinc-500">{sub}</p>
    </div>
  );
}

function formatYear(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return String(d.getFullYear());
}
