// ════════════════════════════════════════════════════════════════════════════
//  app/admin/settings/page.tsx — Platform Settings (Sprint 4 close)
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { fetchFeeSchedule, readIntegrationSecrets } from '@/lib/data/settings';
import { fetchMfaStatus } from '@/lib/data/mfa';
import { FeeScheduleEditor } from '@/components/admin/settings/FeeScheduleEditor';
import { IntegrationSecrets } from '@/components/admin/settings/IntegrationSecrets';
import { MfaSection } from '@/components/account/MfaSection';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [fees, secrets, mfaStatus] = await Promise.all([
    fetchFeeSchedule(),
    Promise.resolve(readIntegrationSecrets()),
    fetchMfaStatus(),
  ]);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Command Console, Live
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Settings
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          Platform-wide configuration. Fee changes fire{' '}
          <span className="font-mono text-violet-glow">admin_set_fee_schedule</span>{' '}
          (audit-critical). Integration credentials are read-only here,
          rotation happens in your host&apos;s env panel.
        </p>
      </header>

      <FeeScheduleEditor initial={fees} />
      <IntegrationSecrets secrets={secrets} />

      {/* Sprint 13.3, Two-factor authentication. Self-suppresses if the
          current session is unauthenticated. Strictly additive at the
          tail of the existing layout. */}
      <MfaSection initial={mfaStatus} />
    </div>
  );
}
