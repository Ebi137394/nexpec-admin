// ════════════════════════════════════════════════════════════════════════════
//  app/(auth)/forgot-password/page.tsx — self-serve password reset request
//
//  Mirrors /sign-in visually. Posts to the requestPasswordReset server
//  action, which sends the Supabase recovery email pointing back at
//  /reset-password. Sent/error states come back as search params.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import type { Metadata } from 'next';
import { requestPasswordReset } from '@/lib/auth/actions';
import { AuthCard } from '@/components/auth/AuthCard';
import { AuthField } from '@/components/auth/AuthField';
import { SubmitButton } from '@/components/auth/SubmitButton';

export const metadata: Metadata = {
  title: 'Forgot password',
  description: 'Request a password reset link for your NEXPEC account.',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    error?: string;
    sent?: string;
    email?: string;
  }>;
}

export default async function ForgotPasswordPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = params.error;
  const sent = params.sent === '1';
  const prefillEmail = params.email ?? '';

  return (
    <AuthCard
      title="Reset your password"
      subtitle={
        <>
          Remembered it?{' '}
          <Link href="/sign-in" className="text-violet-glow hover:text-white">
            Back to sign in
          </Link>
          .
        </>
      }
    >
      {sent ? (
        <div className="space-y-6">
          <p className="rounded-lg border border-violet/30 bg-violet/10 px-3 py-2 text-xs leading-relaxed text-violet-glow">
            If an account exists for{' '}
            <span className="font-semibold">{prefillEmail || 'that address'}</span>
            , a reset link is on its way. Open it to choose a new password —
            and check your spam folder if it doesn&apos;t arrive.
          </p>
          <p className="text-center text-xs text-zinc-500">
            Wrong address?{' '}
            <Link href="/forgot-password" className="text-zinc-300 hover:text-white">
              Try again
            </Link>
            .
          </p>
        </div>
      ) : (
        <form action={requestPasswordReset} className="space-y-4">
          <AuthField
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@company.com"
            defaultValue={prefillEmail}
          />

          {error && (
            <p className="rounded-lg border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-xs text-accent-red">
              {error}
            </p>
          )}

          <div className="pt-2">
            <SubmitButton>Send reset link</SubmitButton>
          </div>
        </form>
      )}
    </AuthCard>
  );
}
