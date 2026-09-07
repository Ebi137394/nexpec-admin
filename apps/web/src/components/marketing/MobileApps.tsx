// ════════════════════════════════════════════════════════════════════════════
//  MobileApps — tells visitors the iOS and Android apps exist.
//
//  Placed LATE in the page, immediately before the closing CTA. The store
//  download is a secondary action: the primary conversion is still "Get
//  started" in the nav and the closing CTA, and this section must not compete
//  with the business proposition above it. That is also why it is a quiet
//  bordered panel rather than another full-bleed cinematic block, and why the
//  copy stays B2B ("manage inspection work") rather than consumer-app pitch.
// ════════════════════════════════════════════════════════════════════════════
import { StoreBadges } from '@/components/marketing/StoreBadges';

export function MobileApps() {
  return (
    <section id="mobile-apps" className="relative py-16 sm:py-20">
      <div className="container-narrow">
        <div className="flex flex-col items-start gap-8 rounded-3xl border border-white/[0.08] bg-ink-950/60 px-8 py-10 sm:px-12 sm:py-12 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <h2 className="text-balance text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              NEXPEC, wherever inspections happen.
            </h2>
            <p className="mt-3 text-pretty text-sm leading-relaxed text-zinc-400 sm:text-base">
              Manage inspection work from web, iPhone, or Android — assign jobs,
              capture evidence in the field, and review audit-grade reports on
              the same account.
            </p>
          </div>

          {/* shrink-0 keeps the badges from being squeezed by the copy on
              tablet widths, where the row is still side by side. */}
          <StoreBadges className="shrink-0" />
        </div>
      </div>
    </section>
  );
}
