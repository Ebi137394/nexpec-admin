# NEXPEC — External Dashboard Setup Workbook

Everything you must configure outside the repo. **No real passwords, private keys, or service-role keys appear here** — placeholders only. Each row: field · value/placeholder · environment · secret? · verify · what breaks · repo evidence · status.

## Quick checklist
- [ ] 1. Vercel — project, root dir, env vars, domain
- [ ] 2. Supabase — db push, owner seed, edge deploy+secrets, redirect URLs, storage
- [ ] 3. Google OAuth — client + consent branding + publish
- [ ] 4. Apple Sign In — App ID capability + Services ID + key
- [ ] 5. LinkedIn OAuth — OIDC app + product
- [ ] 6. Stripe — keys, Connect, webhooks
- [ ] 7. Resend — domain verify + API key
- [ ] 8. Sentry — projects + DSN + auth token
- [ ] 9. Expo/EAS — project id, env, credentials
- [ ] 10. Apple Developer / App Store Connect — app record, privacy, screenshots
- [ ] 11. Google Play Console — app, data safety, service account
- [ ] 12. DNS/domain — A/CNAME, SSL, email records

---

## 1. Vercel
| Field | Value / placeholder | Env | Secret | Verify | Breaks if wrong | Repo evidence | Status |
|---|---|---|---|---|---|---|---|
| Root Directory | `apps/web` | all | no | Build detects Next.js | "No Next.js detected" build fail | `apps/web/` monorepo | must confirm |
| `NEXT_PUBLIC_SITE_URL` | `https://nexpecapp.com` | prod | no | OAuth redirect + sitemap use it | OAuth returns to raw VERCEL_URL | `apps/web/.env.example` | missing |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | all | no | app loads data | app can't reach DB | `.env.example` | missing |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon JWT | all | no (anon) | reads work | auth/reads fail | `.env.example` | missing |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_…` | prod | no | payment sheet loads | payments break | `.env.example` | missing |
| `SUPABASE_SERVICE_ROLE_KEY` | service JWT | all | **YES** | server actions work | privileged server ops fail | `.env.example` | missing |
| `STRIPE_SECRET_KEY` | `sk_live_…` | prod | **YES** | server Stripe calls | charges fail | `.env.example` | missing |
| `STRIPE_WEBHOOK_SIGNING_SECRET` | `whsec_…` | prod | **YES** | webhook 200 | webhook signature fails | `.env.example` | missing |
| `OWNER_EMAILS` | `owner@nexpecapp.com` | all | no | admin failsafe login | owner lockout risk | `middleware.ts` | missing |
| `CONTACT_INBOX_EMAIL` | `support@nexpecapp.com` | all | no | contact form routes | contact form fails | `lib/actions/contact.ts` | missing |
| `RESEND_API_KEY` | `re_…` | all | **YES** | emails send | no email | `.env.example` | missing |
| `RESEND_FROM_EMAIL` | `NEXPEC <no-reply@nexpecapp.com>` | all | no | from-address correct | email rejected | `.env.example` | missing |
| `NEXT_PUBLIC_VISION_MODEL_*` | model url/slug/version/sha/labels | prod | no | web AI loads | web AI disabled | `.env.example` | missing |
| `NEXT_PUBLIC_ENV` | **unset** (or `production`) | prod | no | header badge = PRODUCTION | badge shows DEVELOPMENT | `admin/Header.tsx` | must confirm (remove if `development`) |
| `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` | from Sentry | prod/CI | token **YES** | source maps upload | no readable stacktraces | `next.config.mjs` | missing |

Verify all: `vercel env ls` per scope. **Do NOT set `NEXT_PUBLIC_ENV=development` anywhere but local.**

## 2. Supabase
| Action | Path / command | Env | Secret | Verify | Breaks | Status |
|---|---|---|---|---|---|---|
| Apply migrations | `supabase db push` (batch → `20260801278000`) | staging then prod | no | `supabase migration list` | guards/tables absent | pending |
| Seed Platform Owner | SQL editor (service_role): `SELECT public.seed_platform_owner('<owner-uuid>')` | staging then prod | UUID | `nx_is_platform_owner('<uuid>')`=true | owner unprotected | pending |
| Deploy edge fn | `supabase functions deploy delete-account` (AFTER push) | staging then prod | no | invoke on `/account/delete` | deletion fails | pending |
| Edge secrets | `supabase secrets set` for `NOTIFY_SHARED_SECRET`, `WEBHOOK_SECRET`, `STRIPE_PAYMENTS_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `TAX_VAULT_KEY`, `WORKER_SHARED_SECRET`, `CRON_SECRET`, `RESEND_API_KEY` | all | **YES** | `supabase secrets list` | edge fns 500/401 | pending |
| Auth redirect URLs | Auth → URL Configuration → Redirect URLs (the four in inventory #8) | prod | no | sign-in + reset per provider | OAuth/reset fail | pending |
| Storage | applied by lockdown migrations | prod | no | buckets private | PII leak / broken URLs | pending |
| Reviewer account | Auth → Add user `apple_tester@nexpec.com` (Auto-Confirm) + `supabase/seed_apple_reviewer.sql` | prod | password out-of-band | reviewer can browse | store rejection | pending |

## 3. Google OAuth
| Field | Value | Secret | Verify | Breaks | Status |
|---|---|---|---|---|---|
| OAuth client (Web) | authorized redirect `https://<ref>.supabase.co/auth/v1/callback` | secret | Google sign-in works | login fails | missing |
| Consent screen — App name | `NEXPEC` | no | chooser shows NEXPEC | shows supabase.co host | missing |
| Consent — Authorized domains | `nexpecapp.com`, `supabase.co` | no | passes verification | branding rejected | missing |
| Consent — Publishing status | **In production** | no | real users can sign in | Testing-mode blocks users | missing |
| Logo | NEXPEC logo (may trigger review) | no | shows in chooser | none (name still works) | optional now |

## 4. Apple Sign In
| Field | Value | Secret | Verify | Breaks | Status |
|---|---|---|---|---|---|
| App ID capability | Sign In with Apple on `com.nexpec.app` | no | entitlement present | 4.8 rejection | must confirm |
| Services ID | for Supabase web-OAuth return URL | no | web Apple login | web Apple fails | missing |
| Key (.p8) + Key ID + Team ID | in Supabase Apple provider | **YES** | Apple sign-in works | login fails | missing |

## 5. LinkedIn OAuth
| Field | Value | Secret | Verify | Breaks | Status |
|---|---|---|---|---|---|
| LinkedIn app | "Sign In with LinkedIn using OpenID Connect" product enabled | — | provider tile works | LinkedIn login fails | missing |
| Client id/secret | in Supabase `linkedin_oidc` provider | secret | sign-in works | fails | missing |
| Redirect | `https://<ref>.supabase.co/auth/v1/callback` | no | round-trip | fails | missing |

## 6. Stripe
| Field | Value | Secret | Verify | Breaks | Status |
|---|---|---|---|---|---|
| Publishable key | `pk_live_…` → Vercel/EAS public | no | sheet loads | payments break | missing |
| Secret key | `sk_live_…` → Vercel `STRIPE_SECRET_KEY` | **YES** | server charge | charges fail | missing |
| Payments webhook | endpoint → `stripe-payments-webhook`; signing secret → edge secret | **YES** | test event 200 | settlement stuck | missing |
| Connect webhook | endpoint → `stripe-connect-webhook`; signing secret → edge secret | **YES** | test event 200 | payout status stuck | missing |
| Connect enabled | for inspector/supplier payouts | — | onboarding link | no payouts | must confirm |

## 7. Resend
| Field | Value | Secret | Verify | Breaks | Status |
|---|---|---|---|---|---|
| Domain verify | SPF + DKIM for nexpecapp.com | no | domain "verified" | email to spam/blocked | missing |
| API key | `re_…` → Vercel + edge `RESEND_API_KEY` | **YES** | test email arrives | no email | missing |
| From address | `no-reply@nexpecapp.com` | no | matches verified domain | send rejected | missing |

## 8. Sentry
| Field | Value | Secret | Verify | Breaks | Status |
|---|---|---|---|---|---|
| Web project DSN | `SENTRY_*` in next.config | token secret | test error appears | no web telemetry | missing |
| Mobile DSN | `EXPO_PUBLIC_SENTRY_DSN` | no (public) | test crash appears | no crash reports | missing |
| Auth token | source-map upload (CI only) | **YES** | readable stacktraces | minified stacks | missing |

## 9. Expo / EAS
| Field | Value | Secret | Verify | Breaks | Status |
|---|---|---|---|---|---|
| `EAS_PROJECT_ID` | from `eas init` (bound: a8faa2b1-…) | no | `eas build` runs | OTA inert | must confirm |
| EAS env (production) | `EXPO_PUBLIC_SUPABASE_URL/ANON_KEY/STRIPE_PUBLISHABLE_KEY` (+ optional DSN) | anon public | `eas env:list production` | white-screen crash | missing |
| iOS credentials | let EAS manage certs/provisioning | **YES** | build signs | build fails | must confirm |
| Android keystore | EAS-managed upload key | **YES** | .aab signs | build fails | must confirm |

## 10. Apple Developer / App Store Connect
| Field | Value | Secret | Verify | Breaks | Status |
|---|---|---|---|---|---|
| `eas.json` submit.ios | real Apple ID / ASC App ID / Team ID | account ids | `eas submit` | submit fails | missing (placeholders) |
| App record | v1.0.0, `com.nexpec.app` | no | appears in ASC | can't submit | missing |
| App Privacy | contact/user-content/identifiers/diagnostics; no tracking | no | form complete | rejection | missing |
| Screenshots | 6.7" + 6.5" (+ iPad or set `supportsTablet:false`) | no | uploaded | rejection | missing |
| Export compliance | `ITSAppUsesNonExemptEncryption=false` (baked) | no | no per-build prompt | prompt each upload | ready (`app.config.js`) |

## 11. Google Play Console
| Field | Value | Secret | Verify | Breaks | Status |
|---|---|---|---|---|---|
| `google-service-account.json` | repo root, Release-manager role | **YES** | `eas submit` android | submit fails | missing |
| Data safety | mirror Apple + Sentry crash | no | form complete | #1 Play rejection | missing |
| Account-deletion URL | `https://nexpecapp.com/account/delete` | no | form saved | policy rejection | ready (route exists) |
| Content rating / target age | 18+, ads none | no | rating issued | listing blocked | missing |
| Feature graphic | 1024×500 | no | uploaded | can't publish | missing |

## 12. DNS / domain
| Record | Value | Verify | Breaks | Status |
|---|---|---|---|---|
| Apex/root | Vercel A/ALIAS per Vercel domains | site loads on nexpecapp.com | site unreachable | must confirm |
| `www` CNAME | → Vercel | www redirects | www broken | must confirm |
| SSL | auto via Vercel | https padlock | insecure warnings | must confirm |
| SPF/DKIM/DMARC | Resend values | email deliverability | email to spam | missing |
| (optional) `auth.nexpecapp.com` | Supabase custom domain CNAME | Google chooser shows custom host | supabase.co host shown | optional (fast-follow) |
