'use client';

// ════════════════════════════════════════════════════════════════════════════
//  RevealButton — admin decrypts a stored TIN on demand (audited server-side).
//  Plaintext is held only in local component state, shown briefly, and cleared.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { revealTaxId } from '@/lib/actions/taxCenter';

export function RevealButton({ userId, hasCipher }: { userId: string; hasCipher: boolean }) {
  const [value, setValue] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!hasCipher) return <span className="text-[11px] text-zinc-600">no TIN on file</span>;

  async function onReveal() {
    if (value) { setValue(null); return; } // toggle hide
    setLoading(true);
    setErr(null);
    const res = await revealTaxId(userId);
    setLoading(false);
    if (res.error) setErr(res.error);
    else setValue(res.taxId ?? '');
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onReveal}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-lg border border-violet-glow/30 bg-violet-glow/10 px-2.5 py-1 text-[11px] font-semibold text-violet-glow transition hover:bg-violet-glow/20 disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : value ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        {value ? 'Hide' : 'Reveal'}
      </button>
      {value && <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-xs text-white">{value}</span>}
      {err && <span className="text-[11px] text-red-400">{err}</span>}
    </span>
  );
}
