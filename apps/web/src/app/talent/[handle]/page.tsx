// ════════════════════════════════════════════════════════════════════════════
//  app/talent/[handle]/page.tsx — canonical pseudonymous talent page (ISR + SEO)
//
//  Per-inspector long-tail SEO surface, keyed by the opaque NX- handle (the only
//  identifier the supply feed exposes). ProfilePage + Person JSON-LD. Identity
//  stays protected by construction — there is no name/photo/contact to render.
// ════════════════════════════════════════════════════════════════════════════
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, BadgeCheck, MapPin, ShieldCheck, Star } from 'lucide-react';
import { Nav } from '@/components/marketing/Nav';
import { Footer } from '@/components/marketing/Footer';
import { JsonLd } from '@/components/teaser/JsonLd';
import { SourceBadge } from '@/components/teaser/SourceBadge';
import {
  fetchAllSupplyHandles,
  fetchSupplyTeaserByHandle,
  humanizeSlug,
} from '@/lib/data/teaser';

export const revalidate = 60;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexpecapp.com';

interface PageProps {
  params: Promise<{ handle: string }>;
}

export async function generateStaticParams() {
  const handles = await fetchAllSupplyHandles();
  return handles.map((handle) => ({ handle }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { handle } = await params;
  const pro = await fetchSupplyTeaserByHandle(handle);
  if (!pro || pro.source_kind !== 'inspector') {
    return { title: 'Inspector not found, NEXPEC', robots: { index: false, follow: false } };
  }
  const specs = (pro.specialty_slugs ?? []).map(humanizeSlug).slice(0, 3).join(', ');
  const where = [pro.location_city, pro.location_province ?? pro.country].filter(Boolean).join(', ');
  const title = `NEXPEC-Verified Inspector ${pro.handle}${specs ? `, ${specs}` : ''}`;
  const description = `A NEXPEC-verified, vetted inspection specialist${
    specs ? ` in ${specs}` : ''
  }${where ? `, based in ${where}` : ''}. Capability and performance verified by the platform; identity protected. Engage securely through NEXPEC.`;
  return {
    title: `${title}, NEXPEC`,
    description,
    alternates: { canonical: `/talent/${pro.handle}` },
    openGraph: {
      title: `${title}, NEXPEC`,
      description,
      url: `${SITE_URL}/talent/${pro.handle}`,
      type: 'profile',
      siteName: 'NEXPEC',
    },
    robots: { index: true, follow: true },
  };
}

export default async function TalentPage({ params }: PageProps) {
  const { handle } = await params;
  const pro = await fetchSupplyTeaserByHandle(handle);
  if (!pro || pro.source_kind !== 'inspector') notFound();

  const specs = (pro.specialty_slugs ?? []).filter(Boolean);
  const certs = (pro.certifications ?? []).filter(Boolean);
  const where = [pro.location_city, pro.location_province ?? pro.country].filter(Boolean).join(', ');
  const rating = pro.rating_average != null ? Number(pro.rating_average) : null;

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    dateModified: new Date().toISOString(),
    mainEntity: {
      '@type': 'Person',
      identifier: pro.handle,
      name: `NEXPEC Verified Inspector ${pro.handle}`,
      jobTitle: specs.map(humanizeSlug).join(', ') || 'Industrial Inspector',
      knowsAbout: [...specs.map(humanizeSlug), ...certs],
      ...(where
        ? {
            address: {
              '@type': 'PostalAddress',
              addressLocality: pro.location_city ?? undefined,
              addressRegion: pro.location_province ?? undefined,
              addressCountry: pro.country ?? undefined,
            },
          }
        : {}),
      ...(rating != null
        ? {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: rating,
              ratingCount: pro.rating_count ?? 1,
              bestRating: 5,
            },
          }
        : {}),
      worksFor: { '@type': 'Organization', name: 'NEXPEC', url: SITE_URL },
    },
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
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet to-cyan-glow shadow-glow">
                <ShieldCheck className="h-8 w-8 text-white" aria-hidden />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="font-mono text-2xl font-semibold text-white">{pro.handle}</h1>
                  <BadgeCheck className="h-5 w-5 text-cyan-glow" aria-hidden />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                  <SourceBadge kind="inspector" />
                  {where && (
                    <span className="inline-flex items-center gap-1.5 text-zinc-400">
                      <MapPin className="h-3.5 w-3.5 text-violet-glow/70" aria-hidden />
                      {where}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {(rating != null || pro.completed_jobs_count != null || pro.is_available) && (
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/[0.06] pt-5 text-sm">
                {rating != null && (
                  <span className="inline-flex items-center gap-1.5 text-zinc-200">
                    <Star className="h-4 w-4 fill-accent-amber text-accent-amber" aria-hidden />
                    {rating.toFixed(1)}
                    {pro.rating_count != null && (
                      <span className="text-zinc-500"> ({pro.rating_count} reviews)</span>
                    )}
                  </span>
                )}
                {pro.completed_jobs_count != null && (
                  <span className="text-zinc-300">{pro.completed_jobs_count} inspections completed</span>
                )}
                {pro.is_available && (
                  <span className="inline-flex items-center gap-1.5 text-accent-green">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent-green" aria-hidden />
                    Available for dispatch
                  </span>
                )}
              </div>
            )}
          </div>

          {(specs.length > 0 || certs.length > 0) && (
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              {specs.length > 0 && <Panel title="Specialties" items={specs.map(humanizeSlug)} />}
              {certs.length > 0 && <Panel title="Certifications" items={certs} />}
            </div>
          )}

          <div className="mt-8 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
            <p className="text-sm text-zinc-400">
              Identity is protected by design. This specialist is vetted and verified by NEXPEC;
              engagement, contracting, and payment are brokered and escrowed through the platform.
            </p>
            <Link href="/sign-up" className="btn-primary mt-5">
              Engage via NEXPEC <ArrowRight className="h-4 w-4" aria-hidden />
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
