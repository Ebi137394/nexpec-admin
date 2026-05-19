// ════════════════════════════════════════════════════════════════════════════
//  app/(auth)/sign-up/page.tsx — Onboarding wizard host
//
//  All business logic lives in components/auth/OnboardingWizard.tsx. This
//  page is a thin server-side wrapper that resolves query params (error,
//  email, role, pending state) and hands them to the wizard.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { OnboardingWizard } from '@/components/auth/OnboardingWizard';

export const metadata: Metadata = {
  title: 'Create your NEXPEC account',
  description:
    'Join NEXPEC — vetted industrial inspections with audit-grade reports.',
};

export const dynamic = 'force-dynamic';

const PUBLIC_ROLES = new Set(['client', 'inspector', 'agency', 'enterprise']);

interface PageProps {
  searchParams: Promise<{
    error?: string;
    email?: string;
    role?: string;
    pending?: string;
  }>;
}

export default async function SignUpPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const role =
    params.role && PUBLIC_ROLES.has(params.role)
      ? (params.role as 'client' | 'inspector' | 'agency' | 'enterprise')
      : '';
  const pendingMode =
    params.pending === 'magic'
      ? 'magic'
      : params.pending === '1'
        ? '1'
        : null;

  return (
    <main className="relative isolate min-h-screen bg-ink-950 px-4 py-12 sm:px-6 sm:py-20">
      {/* Atmospheric layers */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-40 topo-grid"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -top-40 right-0 -z-10 h-[400px] w-[600px] rounded-full bg-violet/15 blur-[100px]"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -bottom-40 left-0 -z-10 h-[400px] w-[600px] rounded-full bg-cyan-glow/10 blur-[100px]"
      />

      <OnboardingWizard
        defaultEmail={params.email ?? ''}
        initialError={params.error ?? ''}
        initialRole={role}
        pendingMode={pendingMode}
      />
    </main>
  );
}
