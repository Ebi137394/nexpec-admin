# NEXPEC — Staging Environment Variable Checklist

*No values are included — names, scope, and provenance only. Set these in the STAGING scope of each platform (Vercel for web, EAS for mobile, shell/CI for tooling). Verified this pass: **no secret is exposed through a `NEXT_PUBLIC_` or `EXPO_PUBLIC_` prefix.***

## Legend
- **Scope:** web‑client (bundled to browser) · web‑server (server only) · mobile · CLI/worker
- **Class:** PUBLIC (safe to ship to client) · SECRET (server/worker only — never a public prefix)

---

## Web (Vercel → Project → Settings → Environment Variables → Preview/Staging)

| Name | Scope | Class | Req | Source of value | Read by | If missing |
|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | web‑client | PUBLIC | required | Supabase → Project Settings → API | `lib/supabase/*` | app can't reach DB/auth |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web‑client | PUBLIC | required | Supabase → API (anon) | `lib/supabase/*` | auth/data reads fail |
| `SUPABASE_SERVICE_ROLE_KEY` | web‑server | **SECRET** | required | Supabase → API (service_role) | `lib/actions/adminUserModeration.ts` (server) | admin password‑reset/admin ops fail |
| `NEXT_PUBLIC_SITE_URL` | web‑client | PUBLIC | required | staging domain | metadata, links, auth redirects | wrong absolute URLs / OAuth redirect mismatch |
| `NEXT_PUBLIC_BRIDGE_PORTAL_BASE_URL` | web‑client | PUBLIC | required | staging domain | coordination bridge links | broken vendor bridge links |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | web‑client | PUBLIC | required | Stripe (test) publishable | checkout client | payments UI can't init |
| `STRIPE_SECRET_KEY` | web‑server | **SECRET** | required | Stripe (test) secret | Stripe server calls / webhooks | payment server ops fail |
| `STRIPE_WEBHOOK_SIGNING_SECRET` | web‑server | **SECRET** | required | Stripe → Webhooks | webhook verify | webhook rejected/spoofable |
| `RESEND_API_KEY` | web‑server | **SECRET** | required (contact) | Resend | contact email dispatch | contact form emails fail |
| `RESEND_FROM_EMAIL` | web‑server | PUBLIC‑ish | required (contact) | verified sender | contact email | send fails / spam |
| `CONTACT_INBOX_EMAIL` | web‑server | config | optional | your inbox | contact routing | falls back |
| `OWNER_EMAILS` | web‑server | config | required | owner allow‑list | `admin/layout.tsx` gate | owner lockout fallback path |
| `NEXT_PUBLIC_VISION_MODEL_URL` | web‑client | PUBLIC | required (AI) | `/models/corrosion_yolo26s_seg_1024_fp32.tflite` | `lib/data/aiCoinspector.ts` | corrosion model won't load on web |
| `NEXT_PUBLIC_WDA_MODEL_URL` | web‑client | PUBLIC | required (AI) | `/models/wda_fissures_yolo26s_seg_1024_fp32.tflite` | `lib/data/aiCoinspector.ts` | WDA model won't load on web |
| `NEXT_PUBLIC_YOLOV9T_MODEL_URL` | web‑client | PUBLIC | required (AI) | `/models/yolov9t_2class_fp32.tflite` | `lib/data/aiCoinspector.ts` | detector won't load on web |
| `NEXT_PUBLIC_VISION_MODEL_SLUG` / `_VERSION` / `_SHA256` / `_LABELS` | web‑client | PUBLIC | optional | shared registry (env fallback only) | `lib/data/aiCoinspector.ts` | falls back to `ml_resolve_models` |

> **Add to `apps/web/.env.example`:** `NEXT_PUBLIC_YOLOV9T_MODEL_URL` (referenced in code + `scripts/ops/ai-model-env.md`, currently absent from the example). Minor doc gap — noted, not a blocker.

## Mobile (EAS → project secrets / `eas.json` staging profile)

| Name | Class | Req | Notes |
|---|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | PUBLIC | required | client Supabase |
| `EXPO_PUBLIC_WEB_URL` / `EXPO_PUBLIC_BRIDGE_PORTAL_BASE_URL` | PUBLIC | required | deep links |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | PUBLIC | required | payments UI |
| `EXPO_PUBLIC_ML_RUNTIME` / `EXPO_PUBLIC_ML_ALLOW_UNSIGNED` | PUBLIC | optional | on‑device ML flags (keep `ALLOW_UNSIGNED` **false** in staging/prod) |
| `EXPO_PUBLIC_ML_SIGNING_PUBKEY_PEM` | PUBLIC | required (signed models) | **public** key only |
| `EXPO_PUBLIC_SENTRY_DSN` | PUBLIC | optional | crash reporting |
| `SENTRY_ORG` / `SENTRY_PROJECT_MOBILE` / `EAS_PROJECT_ID` | CLI | optional | build tooling |

> Mobile models are **bundled** (Metro) — no model URL env needed on mobile.

## CLI / worker (shell or CI secrets — never committed)

| Name | Class | Used by |
|---|---|---|
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | **SECRET** | `scripts/ml/register-nexpec-models.sh`, `supabase` CLI (staging) |
| `STAGING_DB_URL` | **SECRET** | optional `psql` verification |

## Security assertions (verified this pass)
- ✅ No `SERVICE_ROLE` / `SECRET` / `PRIVATE` / `PASSWORD` behind any public prefix.
- ✅ `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SIGNING_SECRET`, `RESEND_API_KEY` are server‑only.
- ✅ `.env`, `.env.local`, `.env.*.local` are git‑ignored and untracked.
