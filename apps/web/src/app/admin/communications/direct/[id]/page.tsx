// ════════════════════════════════════════════════════════════════════════════
//  app/admin/communications/direct/[id]/page.tsx
//  Admin MEDIATION view of one Full-mode Buyer↔Inspector room (D23).
//
//  Was read-only oversight; the owner rule requires Admin to be an actual
//  participant/mediator, so this page now also carries:
//    • a composer — posts via sendMessage as the admin themselves
//      (msg_insert_party's nx_is_admin() branch has always allowed it), and
//      the message is labelled ADMIN in the transcript (sender_party is
//      three-valued as of 20260801540000);
//    • close/reopen — moderateDirectRoom flips conversations.status; a closed
//      room locks BOTH parties out (their insert branch requires status='open')
//      while the admin can still write; each flip writes an audit_events row.
//  Still no mark-read RPC — reading leaves no participant state. Attachments
//  open through the ordinary signed-URL path: nx_can_access_doc grants
//  admin/super_admin before any relationship branch runs.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Eye } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { sendMessage, moderateDirectRoom } from '@/lib/actions/messages';

export const metadata: Metadata = { title: 'Direct transcript' };
export const dynamic = 'force-dynamic';

interface Msg {
  id: string;
  sender_id: string;
  sender_name: string | null;
  sender_role: string | null;
  sender_party: 'buyer' | 'inspector' | 'admin';
  content: string | null;
  attachment_url: string | null;
  attachment_type: string | null;
  attachment_name: string | null;
  created_at: string;
  deleted_at: string | null;
}

const TINT: Record<Msg['sender_party'], string> = {
  buyer: 'text-blue-300 border-blue-400/40',
  inspector: 'text-teal-300 border-teal-400/40',
  admin: 'text-amber-300 border-amber-400/40',
};

export default async function AdminOperationalTranscriptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(`/admin/communications/direct/${id}`));

  const [{ data: head }, { data: rows }, { data: convRow }] = await Promise.all([
    supabase
      .from('admin_direct_conversations_view')
      .select('job_id, job_title, job_status, identity_mode, buyer_name, buyer_kind, buyer_role, inspector_name')
      .eq('conversation_id', id)
      .maybeSingle(),
    supabase
      .from('admin_direct_messages_view')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true }),
    supabase.from('conversations').select('status').eq('id', id).maybeSingle(),
  ]);

  if (!head) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-16 text-center">
        <p className="text-sm text-slate-400">
          Conversation not found, or you are not an administrator.
        </p>
      </main>
    );
  }

  const messages = (rows as Msg[] | null) ?? [];

  // Signed URLs are minted server-side, one per attachment, at render time.
  const signed = new Map<string, string>();
  for (const m of messages) {
    if (!m.attachment_url || signed.has(m.attachment_url)) continue;
    const { data } = await supabase.storage
      .from('chat_attachments')
      .createSignedUrl(m.attachment_url, 3600);
    if (data?.signedUrl) signed.set(m.attachment_url, data.signedUrl);
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="mb-3 flex items-start gap-3">
        <Link href="/admin/communications/direct" aria-label="Back" className="mt-1 rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/5">
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-white">
            {head.job_title ?? 'Direct room'}
          </h1>
          <p className="truncate text-xs text-slate-400">
            Buyer ↔ Inspector · {head.buyer_name ?? 'Buyer'} ↔ {head.inspector_name ?? 'Inspector'}
            {head.job_status ? ` · ${String(head.job_status).replace('_', ' ')}` : ''}
          </p>
        </div>
      </header>

      {(() => {
        const roomStatus = (convRow as { status?: string } | null)?.status ?? 'open';
        const returnTo = `/admin/communications/direct/${id}`;
        return (
          <div className="mb-4 flex flex-col gap-2">
            <p className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <Eye className="h-4 w-4 shrink-0" aria-hidden />
              Admin mediation. Reading leaves no participant state; anything you
              send is labelled ADMIN for both parties and in this transcript.
            </p>
            <form action={moderateDirectRoom} className="flex items-center gap-2">
              <input type="hidden" name="conversationId" value={id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <input
                type="hidden"
                name="nextStatus"
                value={roomStatus === 'open' ? 'closed' : 'open'}
              />
              <span className="text-[11px] uppercase tracking-wide text-slate-500">
                Room is {roomStatus}
              </span>
              <button
                type="submit"
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5"
              >
                {roomStatus === 'open' ? 'Close room (freeze parties)' : 'Reopen room'}
              </button>
            </form>
          </div>
        );
      })()}

      {messages.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500">This room has no messages yet.</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {messages.map((m) => {
            const url = m.attachment_url ? signed.get(m.attachment_url) : undefined;
            const type = m.attachment_type ?? '';
            return (
              <li key={m.id} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`font-semibold ${TINT[m.sender_party].split(' ')[0]}`}>
                    {m.sender_name ?? m.sender_party}
                  </span>
                  <span className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-slate-400">
                    {m.sender_party}
                  </span>
                  <span className="ml-auto text-[10px] text-slate-500">
                    {new Date(m.created_at).toLocaleString()}
                  </span>
                </div>
                <div className={`border-l-2 pl-3 ${TINT[m.sender_party].split(' ')[1]}`}>
                  {m.deleted_at && (
                    <p className="text-xs italic text-red-300">Deleted by sender — retained for audit</p>
                  )}
                  {url && type.includes('image') && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={url} alt={m.attachment_name ?? 'attachment'} className="mb-2 max-h-56 rounded-lg" />
                  )}
                  {url && type.startsWith('audio') && (
                    <audio controls src={url} className="mb-2 w-full max-w-sm">
                      <track kind="captions" />
                    </audio>
                  )}
                  {url && !type.includes('image') && !type.startsWith('audio') && (
                    <a href={url} target="_blank" rel="noreferrer" className="mb-2 block text-sm font-semibold text-violet-300 underline">
                      {m.attachment_name ?? 'Attachment'}
                    </a>
                  )}
                  {m.content && <p className="text-sm leading-relaxed text-slate-100">{m.content}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Admin composer — the mediation half of D23. Posts as the admin via the
          ordinary sendMessage action; RLS (msg_insert_party, nx_is_admin
          branch) is the authority, and it works even while the room is closed
          so a mediator can always explain a freeze. */}
      <form action={sendMessage} className="mt-6 flex items-end gap-2">
        <input type="hidden" name="conversationId" value={id} />
        <input type="hidden" name="returnTo" value={`/admin/communications/direct/${id}`} />
        <textarea
          name="content"
          rows={2}
          required
          placeholder="Write as NEXPEC admin — visible to both parties"
          className="min-h-[3rem] flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-amber-400/40"
        />
        <button
          type="submit"
          className="rounded-xl bg-amber-400/90 px-4 py-2.5 text-sm font-semibold text-black hover:bg-amber-400"
        >
          Send as admin
        </button>
      </form>
    </main>
  );
}
