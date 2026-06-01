// ════════════════════════════════════════════════════════════════════════════
//  passport/ — Verifiable Inspection Passport (VIP) contract
//
//  Typed view over the public get_inspection_passport() RPC + trust helpers.
//  Pure TS — consumed by the web /passport/[sealId] page and mobile alike.
// ════════════════════════════════════════════════════════════════════════════

export type AnchorStatus = 'pending' | 'submitted' | 'bitcoin_confirmed' | 'failed';

export interface InspectionPassport {
  seal: {
    id: string;
    rootSha256: string;
    algorithm: string;
    chainVerified: boolean;
    itemsCount: number;
    capturesCount: number;
    sealedAt: string;
  };
  // ANTI-POACHING: opaque inspector id only — never the name. Consumers derive a
  // pseudonymous handle/sigil from it and may cross-link to the anonymized card.
  inspector: { id: string };
  credentials: { certificationsValidAtSeal: number; equipmentInCalibrationAtSeal: number };
  anchor: { status: AnchorStatus; confirmedAt: string | null; calendar: string | null };
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : d);
const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d);
const ANCHOR_STATES: AnchorStatus[] = ['pending', 'submitted', 'bitcoin_confirmed', 'failed'];

/** Parse the RPC jsonb (snake_case) → typed passport. Returns null if malformed. */
export function parseInspectionPassport(data: unknown): InspectionPassport | null {
  const root = rec(data);
  const seal = rec(root.seal);
  if (!seal.id && !seal.root_sha256) return null;
  const insp = rec(root.inspector);
  const creds = rec(root.credentials);
  const anchor = rec(root.anchor);
  const status = str(anchor.status, 'pending');
  return {
    seal: {
      id: str(seal.id),
      rootSha256: str(seal.root_sha256),
      algorithm: str(seal.algorithm),
      chainVerified: bool(seal.chain_verified),
      itemsCount: num(seal.items_count),
      capturesCount: num(seal.captures_count),
      sealedAt: str(seal.sealed_at),
    },
    inspector: { id: str(insp.id) },
    credentials: {
      certificationsValidAtSeal: num(creds.certifications_valid_at_seal),
      equipmentInCalibrationAtSeal: num(creds.equipment_in_calibration_at_seal),
    },
    anchor: {
      status: (ANCHOR_STATES.includes(status as AnchorStatus) ? status : 'pending') as AnchorStatus,
      confirmedAt: typeof anchor.confirmed_at === 'string' ? anchor.confirmed_at : null,
      calendar: typeof anchor.calendar === 'string' ? anchor.calendar : null,
    },
  };
}

export function anchorLabel(s: AnchorStatus): string {
  switch (s) {
    case 'bitcoin_confirmed': return 'Anchored to Bitcoin — immutable';
    case 'submitted': return 'Submitted — awaiting Bitcoin confirmation';
    case 'failed': return 'Anchoring failed';
    default: return 'Pending anchor';
  }
}

export interface PassportVerdict { ok: boolean; notes: string[] }

export function passportTrustVerdict(p: InspectionPassport): PassportVerdict {
  const notes: string[] = [];
  notes.push(p.seal.chainVerified ? 'Capture chain verified — unaltered.' : 'Capture chain shows a break.');
  if (p.credentials.certificationsValidAtSeal > 0) notes.push(`${p.credentials.certificationsValidAtSeal} certification(s) valid at inspection time.`);
  if (p.credentials.equipmentInCalibrationAtSeal > 0) notes.push(`${p.credentials.equipmentInCalibrationAtSeal} equipment item(s) in calibration at inspection time.`);
  if (p.anchor.status === 'bitcoin_confirmed') notes.push('Independently anchored to the Bitcoin blockchain.');
  return { ok: p.seal.chainVerified, notes };
}

export function passportUrl(base: string, sealId: string): string {
  return `${base.replace(/\/$/, '')}/passport/${sealId}`;
}
