import { cn } from '@/lib/cn';

const ROLE_TONES: Record<string, string> = {
  super_admin: 'border-violet/50 bg-violet/15 text-white',
  admin: 'border-violet/40 bg-violet/10 text-violet-glow',
  agency: 'border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow',
  enterprise: 'border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow',
  client: 'border-white/15 bg-white/[0.04] text-zinc-200',
  inspector: 'border-accent-green/40 bg-accent-green/10 text-accent-green',
  contractor: 'border-accent-green/40 bg-accent-green/10 text-accent-green',
};

export function UserRoleBadge({ role }: { role: string | null }) {
  const tone = (role && ROLE_TONES[role]) ?? 'border-white/15 bg-white/[0.03] text-zinc-400';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial',
        tone,
      )}
    >
      {role ?? 'unknown'}
    </span>
  );
}
