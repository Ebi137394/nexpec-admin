# NEXPEC — Definitive Remaining-Work Inventory

Classification: **A** = doable now locally · **B** = needs staging/live service · **C** = needs your dashboard/account/credential · **D** = needs legal/business approval · **E** = post-launch, not a blocker.

Status of the account-deletion hardening + owner protection + legal drafts + UI/version fixes: **done locally, validated** (see FINAL VALIDATION). Everything below is what remains.

| # | Item | Class | Exact setting / value / where | How to verify | Secret? |
|---|---|---|---|---|---|
| 1 | Production web build | B/C | `cd apps/web && npm run build` on Vercel or a full local shell (sandbox time-caps it). Root Directory = `apps/web`. | Build exits 0; route manifest printed | No |
| 2 | Vercel env vars | C | Project → Settings → Environment Variables. Set (Production scope): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`(pk_live), `NEXT_PUBLIC_SITE_URL=https://nexpecapp.com`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SIGNING_SECRET`, `OWNER_EMAILS`, `CONTACT_INBOX_EMAIL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, vision vars. **Remove/repoint `NEXT_PUBLIC_ENV` if set to `development`.** | `vercel env ls`; header badge shows PRODUCTION | Several secret |
| 3 | Vercel Root Directory | C | Settings → Build & Deployment → Root Directory = `apps/web` | Build detects Next.js | No |
| 4 | Pending DB migrations | B/C | `supabase db push` applies the batch through `20260801278000` (incl. storage lockdowns). | `supabase migration list` head = 278000; self-tests pass | No |
| 5 | Platform Owner UUID seeding | C | Run as service_role after push: `SELECT public.seed_platform_owner('<owner-profiles-uuid>');` | `SELECT nx_is_platform_owner('<uuid>')` = true | UUID (not secret, but identity) |
| 6 | Edge Function deploy | C | `supabase functions deploy delete-account` **after** db push (REVIEW_CORRECTIONS §1) | Invoke `/account/delete` on staging | No |
| 7 | Storage policies | B | Applied by the storage-lockdown migrations in the batch (`236000/242000/246000/264000`). | Buckets private; owner-folder RLS enforced | No |
| 8 | Supabase Auth Redirect URLs | C | Auth → URL Configuration → Redirect URLs: `nexpec://oauth-callback`, `nexpec://reset-password`, `https://nexpecapp.com/auth/callback`, `https://nexpecapp.com/reset-password` | One sign-in + one reset per provider | No |
| 9 | OAuth providers | C | Auth → Providers: enable Google (client id+secret), Apple (Services ID+Team+Key+.p8), LinkedIn OIDC | Sign-in per provider works | Secrets |
| 10 | Google OAuth consent branding | C | Google Cloud → OAuth consent screen: app name "NEXPEC", logo, authorized domains `nexpecapp.com`+`supabase.co`, publish to Production | Chooser shows "NEXPEC", not the supabase.co host | No |
| 11 | Stripe | C | Dashboard: live keys, Connect enabled, webhooks → `stripe-payments-webhook`/`stripe-connect-webhook` with signing secrets set as edge secrets | Test event → 200; ledger row once | Secrets |
| 12 | Resend / email | C | Resend: verify sending domain (SPF/DKIM), API key set as `RESEND_API_KEY` (Vercel + edge secrets) | Send a test email; deliverability | Secret |
| 13 | Push notifications | C | Expo push credentials: iOS APNs key (`AuthKey_*.p8`), Android FCM. `expo-notifications` configured. | Send a test push; tap routes | Secrets |
| 14 | Sentry | C | `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (web CI, source maps); `EXPO_PUBLIC_SENTRY_DSN` (mobile), `SENTRY_PROJECT_MOBILE` | Trigger a test error → appears in Sentry | Token secret; DSN public |
| 15 | EAS config | C | `eas.json` submit.ios placeholders → real Apple ID/ASC App ID/Team ID; `EAS_PROJECT_ID`; EAS env for `EXPO_PUBLIC_*` prod | `eas env:list production` | Some secret |
| 16 | Apple App Store | C | App ID `com.nexpec.app` w/ Sign In with Apple; ASC app record v1.0.0; screenshots; App Privacy | TestFlight processes build | No (creds separate) |
| 17 | Google Play | C | App `com.nexpec.app`; `google-service-account.json` (Release manager); data-safety; deletion URL | Internal-test install works | Service-acct secret |
| 18 | Store assets | A(spec)/C(create) | Adaptive icon foreground (see `ANDROID_ADAPTIVE_ICON_SPEC.md`), 512×512 icon, 1024×500 feature graphic, phone+tablet/iPad screenshots | Visual review | No |
| 19 | Reviewer account | B/C | Seed `apple_tester@nexpec.com` (Auto-Confirm) + `supabase/seed_apple_reviewer.sql`; password out-of-band | Can browse a job + reach Delete Account | Password (out-of-band) |
| 20 | Legal activation | D | Flip TOS/PRIV/role docs `status:'draft'→'active'` + `effectiveDate`; bump `TERMS_VERSION` in `app/(auth)/choose-role.tsx` to force re-acceptance | Counsel sign-off; viewer shows active | No |
| 21 | AI de-identification pipeline | A(spec)/E | No de-id exists yet. Build a job that strips EXIF/GPS, blurs faces, redacts identifiers, sets `ai_dataset_provenance.deidentified=true`. Until then AI retention is licensed-but-inert. | Rows flip to `deidentified=true` | No |
| 22 | Staging runtime tests | B | Run `STAGING_VERIFICATION_TESTS.sql` + app-layer tests (OWNER_MANUAL_*). | PASS evidence per test | No |
| 23 | Production deployment | C | Order in `STAGING_AND_PRODUCTION_PLAN.md` §6 (corrected: edge fn AFTER db push). | Post-deploy smoke | No |
| 24 | Marketing release | D/E | Package A (early access) now; Package B (post-launch) only after listings verified. | Listings live | No |

## Cross-cutting local items already completed this session
- `.env.example` (web + root): added the 11 web + 6 mobile used-but-undocumented vars (names/placeholders only, no secrets). **A — done.**
- Superseded `docs/account_deletion_hardening/*.DRAFT.*` marked "SUPERSEDED — DO NOT USE". **A — done.**
- Android adaptive-icon spec written; graphic flagged manual. **A — done / C for the graphic.**
- Mobile permissions (`app.config.js`): already trimmed; each maps to a real call site — no unnecessary permission to remove. **A — verified.**
- OAuth callback + deep-link paths consistent (`scheme: nexpec`, `nexpec://oauth-callback`, `nexpec://reset-password`, web `/auth/callback` route present). **A — verified.**
- Bundle/package `com.nexpec.app` consistent iOS/Android; `/legal/privacy`, `/legal/terms`, `/contact`, `/account/delete` routes present. **A — verified.**

## Not blockers (post-launch, E)
- Storage orphan-sweep for personal buckets beyond avatars/resumes.
- `inspection_captures` de-identification (also #21).
- Android themed monochrome icon layer.
- Tightening `any`/`@ts-ignore` density.
