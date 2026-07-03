# NEXPEC — Launch Playbook

Zero-to-100 guide for launch day. This complements `docs/MASTER_RELEASE_RUNBOOK.md` (the backend/web deploy bible). Order of operations across both: **console prep → edge functions → web → mobile store builds → `supabase db push` → store rollout**.

---

## Part 0 — One-time console prep (do these BEFORE any build)

### 0.1 Supabase (Dashboard)
- [ ] **Auth → URL Configuration → Redirect URLs**, add all four:
  `nexpec://oauth-callback` · `nexpec://reset-password` · `https://<web-domain>/reset-password` · web OAuth callback (if not present).
- [ ] **Auth → Providers**: enable **Google** (Web OAuth client ID + secret; authorized redirect URI = `https://<project-ref>.supabase.co/auth/v1/callback`), **Apple** (Services ID + Team ID + Key ID + `.p8` key; same return URL), **LinkedIn (OIDC)** — use the *linkedin_oidc* provider tile; the LinkedIn app needs the "Sign In with LinkedIn using OpenID Connect" product.
- [ ] Edge-function secrets set (`supabase secrets set`): `NOTIFY_SHARED_SECRET`, `WEBHOOK_SECRET`, `STRIPE_PAYMENTS_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `TAX_VAULT_KEY`, plus the rest listed in `.env.example` § edge-function secrets.
- [ ] Create the **review account**: Supabase → Auth → Add user `apple_tester@nexpec.com` (Auto-Confirm ON), then run `supabase/seed_apple_reviewer.sql`. Save the password for the store review notes.

### 0.2 Apple Developer portal
- [ ] App ID `com.nexpec.app` has the **Sign In with Apple** capability (EAS will auto-manage via `usesAppleSignIn` in app.config.js, but verify).
- [ ] A **Services ID** exists for the Supabase web-OAuth return URL.

### 0.3 Google Cloud
- [ ] OAuth consent screen **published** (not Testing mode) — otherwise Google sign-in fails for real users.

### 0.4 Vercel
- [ ] Project **Root Directory = `apps/web`** (Settings → Build & Deployment). A repo-root build fails with "No Next.js version detected".

### 0.5 EAS environment (the white-screen guard)
The app reads `EXPO_PUBLIC_*` at build time; missing values = crash on launch = instant rejection.
```bash
# from repo root — either the helper script:
bash scripts/eas-prod-env.sh
# or manually:
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://<project-ref>.supabase.co
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon-key>
eas env:create --environment production --name EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY --value pk_live_...
eas env:list production      # verify all three (+ optional EXPO_PUBLIC_SENTRY_DSN)
```

### 0.6 Submit credentials
- [ ] `eas.json → submit.production.ios`: replace `REPLACE_WITH_APPLE_ID`, `REPLACE_WITH_ASC_APP_ID`, `REPLACE_WITH_APPLE_TEAM_ID`.
- [ ] Place `google-service-account.json` at repo root (stays gitignored). Grant it "Release manager" in Play Console → API access.

---

## Part 1 — Backend + web first (per MASTER_RELEASE_RUNBOOK §3–§5)

```bash
# gates (all must be green — they were on 2026-07-02):
cd ~/Desktop/nexpec && (cd apps/web && npm run typecheck) && npx tsc --noEmit \
  && npm run qa:outbox && npm run qa:gr2 && npm run qa:rls-admin && npm run qa:db-refs

# Phase 1 — edge functions:
supabase functions deploy mint-doc-url
supabase functions deploy stripe-connect-webhook
# (+ any others listed in the runbook's change manifest)

# Phase 2 — web: push to the production branch; Vercel builds apps/web.
```
**Do NOT run `supabase db push` yet** — it goes LAST (after the mobile binary is approved or at minimum submitted), because the storage lockdowns in the migration batch break old clients still calling `getPublicUrl`.

---

## Part 2 — iOS: EAS build → TestFlight → App Store

### 2.1 Build
```bash
npx eas-cli@latest --version        # be current
eas login                           # the account owning project a8faa2b1-…
eas build --platform ios --profile production
```
First run: let EAS manage certificates/provisioning (recommended). `appVersionSource: remote` + `autoIncrement` handle build numbers automatically.

### 2.2 TestFlight
```bash
eas submit --platform ios --latest
```
Then in **App Store Connect → TestFlight**: wait for processing (10–30 min), answer the export-compliance question if asked (should be pre-answered: `ITSAppUsesNonExemptEncryption=false` is baked in), add yourself to an internal test group, and **install + smoke test on a real device**: sign-in (email + Apple + Google), one job browse, one chat send, one photo capture offline → sync.

### 2.3 App Store submission
In **App Store Connect → App Store → (+) version 1.0.0**:
1. Screenshots: 6.7" (iPhone 15 Pro Max) + 6.5" sets minimum; iPad if supported.
2. Description, keywords, support URL, marketing URL, privacy policy URL (must be live).
3. **App Privacy** questionnaire: data collected = contact info (email/name), user content (photos/documents), identifiers (user ID), usage data (if Sentry DSN enabled = crash data). All "linked to user", none used for tracking → no ATT prompt needed.
4. **App Review Information**: demo account `apple_tester@nexpec.com` + password; notes: "Two-sided industrial inspection marketplace. Reviewer account is pre-seeded with an inspector profile, sample jobs, and chat threads. Payments use Stripe test rails in the demo account."
5. Sign in with Apple is offered alongside Google/LinkedIn (guideline 4.8 satisfied).
6. Select the build → **Submit for Review**. Typical first review: 24–72h.

**Rejection playbook**: respond in Resolution Center within the same thread; most first-app rejections are metadata/demo-account clarity, not code.

---

## Part 3 — Android: EAS build → Internal testing → Production

### 3.1 Build
```bash
eas build --platform android --profile production   # produces .aab
```

### 3.2 Play Console setup (first time)
1. Create app (`com.nexpec.app`), fill **App content**: privacy policy URL, data-safety form (mirror the Apple privacy answers), content rating questionnaire, target audience 18+, "News" = no, ads = **none**.
2. **App access**: provide the reviewer credentials (`apple_tester@nexpec.com` + password) — Google checks gated apps too.

### 3.3 Internal testing → production
```bash
eas submit --platform android --latest    # uploads to the internal track by default config
```
1. **Testing → Internal testing**: add your email as tester, install via the opt-in link, smoke test (same checklist as iOS + hardware-back behavior through a modal and a chat thread).
2. Promote: Internal → **Production** with a **staged rollout at 20%**, monitor Play vitals (ANR/crash) for 24–48h, then 50% → 100%.
3. First-ever production release triggers Google review: usually hours, occasionally 1–3 days.

---

## Part 4 — The final switch (after both binaries are live or in review)

```bash
supabase db push        # applies 182000 … 250000, in order, self-testing
```
Then the runbook §Post-push verification queries + role-by-role smoke tests. Keep OTA updates on the `production` channel for surgical JS fixes post-launch (`eas update --channel production --message "fix: …"`) — never for native-module changes.

---

## Part 5 — The LinkedIn launch post

> **Today, NEXPEC is live.**
>
> Industrial inspection is one of the largest, least-digitized markets in the world, and it still runs on phone calls, PDF chaos, and blind trust. Asset owners can't verify who actually inspected their equipment. Inspectors chase invoices for months. Evidence lives in camera rolls.
>
> We built the trust infrastructure this industry deserves:
>
> **A brokered marketplace** where every engagement is contract-first, every price is protected by structural blindness (inspectors see their payout, clients see their price, and the platform's economics stay private, enforced in the database itself), and every report passes expert review before it reaches the client.
>
> **An offline-first field app** with a private AI co-inspector that runs entirely on-device. Corrosion detection with zero cloud dependency, in the middle of a tank farm with no signal, on evidence that never leaves the inspector's phone.
>
> **Cryptographically provable reports.** Every evidence pack is signed on-device and anchored to the Bitcoin blockchain. Anyone can verify a NEXPEC report's integrity, years later, in seconds.
>
> **Admin-controlled treasury.** Client funds are secured on our ledger and every inspector payout is individually reviewed and released by our operations team. No black-box automation where money is concerned.
>
> Available now on the App Store, Google Play, and the web.
>
> To the inspectors who shaped this with brutal, brilliant field feedback: this is yours.
>
> If you own industrial assets, run an EPC, or inspect for a living, I'd love to show you what we built. DMs open.
>
> #IndustrialInspection #NDT #ConstructionTech #AI #Marketplace #TrustInfrastructure #Launch

*(Attach: 60–90s screen recording of the field app capturing → sealing → verifying a report. Post Tuesday–Thursday, 8–10am ET, and reply to every comment in the first 2 hours.)*

---

## Appendix — Day-of quick reference

| Moment | Command / place |
|---|---|
| Gates | the six-command battery in Part 1 |
| iOS build | `eas build -p ios --profile production` |
| iOS submit | `eas submit -p ios --latest` |
| Android build | `eas build -p android --profile production` |
| Android submit | `eas submit -p android --latest` |
| DB push (LAST) | `supabase db push` |
| Hotfix JS | `eas update --channel production` |
| Rollback | `docs/MASTER_RELEASE_RUNBOOK.md` § Rollback |
