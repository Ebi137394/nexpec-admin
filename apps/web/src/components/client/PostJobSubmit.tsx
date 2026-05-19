// ════════════════════════════════════════════════════════════════════════════
//  components/client/PostJobSubmit.tsx — disabled-on-click submit
//
//  React 19 useFormStatus disables the button while the server action is
//  pending. Combined with the DB unique partial index on jobs.client_op_id,
//  triple-submissions can't happen even on flaky networks.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';

export function PostJobSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-primary inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          Posting…
        </>
      ) : (
        <>
          Post for moderation
          <span aria-hidden>→</span>
        </>
      )}
    </button>
  );
}
