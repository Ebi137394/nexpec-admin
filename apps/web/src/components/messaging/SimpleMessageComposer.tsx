// ════════════════════════════════════════════════════════════════════════════
//  components/messaging/SimpleMessageComposer.tsx
//
//  ZERO client-side JS dependencies. Pure server component. Plain HTML form
//  posting to the sendMessage server action. Submission triggers the
//  framework's native redirect handling; the page reloads with the new
//  message visible. No useFormStatus, no useRef, no closure wrapping —
//  nothing that can swallow a NEXT_REDIRECT throw.
//
//  Trade-off vs. MessageComposer: no Enter-to-send (you click the button).
//  In exchange: this WILL work even if every other client-side hook fails.
// ════════════════════════════════════════════════════════════════════════════

import { Send, Paperclip } from 'lucide-react';
import { sendMessage } from '@/lib/actions/messages';
import { VoiceRecorder } from './VoiceRecorder';

interface Props {
  conversationId: string;
  returnTo: string;
  placeholder?: string;
  /** When true, omit the file picker (small surfaces like the dashboard composer). */
  textOnly?: boolean;
}

export function SimpleMessageComposer({
  conversationId,
  returnTo,
  placeholder = 'Write a message…',
  textOnly = false,
}: Props) {
  return (
    <div className="border-t border-white/[0.06] bg-ink-950/80 p-3 sm:p-4">
      <form
        action={sendMessage}
        encType="multipart/form-data"
        className=""
      >
        <input type="hidden" name="conversationId" value={conversationId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <div className="flex items-end gap-2">
          <textarea
            name="content"
            rows={2}
            maxLength={8000}
            placeholder={placeholder}
            className="min-h-[48px] max-h-32 flex-1 resize-y rounded-2xl border border-white/[0.12] bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-violet/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-violet/30"
            autoFocus
          />
          {!textOnly && (
            <label
              htmlFor={`attach-${conversationId}`}
              className="inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:border-violet/40 hover:text-white"
              title="Attach file (image, PDF, doc, audio, video, zip, max 50 MB)"
            >
              <Paperclip className="h-4 w-4" strokeWidth={1.75} />
            </label>
          )}
          <input
            id={`attach-${conversationId}`}
            type="file"
            name="attachment"
            accept="image/jpeg,image/png,image/webp,image/heic,image/gif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/webm,audio/ogg,audio/mp4,text/plain"
            className="sr-only"
          />
          <button
            type="submit"
            aria-label="Send message"
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet text-white shadow-sm transition-colors hover:bg-violet/90"
          >
            <Send className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </form>
      {!textOnly && (
        <div className="mt-2 flex items-center gap-3">
          {/* Voice recorder lives OUTSIDE the text form so MediaRecorder's
              JS doesn't interfere with the plain-form text submission. It
              has its own hidden form. */}
          <VoiceRecorder conversationId={conversationId} returnTo={returnTo} />
          <p className="text-[10px] text-zinc-600">
            Type text and click Send, attach a file with 📎, or tap the mic
            to record a voice message (max 5 min, 50 MB).
          </p>
        </div>
      )}
      {textOnly && (
        <p className="mt-2 text-[10px] text-zinc-600">
          Click Send, the page reloads with your message.
        </p>
      )}
    </div>
  );
}
