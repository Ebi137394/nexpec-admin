# Domain Launch Playbook

**Purpose:** activate one of the four currently-dark inspection domains (`civil_construction`, `electrical`, `mechanical_field`, `chemical_process`). All four have content seeded (Phases 1–5 of the catalogue sprint) but `is_launched = false`, so nothing surfaces on consumer pages today.

**Recommended launch order:**
1. `mechanical_field` (closest adjacency to `industrial_ndt` — many overlapping inspectors)
2. `chemical_process` (highest unit economics — `cci_lead` PHA/HAZOP at $12K, EPA RMP at $9K)
3. `electrical` (broad applicability, NETA / NFPA 70E recognition)
4. `civil_construction` (largest TAM but most fragmented inspector pool)

This document is the same checklist for every domain — just swap the slug.

---

## STEP 0 — Set the working slug

Pick the domain you're launching and use it consistently throughout.

```sql
-- Run this once at the start of every launch attempt
SELECT current_setting('app.launch_domain', true);
SET LOCAL app.launch_domain = 'mechanical_field';   -- ← change per launch
```

> Everywhere this document says `<DOMAIN>`, substitute the slug you chose.

---

## STEP 1 — Content readiness check

Confirms the database has the content the launch depends on. Should return a single row with sensible numbers; any zero or NULL is a blocker.

```sql
SELECT
  d.slug,
  d.is_launched,
  d.is_active,
  d.display_order,
  array_length(d.default_specialty_groups, 1)                    AS group_count,
  (SELECT count(*) FROM public.inspection_scope_templates t
     WHERE t.domain = d.slug AND t.is_active)                    AS scope_template_count,
  (SELECT count(*) FROM public.inspection_evidence_requirements r
     JOIN public.inspection_scope_templates t ON t.id = r.template_id
     WHERE t.domain = d.slug)                                    AS evidence_row_count
FROM public.inspection_domains d
WHERE d.slug = '<DOMAIN>';
```

**Expected counts (from the Phase 1–5 sprint):**

| Domain | Groups | Scope templates | Evidence rows |
|---|---|---|---|
| `industrial_ndt` | 12 | 10 | 59 |
| `civil_construction` | 5 | 10 | 58 |
| `electrical` | 5 | 10 | 64 |
| `mechanical_field` | 7 | 12 | 85 |
| `chemical_process` | 4 | 15 | 123 |

`is_launched` should still be `false` and `is_active` should be `true` at this stage. If the counts look wrong, the relevant phase migration didn't apply cleanly — re-run it before going further.

---

## STEP 2 — Inspector pool count

How many inspectors today already hold at least one specialty that would match this domain? Uses the canonical kebab discipline slugs across the domain's `default_specialty_groups` (computed from `packages/shared-core/src/data/specialtyTaxonomy.ts` at this commit).

### `mechanical_field` (7 groups, 136 disciplines)

```sql
SELECT count(*) AS eligible_inspectors
  FROM public.profiles
 WHERE role = 'inspector'
   AND specialty_slugs && ARRAY[
'alignment-laser','asme-b31','asme-b31-1','asme-b31-12','asme-b31-3','asme-b31-4','asme-b31-5','asme-b31-8','asme-b31-9','asme-section-ix','aws-cawi','aws-cwe','aws-cwi','aws-cwsupervisor','aws-scwi','balancing-field','bgas-cswip-coating','blast-cleaning','brazing','cathodic-protection','compressors-centrifugal','compressors-reciprocating','confined-space-entry','corrosion-engineering','corrosion-monitoring','crane-inspection','cswip-3-1','cswip-3-2','cswip-3-2-2','cui','directional-drilling','document-control','expediting','fcaw','fiber-optic-leak','fmea-rcm','forklift-thorough','frosio','galvanic-survey','galvanizing','gas-turbine-inspection','gas-turbines','gearboxes','hse-management','hvac-mechanical','icorr-coatings','iosh-managing','iso-14001-auditor','iso-17020-auditor','iso-17025-auditor','iso-45001-auditor','iso-9001-auditor','iso-iec-19011','iwe','iws','iwt','leea-foundation','leea-general','leea-mewp','leea-overhead','lifting-gear','lifting-gear-cranes','lubrication','metallurgy-materials-engineering','mig-gmaw','nace-cip-1','nace-cip-2','nace-cip-3','nace-cp-1','nace-cp-2','nace-cp-3','nace-cp-4','nace-pcs-1','nace-pcs-2','ndt-ae','ndt-borescope','ndt-ct','ndt-dr','ndt-ecpit','ndt-et','ndt-ferrite','ndt-guided-wave','ndt-hardness','ndt-iris','ndt-irt','ndt-lt','ndt-mfl','ndt-mt','ndt-nrft','ndt-paut','ndt-pmi','ndt-pt','ndt-replication','ndt-rfet','ndt-rt','ndt-tofd','ndt-ut','ndt-vt','nebosh-diploma','nebosh-igc','orbital-welding','osha-30','osha-510','osha-authorised-person','painting','pigging-ili','pipeline-coating','pipeline-construction','pipeline-hydrotest','pipeline-integrity','pipeline-pigging','pumps-centrifugal','pumps-reciprocating','qa-qc-management','qaqc-management','rcfa','rigging-loft','rope-access-irata-sprat','rotating-equipment','rotating-equipment-inspection','saw','six-sigma-black','smaw','sspc-bci','sspc-cas','sspc-pci','steam-turbines','subsea-pipeline','tig-gtaw','valves-actuators','vendor-surveillance','vibration-analysis','welder-qualification','wire-rope-inspection','witness-inspection','wps-pqr'
   ]::text[]
   AND COALESCE(deleted_at, NULL) IS NULL;
```

### `chemical_process` (4 groups, 70 disciplines)

```sql
SELECT count(*) AS eligible_inspectors
  FROM public.profiles
 WHERE role = 'inspector'
   AND specialty_slugs && ARRAY[
'air-cooled-hx','asme-b31','asme-b31-1','asme-b31-12','asme-b31-3','asme-b31-4','asme-b31-5','asme-b31-8','asme-b31-9','asme-bpvc-i','asme-bpvc-iv','asme-bpvc-viii-1','asme-bpvc-viii-2','asme-bpvc-viii-3','asme-bpvc-x','asme-bpvc-xi','asme-bpvc-xii','asme-section-viii','batch-records-gmp-audit','boiler-startup','catalyst-handling-loading','columns-towers','confined-space-entry','cryogenic-vessels','directional-drilling','distillation-column-internals','document-control','epa-rmp-audit','expediting','fiber-optic-leak','fmea-rcm','hazardous-area-classification','heat-exchanger','heat-exchanger-inspection','hse-management','hydrostatic-test','iosh-managing','iso-14001-auditor','iso-17020-auditor','iso-17025-auditor','iso-45001-auditor','iso-9001-auditor','iso-iec-19011','ldar','mechanical-integrity','nebosh-diploma','nebosh-igc','osha-30','osha-510','osha-authorised-person','pha-hazop','pigging-ili','pipeline-coating','pipeline-construction','pipeline-hydrotest','pipeline-integrity','pipeline-pigging','pressure-relief','pressure-relief-devices','psm','qa-qc-management','qaqc-management','rcfa','reactor-vessel','rope-access-irata-sprat','safety-instrumented-systems','six-sigma-black','subsea-pipeline','vendor-surveillance','witness-inspection'
   ]::text[]
   AND COALESCE(deleted_at, NULL) IS NULL;
```

### `electrical` (5 groups, 99 disciplines)

```sql
SELECT count(*) AS eligible_inspectors
  FROM public.profiles
 WHERE role = 'inspector'
   AND specialty_slugs && ARRAY[
'asbestos-survey','automotive-mfg','battery-storage','cable-fault','cement-plant','cleanroom','combined-cycle','compex-ex01-04','compex-ex05-06','compex-ex11-12','compex-foundation','composites-aerospace','confined-space-entry','csp-solar','desalination','document-control','earthing-bonding','electrical-inspection','environmental-audit','ex-atex-iecex-inspection','expediting','fire-protection','fmea-rcm','food-pharma','fossil-power','geothermal','glass-manufacturing','hazardous-area-ex','high-voltage','hse-management','hydro-power','hydrogen-electrolyser','instrumentation','instrumentation-control','iosh-managing','iso-14001-auditor','iso-17020-auditor','iso-17025-auditor','iso-45001-auditor','iso-9001-auditor','iso-iec-19011','lead-paint','mining','ndt-ae','ndt-borescope','ndt-ct','ndt-dr','ndt-ecpit','ndt-et','ndt-ferrite','ndt-guided-wave','ndt-hardness','ndt-iris','ndt-irt','ndt-lt','ndt-mfl','ndt-mt','ndt-nrft','ndt-paut','ndt-pmi','ndt-pt','ndt-replication','ndt-rfet','ndt-rt','ndt-tofd','ndt-ut','ndt-vt','nebosh-diploma','nebosh-igc','nuclear-inspection','nuclear-power','osha-30','osha-510','osha-authorised-person','partial-discharge','plc-scada','power-generation-conventional','pulp-paper','qa-qc-management','qaqc-management','rail-track','rcfa','rope-access-irata-sprat','shipbuilding','six-sigma-black','solar-pv','sprinkler-nfpa','steel-mill','substation-audit','thermography-electrical','transmission-tower','tunneling','vendor-surveillance','water-treatment','wind-blade','wind-offshore','wind-onshore','wind-renewables','witness-inspection'
   ]::text[]
   AND COALESCE(deleted_at, NULL) IS NULL;
```

### `civil_construction` (5 groups, 104 disciplines)

```sql
SELECT count(*) AS eligible_inspectors
  FROM public.profiles
 WHERE role = 'inspector'
   AND specialty_slugs && ARRAY[
'asbestos-survey','asme-section-ix','automotive-mfg','aws-cawi','aws-cwe','aws-cwi','aws-cwsupervisor','aws-scwi','bgas-cswip-coating','blast-cleaning','brazing','bridge-inspection','cathodic-protection','cement-plant','cleanroom','composites-aerospace','concrete-inspection','confined-space-entry','corrosion-engineering','corrosion-monitoring','cswip-3-1','cswip-3-2','cswip-3-2-2','cui','desalination','document-control','environmental-audit','expediting','fcaw','fire-protection','fmea-rcm','food-pharma','foundation','frosio','galvanic-survey','galvanizing','geotechnical','glass-manufacturing','high-rise','hse-management','icorr-coatings','iosh-managing','iso-14001-auditor','iso-17020-auditor','iso-17025-auditor','iso-45001-auditor','iso-9001-auditor','iso-iec-19011','iwe','iws','iwt','lead-paint','masonry','metallurgy-materials-engineering','mig-gmaw','mining','nace-cip-1','nace-cip-2','nace-cip-3','nace-cp-1','nace-cp-2','nace-cp-3','nace-cp-4','nace-pcs-1','nace-pcs-2','nebosh-diploma','nebosh-igc','orbital-welding','osha-30','osha-510','osha-authorised-person','painting','post-tension','pulp-paper','qa-qc-management','qaqc-management','rail-track','rcfa','rebar-scanning','rope-access-irata-sprat','rope-access-l1','rope-access-l2','rope-access-l3','saw','scaffolding-inspector','seismic-assessment','shipbuilding','six-sigma-black','smaw','soil-testing','sprinkler-nfpa','sspc-bci','sspc-cas','sspc-pci','steel-mill','structural-steel','tank-foundation-bunds','tig-gtaw','tunneling','vendor-surveillance','water-treatment','welder-qualification','witness-inspection','wps-pqr'
   ]::text[]
   AND COALESCE(deleted_at, NULL) IS NULL;
```

**Launch-readiness target:** at least **5 eligible inspectors** before flipping `is_launched = true`. Below that, the first job posted in the new domain will see "no qualified inspectors" and erode client trust on day one.

### If the count is too low — what to do

- **Inspector outreach pass.** Reach out to existing inspectors whose adjacent specialties suggest they'd qualify (e.g. an inspector with `aws-cwi` and `api-510` is a strong candidate for mechanical_field). Ask them to update their specialty list from the inspector profile editor.
- **Seed credential-import campaign.** If you have a curated CSV of inspector credentials from a recent industry conference / NDT trade association, import via the existing inspector_certificates flow and prompt the inspector to confirm specialty mapping.
- **Hold the launch** until the pool clears 5. A premature launch is harder to recover from than a delayed one.

---

## STEP 3 — Inspector who covers the most templates

A useful sanity check before launch: of the eligible inspectors, who's the strongest match against the actual scope templates you'd post in this domain? Helps you identify a candidate to ask "would you accept the first job?" before flipping the switch.

```sql
-- The same ARRAY[…] from STEP 2 — paste it inside the && check below.
SELECT p.id, p.full_name, p.email,
       cardinality(p.specialty_slugs)                  AS total_specialties,
       cardinality(p.specialty_slugs & ARRAY[/* paste */]::text[]) AS domain_specialty_overlap
  FROM public.profiles p
 WHERE p.role = 'inspector'
   AND p.specialty_slugs && ARRAY[/* paste */]::text[]
   AND COALESCE(p.deleted_at, NULL) IS NULL
 ORDER BY domain_specialty_overlap DESC
 LIMIT 10;
```

> Note: `cardinality(arr1 & arr2)` requires `intarray` extension; if it's not enabled, expand the array via `unnest` and `JOIN` instead.

---

## STEP 4 — Smoke-test the consumer flow before launching

Do this with `is_launched` still `false`. The badge gating means consumer surfaces stay invisible; your goal is to verify the admin-side flow works end-to-end.

1. **Post a sample job from the client portal.** Sign in as a test client. From `/client/jobs/new`, post a job with `domain = '<DOMAIN>'`. Title it `[TEST – DO NOT FULFILL] <domain> launch smoke test`.
2. **Verify the job lands in the admin moderation queue.** Sign in as an admin. From `/admin/jobs`, confirm the new job is in `pending_review` and the domain pill shows the right badge.
3. **Approve the job for the marketplace.** Approve via the admin moderation drawer.
4. **Sign in as the strongest-match inspector from STEP 3.** Confirm the job is visible on `/inspector/jobs`. Confirm the `Apply` button works (don't actually apply — close the modal).
5. **Cancel the test job** from the client portal so it doesn't appear in production listings.

If any step in this sequence breaks, **do not flip `is_launched`** — fix the broken step first. Common breakage points: domain badge missing on `/admin/jobs` (look at the badge gating in `apps/web/src/components/admin/jobs/JobModerationPanel.tsx`), inspector match-engine filter excluding the new domain (look at `apps/web/src/lib/data/openJobs.ts`), domain-specific scope picker not surfacing the new templates (look at `apps/web/src/app/client/jobs/new/page.tsx`).

---

## STEP 5 — Launch

When STEP 1 numbers are good, STEP 2 count is ≥5, and STEP 4 smoke test passes:

```sql
UPDATE public.inspection_domains
   SET is_launched = true,
       updated_at = now()
 WHERE slug = '<DOMAIN>';
```

Or, equivalently, from `/admin/domains`, toggle the **Launched** switch on the domain card.

The change is immediate. `apps/web/src/lib/data/inspectionDomains.ts:fetchLaunchedDomainSlugs()` is called per-request (the consumer surfaces are `dynamic = 'force-dynamic'`), so the next page load surfaces the badge on jobs in this domain on the inspector + client job-detail pages.

---

## STEP 6 — Post-launch verification (first 24 h)

Spot-check daily for the first week, then weekly:

```sql
-- New jobs posted in this domain since launch
SELECT count(*) FROM public.jobs
 WHERE domain = '<DOMAIN>' AND created_at >= now() - interval '24 hours';

-- New applications in this domain
SELECT count(*) FROM public.job_applications a
 JOIN public.jobs j ON j.id = a.job_id
 WHERE j.domain = '<DOMAIN>' AND a.created_at >= now() - interval '24 hours';

-- Inspector profiles that added a relevant kebab specialty since launch
SELECT p.id, p.full_name, p.specialty_slugs
  FROM public.profiles p
 WHERE p.role = 'inspector'
   AND p.updated_at >= now() - interval '24 hours'
   AND p.specialty_slugs && ARRAY[/* domain disciplines from STEP 2 */]::text[];
```

If new-job volume in the domain stays at zero for the first two weeks, the launch is silent — usually means the customer-facing surfaces (marketing pages, sales outreach) haven't caught up. Loop back to a per-domain landing-page sprint.

---

## STEP 7 — Rollback (if needed)

A launch can be reversed safely at any time. The badge contract reads `is_launched` per-request, so flipping it back hides the new domain immediately on consumer surfaces; existing jobs already in flight continue to function (job-detail pages render the badge unconditionally when accessed by the assigned party).

```sql
-- Soft rollback — domain stays admin-visible but consumer-invisible
UPDATE public.inspection_domains
   SET is_launched = false, updated_at = now()
 WHERE slug = '<DOMAIN>';

-- Hard rollback — domain disappears from /admin/domains list too
UPDATE public.inspection_domains
   SET is_launched = false, is_active = false, updated_at = now()
 WHERE slug = '<DOMAIN>';
```

Hard rollback is rarely the right move — use it only if a security or content issue requires the domain card to be completely hidden from non-super-admin accounts.

---

## Per-launch retro log

After each domain launches, append a row here for institutional memory.

| Domain | Launched on | Eligible inspectors at launch | First job posted | First job filled | Notes |
|---|---|---|---|---|---|
| `industrial_ndt` | original launch | — | — | — | Platform default; launched with the system |
| `mechanical_field` | _pending_ | | | | |
| `chemical_process` | _pending_ | | | | |
| `electrical` | _pending_ | | | | |
| `civil_construction` | _pending_ | | | | |
