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
