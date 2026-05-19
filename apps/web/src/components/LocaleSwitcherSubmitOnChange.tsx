// ════════════════════════════════════════════════════════════════════════════
//  components/LocaleSwitcherSubmitOnChange.tsx — micro client helper
//
//  Listens to the nearest <form>'s "change" event and submits it whenever
//  any field (i.e. the locale <select>) changes. Renders nothing visible.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useEffect, useRef } from 'react';

export function SubmitOnChange() {
  const anchorRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const form = anchorRef.current?.closest('form');
    if (!form) return;
    function handle(e: Event) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.tagName === 'SELECT' || target.tagName === 'INPUT') {
        try {
          form?.requestSubmit();
        } catch {
          form?.submit();
        }
      }
    }
    form.addEventListener('change', handle);
    return () => form.removeEventListener('change', handle);
  }, []);

  return <span ref={anchorRef} className="hidden" aria-hidden />;
}
