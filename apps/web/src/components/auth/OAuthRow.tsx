import { signInWithOAuth } from '@/lib/auth/actions';

/**
 * Two OAuth buttons: Google + Apple. Both submit to the same server action
 * with a hidden `provider` field. Disabled visual state is intentional —
 * if the OAuth provider isn't configured in the Supabase project, the
 * action redirects back with an error and the button regains pointer use.
 */
export function OAuthRow() {
  return (
    <div className="space-y-3">
      <form action={signInWithOAuth}>
        <input type="hidden" name="provider" value="google" />
        <button
          type="submit"
          className="group flex w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-medium text-zinc-200 transition-all hover:border-white/30 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-glow/50"
        >
          <GoogleGlyph className="h-5 w-5" />
          Continue with Google
        </button>
      </form>
      <form action={signInWithOAuth}>
        <input type="hidden" name="provider" value="apple" />
        <button
          type="submit"
          className="group flex w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-medium text-zinc-200 transition-all hover:border-white/30 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-glow/50"
        >
          <AppleGlyph className="h-5 w-5" />
          Continue with Apple
        </button>
      </form>
      <form action={signInWithOAuth}>
        <input type="hidden" name="provider" value="linkedin_oidc" />
        <button
          type="submit"
          className="group flex w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-medium text-zinc-200 transition-all hover:border-white/30 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-glow/50"
        >
          <LinkedInGlyph className="h-5 w-5" />
          Continue with LinkedIn
        </button>
      </form>
    </div>
  );
}

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.7 4.7-6.2 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.4 4 9.8 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.3 26.7 36 24 36c-5.1 0-9.6-3.3-11.3-7.9l-6.5 5C9.8 39.7 16.4 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.7l6.2 5.2C40.9 35 44 30 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function AppleGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M16.365 1.43c0 1.14-.413 2.234-1.21 3.05-.798.82-2.1 1.46-3.32 1.36-.144-1.15.412-2.32 1.18-3.13.86-.92 2.33-1.6 3.35-1.28zM20.43 17.07c-.572 1.32-.853 1.91-1.6 3.08-1.04 1.62-2.51 3.64-4.33 3.66-1.62.02-2.04-1.06-4.24-1.05-2.2.02-2.66 1.07-4.28 1.05-1.82-.02-3.21-1.83-4.25-3.45C-.97 16.95-.42 11.4 1.95 8.86c1.69-1.82 4.36-2.88 6.87-2.83 1.59.05 3.09 1.07 4.13 1.07 1.04 0 2.86-1.32 4.83-1.13.83.04 3.16.34 4.66 2.55-.12.08-2.79 1.62-2.75 4.83.04 3.84 3.4 5.12 3.44 5.14-.02.08-.53 1.85-1.7 4.58z" />
    </svg>
  );
}

function LinkedInGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="#0A66C2" aria-hidden>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}
