// ════════════════════════════════════════════════════════════════════════════
//  app/client/vault/[id]/page.tsx — Vault document detail
//
//  Shows the full metadata + signed download link + owner/admin action panel.
//  Same component is reused at /admin/vault/[id] via a thin re-export.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Download,
  FileText,
  Hash,
  ShieldAlert,
  ShieldCheck,
  Briefcase,
} from 'lucide-react';
import {
  fetchVaultDocumentById,
  formatVaultDate,
  getVaultSignedUrl,
  vaultExpiryStatus,
  vaultRelativeTime,
} from '@/lib/data/vault';
import { VAULT_CATEGORY_LABEL } from '@/lib/data/vault.types';
import { VaultDocumentActions } from '@/components/vault/VaultDocumentActions';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const doc = await fetchVaultDocumentById(id);
  return { title: doc ? `${doc.label}, Vault` : 'Document, Vault' };
}

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function VaultDocumentPage({ params }: PageProps) {
  const { id } = await params;
  const doc = await fetchVaultDocumentById(id);
  if (!doc) notFound();

  // Auth context for action panel
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isOwner = !!user && user.id === doc.ownerId;
  let isAdmin = false;
  if (user) {
    const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    const role = (prof as { role?: string | null } | null)?.role ?? '';
    isAdmin = role === 'admin' || role === 'super_admin';
  }

  const signedUrl = doc.filePath ? await getVaultSignedUrl(doc.filePath) : null;
  const expiry = vaultExpiryStatus(doc.validUntil);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <Link
          href="/client/vault"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Vault
        </Link>

        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
            Client Portal, Compliance
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {doc.label}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-violet/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-industrial text-violet-glow">
              {VAULT_CATEGORY_LABEL[doc.category]}
            </span>
            {doc.isVerified ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-accent-green/30 bg-accent-green/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-industrial text-accent-green">
                <ShieldCheck className="h-3 w-3" strokeWidth={2} />
                Verified
                {doc.verifiedAt ? `, ${vaultRelativeTime(doc.verifiedAt)}` : ''}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-industrial text-amber-300">
                <ShieldAlert className="h-3 w-3" strokeWidth={2} />
                Unverified
              </span>
            )}
            {expiry !== 'none' && expiry !== 'ok' && (
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-industrial ${
                  expiry === 'expired'
                    ? 'border-red-500/30 bg-red-500/10 text-red-300'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                }`}
              >
                {expiry === 'expired' ? 'Expired' : 'Expiring soon'}
              </span>
            )}
            {doc.isArchived && (
              <span className="rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-industrial text-zinc-400">
                Archived
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Metadata grid */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Meta icon={<Hash className="h-3.5 w-3.5" />} label="Category" value={VAULT_CATEGORY_LABEL[doc.category]} />
        <Meta icon={<Calendar className="h-3.5 w-3.5" />} label="Valid from" value={formatVaultDate(doc.validFrom)} />
        <Meta icon={<Calendar className="h-3.5 w-3.5" />} label="Valid until" value={formatVaultDate(doc.validUntil)} />
        <Meta icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Uploaded" value={vaultRelativeTime(doc.createdAt)} />
      </section>

      {/* Download */}
      {signedUrl ? (
        <a
          href={signedUrl}
          target="_blank"
          rel="noreferrer"
          className="group flex items-center gap-4 rounded-2xl border border-cyan-glow/30 bg-cyan-glow/[0.06] p-5 transition-colors hover:border-cyan-glow/60 hover:bg-cyan-glow/[0.1]"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-glow/15 text-cyan-glow ring-1 ring-inset ring-cyan-glow/30">
            <FileText className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-cyan-glow/80">
              File
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-white">{doc.label}</p>
            <p className="font-mono text-[10px] text-zinc-500">Signed URL, expires in 5 minutes</p>
          </div>
          <Download className="h-5 w-5 shrink-0 text-cyan-glow" strokeWidth={2} />
        </a>
      ) : doc.externalUrl ? (
        <a
          href={doc.externalUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-xl border border-cyan-glow/30 bg-cyan-glow/10 px-4 py-3 text-sm font-semibold text-cyan-glow hover:bg-cyan-glow/15"
        >
          Open external link
        </a>
      ) : (
        <p className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-4 text-sm text-zinc-500">
          No file attached.
        </p>
      )}

      {/* Notes */}
      {doc.notes && (
        <section className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-5">
          <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            Notes
          </p>
          <p className="mt-2 whitespace-pre-line text-sm text-zinc-300">{doc.notes}</p>
        </section>
      )}

      {/* Linked job */}
      {doc.jobId && (
        <Link
          href={`/client/jobs/${doc.jobId}`}
          className="group flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.01] p-4 transition-colors hover:border-violet/30 hover:bg-violet/[0.04]"
        >
          <Briefcase className="h-4 w-4 text-violet-glow" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
              Linked job
            </p>
            <p className="mt-0.5 truncate text-sm text-white">{doc.jobTitle ?? doc.jobId.slice(0, 8) + '…'}</p>
          </div>
          <span className="font-mono text-[10px] text-zinc-500 group-hover:text-violet-glow">OPEN →</span>
        </Link>
      )}

      {/* Actions */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-5 sm:p-6">
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">Actions</h2>
        <p className="mt-1 text-xs text-zinc-500">
          {isAdmin
            ? 'You can verify or revoke verification on any document. Owners can archive.'
            : isOwner
              ? 'You can archive this document. Admin handles verification.'
              : 'Read-only view.'}
        </p>
        <div className="mt-5">
          <VaultDocumentActions
            documentId={doc.id}
            isVerified={doc.isVerified}
            isArchived={doc.isArchived}
            isAdmin={isAdmin}
            isOwner={isOwner}
          />
        </div>
      </section>

      <p className="text-[10px] font-mono uppercase tracking-industrial text-zinc-600">
        Source, public.client_documents, storage: client_documents bucket
      </p>
    </div>
  );
}

function Meta({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        <span className="text-zinc-400">{icon}</span>
        {label}
      </p>
      <p className="mt-1.5 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}
