// ════════════════════════════════════════════════════════════════════════════
//  @nexpec/shared-core — public API
//
//  This package is the cross-platform spine of NEXPEC. It contains:
//
//    - net/           Retry-wrapped Supabase RPC helpers (network-resilient
//                     critical writes for mobile + web).
//    - storage/       Signed-URL minting + Supabase storage URL parsing.
//    - domain/        Pure business logic: status enums, legal transition
//                     tables, money helpers, audit-intent helpers.
//    - schemas/       Zod schemas for every state-machine mutation. One
//                     source of truth used by every form on every platform.
//    - client/        Factory that binds the package to a Supabase client
//                     instance. Mobile and web each call this once at boot.
//
//  PHILOSOPHICAL RULE: nothing in this package may import from `react`,
//  `react-native`, `next`, or any platform shell. If it does, it belongs in
//  the consumer, not here.
// ════════════════════════════════════════════════════════════════════════════

export * from './client/createCore';
export * from './client/getCore';
export * from './net/supabaseRetry';
export * from './storage/signedUrls';
export * from './domain/jobStatus';
export * from './domain/money';
export * from './domain/audit';
export * from './schemas/jobs';
export * from './schemas/disputes';
export * from './schemas/payouts';
export * from './schemas/credentials';
export * from './schemas/moderation';
export * from './schemas/settings';
export * from './schemas/organizations';
// Layer 4 / Layer 5 — multi-domain expansion. Exposes inspection-domain
// slugs, icon-key enum, display meta map, and the getInspectionDomainMeta()
// accessor that both mobile (src/components/shared/InspectionDomainBadge)
// and web (apps/web/src/components/inspection-domain/InspectionDomainBadge)
// rely on. Without this line, Next.js TS-strict rejected the import in the
// web badge and the apps/web Vercel build failed at compile-time even though
// schemas/index.ts itself already re-exported the module.
export * from './schemas/inspectionDomain';

// Phase 0 (Layer 5 finish) — unified canonical specialty taxonomy.
// Both surfaces (apps/web and src/) re-export from this module so the
// kebab-case slug inventory, group titles, descriptions, and synonyms
// stay perfectly aligned. Migration 20260622120000_unify_specialty_slugs_kebab.sql
// backfills any legacy snake_case slugs in jobs.specialty_slugs and
// profiles.specialty_slugs to their kebab canonical equivalents.
export * from './data/specialtyTaxonomy';

// Phase A.5 — on-device Model Runtime + signed model-registry contracts.
// Pure-TS types, canonical signing serialization, the fail-closed integrity
// gate (verifyDownloadedArtifact), Zod validation of the ml_resolve_models RPC,
// and the typed registry client. Consumed by mobile (src/core/ml) and web.
// Additive only — no existing export is touched.
export * from './ml';
export * from './aiops';

// Secret weapons — Verifiable Inspection Passport, Predictive Integrity (RBI),
// and the Voice Copilot's $0 transcript→defect NLU. Pure-TS, additive.
export * from './passport';
export * from './integrity/rbi';
// P2.2 — Predictive-Integrity risk scorer. Consumes the inspector_integrity_analytics
// RPC (P2.1) → one 0–100 integrity_risk_score per inspector with an explainable
// component breakdown. Pure statistics, $0, platform-agnostic.
export * from './integrity/riskScore';
export * from './voice/transcriptToDefects';

// P3 — Stripe webhook integrity: signature verification + claim-then-process
// idempotency decisions. Pure, dependency-injected, strictly unit-tested.
export * from './payments/stripeWebhook';

// P3 — Observability: PII scrubbing for Sentry beforeSend/beforeBreadcrumb on
// both platforms + safe (non-PII) instrumentation tags. Pure, unit-tested.
export * from './observability/scrub';

// P3 — Offline-sync error taxonomy. Pure classification of the errors thrown
// while draining the mobile outbox against Supabase (auth-expiry vs conflict vs
// transient vs fatal) + the SyncConflictError handlers raise on a 0-row write.
// Drives the drain loop's "never abandon good field data on a token blip"
// behavior. Pure, unit-tested; consumed by mobile src/core/offline.
export * from './offline/syncErrors';
