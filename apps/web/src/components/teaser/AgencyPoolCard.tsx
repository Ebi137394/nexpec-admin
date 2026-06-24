// ════════════════════════════════════════════════════════════════════════════
//  components/teaser/AgencyPoolCard.tsx — agency aggregate spotlight (RSC)
//
//  An agency surfaces as ONE pseudonymous entity: NX- handle + member COUNT +
//  the union of disciplines + a representative region + aggregate trust. The
//  individual roster is never shown — the feed only ever has aggregates, so
//  there is nothing per-person to leak (anti-poaching by construction).
// ════════════════════════════════════════════════════════════════════════════
import Link from 'next/link';
import { ArrowRight, BadgeCheck, Building2, MapPin, Star, Users } from 'lucide-react';
import { agencyPath, humanizeSlug, type SupplyTeaser } from '@/lib/data/teaser';

export function AgencyPoolCard({ pool }: { pool: SupplyTeaser }) {
  const chips = (pool.specialty_slugs ?? []).filter(Boolean).slice(0, 4);
  const place = [pool.location_city, pool.location_province ?? pool.country].filter(Boolean).join(', ');
  const rating = pool.rating_average != null ? Number(pool.rating_average) : null;
  const size = pool.pool_size != null ? Number(pool.pool_size) : null;
  const jobs = pool.completed_jobs_count;

  return (
    <article className="group relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-violet/20 bg-gradient-to-b from-ink-800/70 to-ink-900/50 p-5 backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-violet/50 hover:shadow-[0_24px_50px_-30px_rgba(124,58,237,0.6)]">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet to-violet-glow shadow-glow">
          <Building2 className="h-5 w-5 text-white" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Link
              href={agencyPath(pool.handle)}
              className="truncate font-mono text-sm font-semibold tracking-wide text-white transition-colors hover:text-violet-glow"
            >
              {pool.handle}
            </Link>
            <BadgeCheck className="h-4 w-4 shrink-0 text-violet-glow" aria-hidden />
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
            Vetted Agency
          </span>
        </div>
      </div>

      {size != null && (
        <div className="inline-flex w-fit items-center gap-1.5 rounded-full border border-violet/30 bg-violet/10 px-3 py-1 text-sm text-violet-glow">
          <Users className="h-3.5 w-3.5" aria-hidden />
          {size} vetted specialist{size === 1 ? '' : 's'}
        </div>
      )}

      {place && (
        <span className="inline-flex items-center gap-1.5 text-sm text-zinc-400">
          <MapPin className="h-3.5 w-3.5 text-violet-glow/70" aria-hidden />
          {place}
        </span>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((s) => (
            <span
              key={s}
              className="rounded-md border border-ink-600 bg-ink-950/60 px-2 py-0.5 text-[11px] font-medium text-zinc-400"
            >
              {humanizeSlug(s)}
            </span>
          ))}
        </div>
      )}

      {(rating != null || jobs != null || pool.is_available || pool.rate_band) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {rating != null && (
            <span className="inline-flex items-center gap-1 text-zinc-300">
              <Star className="h-3.5 w-3.5 fill-accent-amber text-accent-amber" aria-hidden />
              {rating.toFixed(1)}
              <span className="text-zinc-500"> team avg</span>
            </span>
          )}
          {jobs != null && (
            <span className="text-zinc-400">{jobs} inspections delivered</span>
          )}
          {pool.is_available && (
            <span className="inline-flex items-center gap-1.5 text-accent-green">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-green" aria-hidden />
              Available
            </span>
          )}
          {pool.rate_band && (
            <span className="inline-flex items-center gap-1.5 text-zinc-400" title="Typical team rate tier">
              <span className="font-semibold text-violet-glow">{pool.rate_band}</span>
              <span className="text-zinc-500">rate</span>
            </span>
          )}
        </div>
      )}

      <Link
        href="/sign-up"
        className="mt-auto inline-flex items-center gap-1.5 text-sm font-semibold text-violet-glow transition-colors hover:text-white"
      >
        Engage the team via NEXPEC
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </article>
  );
}
