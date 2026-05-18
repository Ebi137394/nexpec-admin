// ════════════════════════════════════════════════════════════════════════════
//  app/client/branding-settings/page.tsx — client report branding
//
//  Web parity of app/(client)/branding-settings.tsx (mobile). Logo
//  upload + report header/footer text + custom-branding toggle.
//  primary_color deferred until schema confirms the column.
// ════════════════════════════════════════════════════════════════════════════

import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Image from 'next/image';
import {
  AlertCircle,
  CheckCircle2,
  Camera,
  Palette,
  Sparkles,
} from 'lucide-react';
import { fetchClientBranding } from '@/lib/data/clientBranding';
import { updateClientBranding } from '@/lib/actions/clientBranding';
import { uploadCompanyLogo } from '@/lib/actions/uploadCompanyLogo';

export const metadata: Metadata = {
  title: 'Report branding',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ saved?: string; error?: string }>;
}

export default async function ClientBrandingPage({ searchParams }: PageProps) {
  const qp = await searchParams;
  const branding = await fetchClientBranding();
  if (!branding) redirect('/client/dashboard');

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Client Portal · Branding
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Report branding
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-sm text-zinc-400">
          Customise the cover, header, and footer of every report
          delivered for your jobs. Stored in the{' '}
          <span className="font-mono">branding_assets</span> bucket; the
          PDF renderer applies these to every signed report on delivery.
        </p>
      </header>

      {qp.error && (
        <Banner tone="red" icon={<AlertCircle className="h-5 w-5" />}>
          {qp.error}
        </Banner>
      )}
      {qp.saved === '1' && (
        <Banner tone="cyan" icon={<CheckCircle2 className="h-5 w-5" />}>
          Branding saved.
        </Banner>
      )}

      {/* Logo upload */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <header className="mb-6">
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            Company logo
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Appears in the top-left of every report PDF. Square crops or
            wordmarks both work — max 2 MB.
          </p>
        </header>
        <form
          action={uploadCompanyLogo}
          encType="multipart/form-data"
          className="flex flex-col items-start gap-4 sm:flex-row sm:items-center"
        >
          <div
            className="relative inline-flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/[0.04] ring-2 ring-white/[0.06]"
            aria-hidden
          >
            {branding.companyLogoUrl ? (
              <Image
                src={branding.companyLogoUrl}
                alt={branding.companyName ?? 'Company logo'}
                width={96}
                height={96}
                className="h-full w-full object-contain"
                unoptimized
              />
            ) : (
              <Palette
                className="h-8 w-8 text-zinc-500"
                strokeWidth={1.5}
              />
            )}
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <label
              htmlFor="logo"
              className="group inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-violet/40 hover:bg-white/[0.04] hover:text-white"
            >
              <Camera className="h-4 w-4" strokeWidth={1.75} />
              Choose new logo
            </label>
            <input
              id="logo"
              name="logo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
            />
            <p className="text-[11px] text-zinc-500">
              JPEG, PNG, or WebP · max 2 MB · transparent PNGs look best
              on the dark theme.
            </p>
            <button
              type="submit"
              className="btn-primary mt-2 inline-flex w-fit items-center gap-2"
            >
              Upload logo
              <span aria-hidden>→</span>
            </button>
          </div>
        </form>
      </section>

      {/* Text + toggle form */}
      <form
        action={updateClientBranding}
        className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8"
      >
        <header className="mb-6">
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            Report copy
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Header sits above the inspection title; footer sits below the
            signature block (legal disclaimers, support phone, address).
          </p>
        </header>

        <div className="space-y-5">
          <div>
            <label
              htmlFor="reportHeaderText"
              className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
            >
              Report header
            </label>
            <textarea
              id="reportHeaderText"
              name="reportHeaderText"
              maxLength={500}
              rows={3}
              defaultValue={branding.reportHeaderText ?? ''}
              placeholder={`${branding.companyName ?? 'Your company'} · Field Operations Division`}
              className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
            />
            <p className="mt-1.5 text-[11px] text-zinc-500">
              Max 500 chars. Plain text. Appears below the logo.
            </p>
          </div>
          <div>
            <label
              htmlFor="reportFooterText"
              className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
            >
              Report footer
            </label>
            <textarea
              id="reportFooterText"
              name="reportFooterText"
              maxLength={500}
              rows={4}
              defaultValue={branding.reportFooterText ?? ''}
              placeholder={`Confidential — for the internal use of ${branding.companyName ?? 'the client'} only. Distribution outside the requesting party requires written consent.`}
              className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
            />
            <p className="mt-1.5 text-[11px] text-zinc-500">
              Max 500 chars. Plain text. Appears at the end of every page.
            </p>
          </div>

          <label className="group flex cursor-pointer items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 text-sm leading-relaxed text-zinc-300 transition-colors hover:border-violet/40 hover:bg-white/[0.04] has-[:checked]:border-violet/40 has-[:checked]:bg-violet/10 has-[:checked]:text-white">
            <input
              type="checkbox"
              name="useCustomBranding"
              defaultChecked={branding.useCustomBranding}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-transparent text-violet focus:ring-violet/40 focus:ring-offset-0"
            />
            <span className="flex-1">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                Apply custom branding to every report
              </span>
              <span className="mt-1 block text-xs text-zinc-500">
                When off, reports use NEXPEC&apos;s default chrome.
                Toggle on to apply your logo + header + footer.
              </span>
            </span>
          </label>
        </div>

        <div className="mt-8 flex justify-end">
          <button
            type="submit"
            className="btn-primary inline-flex items-center gap-2"
          >
            Save branding
            <span aria-hidden>→</span>
          </button>
        </div>
      </form>
    </div>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: 'cyan' | 'red';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const classes =
    tone === 'cyan'
      ? 'border-cyan-glow/30 bg-cyan-glow/5 text-cyan-glow'
      : 'border-accent-red/30 bg-accent-red/10 text-accent-red';
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-4 ${classes}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <p className="text-sm">{children}</p>
    </div>
  );
}
