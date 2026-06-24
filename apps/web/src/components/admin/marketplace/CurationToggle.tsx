// ════════════════════════════════════════════════════════════════════════════
//  components/admin/marketplace/CurationToggle.tsx — feature/unfeature (client)
//
//  Flips public_listing_featured via the admin RPC, then refreshes the RSC.
//  Featuring requires eligibility (verified inspector / agency with >=2 members);
//  unfeaturing is always allowed.
// ════════════════════════════════════════════════════════════════════════════
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Star, StarOff } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { cn } from '@/lib/cn';

export function CurationToggle({
  targetId,
  kind,
  featured,
  eligible,
}: {
  targetId: string;
  kind: 'inspector' | 'agency';
  featured: boolean;
  eligible: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const disabled = busy || (!featured && !eligible);

  async function toggle() {
    setBusy(true);
    const { error } = await createSupabaseBrowserClient().rpc('admin_set_listing_featured', {
      p_target_id: targetId,
      p_kind: kind,
      p_featured: !featured,
    });
    setBusy(false);
    if (!error) startTransition(() => router.refresh());
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      title={!featured && !eligible ? 'Not eligible yet' : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
        featured
          ? 'border-accent-green/40 bg-accent-green/10 text-accent-green hover:bg-accent-green/20'
          : eligible
            ? 'border-violet/40 bg-violet/10 text-violet-glow hover:bg-violet/20'
            : 'cursor-not-allowed border-white/10 bg-white/[0.02] text-zinc-600',
      )}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : featured ? (
        <StarOff className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Star className="h-3.5 w-3.5" aria-hidden />
      )}
      {busy ? 'Saving' : featured ? 'Unfeature' : 'Feature'}
    </button>
  );
}
