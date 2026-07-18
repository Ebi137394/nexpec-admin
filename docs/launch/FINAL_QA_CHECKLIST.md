# NEXPEC — Final Manual QA / Acceptance-Test Checklist

Use this as your end-to-end acceptance document before staging → production. Test **web** (desktop + mobile browser) and **mobile app** (iOS + Android). Columns for every item: **Role · Action · Expected · Failure condition · Priority (P0 blocker / P1 high / P2 medium) · Blocks launch?**

Legend: P0 = must pass to launch · P1 = fix before or immediately after · P2 = post-launch acceptable.

---

## A. Authentication & Account

| Role | Action | Expected | Failure | Pri | Blocks |
|---|---|---|---|---|---|
| Any | Sign up (email) | Account created, role assigned, lands on role home | Error / wrong home / no confirm | P0 | Yes |
| Any | Sign in (email) | Session set, role-routed | Wrong portal / loop | P0 | Yes |
| Any | Sign in (Google / Apple / LinkedIn) | OAuth round-trips via `nexpec://oauth-callback` (mobile) / `/auth/callback` (web), signed in | Provider error / stuck | P0 | Yes |
| Any | Sign out | Session cleared, returns to sign-in | Session persists | P0 | Yes |
| Any | Forgot password → email link | Reset email arrives, link opens `reset-password` | No email / broken link | P0 | Yes |
| Any | Password reset | New password works, old fails | Reset fails | P0 | Yes |
| Any | Email verification | Verified state reflected | Never verifies | P1 | No |
| Any | Session expiration | Expired token → redirect to sign-in with `?next=` | White screen / crash | P1 | No |
| Any | Stale session (after deletion/ban) | Middleware clears `sb-*` cookies; no `AuthApiError` loop | Repeated 401 noise | P1 | No |
| Any | Role routing | Each role lands in its portal; cross-portal URL blocked | Cross-portal access | P0 | Yes |
| Any | Account settings load | Settings render with real data | Blank / 500 | P1 | No |
| Inspector/Client/Supplier/Agency/Enterprise | Delete Account (web Danger Zone + mobile Security) | Sign-in gate → confirm → anonymized + banned → signed out | Deletes with open obligations / no confirm | P0 | Yes |
| Admin / Super Admin | Attempt self-delete | Blocked: `ADMIN_NOT_SELF_DELETABLE` (UI + RPC + edge + trigger) | Any path succeeds | P0 | Yes |
| Platform Owner | Attempt delete/ban/suspend/demote via any path | Blocked: `PLATFORM_OWNER_PROTECTED`; owner keeps admin access | Any weakening succeeds | P0 | Yes |

---

## B. Role presence & isolation

| Role | Action | Expected | Failure | Pri | Blocks |
|---|---|---|---|---|---|
| Inspector | Login | Inspector dashboard; no client/admin data | Sees other-role data | P0 | Yes |
| Client | Login | Client portal (also used by Agency/Enterprise on web) | — | P0 | Yes |
| Supplier | Login | Supplier dashboard + Supplier settings | Missing supplier surfaces | P1 | No |
| Agency | Login | `/client` portal, agency data scope | Cross-org leakage | P0 | Yes |
| Enterprise | Login | `/client` portal + enterprise/org surfaces | — | P1 | No |
| Admin | Login | Admin console; env badge reads "PRODUCTION" | Badge says DEVELOPMENT | P1 | No |
| Super Admin | Login | Full admin; owner-failsafe via OWNER_EMAILS | Locked out | P0 | Yes |
| Platform Owner | Login | Unrestricted admin, all privileged ops audited | Missing audit rows | P0 | Yes |

---

## C. Inspector workflows

| Action | Expected | Failure | Pri | Blocks |
|---|---|---|---|---|
| Profile creation / edit | Saves; avatar uploads to `avatars/<uid>/` | Upload 0 bytes / RLS error | P0 | Yes |
| Qualifications / competencies | Saved, shown on trust card | Not persisted | P1 | No |
| Documents (CV/cert upload) | Uploads to private bucket; signed URL renders | 403 / broken image | P1 | No |
| Availability | Toggle persists | — | P2 | No |
| Job discovery | Open jobs list; price-blind (payout only) | Sees client price/margin | P0 | Yes |
| Applications / bids | Submit bid, admin sees it | Bid lost | P0 | Yes |
| Offers / counter-offers | Negotiation loop closes | Stuck state | P1 | No |
| Contracts | Sign job contract; "held on payment hold" copy | Wrong money copy | P1 | No |
| Job execution + AI capture | Camera → seg overlay on-device; offline outbox queues | Crash / lost captures | P0 | Yes |
| Reports / findings / NCR | Submit → routes to admin (not client) | Client sees pre-review | P0 | Yes |
| Photos & attachments | Upload non-zero; appear in report | 0-byte upload | P0 | Yes |
| Earnings / payments | Payout only; request payout → admin Mark-as-Paid | Auto-payout fires | P0 | Yes |
| Disputes | File → pauses payout release | Wrong pause semantics | P1 | No |
| Account deletion | Blocked if active job/wallet/payout/dispute; else "Former Inspector" | Deletes mid-engagement | P0 | Yes |

---

## D. Client workflows

| Action | Expected | Failure | Pri | Blocks |
|---|---|---|---|---|
| Company profile | Saves | — | P1 | No |
| Project / job posting | Post → admin review → auto-publishes on approve | Publishes unreviewed | P0 | Yes |
| Inspector selection | Admin-brokered; pseudonymous pre-reveal | Identity leaked early | P0 | Yes |
| Contracts | Sign & fund; "payment hold" copy | Wrong copy / no fund | P1 | No |
| Inspection monitoring | Status visible; own data only | Cross-client leak | P0 | Yes |
| Reports & deliverables | Visible only after admin confirm | Pre-confirm visibility | P0 | Yes |
| Invoices | Correct amounts; own invoices only | Wrong totals | P0 | Yes |
| Payments / refunds | Stripe test path; refund via dispute | Charge error | P0 | Yes |
| Disputes | File → pauses payout release | — | P1 | No |
| Account deletion | Blocked if active job/invoice/dispute/org-owner; else "Former Client" | Deletes with open invoice | P0 | Yes |

---

## E. Supplier workflows

| Action | Expected | Failure | Pri | Blocks |
|---|---|---|---|---|
| Onboarding + Supplier Agreement | SUP-AGR-001 surfaced & accepted | No supplier agreement | P1 | No |
| Profile & documents | Saves; vendor docs to private bucket | 403 | P1 | No |
| Quotes | Submit; client sees administered offer only (price-blind) | Raw price leaked | P0 | Yes |
| Supplier contracts | Two-party e-sign → `executed` | Money before executed | P0 | Yes |
| Deliveries | Tracked against contract | — | P2 | No |
| Earnings / payouts / wallet | Payout-hold ledger; halalas==cents | Mint / wrong math | P0 | Yes |
| Invoices | Correct | — | P1 | No |
| Disputes | Handled | — | P1 | No |
| Org ownership | Owner-transfer required before delete | — | P1 | No |
| Account deletion restrictions | Blocked on contract/quote/earnings/withdrawal/dispute/org (`SUPPLIER_*`, `ORG_*`) | Deletes with open contract | P0 | Yes |

---

## F. Agency & Enterprise workflows

| Action | Expected | Failure | Pri | Blocks |
|---|---|---|---|---|
| Organization creation | Org created, owner = creator | — | P1 | No |
| Membership / invitations | Invite → join (note: prod = read-only roster per MEMORY) | Self-serve invite if disabled | P1 | No |
| Ownership transfer | Reassign owner before owner can delete | Orphaned org | P1 | No |
| Team roles (owner/procurement_admin/project_lead/viewer) | Scoped access | Over-broad access | P1 | No |
| Projects / contracts | Org-scoped visibility | Cross-org leak | P0 | Yes |
| Billing / reporting | Rollups correct | Wrong figures | P1 | No |
| Account deletion | Blocked if org owner/owner-member; else "Former Agency/Enterprise User" | Deletes owning org | P0 | Yes |

---

## G. Admin platform

| Action | Expected | Failure | Pri | Blocks |
|---|---|---|---|---|
| User management | List/search users; moderate non-admins | Can anonymize admin | P0 | Yes |
| Role management | Promote/demote non-owner; last-super-admin protected | Demote last super_admin | P0 | Yes |
| Project / contract oversight | Full visibility | — | P1 | No |
| Payment oversight / Mark-as-Paid | Manual payout release | Auto-release | P0 | Yes |
| Dispute handling | Resolve; state transitions valid | Stuck disputes | P1 | No |
| Audit logs | Privileged ops appear in `audit_events` | Missing rows | P0 | Yes |
| Legal document management | v1.1 docs + SUP-AGR-001 render | Stale versions | P1 | No |
| Security monitoring / Sentry | Errors captured | No telemetry | P1 | No |
| Platform Owner protection | Owner un-deletable everywhere | Any weakening | P0 | Yes |
| Environment badge | "PRODUCTION" in prod | "DEVELOPMENT" | P1 | No |
| Production-only controls | No debug banners/screens | Dev UI visible | P1 | No |

---

## H. Business & financial records (post-deletion integrity)

| Action | Expected | Failure | Pri | Blocks |
|---|---|---|---|---|
| After a test deletion, open a retained job/contract/report/invoice referencing that user | Loads; shows "Former {Role}" tombstone; no FK error | Broken record / FK violation | P0 | Yes |
| Wallets / earnings / payouts / refunds | Retained; ledger intact | Data loss | P0 | Yes |
| Taxes | Retained per law | Purged | P0 | Yes |
| Disputes / NCRs | Retained | Lost | P0 | Yes |
| Audit history | Immutable, complete | Mutable/gap | P0 | Yes |

---

## I. AI features & technical data

| Action | Expected | Failure | Pri | Blocks |
|---|---|---|---|---|
| Capture upload | Non-zero, signed, queued | 0-byte | P0 | Yes |
| On-device inference | Seg overlay, no cloud dependency | Crash/no output | P1 | No |
| Detection records (`ai_detections`) | Written with model slug/version/sha | Missing provenance | P1 | No |
| Technical image retention | Retained per license | — | P1 | No |
| De-identification | GPS/EXIF/face removed before AI retention | Personal data retained raw | P1 | No |
| AI dataset provenance (`ai_dataset_provenance`) | Row written w/ legal basis + de-id state | Not tracked | P2 | No |
| Access controls | Admin-read only | Client-readable | P1 | No |
| Failure handling | Queue retries; no data loss | Silent drop | P1 | No |

---

## J. Files & storage

| Action | Expected | Failure | Pri | Blocks |
|---|---|---|---|---|
| Avatars / resumes | Upload to `<uid>/`; private where required | Public leak | P1 | No |
| User / supplier / project docs | Private buckets; signed URLs | 403 / public | P1 | No |
| Inspection images / report attachments | Retained business evidence | Lost | P0 | Yes |
| Signed agreements / invoice docs | Retained | Lost | P1 | No |
| Storage access permissions | RLS/owner-folder enforced | Cross-user read | P0 | Yes |
| Personal-file cleanup on deletion | `avatars/<uid>/`, `resumes/<uid>/` purged; evidence preserved | Evidence deleted OR personal file orphaned | P1 | No |

---

## K. Notifications & communication

| Action | Expected | Failure | Pri | Blocks |
|---|---|---|---|---|
| Email (Resend) | Delivered; no PII over-share | Not sent | P1 | No |
| Push notifications | Received; tap routes correctly | No route | P1 | No |
| In-app notifications | Unread badge; mark-read | Stuck unread | P2 | No |
| Reminders | Fire on schedule | Missed | P2 | No |
| Failed notification handling | Retried/logged | Silent fail | P2 | No |
| Duplicate prevention | Approval push deduped | Double push | P1 | No |

---

## L. UI & product quality

| Action | Expected | Failure | Pri | Blocks |
|---|---|---|---|---|
| Mobile responsiveness (web 320/768/1440) | No overflow/clipping | Broken layout | P1 | No |
| iPhone / Android app layouts | Native layout correct incl. hardware back | Clipping/crash | P1 | No |
| Tablet / desktop layouts | Usable | Broken | P2 | No |
| Loading / empty / error states | Present everywhere | Blank/spinner-forever | P1 | No |
| Accessibility | Labels, contrast, focus order (VoiceOver/TalkBack, axe/Lighthouse) | Fails a11y | P1 | No |
| Broken links / missing pages | All internal links resolve | 404 | P1 | No |
| Labels / terminology | "payment hold" (not escrow) in user copy; correct role names | Stale copy | P1 | No |
| Placeholder / dev-only UI | None in production | Visible | P1 | No |
| Console errors | Clean in prod build | Errors/warnings | P1 | No |

---

## Automated coverage vs manual

**Automated (green as of this audit):** TS typecheck (web/mobile/shared), ESLint (web), 4 CI guards (db-refs, rls-admin, outbox-routing, price-blindness). These cover: type safety, RPC/relation references, admin RLS coverage, offline write routing, price-blindness.

**Manual-only (no automated coverage — must be tested by a human):** every runtime flow above, on-device AI capture/offline/sync, real Stripe test-mode payment E2E incl. 7-day acceptance cadence, OAuth per provider, push delivery, responsiveness, accessibility, and the account-deletion role matrix against a live DB.
