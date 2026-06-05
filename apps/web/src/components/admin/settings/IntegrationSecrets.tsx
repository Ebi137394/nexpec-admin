import { ShieldAlert, CheckCircle2, Lock } from 'lucide-react';
import type { IntegrationSecret } from '@/lib/data/settings.types';
import { cn } from '@/lib/cn';

const CATEGORY_TONE: Record<IntegrationSecret['category'], string> = {
  supabase: 'border-accent-green/30 bg-accent-green/[0.04]',
  stripe: 'border-violet/30 bg-violet/[0.04]',
  mail: 'border-cyan-glow/30 bg-cyan-glow/[0.04]',
  expo: 'border-white/10 bg-white/[0.02]',
  platform: 'border-white/10 bg-white/[0.02]',
};

const CATEGORY_LABEL: Record<IntegrationSecret['category'], string> = {
  supabase: 'Supabase',
  stripe: 'Stripe',
  mail: 'Email',
  expo: 'Mobile',
  platform: 'Platform',
};

export function IntegrationSecrets({ secrets }: { secrets: IntegrationSecret[] }) {
  // Group by category for readability.
  const grouped = secrets.reduce<Record<string, IntegrationSecret[]>>((acc, s) => {
    (acc[s.category] = acc[s.category] || []).push(s);
    return acc;
  }, {});

  const order: IntegrationSecret['category'][] = [
    'supabase',
    'stripe',
    'mail',
    'platform',
    'expo',
  ];

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/60 to-ink-900/30 p-6 sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            Integration secrets
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            Masked previews of the env vars this deployment is reading.
            Full values stay on the server, only the first 8 and last 4
            characters ever reach the browser. Rotation happens in your
            host&apos;s env panel (Vercel project, Supabase dashboard,
            etc.), there&apos;s no in-app rotation by design.
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-violet/30 bg-violet/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
          <Lock className="h-3 w-3" />
          server-only
        </span>
      </div>

      <div className="mt-6 space-y-5">
        {order.map((cat) => {
          const items = grouped[cat];
          if (!items || items.length === 0) return null;
          return (
            <div key={cat}>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                {CATEGORY_LABEL[cat]}
              </p>
              <ul className="space-y-2">
                {items.map((s) => (
                  <li
                    key={s.key}
                    className={cn(
                      'flex items-start gap-4 rounded-xl border px-4 py-3',
                      CATEGORY_TONE[s.category],
                    )}
                  >
                    <SecretStatusIcon present={s.present} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 font-mono text-xs">
                        <span className="text-white">{s.key}</span>
                        <span className="text-zinc-500">·</span>
                        <span className="text-zinc-400">{s.label}</span>
                      </p>
                      <p className="mt-1 font-mono text-xs text-zinc-500">
                        {s.masked ?? <span className="text-accent-red">not set</span>}
                      </p>
                      {s.hint && (
                        <p className="mt-1.5 text-[11px] text-zinc-500">{s.hint}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="mt-6 rounded-lg border border-accent-amber/30 bg-accent-amber/[0.06] px-3 py-2.5 text-[11px] leading-relaxed text-accent-amber">
        <strong>Service-role key</strong> bypasses RLS entirely. If it ever
        leaks publicly, rotate it in Supabase → Settings → API immediately
        and update the env var in Vercel.
      </p>
    </section>
  );
}

function SecretStatusIcon({ present }: { present: boolean }) {
  if (present) {
    return (
      <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent-green/15 text-accent-green ring-1 ring-inset ring-accent-green/40">
        <CheckCircle2 className="h-3 w-3" />
      </span>
    );
  }
  return (
    <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent-red/15 text-accent-red ring-1 ring-inset ring-accent-red/40">
      <ShieldAlert className="h-3 w-3" />
    </span>
  );
}
