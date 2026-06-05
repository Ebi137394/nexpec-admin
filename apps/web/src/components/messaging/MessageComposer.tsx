// ════════════════════════════════════════════════════════════════════════════
//  components/messaging/MessageComposer.tsx — sticky bottom composer
//
//  Server-action driven, with React 19 useFormStatus() for the pending UI.
//
//  PRIOR BUG: this file wrapped sendMessage in `action={async (fd) => {
//  try { await sendMessage(fd) } finally { setPending(false) } }}`. The
//  redirect() that sendMessage throws as a NEXT_REDIRECT sentinel was
//  caught by the wrapping closure's finally block, so Next.js never saw
//  the redirect — the form appeared "broken" with no feedback. Fix: pass
//  the server action straight to <form action={...}> so the framework
//  handles the throw natively.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Send } from 'lucide-react';
import { sendMessage } from '@/lib/actions/messages';

interface Props {
  conversationId: string;
  returnTo: string;
  disabled?: boolean;
  placeholder?: string;
}

export function MessageComposer({
  conversationId,
  returnTo,
  disabled = false,
  placeholder = 'Write a message…',
}: Props) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={sendMessage}
      className="sticky bottom-0 border-t border-white/[0.06] bg-ink-950/80 px-4 py-3 backdrop-blur-xl sm:px-6"
    >
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="flex items-end gap-2">
        <ComposerTextarea
          disabled={disabled}
          placeholder={placeholder}
          onEnterSubmit={() => formRef.current?.requestSubmit()}
        />
        <SubmitButton disabled={disabled} />
      </div>
      <p className="mt-1.5 text-[10px] text-zinc-600">
        Enter to send, Shift+Enter for a new line, max 8000 characters
      </p>
    </form>
  );
}

/**
 * Textarea is split out so it can read useFormStatus() — that hook only
 * works inside a child of the <form> that owns the action.
 */
function ComposerTextarea({
  disabled,
  placeholder,
  onEnterSubmit,
}: {
  disabled: boolean;
  placeholder: string;
  onEnterSubmit: () => void;
}) {
  const { pending } = useFormStatus();
  return (
    <textarea
      name="content"
      required
      rows={1}
      maxLength={8000}
      disabled={disabled || pending}
      placeholder={placeholder}
      onKeyDown={(e) => {
        // Enter submits, Shift+Enter newline.
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (!pending) onEnterSubmit();
        }
      }}
      className="min-h-[44px] max-h-40 flex-1 resize-y rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-violet/40 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/20 disabled:opacity-50"
    />
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-label="Send message"
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-violet text-white shadow-sm transition-colors hover:bg-violet/90 disabled:opacity-50"
    >
      <Send className="h-4 w-4" strokeWidth={1.75} />
    </button>
  );
}
