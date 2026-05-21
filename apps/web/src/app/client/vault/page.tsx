// ════════════════════════════════════════════════════════════════════════════
//  app/client/vault/page.tsx — Compliance Vault (buyer side)
//
//  Two-tab layout: My Documents (uploadable) + Inspection Certificates
//  (read-only trust_certificates aggregator). Category chips below the
//  tabs. Click any document → /client/vault/[id] for verify + edit.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronRight,
  ShieldCheck,
  ShieldAlert,
  FileText,
  Calendar,
  Hash,
  Award,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import {
  fetchVaultDocuments,
  fetchTrustCertificates,
  formatVaultDate,
  vaultExpiryStatus,
  vaultRelativeTime,
} from '@/lib/data/vault';
import {
  VAULT_CATEGORY_LABEL,
  type TrustCertificate,
  type VaultCategory,
  type VaultDocument,
} from '@/lib/data/vault.types';
import { VaultUploadDialog } from '@/components/vault/VaultUploadDialog';

export const metadata: Metadata = {
  title: 'Compliance Vault',
  description:
    'Upload + manage corporate compliance documents (insurance, licenses, NDAs, MSAs) and review inspection trust certificates.',
};

export const dynamic = 'force-dynamic';

type TabKey = 'documents' | 'certificates';

interface PageProps {
  searchParams: Promise<{ tab?: string; category?: string }>;
}

function isCategoryKey(v: string | undefined): v is VaultCategory {
  return v === 'insurance' || v === 'license' || v === 'nda' || v === 'msa' || v === 'regulatory' || v === 'audit' || v === 'other';
}

export default async function ClientVaultPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const tab: TabKey = sp.tab === 'certificates' ? 'certificates' : 'documents';
  const category = isCategoryKey(sp.category) ? sp.category : undefined;

  const [{ documents, counts }, certificates] = await Promise.all([
    fetchVaultDocuments({ category, limit: 200 }),
    tab === 'certificates' ? fetchTrustCertificates({ limit: 100 }) : Promise.resolve([] as TrustCertificate[]),
  ]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <header>
        <Link
          href="/client/finance"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Finance
        </Link>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
              Client Portal · Compliance
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Compliance Vault
            </h1>
            <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
              Your corporate compliance documents — insurance, licenses,
              NDAs, MSAs, regulatory filings. Admin verification stamps
              prove provenance. The Certificates tab aggregates trust
              certificates issued from your completed inspections.
            </p>
          </div>
          {tab === 'documents' && <VaultUploadDialog />}
        </div>
      </header>

      {/* Aggregate strip */}
      {tab === 'documents' && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Total" value={counts.total.toLocaleString()} />
          <Stat label="Verified" value={counts.verified.toLocaleString()} tone="green" />
          <Stat label="Unverified" value={counts.unverified.toLocaleString()} tone={counts.unverified > 0 ? 'amber' : 'default'} />
          <Stat label="Expiring 30d" value={counts.expiringSoon.toLocaleString()} tone={counts.expiringSoon > 0 ? 'amber' : 'default'} />
          <Stat label="Expired" value={counts.expired.toLocaleString()} tone={counts.expired > 0 ? 'red' : 'default'} />
        </section>
      )}

      {/* Tabs */}
      <nav className="flex flex-wrap gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.01] p-1.5">
        <TabLink active={tab === 'documents'} href="/client/vault">
          My Documents · {counts.total}
        </TabLink>
        <TabLink active={tab === 'certificates'} href="/client/vault?tab=certificates">
          Inspection Certificates
        </TabLink>
      </nav>

      {/* DOCUMENTS TAB */}
      {tab === 'documents' && (
        <>
          {/* Category chips */}
          {counts.byCategory.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <CategoryChip active={!category} href="/client/vault" label="All categories" count={counts.total} />
              {counts.byCategory.map((c) => (
                <CategoryChip
                  key={c.category}
                  active={category === c.category}
                  href={`/client/vault?category=${c.category}`}
                  label={VAULT_CATEGORY_LABEL[c.category]}
                  count={c.count}
                />
              ))}
            </div>
          )}

          {/* List */}
          <section className="space-y-3">
            {documents.length === 0 ? (
              <EmptyDocumentsState />
            ) : (
              documents.map((d) => <DocumentRow key={d.id} doc={d} />)
            )}
          </section>
        </>
      )}

      {/* CERTIFICATES TAB */}
      {tab === 'certificates' && (
        <section className="space-y-3">
          {certificates.length === 0 ? (
            <EmptyCertificatesState />
          ) : (
            certificates.map((c) => <CertificateRow key={c.id} cert={c} />)
          )}
        </section>
      )}

      <p className="text-[10px] font-mono uppercase tracking-industrial text-zinc-600">
        Source · public.client_documents · public.trust_certificates · RLS owner+admin scope.
      </p>
    </div>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────

function TabLink({
  active,
  href,
  children,
}: {
  active: boolean;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
        active
          ? 'bg-violet/15 text-white ring-1 ring-inset ring-violet/30'
          : 'text-zinc-400 hover:bg-white/[0.04] hover:text-white'
      }`}
    >
      {children}
    </Link>
  );
}

function CategoryChip({
  active,
  href,
  label,
  count,
}: {
  active: boolean;
  href: string;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
        active
          ? 'border-violet/40 bg-violet/10 text-violet-glow'
          : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:text-white'
      }`}
    >
      <Hash className="h-3 w-3" strokeWidth={1.75} />
      {label}
      <span className="ml-1 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px]">{count}</span>
    </Link>
  );
}

function DocumentRow({ doc }: { doc: VaultDocument }) {
  const expiry = vaultExpiryStatus(doc.validUntil);
  return (
    <Link
      href={`/client/vault/${doc.id}`}
      className="group flex flex-wrap items-start gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.01] p-5 transition-colors hover:border-violet/30 hover:bg-violet/[0.04]"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
        <FileText className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-violet/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
            {VAULT_CATEGORY_LABEL[doc.category]}
          </span>
          {doc.isVerified ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-accent-green/30 bg-accent-green/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-accent-green">
              <ShieldCheck className="h-2.5 w-2.5" strokeWidth={2} />
              Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-amber-300">
              <ShieldAlert className="h-2.5 w-2.5" strokeWidth={2} />
              Unverified
            </span>
          )}
          {expiry !== 'none' && expiry !== 'ok' && (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${
                expiry === 'expired'
                  ? 'border-red-500/30 bg-red-500/10 text-red-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              }`}
            >
              {expiry === 'expired' ? 'Expired' : 'Expiring soon'}
            </span>
          )}
        </div>
        <p className="mt-2 truncate text-sm font-semibold text-white">{doc.label}</p>
        {doc.jobTitle && (
          <p className="mt-1 truncate text-[11px] text-zinc-500">
            Linked to job · {doc.jobTitle}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
          {doc.validUntil && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" strokeWidth={1.75} />
              Valid through {formatVaultDate(doc.validUntil)}
            </span>
          )}
          <span>Updated {vaultRelativeTime(doc.updatedAt)}</span>
        </div>
      </div>
      <ChevronRight
        className="h-4 w-4 shrink-0 self-center text-zinc-600 transition-transform group-hover:translate-x-0.5"
        strokeWidth={2}
      />
    </Link>
  );
}

function CertificateRow({ cert }: { cert: TrustCertificate }) {
  const isRevoked = !!cert.revokedAt;
  const isExpired = new Date(cert.validUntil).getTime() < Date.now();
  const verifyUrl = `/verify/${cert.publicSlug}`;
  return (
    <article className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-glow/15 text-cyan-glow ring-1 ring-inset ring-cyan-glow/30">
            <Award className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">
              {cert.scopeTemplateName ?? 'Trust certificate'}
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Issued for {cert.supplierName ?? 'a supplier'} · valid through{' '}
              {formatVaultDate(cert.validUntil)}
            </p>
            {isRevoked && (
              <p className="mt-1 inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-red-300">
                <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2} />
                Revoked · {cert.revokedReason ?? 'see audit log'}
              </p>
            )}
            {!isRevoked && isExpired && (
              <p className="mt-1 inline-flex items-center gap-1 rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
                Expired
              </p>
            )}
          </div>
        </div>
        {cert.publicSlug && (
          <a
            href={verifyUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-3.5 py-1.5 text-xs font-semibold text-cyan-glow hover:bg-cyan-glow/15"
          >
            Public verify
            <ExternalLink className="h-3 w-3" strokeWidth={2} />
          </a>
        )}
      </header>
    </article>
  );
}

function EmptyDocumentsState() {
  return (
    <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
      <FileText className="mx-auto h-8 w-8 text-zinc-600" strokeWidth={1.5} />
      <p className="mt-3 text-sm text-zinc-400">
        No compliance documents yet. Upload your insurance certs, business
        licenses, NDAs, and MSAs to keep them at hand.
      </p>
    </div>
  );
}

function EmptyCertificatesState() {
  return (
    <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
      <Award className="mx-auto h-8 w-8 text-zinc-600" strokeWidth={1.5} />
      <p className="mt-3 text-sm text-zinc-400">
        No trust certificates yet. Each completed compliance inspection
        produces a public-verifiable trust certificate that lands here.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'violet' | 'green' | 'amber' | 'red';
}) {
  const cls =
    tone === 'violet' ? 'text-violet-glow'
      : tone === 'green' ? 'text-accent-green'
      : tone === 'amber' ? 'text-accent-amber'
      : tone === 'red' ? 'text-accent-red'
      : 'text-white';
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </p>
      <p className={`mt-1 font-display text-2xl font-semibold ${cls}`}>{value}</p>
    </div>
  );
}
