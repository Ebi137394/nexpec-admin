// ════════════════════════════════════════════════════════════════════════════
//  app/agency/[handle]/page.tsx — canonical agency pool page (ISR + SEO)
//
//  Per-agency long-tail SEO surface, keyed by the opaque NX- handle. Organization
//  JSON-LD. AGGREGATE only — member count + union of disciplines + region; the
//  individual roster is never present (anti-poaching by construction).
// ════════════════════════════════════════════════════════════════════════════
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, BadgeCheck, Building2, MapPin, Star, Users } from 'lucide-react';
import { Nav } from '@/components/marketing/Nav';
import { Footer } from '@/components/marketing/Footer';
import { JsonLd } from '@/components/teaser/JsonLd';
import { SourceBadge } from '@/components/teaser/SourceBadge';
import {
  fetchAllAgencyHandles,
  fetchSupplyTeaserByHandle,
  humanizeSlug,
} from '@/lib/data/teaser';

export const revalidate = 60;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexpecapp.com';

interface PageProps {
  params: Promise<{ handle: string }>;
}

export async function generateStaticParams() {
  const handles = await fetchAllAgencyHandles();
  return handles.map((handle) => ({ handle }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { handle } = await params;
  const pool = await fetchSupplyTeaserByHandle(handle);
  if (!pool || pool.source_kind !== 'agency_pool') {
    return { title: 'Agency not found, NEXPEC', robots: { index: false, follow: false } };
  }
  const specs = (pool.specialty_slugs ?? []).map(humanizeSlug).slice(0, 3).join(', ');
  const where = [pool.location_city, pool.location_province ?? pool.country].filter(Boolean).join(', ');
  const size = pool.pool_size != null ? Number(pool.pool_size) : null;
  const title = `NEXPEC-Vetted Inspection Agency ${pool.handle}`;
  const description = `A NEXPEC-vetted inspection agency${
    size ? ` of ${size} verified specialists` : ''
  }${specs ? ` covering ${specs}` : ''}${where ? `, based in ${where}` : ''}. Identities protected; engage the team through NEXPEC.`;
  return {
    title: `${title}, NEXPEC`,
    description,
    alternates: { canonical: `/agency/${pool.handle}` },
    openGraph: {
      title: `${title}, NEXPEC`,
      description,
      url: `${SITE_URL}/agency/${pool.handle}`,
      type: 'website',
      siteName: 'NEXPEC',
    },
    robots: { index: true, follow: true },
  };
}

export default async function AgencyPage({ params }: PageProps) {
  const { handle } = await params;
  const pool = await fetchSupplyTeaserByHandle(handle);
  if (!pool || pool.source_kind !== 'agency_pool') notFound();

  const specs = (pool.specialty_slugs ?? []).filter(Boolean);
  const certs = (pool.certifications ?? []).filter(Boolean);
  const where = [pool.location_city, pool.location_province ?? pool.country].filter(Boolean).join(', ');
  const rating = pool.rating_average != null ? Number(pool.rating_average) : null;
  const size = pool.pool_size != null ? Number(pool.pool_size) : null;

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    identifier: pool.handle,
    name: `NEXPEC Vetted Agency ${pool.handle}`,
    description: 'A NEXPEC-vetted industrial inspection agency. Identities protected; engagements brokered through NEXPEC with funds on payment hold.',
    knowsAbout: [...specs.map(humanizeSlug), ...certs],
    ...(size ? { numberOfEmployees: { '@type': 'QuantitativeValue', value: size } } : {}),
    ...(where
      ? {
          address: {
            '@type': 'PostalAddress',
            addressLocality: pool.location_city ?? undefined,
            addressCountry: pool.country ?? undefined,
          },
        }
      : {}),
    ...(rating != null
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: rating,
            ratingCount: pool.rating_count ?? 1,
            bestRating: 5,
          },
        }
      : {}),
    parentOrganization: { '@type': 'Organization', name: 'NEXPEC', url: SITE_URL },
  };

  return (
    <>
      <JsonLd data={jsonLd} />
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
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet to-violet-glow shadow-glow">
                <Building2 className="h-8 w-8 text-white" aria-hidden />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="font-mono text-2xl font-semibold text-white">{pool.handle}</h1>
                  <BadgeCheck className="h-5 w-5 text-violet-glow" aria-hidden />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                  <SourceBadge kind="agency_pool" />
                  {size != null && (
                    <span className="inline-flex items-center gap-1.5 text-violet-glow">
                      <Users className="h-3.5 w-3.5" aria-hidden />
                      {size} vetted specialist{size === 1 ? '' : 's'}
                    </span>
                  )}
                  {where && (
                    <span className="inline-flex items-center gap-1.5 text-zinc-400">
                      <MapPin className="h-3.5 w-3.5 text-violet-glow/70" aria-hidden />
                      {where}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {(rating != null || pool.completed_jobs_count != null || pool.is_available || pool.rate_band) && (
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/[0.06] pt-5 text-sm">
                {rating != null && (
                  <span className="inline-flex items-center gap-1.5 text-zinc-200">
                    <Star className="h-4 w-4 fill-accent-amber text-accent-amber" aria-hidden />
                    {rating.toFixed(1)}
                    <span className="text-zinc-500"> team avg</span>
                  </span>
                )}
                {pool.completed_jobs_count != null && (
                  <span className="text-zinc-300">{pool.completed_jobs_count} inspections delivered</span>
                )}
                {pool.is_available && (
                  <span className="inline-flex items-center gap-1.5 text-accent-green">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent-green" aria-hidden />
                    Available for dispatch
                  </span>
                )}
                {pool.rate_band && (
                  <span className="inline-flex items-center gap-1.5 text-zinc-300">
                    <span className="font-semibold text-violet-glow">{pool.rate_band}</span> rate tier
                  </span>
                )}
              </div>
            )}
          </div>

          {(specs.length > 0 || certs.length > 0) && (
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              {specs.length > 0 && <Panel title="Disciplines covered" items={specs.map(humanizeSlug)} />}
              {certs.length > 0 && <Panel title="Team certifications" items={certs} />}
            </div>
          )}

          <div className="mt-8 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
            <p className="text-sm text-zinc-400">
              Team composition is aggregated to protect the agency&apos;s roster. Members are vetted and
              verified by NEXPEC; engagement, contracting, and payment are brokered through the
              platform, with payment on payment hold.
            </p>
            <Link href="/sign-up" className="btn-primary mt-5">
              Engage the team via NEXPEC <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

function Panel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/60 to-ink-900/40 p-5">
      <p className="eyebrow">{title}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {items.map((s) => (
          <span
            key={s}
            className="rounded-md border border-ink-600 bg-ink-950/60 px-2 py-0.5 text-[11px] font-medium text-zinc-300"
          >
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}
