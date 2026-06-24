// ════════════════════════════════════════════════════════════════════════════
//  app/inspections/[slug]/page.tsx — canonical inspection teaser (ISR + SEO)
//
//  THE Google-Jobs play: each open, public-listable inspection gets a crawlable
//  canonical page carrying JobPosting JSON-LD. Keyed by the trailing NX- ref in
//  the descriptive slug. Sanitized by construction — no client identity, no
//  price, no exact date (only a coarse timeframe). Full scope unlocks on sign-in.
// ════════════════════════════════════════════════════════════════════════════
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, CalendarDays, Lock, MapPin, ShieldCheck } from 'lucide-react';
import { Nav } from '@/components/marketing/Nav';
import { Footer } from '@/components/marketing/Footer';
import { JsonLd } from '@/components/teaser/JsonLd';
import { SourceBadge, type SourceKind } from '@/components/teaser/SourceBadge';
import {
  domainLabel,
  fetchAllDemand,
  fetchDemandTeaserByRef,
  humanizeSlug,
  inspectionSlug,
  parseRefFromSlug,
} from '@/lib/data/teaser';

export const revalidate = 60;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexpecapp.com';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const jobs = await fetchAllDemand();
  return jobs.map((j) => ({ slug: inspectionSlug(j) }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const ref = parseRefFromSlug(slug);
  const job = ref ? await fetchDemandTeaserByRef(ref) : null;
  if (!job) {
    return { title: 'Inspection not found, NEXPEC', robots: { index: false, follow: false } };
  }
  const where = [job.location_city, job.country].filter(Boolean).join(', ');
  const title = `${domainLabel(job.domain)} Inspection${where ? ` — ${where}` : ''}`;
  const description = `Open ${domainLabel(job.domain).toLowerCase()} inspection${
    where ? ` in ${where}` : ''
  }${job.timeframe ? `, ${job.timeframe}` : ''}. Vetted inspectors apply through NEXPEC — brokered, escrowed, and audit-grade.`;
  return {
    title: `${title}, NEXPEC`,
    description,
    alternates: { canonical: `/inspections/${inspectionSlug(job)}` },
    openGraph: {
      title: `${title}, NEXPEC`,
      description,
      url: `${SITE_URL}/inspections/${inspectionSlug(job)}`,
      type: 'website',
      siteName: 'NEXPEC',
    },
    robots: { index: true, follow: true },
  };
}

export default async function InspectionPage({ params }: PageProps) {
  const { slug } = await params;
  const ref = parseRefFromSlug(slug);
  const job = ref ? await fetchDemandTeaserByRef(ref) : null;
  if (!job) notFound();

  const where = [job.location_city, job.country].filter(Boolean).join(', ');
  const specs = (job.specialty_slugs ?? []).filter(Boolean);
  const dLabel = domainLabel(job.domain);
  const posted = job.posted_at ? new Date(job.posted_at) : null;
  const validThrough = posted ? new Date(posted.getTime() + 60 * 86400000) : null;

  const jobLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: `${dLabel} Inspection${where ? ` — ${where}` : ''}`,
    description:
      `<p>Open ${dLabel} inspection engagement${where ? ` in ${where}` : ''}${
        job.timeframe ? `, scheduled ${job.timeframe}` : ''
      }.</p>` +
      `<p>NEXPEC is an industrial inspection marketplace: vetted, verified inspectors are matched to client work, with every engagement brokered, contracted, and escrowed through the platform. Client and inspector identities are protected by design.</p>` +
      (specs.length ? `<p>Relevant scope: ${specs.map(humanizeSlug).join(', ')}.</p>` : ''),
    datePosted: posted ? posted.toISOString() : undefined,
    validThrough: validThrough ? validThrough.toISOString() : undefined,
    employmentType: 'CONTRACTOR',
    directApply: false,
    identifier: { '@type': 'PropertyValue', name: 'NEXPEC', value: job.ref },
    hiringOrganization: {
      '@type': 'Organization',
      name: 'NEXPEC',
      sameAs: SITE_URL,
      url: SITE_URL,
    },
    ...(where
      ? {
          jobLocation: {
            '@type': 'Place',
            address: {
              '@type': 'PostalAddress',
              addressLocality: job.location_city ?? undefined,
              addressCountry: job.country ?? undefined,
            },
          },
        }
      : {}),
    industry: dLabel,
  };

  return (
    <>
      <JsonLd data={jobLd} />
      <Nav viewer={null} />
      <main id="top" className="relative py-24 sm:py-28">
        <div className="container-narrow max-w-3xl">
          <Link
            href="/discover"
            className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to marketplace
          </Link>

          <div className="card-elevated mt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SourceBadge kind={job.source_kind as SourceKind} />
              {job.posted_at && (
                <span className="text-xs text-zinc-500">
                  Posted{' '}
                  {new Date(job.posted_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              )}
            </div>
            <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight text-white">
              {dLabel} Inspection
            </h1>
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-zinc-400">
              {where && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-violet-glow/70" aria-hidden />
                  {where}
                </span>
              )}
              {job.timeframe && (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="h-4 w-4 text-violet-glow/70" aria-hidden />
                  {job.timeframe}
                </span>
              )}
            </div>
            {specs.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-1.5">
                {specs.map((s) => (
                  <span
                    key={s}
                    className="rounded-md border border-ink-600 bg-ink-950/60 px-2 py-0.5 text-[11px] font-medium text-zinc-300"
                  >
                    {humanizeSlug(s)}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Info
              icon={<ShieldCheck className="h-5 w-5 text-cyan-glow" aria-hidden />}
              title="Brokered & escrowed"
              body="Contracting and payment run through NEXPEC. Funds are held in escrow until the report is approved."
            />
            <Info
              icon={<Lock className="h-5 w-5 text-violet-glow" aria-hidden />}
              title="Identities protected"
              body="Client and inspector identities stay private until an engagement is formed on-platform."
            />
          </div>

          <div className="mt-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
            <p className="text-sm text-zinc-400">
              Full scope, exact location, and schedule are shared with vetted inspectors after
              sign-in. Apply to be matched to this engagement.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/sign-up" className="btn-primary">
                Sign in to apply <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link href="/discover" className="btn-secondary">
                Browse more inspections
              </Link>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

function Info({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/60 to-ink-900/40 p-5">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </div>
      <p className="mt-2 text-sm text-zinc-400">{body}</p>
    </div>
  );
}
