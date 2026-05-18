# Mobile Sprint 1 — Pre-flight + Foundational Hotfixes

**Goal:** Mobile codebase is honest about the current production schema, the smallest user-visible parity gap (CCI flag) is closed, the longest-standing silent failure (`primary_color`) is resolved, and we have a written inventory of the larger gaps to tackle in Sprint 2+.

**Pass criteria:**
- Mobile builds clean on iOS + Android (EAS preview profile)
- `requires_cci` toggle visible and writing correctly from `post-new-job.tsx`
- Zero silent column-write failures in production traffic
- `MOBILE_AUDIT_2026-05-18.md` checked in with a punch list of P0/P1/P2 findings
- No new Golden Rule violations introduced

**Duration:** 3–4 days of focused work.

**Dependencies:** Web Sprint 12 deployed and all Section H of `MOBILE_SYNC_LEDGER.md` reviewed.

---

## Step 0 — Environment setup (~15 min)

```bash
# Locate the mobile app (adjust path if needed)
cd "/Users/ebrahimfeyzi/Desktop/my application/last nexpec/NEXPEC"
find . -maxdepth 3 -name "package.json" -path "*mobile*" -not -path "*/node_modules/*"

# Switch into the mobile workspace
cd apps/mobile  # adjust if your path differs

# Verify environment
node --version
yarn --version
npx expo --version

# Install + doctor
yarn install
npx expo doctor

# Capture any flagged issues — we'll triage them at the end of Step 1.
```

If `expo doctor` flags an SDK / RN version mismatch, capture the output before proceeding. Don't auto-upgrade — the audit step (Step 1) decides scope.

---

## Step 1 — Pre-flight audit (~3–4 hours)

**Goal:** Produce a one-page audit doc at the repo root: `MOBILE_AUDIT_2026-05-18.md`.

### 1.1 Route inventory

```bash
find apps/mobile/app -name "*.tsx" -not -path "*/node_modules/*" | sort > /tmp/mobile-routes.txt
wc -l /tmp/mobile-routes.txt
```

Paste the route list into the audit doc under a `## Route inventory` heading.

### 1.2 Schema-write inventory

For each route, identify what tables it writes to and what columns. Grep helpers:

```bash
cd apps/mobile

# Find every Supabase .insert() / .update() / .upsert() call
grep -rn "supabase" src app --include='*.ts' --include='*.tsx' \
  | grep -E "\.(insert|update|upsert)\(" \
  | head -60

# Find every table name referenced in .from()
grep -rn "\.from\(['\"]" src app --include='*.ts' --include='*.tsx' \
  | grep -oE "from\(['\"][^'\"]+['\"]\)" \
  | sort -u
```

In the audit doc, build a table:

```
| Screen / file | Tables read | Tables written | Notes |
```

### 1.3 Cross-reference against Mobile Sync Ledger Section B

For each (screen, table) pair, flag if the screen writes to a column that does NOT exist in production. Known suspects:

- `primary_color` on `profiles` — **silent failure** (column does not exist)
- `inspection_type`, `scope_template_id`, `claimed_address_text`, `claimed_address_geocoded` on `jobs` — **likely missing** in production (rolled back in favor of `requires_cci`)
- Direct writes to `profiles.certifications` text[] when the screen should be writing to the new `inspector_certifications` table (Sprint 10)
- Resume uploads writing to the public path instead of the private `resumes` bucket (Sprint 11)

### 1.4 Smoke test on simulator

```bash
npx expo start --clear
```

Walk through the app:

1. Sign in
2. Inspector dashboard → open jobs → job detail → apply
3. Inspector → submit report (don't actually submit; just check the form opens)
4. Inspector → compliance / wallet / settings
5. Client → post a job (if mobile has client side)
6. Settings → save changes

For every screen that throws, every silent error, every console warning — log it in the audit doc with severity:

- **P0** — Golden Rule violation OR silent data loss
- **P1** — Schema mismatch (write that succeeds-but-fails-silently OR fails with a user-visible error)
- **P2** — UX / cosmetic

### 1.5 Golden Rule audit

For each screen, check:

- Does any non-admin code path call `assign_inspector_to_job` or directly UPDATE `jobs.assigned_inspector_id`? → GR3 violation
- Does any client-facing screen read `inspector_payout_cents`? → GR2 violation
- Does any inspector-facing screen read `client_price_cents`? → GR2 violation
- Does any screen create a chat room that isn't `help_support` / `job_client_admin` / `job_inspector_admin`? → GR4/GR7 violation
- Does any inspector screen call an "accept" action on their own application? → GR5 violation
- Does any client screen call Stripe / payout APIs directly? → GR6 violation

Each finding → add to the audit doc.

### 1.6 Deliverable

A populated `MOBILE_AUDIT_2026-05-18.md` at the repo root with:

```markdown
# Mobile Audit — 2026-05-18

## Route inventory
<route list>

## Schema-write inventory
| Screen | Tables read | Tables written | Suspect columns |
...

## Golden Rule findings
<list, severity-tagged>

## Smoke-test failures
<list>

## Punch list
P0: …
P1: …
P2: …
```

Commit:
```bash
git add MOBILE_AUDIT_2026-05-18.md
git commit -m "audit(mobile): sprint 1 pre-flight inventory + GR check + smoke results"
```

---

## Step 2 — Apply `requires_cci` toggle to mobile post-new-job (~2 hours)

**File:** `apps/mobile/app/post-new-job.tsx` (path may differ; locate via the audit's route inventory)

### 2.1 UI changes

Add a labeled `<Switch>` (or `<Checkbox>` — whichever your design system uses) in the requirements section, **NOT** in the main scope section. Match the web pattern from `apps/web/src/app/client/jobs/new/page.tsx`:

```tsx
// somewhere in the form
const [requiresCci, setRequiresCci] = useState(false);

// ...in the JSX, after Specialties or in a new Requirements section:
<View style={styles.section}>
  <Text style={styles.sectionTitle}>Requirements</Text>
  <Pressable
    style={styles.toggleRow}
    onPress={() => setRequiresCci(v => !v)}
  >
    <Switch value={requiresCci} onValueChange={setRequiresCci} />
    <View style={styles.toggleCopy}>
      <Text style={styles.toggleTitle}>Requires CCI-certified inspector</Text>
      <Text style={styles.toggleHelper}>
        Only inspectors with a verified CCI credential will be eligible to
        apply. Admin can adjust this during moderation.
      </Text>
    </View>
  </Pressable>
</View>
```

### 2.2 Submit logic

In the submit handler, add `requires_cci` to the `.insert()` payload:

```ts
const { error } = await supabase.from('jobs').insert({
  // ...existing fields...
  requires_cci: requiresCci,   // ← NEW
});
```

### 2.3 Validation (if mobile uses Zod or similar)

If there's a client-side Zod schema, add:
```ts
requiresCci: z.boolean().default(false),
```

### 2.4 Verify

1. Post a job from mobile with the toggle OFF → DB row has `requires_cci=false`.
2. Post with toggle ON → `requires_cci=true`.
3. Inspect with `SELECT id, title, requires_cci FROM jobs ORDER BY created_at DESC LIMIT 5;`.

---

## Step 3 — Fix `primary_color` silent failure (~1 hour)

The mobile `branding-settings` screen writes `primary_color` to `profiles`, but that column does not exist on production. The write succeeds at the JS layer but is silently dropped by Supabase.

### Option A — Strip the write (RECOMMENDED)

```bash
# Find every reference
cd apps/mobile
grep -rn "primary_color" src app --include='*.ts' --include='*.tsx'
```

For each hit:

1. Remove `primary_color` from `.insert()` / `.update()` payloads.
2. Remove the color picker UI from the branding-settings screen (or hide behind a feature flag).
3. Leave a comment:
   ```ts
   // primary_color column does not exist on production profiles.
   // Re-enable when Sprint 13C ships the column + theme system.
   ```

### Option B — Add the column

If you actually want this feature now, add a migration:

```sql
-- supabase/migrations/<timestamp>_add_primary_color_to_profiles.sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS primary_color text DEFAULT '#7C3AED'
  CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$');
```

Then verify writes persist.

**Recommendation:** Option A for Sprint 1. Re-introduce in a future themed-PDF sprint where it actually drives output.

---

## Step 4 — Audit the mobile compliance-job flow (~2 hours)

The mobile `app/post-compliance-job.tsx` (if it exists) writes:
- `inspection_type='compliance'`
- `scope_template_id=<uuid>`
- `claimed_address_text`
- `claimed_address_geocoded` (PostGIS EWKT)

These columns may not exist on the current production schema (the compliance-mode-foundation migration was partially rolled back). Verify:

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name='jobs'
   AND column_name IN ('inspection_type','scope_template_id','claimed_address_text','claimed_address_geocoded');
```

If 0 rows → the mobile compliance flow is currently broken in production.

**Two paths:**

1. **Defer to Sprint 5 (Compliance-Mode Decision).** Hide the compliance-job entry point in the mobile UI behind a feature flag until that sprint lands. Quick fix:
   ```ts
   const COMPLIANCE_MODE_ENABLED = false; // re-enable when DB schema lands
   ```

2. **Strip the compliance flow entirely** and replace with the simpler `requires_cci` checkbox (already added in Step 2).

**Recommendation:** Option 1 — feature-flag off, decide for-real in Sprint 5.

---

## Step 5 — Build + smoke + commit + EAS (~1 hour)

```bash
cd apps/mobile

# Type-check
npx tsc --noEmit

# Unit tests if present
yarn test --watchAll=false 2>/dev/null || echo "no test script — skip"

# Commit
git add app/post-new-job.tsx \
        app/branding-settings.tsx \
        MOBILE_AUDIT_2026-05-18.md
git commit -m "feat(mobile): sprint 1 — audit + requires_cci toggle + primary_color cleanup

- MOBILE_AUDIT_2026-05-18.md captures route inventory, schema-write map,
  GR audit findings, smoke-test failures, P0/P1/P2 punch list.
- post-new-job.tsx: 'Requires CCI-certified inspector' toggle wired to
  jobs.requires_cci boolean.
- branding-settings.tsx: stopped writing primary_color (column doesn't
  exist on production; silent-failure resolved).
- Compliance-job flow feature-flagged off pending Sprint 5 decision."

# EAS preview builds for smoke testing on real devices
eas build --profile preview --platform ios
eas build --profile preview --platform android
```

While builds run, write the **Sprint 1 sign-off ticket** in your tracker.

---

## Step 6 — On-device smoke test (~30 min per platform)

Install the preview build via EAS QR code, then:

1. Sign in as `client@test.com`
2. Post a job → toggle `Requires CCI-certified inspector` → submit
3. Open Supabase Studio: confirm `requires_cci = true` on the new row
4. Sign in as `inspector@test.com` (different device or fresh signin)
5. Open Settings → Branding → save (verify no error toast, no console warning, no silent failure)
6. Walk through every screen the audit flagged as P0/P1 → confirm it doesn't regress

---

## Sprint 1 sign-off checklist

- [ ] `MOBILE_AUDIT_2026-05-18.md` checked into the repo with P0/P1/P2 punch list
- [ ] `requires_cci` toggle visible on the post-new-job screen
- [ ] DB shows `requires_cci=true` for jobs posted with the toggle on
- [ ] `primary_color` silent failure resolved (Option A or B chosen and documented)
- [ ] Compliance-job flow feature-flagged off (or removed) pending Sprint 5
- [ ] No new Golden Rule violations introduced (re-audit pass on touched files)
- [ ] App builds and runs on iOS + Android simulators
- [ ] No new console warnings or red-screen errors on the smoke-test path
- [ ] EAS preview builds installable on physical devices
- [ ] Commit messages are descriptive and reference this sprint

When all 10 are checked, Sprint 1 is done.

---

## What unlocks next (Sprint 2 preview)

**Sprint 2 — Messaging parity (Web Sprint 12A mirror).** Implement:
- `ensure_help_support_conversation()` and `ensure_job_conversation(jobId, kind)` RPC calls from mobile
- Realtime subscription on `messages` table filtered by `conversation_id`
- Composer + thread + room list UI
- "Help & Support" entry point in the mobile tab bar / drawer

Realtime is the biggest unknown for mobile — Supabase RN client supports it but tunneling through TestFlight/Internal Testing needs verification. Sprint 2 will be 2–3 days.

After Sprint 2 + Sprint 3 (notifications + disputes), the mobile inspector experience matches the web feature for the most-used flows. Sprints 4–8 backfill the rest.

---

**Maintained by:** ebi · **Last updated:** 2026-05-18
