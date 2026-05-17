import Link from 'next/link';
import type { Metadata } from 'next';
import { signIn } from '@/lib/auth/actions';
import { AuthCard } from '@/components/auth/AuthCard';
import { AuthField } from '@/components/auth/AuthField';
import { Divider } from '@/components/auth/Divider';
import { OAuthRow } from '@/components/auth/OAuthRow';
import { SubmitButton } from '@/components/auth/SubmitButton';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your NEXPEC account.',
};

// Opt out of static prerender — middleware handles signed-in redirects
// dynamically; there's nothing static to generate here.
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    error?: string;
    email?: string;
    next?: string;
  }>;
}

export default async function SignInPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = params.error;
  const prefillEmail = params.email ?? '';
  const next = params.next ?? '';

  return (
    <AuthCard
      title="Sign in to NEXPEC"
      subtitle={
        <>
          New here?{' '}
          <Link href="/sign-up" className="text-violet-glow hover:text-white">
            Create an account
          </Link>
          .
        </>
      }
    >
      <OAuthRow />
      <Divider label="or continue with email" />

      <form action={signIn} className="space-y-4">
        {next && <input type="hidden" name="next" value={next} />}

        <AuthField
          label="Email"
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
          autoComplete="current-password"
          required
          placeholder="••••••••••"
        />

        {error && (
          <p className="rounded-lg border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-xs text-accent-red">
            {error}
          </p>
        )}

        <div className="pt-2">
          <SubmitButton>Sign in</SubmitButton>
        </div>
      </form>

      <p className="mt-6 text-center text-xs text-zinc-500">
        By signing in you agree to our{' '}
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
