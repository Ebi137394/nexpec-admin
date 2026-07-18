// ════════════════════════════════════════════════════════════════════════════
//  src/legal/registry.ts
//
//  The single in-app source of truth for legal documents. Metadata lives
//  here; body markdown lives in bodies.ts (split so the metadata can be
//  loaded without parsing ~50KB of prose).
//
//  The Supabase legal_documents table (see migrations/20260513120000_*) is
//  the SYSTEM OF RECORD for audit and acceptance joins, but day-to-day
//  rendering uses this registry to avoid a roundtrip on every viewer mount.
//  Keep this file in sync with the canonical /legal/v1/*.md sources.
// ════════════════════════════════════════════════════════════════════════════

import type { LegalDocument, LegalDocumentId } from './types';
import { LEGAL_BODIES } from './bodies';

const buildDoc = (
  meta: Omit<LegalDocument, 'bodyMd'>,
): LegalDocument => ({
  ...meta,
  bodyMd: LEGAL_BODIES[meta.id],
});

export const LEGAL_DOCUMENTS: ReadonlyArray<LegalDocument> = [
  // ─────────── Tier 1 — Platform ───────────
  buildDoc({
    id: 'TOS-001',
    version: '1.1',
    language: 'en',
    title: 'Master Platform Terms of Service',
    tier: 1,
    role: null,
    status: 'draft',
    effectiveDate: null,
    plainEnglishSummary:
      'NEXPEC is a marketplace that connects Clients with Inspectors. We are a neutral platform — not an employer or inspection firm. 10% Platform Facilitation & Technology Fee on every contract. v1.1 adds a De-Identified Data & Platform-Improvement (AI/ML) licence.',
    incorporates: [],
  }),
  buildDoc({
    id: 'PRIV-001',
    version: '1.1',
    language: 'en',
    title: 'Privacy Policy',
    tier: 1,
    role: null,
    status: 'draft',
    effectiveDate: null,
    plainEnglishSummary:
      'We collect only what we need to run the platform. We do not sell your data. International transfers use Standard Contractual Clauses and equivalent mechanisms. v1.1 details account deletion and de-identified technical-data retention.',
    incorporates: [],
  }),
  buildDoc({
    id: 'AUP-001',
    version: '1.0',
    language: 'en',
    title: 'Acceptable Use Policy',
    tier: 1,
    role: null,
    status: 'draft',
    effectiveDate: null,
    plainEnglishSummary:
      'Use NEXPEC honestly. No fake credentials, fabricated reports, off-platform circumvention, or abusive behaviour.',
    incorporates: [{ id: 'TOS-001', version: '1.1' }],
  }),

  // ─────────── Tier 2 — Role Agreements ───────────
  buildDoc({
    id: 'INSP-AGR-001',
    version: '1.1',
    language: 'en',
    title: 'Inspector Agreement',
    tier: 2,
    role: 'inspector',
    status: 'draft',
    effectiveDate: null,
    plainEnglishSummary:
      'You are an independent contractor — not a NEXPEC employee. You decide where, when, and how you work, and you carry your own insurance, training, taxes, and PPE. v1.1 adds the De-Identified Technical Data clause.',
    incorporates: [
      { id: 'TOS-001', version: '1.1' },
      { id: 'PRIV-001', version: '1.1' },
      { id: 'AUP-001', version: '1.0' },
    ],
  }),
  buildDoc({
    id: 'AGN-AGR-001',
    version: '1.1',
    language: 'en',
    title: 'Agency Agreement',
    tier: 2,
    role: 'agency',
    status: 'draft',
    effectiveDate: null,
    plainEnglishSummary:
      'Your Agency is responsible for everyone on its roster — vetting, training, insuring, paying, and standing behind their work. NEXPEC does not vet your Inspectors. v1.1 adds the De-Identified Technical Data clause.',
    incorporates: [
      { id: 'TOS-001', version: '1.1' },
      { id: 'PRIV-001', version: '1.1' },
      { id: 'AUP-001', version: '1.0' },
    ],
  }),
  buildDoc({
    id: 'CLI-AGR-001',
    version: '1.1',
    language: 'en',
    title: 'Client Agreement',
    tier: 2,
    role: 'client',
    status: 'draft',
    effectiveDate: null,
    plainEnglishSummary:
      'You hire Inspectors directly — NEXPEC just makes the match. NEXPEC does not warrant Inspector work. You are responsible for site safety and your hiring decisions. v1.1 adds the De-Identified Technical Data clause.',
    incorporates: [
      { id: 'TOS-001', version: '1.1' },
      { id: 'PRIV-001', version: '1.1' },
      { id: 'AUP-001', version: '1.0' },
    ],
  }),
  buildDoc({
    id: 'ORG-AGR-001',
    version: '1.1',
    language: 'en',
    title: 'Organization Agreement',
    tier: 2,
    role: 'organization',
    status: 'draft',
    effectiveDate: null,
    plainEnglishSummary:
      'Enterprise account terms — multi-seat management, audit rights, data processing, and custom commercial Order Forms. Applies on top of the Client Agreement. v1.1 adds the processor-independent De-Identified Technical Data clause.',
    incorporates: [
      { id: 'TOS-001', version: '1.1' },
      { id: 'PRIV-001', version: '1.1' },
      { id: 'AUP-001', version: '1.0' },
      { id: 'CLI-AGR-001', version: '1.1' },
    ],
  }),
  buildDoc({
    id: 'SUP-AGR-001',
    version: '1.0',
    language: 'en',
    title: 'Supplier Agreement',
    tier: 2,
    role: 'supplier',
    status: 'draft',
    effectiveDate: null,
    plainEnglishSummary:
      'You supply goods or services through NEXPEC’s brokered, contract-first marketplace as an independent business. Prices are confidential and administered; you are paid through the payout-hold ledger after obligations are met. Accounts with open contracts, quotes, deliveries, payouts, disputes, or org ownership cannot be deleted.',
    incorporates: [
      { id: 'TOS-001', version: '1.1' },
      { id: 'PRIV-001', version: '1.1' },
      { id: 'AUP-001', version: '1.0' },
    ],
  }),

  // ─────────── Tier 3 — Per-Job ───────────
  buildDoc({
    id: 'JOB-TPL-001',
    version: '1.0',
    language: 'en',
    title: 'Job Contract Template',
    tier: 3,
    role: null,
    status: 'draft',
    effectiveDate: null,
    plainEnglishSummary:
      'The auto-generated contract between Client and Inspector for one Job. Supports three compensation models: fixed lump-sum, sequenced milestones, or recurring periodic billing for long-term engagements. NEXPEC is not a party — we host the contract and the payout hold.',
    incorporates: [
      { id: 'TOS-001', version: '1.1' },
      { id: 'INSP-AGR-001', version: '1.1' },
      { id: 'CLI-AGR-001', version: '1.1' },
      { id: 'PAYOUT-001', version: '1.0' },
    ],
  }),
  buildDoc({
    id: 'PAYOUT-001',
    version: '1.0',
    language: 'en',
    title: 'Payment & Payout Rider',
    tier: 3,
    role: null,
    status: 'draft',
    effectiveDate: null,
    plainEnglishSummary:
      'How the money works across three compensation models. Fixed: full upfront payout hold, single 7-day acceptance window. Milestone: staged funding, per-milestone 7-day acceptance. Recurring: rolling forward-funding for long-term retainers, per-period 7-day acceptance. Day-3 / Day-5 reminders and Day-7 auto-release apply to every disbursement-unit.',
    incorporates: [
      { id: 'TOS-001', version: '1.1' },
      { id: 'CLI-AGR-001', version: '1.1' },
      { id: 'INSP-AGR-001', version: '1.1' },
      { id: 'AGN-AGR-001', version: '1.1' },
      { id: 'JOB-TPL-001', version: '1.0' },
    ],
  }),

  // ─────────── Framework ───────────
  buildDoc({
    id: 'ADDENDUM-FRAMEWORK-001',
    version: '1.0',
    language: 'en',
    title: 'Country Addendum Framework',
    tier: 0,
    role: null,
    status: 'draft',
    effectiveDate: null,
    plainEnglishSummary:
      'How country-specific legal overlays attach to the master stack. Québec law applies by default; per-country addenda overlay only where mandatory local law requires it.',
    incorporates: [],
  }),

  // ───────── Country Addenda (9) ─────────
  buildDoc({
    id: 'ADDENDUM-CA-001',
    version: '1.0',
    language: 'en',
    title: 'Country Addendum — Canada',
    tier: 0,
    role: null,
    status: 'draft',
    effectiveDate: null,
    displayCategoryOverride: 'Country Addendum',
    activationStatus: 'draft',
    plainEnglishSummary:
      'Canada overlay: Bill 96 French versions, Law 25 + PIPEDA privacy, Québec consumer-protection forum carve-out, CASL marketing.',
    incorporates: [{ id: 'ADDENDUM-FRAMEWORK-001', version: '1.0' }],
  }),
  buildDoc({
    id: 'ADDENDUM-EU-001',
    version: '1.0',
    language: 'en',
    title: 'Country Addendum — European Union / EEA',
    tier: 0,
    role: null,
    status: 'draft',
    effectiveDate: null,
    displayCategoryOverride: 'Country Addendum',
    activationStatus: 'draft',
    plainEnglishSummary:
      'EU/EEA overlay: GDPR Article 28 + SCCs Module Two, EU Platform-to-Business Regulation, 14-day consumer right of withdrawal, Brussels I bis consumer-jurisdiction. EU Rep appointment required before activation.',
    incorporates: [{ id: 'ADDENDUM-FRAMEWORK-001', version: '1.0' }],
  }),
  buildDoc({
    id: 'ADDENDUM-UK-001',
    version: '1.0',
    language: 'en',
    title: 'Country Addendum — United Kingdom',
    tier: 0,
    role: null,
    status: 'draft',
    effectiveDate: null,
    displayCategoryOverride: 'Country Addendum',
    activationStatus: 'draft',
    plainEnglishSummary:
      'UK overlay: UK GDPR + IDTA in lieu of SCCs, UK Consumer Rights Act, UK worker-status reservation with indemnity hook. UK Rep appointment required before activation.',
    incorporates: [{ id: 'ADDENDUM-FRAMEWORK-001', version: '1.0' }],
  }),
  buildDoc({
    id: 'ADDENDUM-US-001',
    version: '1.0',
    language: 'en',
    title: 'Country Addendum — United States',
    tier: 0,
    role: null,
    status: 'draft',
    effectiveDate: null,
    displayCategoryOverride: 'Country Addendum',
    activationStatus: 'draft',
    plainEnglishSummary:
      'US multi-state overlay: CCPA/CPRA/VCDPA/CPA/CTDPA/UCPA, California ABC test reservation, class-action + mass-action waivers, optional binding arbitration.',
    incorporates: [{ id: 'ADDENDUM-FRAMEWORK-001', version: '1.0' }],
  }),
  buildDoc({
    id: 'ADDENDUM-GCC-001',
    version: '1.0',
    language: 'en',
    title: 'Country Addendum — GCC (KSA, UAE, Qatar)',
    tier: 0,
    role: null,
    status: 'draft',
    effectiveDate: null,
    displayCategoryOverride: 'Country Addendum',
    activationStatus: 'draft',
    plainEnglishSummary:
      'GCC overlay: KSA PDPL + UAE Federal Data Protection Law + Qatar PDPPL, Arabic-version mandate (KSA), Sharia overlay on interest/penalties, anti-corruption representations.',
    incorporates: [{ id: 'ADDENDUM-FRAMEWORK-001', version: '1.0' }],
  }),
  buildDoc({
    id: 'ADDENDUM-JP-001',
    version: '1.0',
    language: 'en',
    title: 'Country Addendum — Japan',
    tier: 0,
    role: null,
    status: 'draft',
    effectiveDate: null,
    displayCategoryOverride: 'Country Addendum',
    activationStatus: 'draft',
    plainEnglishSummary:
      'Japan overlay: APPI cross-border under PPC-Canada adequacy, Subcontracting Act reservation, Japanese-language consumer-pack, JCT via Stripe Tax.',
    incorporates: [{ id: 'ADDENDUM-FRAMEWORK-001', version: '1.0' }],
  }),
  buildDoc({
    id: 'ADDENDUM-KR-001',
    version: '1.0',
    language: 'en',
    title: 'Country Addendum — South Korea',
    tier: 0,
    role: null,
    status: 'draft',
    effectiveDate: null,
    displayCategoryOverride: 'Country Addendum',
    activationStatus: 'draft',
    plainEnglishSummary:
      'South Korea overlay: PIPA with mandatory local representative above thresholds, Korean platform-worker classification reservation, Korean-language consumer-pack, K-VAT.',
    incorporates: [{ id: 'ADDENDUM-FRAMEWORK-001', version: '1.0' }],
  }),
  buildDoc({
    id: 'ADDENDUM-IN-001',
    version: '1.0',
    language: 'en',
    title: 'Country Addendum — India',
    tier: 0,
    role: null,
    status: 'draft',
    effectiveDate: null,
    displayCategoryOverride: 'Country Addendum',
    activationStatus: 'draft',
    plainEnglishSummary:
      'India overlay: DPDP Act 2023, IT Act 2000 intermediary safe-harbour with Grievance Officer, GST + OIDAR via Stripe Tax, CPA 2019 consumer forum carve-out.',
    incorporates: [{ id: 'ADDENDUM-FRAMEWORK-001', version: '1.0' }],
  }),
  buildDoc({
    id: 'ADDENDUM-CN-001',
    version: '1.0',
    language: 'en',
    title: 'Country Addendum — China (scaffold-only)',
    tier: 0,
    role: null,
    status: 'draft',
    effectiveDate: null,
    displayCategoryOverride: 'Country Addendum',
    activationStatus: 'scaffold-only',
    plainEnglishSummary:
      'China overlay (NOT-FOR-ACTIVATION). PIPL + CSL + DSL high-friction regime; PRC Foreign Investment Negative List; signup-time gating enforced by marketGating.ts.',
    incorporates: [{ id: 'ADDENDUM-FRAMEWORK-001', version: '1.0' }],
  }),

  // ───────── Enterprise Templates (2) ─────────
  buildDoc({
    id: 'DPA-001',
    version: '1.0',
    language: 'en',
    title: 'Data Processing Addendum',
    tier: 2,
    role: 'organization',
    status: 'draft',
    effectiveDate: null,
    displayCategoryOverride: 'Data Processing',
    plainEnglishSummary:
      'Controller-processor DPA between Customer (Controller) and NEXPEC (Processor). GDPR Article 28 + UK GDPR + Law 25 + PIPEDA compatible. SCCs Module Two by reference. 60-day deletion-or-return election window.',
    incorporates: [
      { id: 'TOS-001', version: '1.1' },
      { id: 'PRIV-001', version: '1.1' },
      { id: 'ORG-AGR-001', version: '1.1' },
    ],
  }),
  buildDoc({
    id: 'ORDER-FORM-001',
    version: '1.0',
    language: 'en',
    title: 'Enterprise Order Form (Template)',
    tier: 2,
    role: 'organization',
    status: 'draft',
    effectiveDate: null,
    displayCategoryOverride: 'Enterprise Template',
    plainEnglishSummary:
      'Fill-in-the-blank Order Form for enterprise customers — overrides Master Stack on PFT discount, payment terms, SLA, data residency, dispute forum.',
    incorporates: [
      { id: 'ORG-AGR-001', version: '1.1' },
      { id: 'DPA-001', version: '1.0' },
    ],
  }),
];

// ─────────── Lookups ───────────

const BY_ID: Record<string, LegalDocument> = LEGAL_DOCUMENTS.reduce(
  (acc, d) => {
    acc[d.id] = d;
    return acc;
  },
  {} as Record<string, LegalDocument>,
);

/** Resolve a document by ID (current published version only). */
export function getLegalDocument(id: LegalDocumentId): LegalDocument | null {
  return BY_ID[id] ?? null;
}

/** All documents of a given tier (1, 2, 3, or 0 for framework). */
export function getLegalDocumentsByTier(
  tier: LegalDocument['tier'],
): LegalDocument[] {
  return LEGAL_DOCUMENTS.filter((d) => d.tier === tier);
}

/**
 * Display alias for the meta row of cards and the version pill of the
 * viewer. The canonical ID is preserved everywhere it matters for audit
 * (URL paths, acceptance ledger rows, incorporated_documents arrays);
 * the alias is purely a tighter visual affordance for the long
 * ADDENDUM-FRAMEWORK-001 ID.
 */
export function formatLegalDocumentDisplayId(id: string): string {
  if (id === 'ADDENDUM-FRAMEWORK-001') return 'ADDENDUM-FW-001';
  return id;
}
