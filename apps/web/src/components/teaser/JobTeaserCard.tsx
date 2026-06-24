// ════════════════════════════════════════════════════════════════════════════
//  components/teaser/JobTeaserCard.tsx — demand teaser (RSC)
//
//  A sanitized inspection-demand card: domain headline + coarse location +
//  coarse timeframe + specialty chips + source badge. No client identity, no
//  exact date, no price (all withheld at the DB view). CTA routes to sign-up.
// ════════════════════════════════════════════════════════════════════════════
import Link from 'next/link';
import { ArrowRight, CalendarDays, MapPin } from 'lucide-react';
import { SourceBadge } from './SourceBadge';
import { domainLabel, humanizeSlug, inspectionPath, timeAgo, type DemandTeaser } from '@/lib/data/teaser';

export function JobTeaserCard({ job }: { job: DemandTeaser }) {
  const chips = (job.specialty_slugs ?? []).filter(Boolean).slice(0, 3);
  const place = [job.location_city, job.country].filter(Boolean).join(', ');

  return (
    <article className="group relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/50 p-5 backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-violet/40 hover:shadow-[0_24px_50px_-30px_rgba(124,58,237,0.55)]">
      <div className="flex items-center justify-between gap-2">
        <SourceBadge kind={job.source_kind} />
        {job.posted_at ? (
          <span className="text-[11px] text-zinc-500">{timeAgo(job.posted_at)}</span>
        ) : null}
      </div>

      <h3 className="font-display text-lg font-semibold leading-snug text-white">
        <Link href={inspectionPath(job)} className="transition-colors hover:text-violet-glow">
          {domainLabel(job.domain)} Inspection
        </Link>
      </h3>

      {(place || job.timeframe) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-zinc-400">
          {place && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-violet-glow/70" aria-hidden />
              {place}
            </span>
          )}
          {job.timeframe && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 text-violet-glow/70" aria-hidden />
              {job.timeframe}
            </span>
          )}
        </div>
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

      <Link
        href="/sign-up"
        className="mt-auto inline-flex items-center gap-1.5 text-sm font-semibold text-violet-glow transition-colors hover:text-white"
      >
        Sign in to apply
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </article>
  );
}
