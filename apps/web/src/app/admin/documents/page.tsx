// ════════════════════════════════════════════════════════════════════════════
//  app/admin/documents/page.tsx — Admin Document Dashboard
//
//  Full read access to every client_documents row in the platform. Uses the
//  same fetcher as the client side (fetchAdminAllClientDocuments). Renders
//  External vs Upload chips and the appropriate Open-link affordance for
//  each.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { FileText, ExternalLink, Link2, FolderOpen } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchAdminAllClientDocuments } from '@/lib/data/clientDocuments';
import { CLIENT_DOC_KIND_LABELS } from '@/lib/data/clientDocuments.types';

export const metadata: Metadata = { title: 'Admin · Documents' };
export const dynamic = 'force-dynamic';

export default async function AdminDocumentsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent('/admin/documents'));

  // Defence in depth: middleware should already enforce admin role on /admin/*.
  // Double-check via nx_is_admin to fail closed on any future routing slip.
  const { data: isAdminData } = await supabase.rpc('nx_is_admin');
  if (!isAdminData) redirect('/');

  const documents = await fetchAdminAllClientDocuments(500);

  // Group by owner for the admin overview
  const byOwner = new Map<string, typeof documents>();
  for (const d of documents) {
    const arr = byOwner.get(d.ownerId) ?? [];
    arr.push(d);
    byOwner.set(d.ownerId, arr);
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Admin · Documents
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Client document oversight
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Every document uploaded by a client / agency / enterprise. Includes
          uploaded files (signed URL view) and external links (Drive,
          Dropbox, OneDrive, etc.). Total: {documents.length}.
        </p>
      </header>

      {documents.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
          <FileText className="mx-auto h-8 w-8 text-zinc-600" strokeWidth={1.5} />
          <p className="mt-3 text-sm text-zinc-400">
            No client documents on the platform yet.
          </p>
        </div>
      ) : (
        <ul className="space-y-6">
          {Array.from(byOwner.entries()).map(([ownerId, docs]) => (
            <li key={ownerId}>
              <div className="mb-2 flex items-center gap-2">
                <FolderOpen
                  className="h-4 w-4 text-zinc-500"
                  strokeWidth={1.75}
                />
                <p className="font-mono text-[11px] uppercase tracking-industrial text-zinc-500">
                  Owner · {ownerId.slice(0, 8)}…
                </p>
                <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
                  {docs.length} doc{docs.length === 1 ? '' : 's'}
                </span>
              </div>

              <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.01]">
                {docs.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-white">
                          {doc.label}
                        </span>
                        <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
                          {CLIENT_DOC_KIND_LABELS[doc.kind]}
                        </span>
                        {doc.jobId ? (
                          <span className="rounded-full border border-violet/30 bg-violet/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
                            Job · {(doc.jobTitle ?? doc.jobId.slice(0, 8)).slice(0, 40)}
                          </span>
                        ) : (
                          <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                            Org-wide
                          </span>
                        )}
                        {doc.source === 'external_url' && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-cyan-glow">
                            <Link2 className="h-2.5 w-2.5" strokeWidth={1.75} />
                            External
                          </span>
                        )}
                      </div>
                      {doc.notes && (
                        <p className="mt-1 text-xs text-zinc-500">{doc.notes}</p>
                      )}
                      <p className="mt-1 text-[10px] text-zinc-600">
                        Uploaded {new Date(doc.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="shrink-0">
                      {doc.source === 'external_url' && doc.externalUrl ? (
                        <a
                          href={doc.externalUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1.5 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-3 py-1.5 text-xs font-semibold text-cyan-glow transition-colors hover:bg-cyan-glow/20"
                        >
                          <Link2 className="h-3 w-3" strokeWidth={1.75} />
                          Open link
                          <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                        </a>
                      ) : doc.fileUrl ? (
                        <a
                          href={doc.fileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:border-violet/40 hover:bg-white/[0.04] hover:text-white"
                        >
                          View
                          <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                        </a>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
