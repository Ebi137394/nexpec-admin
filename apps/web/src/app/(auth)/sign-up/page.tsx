import Link from 'next/link';
import type { Metadata } from 'next';
import { signUp } from '@/lib/auth/actions';
import { AuthCard } from '@/components/auth/AuthCard';
import { AuthField } from '@/components/auth/AuthField';
import { Divider } from '@/components/auth/Divider';
import { OAuthRow } from '@/components/auth/OAuthRow';
import { SubmitButton } from '@/components/auth/SubmitButton';

export const metadata: Metadata = {
  title: 'Create an account',
  description: 'Join NEXPEC — vetted industrial inspections with audit-grade reports.',
};

// Opt out of static prerender — middleware handles signed-in redirects
// dynamically; there's nothing static to generate here.
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    error?: string;
    email?: string;
    pending?: string;
  }>;
}

export default async function SignUpPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = params.error;
  const prefillEmail = params.email ?? '';
  const pending = params.pending === '1';

  if (pending) {
    return (
      <AuthCard
        title="Check your inbox"
        subtitle={
          <>
            We sent a confirmation link to{' '}
            <span className="text-white">{prefillEmail || 'your email'}</span>. Click
            it to activate your account.
          </>
        }
      >
        <div className="rounded-xl border border-violet/30 bg-violet/10 p-4 text-sm leading-relaxed text-zinc-300">
          Didn&apos;t get the email? Check your spam folder, or try a different
          address — the link expires in 1 hour.
        </div>
        <div className="mt-6 text-center">
          <Link
            href="/sign-in"
            className="text-sm text-violet-glow hover:text-white"
          >
            Back to sign in
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle={
        <>
          Already have one?{' '}
          <Link href="/sign-in" className="text-violet-glow hover:text-white">
            Sign in
          </Link>
          .
        </>
      }
    >
      <OAuthRow />
      <Divider label="or sign up with email" />

      <form action={signUp} className="space-y-4">
        <AuthField
          label="Full name"
          name="fullName"
          type="text"
          autoComplete="name"
          required
          placeholder="Alex Doe"
        />
        <AuthField
          label="Work email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@company.com"
          defaultValue={prefillEmail}
        />
        <AuthField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          placeholder="At least 10 characters"
          hint="Use 10+ characters. A passphrase beats a complex short password."
        />

        {error && (
          <p className="rounded-lg border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-xs text-accent-red">
            {error}
          </p>
        )}

        <div className="pt-2">
          <SubmitButton>Create account</SubmitButton>
        </div>
      </form>

      <p className="mt-6 text-center text-xs text-zinc-500">
        By creating an account you agree to our{' '}
        <Link href="/legal/terms" className="text-zinc-300 hover:text-white">
          Terms
        </Link>{' '}
        and{' '}
        <Link href="/legal/privacy" className="text-zinc-300 hover:text-white">
          Privacy
        </Link>
        .
      </p>
    </AuthCard>
  );
}
