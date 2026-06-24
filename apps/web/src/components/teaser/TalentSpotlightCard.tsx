// ════════════════════════════════════════════════════════════════════════════
//  components/teaser/TalentSpotlightCard.tsx — supply teaser (RSC)
//
//  A pseudonymous talent spotlight: NX- handle + a shield monogram (NEVER a
//  photo), location, specialty chips, and trust signals. Rating / completed-jobs
//  are rendered ONLY when present (the view emits NULL at zero, so we never show
//  "0 jobs completed"). Agency affiliation is structurally absent. CTA → sign-up.
// ════════════════════════════════════════════════════════════════════════════
import Link from 'next/link';
import { ArrowRight, BadgeCheck, MapPin, ShieldCheck, Star } from 'lucide-react';
import { humanizeSlug, talentPath, type SupplyTeaser } from '@/lib/data/teaser';

export function TalentSpotlightCard({ pro }: { pro: SupplyTeaser }) {
  const chips = (pro.specialty_slugs ?? []).filter(Boolean).slice(0, 3);
  const place = [pro.location_city, pro.location_province ?? pro.country].filter(Boolean).join(', ');
  const rating = pro.rating_average != null ? Number(pro.rating_average) : null;
  const jobs = pro.completed_jobs_count;

  return (
    <article className="group relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/50 p-5 backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-violet/40 hover:shadow-[0_24px_50px_-30px_rgba(124,58,237,0.55)]">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet to-cyan-glow shadow-glow">
          <ShieldCheck className="h-5 w-5 text-white" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Link
              href={talentPath(pro.handle)}
              className="truncate font-mono text-sm font-semibold tracking-wide text-white transition-colors hover:text-violet-glow"
            >
              {pro.handle}
            </Link>
            <BadgeCheck className="h-4 w-4 shrink-0 text-cyan-glow" aria-hidden />
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-industrial text-accent-green">
            Verified &amp; Vetted
          </span>
        </div>
      </div>

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

      {(rating != null || jobs != null || pro.is_available || pro.rate_band) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {rating != null && (
            <span className="inline-flex items-center gap-1 text-zinc-300">
              <Star className="h-3.5 w-3.5 fill-accent-amber text-accent-amber" aria-hidden />
              {rating.toFixed(1)}
              {pro.rating_count != null ? (
                <span className="text-zinc-500"> ({pro.rating_count})</span>
              ) : null}
            </span>
          )}
          {jobs != null && (
            <span className="text-zinc-400">
              {jobs} job{jobs === 1 ? '' : 's'} completed
            </span>
          )}
          {pro.is_available && (
            <span className="inline-flex items-center gap-1.5 text-accent-green">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-green" aria-hidden />
              Available
            </span>
          )}
          {pro.rate_band && (
            <span className="inline-flex items-center gap-1.5 text-zinc-400" title="Typical rate tier">
              <span className="font-semibold text-violet-glow">{pro.rate_band}</span>
              <span className="text-zinc-500">rate</span>
            </span>
          )}
        </div>
      )}

      <Link
        href="/sign-up"
        className="mt-auto inline-flex items-center gap-1.5 text-sm font-semibold text-violet-glow transition-colors hover:text-white"
      >
        Engage via NEXPEC
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </article>
  );
}
