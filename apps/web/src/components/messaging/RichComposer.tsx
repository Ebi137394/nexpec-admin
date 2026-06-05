// ════════════════════════════════════════════════════════════════════════════
//  components/messaging/RichComposer.tsx — the premium message composer.
//
//  Progressive enhancement over the proven server-action form: the core is
//  still a real <form action={sendMessage}> with a textarea + a submit button,
//  so a message ALWAYS sends even if every fancy hook fails. Layered on top:
//
//    • attach any file (image / PDF / doc / sheet / zip / video / audio)
//    • LIVE preview before send — image thumbnail or a file chip w/ size
//    • drag-and-drop onto the composer
//    • paste an image straight from the clipboard
//    • record + send a voice message (VoiceRecorder, its own hidden form)
//    • Enter to send · Shift+Enter for a newline
//
//  Single attachment per message (the messages table's contract); send another
//  message for another file — natural chat behaviour. 50 MB cap, mirrored
//  server-side in sendMessage.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { Send, Paperclip, X, FileText, Loader2 } from 'lucide-react';
import { sendMessage } from '@/lib/actions/messages';
import { VoiceRecorder } from './VoiceRecorder';

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — mirrors sendMessage
const ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/gif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/webm,audio/ogg,audio/mp4,text/plain';

interface Props {
  conversationId: string;
  returnTo: string;
  placeholder?: string;
}

interface Preview {
  name: string;
  size: number;
  isImage: boolean;
  url: string | null;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RichComposer({
  conversationId,
  returnTo,
  placeholder = 'Write a message…',
}: Props) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const setFile = useCallback((file: File | null) => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (!file) {
      setPreview(null);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    if (file.size > MAX_BYTES) {
      setErr('That file is over 50 MB. Pick a smaller one.');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setErr(null);
    const isImage = file.type.startsWith('image/');
    let url: string | null = null;
    if (isImage) {
      url = URL.createObjectURL(file);
      objectUrlRef.current = url;
    }
    setPreview({ name: file.name, size: file.size, isImage, url });
  }, []);

  // Imperatively assign a dropped/pasted file to the real <input type=file>
  // so it rides the normal multipart form submit.
  const assignToInput = useCallback(
    (file: File) => {
      const input = fileRef.current;
      if (input) {
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
        } catch {
          /* DataTransfer unsupported — preview still shows, submit may skip file */
        }
      }
      setFile(file);
    },
    [setFile],
  );

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) assignToInput(file);
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of Array.from(items)) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) {
          assignToInput(f);
          break;
        }
      }
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (text.trim().length > 0 || preview) {
        setSubmitting(true);
        formRef.current?.requestSubmit();
      }
    }
  };

  const canSend = text.trim().length > 0 || !!preview;

  return (
    <div
      className={`relative border-t border-white/[0.06] bg-ink-950/80 p-3 transition-colors sm:p-4 ${
        dragOver ? 'bg-violet/[0.06]' : ''
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragOver(false);
      }}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-violet/50 bg-ink-950/70 text-sm font-semibold text-violet-glow">
          Drop to attach
        </div>
      )}

      {/* Attachment preview chip */}
      {preview && (
        <div className="mb-2 flex items-center gap-3 rounded-2xl border border-violet/25 bg-violet/[0.06] p-2 pr-3">
          {preview.isImage && preview.url ? (
            // Plain <img> is intentional (blob object URL preview).
            <img
              src={preview.url}
              alt={preview.name}
              className="h-14 w-14 shrink-0 rounded-xl object-cover"
            />
          ) : (
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-violet/15 text-violet-glow">
              <FileText className="h-6 w-6" strokeWidth={1.6} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{preview.name}</p>
            <p className="text-[11px] text-zinc-500">
              {fmtSize(preview.size)} · ready to send
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFile(null)}
            aria-label="Remove attachment"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:border-accent-red/40 hover:text-accent-red"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      )}

      {err && <p className="mb-2 text-[11px] text-accent-red">{err}</p>}

      <form
        ref={formRef}
        action={sendMessage}
        encType="multipart/form-data"
        onSubmit={() => setSubmitting(true)}
      >
        <input type="hidden" name="conversationId" value={conversationId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <div className="flex items-end gap-2">
          <textarea
            name="content"
            rows={2}
            maxLength={8000}
            placeholder={placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            className="min-h-[48px] max-h-32 flex-1 resize-y rounded-2xl border border-white/[0.12] bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-violet/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-violet/30"
          />
          <label
            htmlFor={`attach-${conversationId}`}
            className="inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:border-violet/40 hover:text-white"
            title="Attach a file — image, PDF, doc, sheet, zip, video or audio (max 50 MB)"
          >
            <Paperclip className="h-4 w-4" strokeWidth={1.75} />
          </label>
          <input
            id={`attach-${conversationId}`}
            ref={fileRef}
            type="file"
            name="attachment"
            accept={ACCEPT}
            onChange={onPick}
            className="sr-only"
          />
          <button
            type="submit"
            aria-label="Send message"
            disabled={!canSend || submitting}
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet text-white shadow-sm transition-colors hover:bg-violet/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            ) : (
              <Send className="h-4 w-4" strokeWidth={1.75} />
            )}
          </button>
        </div>
      </form>

      <div className="mt-2 flex items-center gap-3">
        {/* Voice recorder owns its own hidden form so MediaRecorder JS never
            interferes with the text form's submit. */}
        <VoiceRecorder conversationId={conversationId} returnTo={returnTo} />
        <p className="hidden text-[10px] text-zinc-600 sm:block">
          Enter to send · Shift+Enter for a new line · 📎 to attach · drag, drop
          or paste an image · tap the mic for voice.
        </p>
      </div>
    </div>
  );
}
