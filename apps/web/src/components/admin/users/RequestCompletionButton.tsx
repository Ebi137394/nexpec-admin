'use client';

// Rate-safety lives in two places on purpose: this button disables itself for
// the rest of the session once used (so a double-click or an impatient admin
// cannot fan out messages), and the server action is the real authority.

import { useState, useTransition } from 'react';
import { requestProfileCompletion } from '@/lib/actions/adminUserModeration';

export function RequestCompletionButton({
  userId,
  email,
  alreadySent,
}: {
  userId: string;
  email: string | null;
  alreadySent: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <span className="rounded-full border border-accent-green/30 bg-accent-green/10 px-3 py-1 text-[11px] font-semibold text-accent-green">
        Reminder sent
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        const verb = alreadySent ? 'Send another reminder to' : 'Send a completion reminder to';
        if (!window.confirm(`${verb} ${email ?? userId}?`)) return;
        startTransition(async () => {
          await requestProfileCompletion(userId);
          setDone(true);
        });
      }}
      className="rounded-full bg-violet px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
    >
      {pending ? 'Sending…' : alreadySent ? 'Send again' : 'Request completion'}
    </button>
  );
}
