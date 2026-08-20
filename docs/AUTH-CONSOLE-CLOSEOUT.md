# Auth console closeout — what is verified, what needs the owner

## Verified from here

| Item | Value | How |
|---|---|---|
| Production project ref | `sxqpjxhslzzcdrdctatm` | Supabase API |
| Staging project ref | `zmzvmgaeovleuvbvwxei` | Supabase API |
| Production OAuth Client ID prefix | `352531469933` | owner-supplied, unchanged |
| Google Cloud **project number** | `352531469933` | the client-ID prefix *is* the project number — that is how Google forms client IDs, so the project is determined, not guessed |
| Mobile URL scheme | `nexpec` | `app.config.js:46` |
| Mobile reset redirect requested | `nexpec://reset-password` | `Linking.createURL('reset-password')` in `app/(auth)/sign-in.tsx`; hardcoded in `src/screens/ForgotPasswordScreen.tsx` |
| Required Production callback | `https://sxqpjxhslzzcdrdctatm.supabase.co/auth/v1/callback` | fixed by the ref |
| Web reset redirect | `${NEXT_PUBLIC_SITE_URL}/auth/callback?next=/reset-password` | `lib/auth/actions.ts` — derived from env, **not** from request headers, so no Host-header injection |
| Password flows | **12/12** | `npm run qa:password-flows`, real GoTrue + real mail delivery |
| Local redirect allowlist | now includes `nexpec://reset-password` | `supabase/config.toml` |

## Why the rest is owner-only

`gcloud` is not installed, and `console.cloud.google.com` returns 302 to an
authenticated login. The Supabase CLI exposes `config push` but **no config
read** — there is no supported way from here to read a hosted project's Site URL,
redirect allowlist, CAPTCHA setting or rate limits. I did not guess at them.

## Exact click path

**1 — resolve the project ID (one click):**
`https://console.cloud.google.com/welcome?project=352531469933`
This prints the Project ID/name and settles whether it is `nexpec` or
`verdantverse-5ea0e`.

**2 — in that project:**

| Where | What |
|---|---|
| `console.cloud.google.com/auth/branding` | App name **NEXPEC**, NEXPEC logo, support email **info@nexpecapp.com**, homepage **https://www.nexpecapp.com/**, Privacy + Terms URLs, authorized domain **nexpecapp.com** |
| same page | Audience **External** → **Publish app** |
| `console.cloud.google.com/auth/scopes` | keep only **openid, email, profile** |
| `console.cloud.google.com/apis/credentials` → client `352531469933-2m1iq…` | Authorized redirect URIs must include `https://sxqpjxhslzzcdrdctatm.supabase.co/auth/v1/callback` |

Uploading a logo triggers Google Brand Verification, which can take days.
**Do not rotate the Client Secret** — nothing here requires it, and it has never
been read or printed.

**3 — Supabase Auth (both projects):**

| Setting | Production | Staging |
|---|---|---|
| Site URL | `https://www.nexpecapp.com` | staging web URL |
| Redirect allowlist | `https://www.nexpecapp.com/auth/callback`, **`nexpec://reset-password`**, `nexpec://oauth-callback` | same shape |
| Google provider | **enabled** (leave as is) | **disabled** — leave disabled unless a separate Staging OAuth client is deliberately created |
| CAPTCHA | verify posture | verify posture |
| Rate limits | verify posture | verify posture |

`nexpec://reset-password` is the one that matters most: GoTrue rejects an
un-allowlisted `redirectTo` **before the app ever sees it**, so without it a
password-reset link opened on a device fails with nothing to show for it. That
is exactly the failure this was found by locally.
