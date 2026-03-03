// ============================================
// NEXPEC TYPES INDEX
// ============================================
// Central export point for all core types

// Export all core types (main source of truth)
export * from './core';

// Re-export specific types from other files (only non-conflicting ones)
// Note: Profile, Job, and other core types are defined in core.ts
// These files may have additional utility types or older definitions
export type { ApplicationWithProfile, ApplicationWithJob, JobApplicationStats } from './application';
export type { MessageWithSender as MessageWithSenderUtil } from './message';
export type { CertificationType as CertificationTypeUtil } from './core';

