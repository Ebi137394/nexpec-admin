import { signOut } from '@/lib/auth/actions';
import { LogOut } from 'lucide-react';

/**
 * Server-action sign-out trigger. Pressing the button hits the action,
 * which clears Supabase cookies and redirects to /sign-in.
 */
export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-accent-red/40 hover:bg-accent-red/10 hover:text-accent-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-red/40"
      >
        <LogOut className="h-3.5 w-3.5" strokeWidth={2} />
        Sign out
      </button>
    </form>
  );
}
