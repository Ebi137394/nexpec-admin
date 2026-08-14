/**
 * scripts/qa/staging-guard.mjs — refuse to act on NEXPEC Production.
 *
 * WHY
 *   Every destructive-capable operation in this repo (migration push, db reset,
 *   QA seeding) takes a target from an env var or a linked project ref. One
 *   wrong ref and the target is the live Production database. This module is the
 *   single chokepoint that makes that mistake impossible to make silently.
 *
 * HOW IT FAILS
 *   Loudly and by default. It throws unless the target is a KNOWN-SAFE ref. An
 *   unrecognised ref is refused too — "not obviously Production" is not the same
 *   as "safe", and a new project nobody has vetted should not be written to by a
 *   script that was written before it existed.
 *
 * DELIBERATELY NOT OVERRIDABLE BY AN ENV VAR.
 *   There is no ALLOW_PRODUCTION escape hatch. The whole value of this file is
 *   that it cannot be satisfied by a flag typed in a hurry. Production changes go
 *   through the documented manual procedure — backup, migration-history review,
 *   rollback review, explicit owner authorization — not through a script.
 */

/** NEXPEC Production. Never a valid target for anything in scripts/qa. */
export const PRODUCTION_REF = 'sxqpjxhslzzcdrdctatm';

/** Refs this repo's QA tooling is allowed to write to. */
export const SAFE_REFS = new Set([
  'zmzvmgaeovleuvbvwxei', // NEXPEC-Staging (ca-central-1, InspectaGlobe Inc)
]);

/** A URL or ref pointing at a local stack is always safe. */
function isLocal(target = '') {
  return /127\.0\.0\.1|localhost|^http:\/\/10\.|:54321|:54322/.test(target);
}

/** Pull a bare project ref out of a Supabase URL, or return the input. */
export function extractRef(target = '') {
  const m = String(target).match(/([a-z]{20})\.supabase\.(co|com)/);
  return m ? m[1] : String(target).trim();
}

/**
 * Throw unless `target` is safe to write to.
 * @param {string} target  a Supabase URL or a bare project ref
 * @param {string} action  what the caller is about to do, for the message
 */
export function assertNotProduction(target, action = 'this operation') {
  const raw = String(target ?? '');
  if (isLocal(raw)) return 'local';

  const ref = extractRef(raw);

  if (ref === PRODUCTION_REF) {
    throw new Error(
      `REFUSED: ${action} targets NEXPEC PRODUCTION (${PRODUCTION_REF}).\n` +
      'There is no override flag for this, on purpose. Production changes require a\n' +
      'verified backup, migration-history review, rollback review and explicit owner\n' +
      'authorization — not a script.',
    );
  }

  if (!SAFE_REFS.has(ref)) {
    throw new Error(
      `REFUSED: ${action} targets an UNRECOGNISED project ref "${ref}".\n` +
      'Only refs listed in SAFE_REFS may be written to. If this is a new staging\n' +
      'project, add it there deliberately — do not disable this check.',
    );
  }

  return ref;
}

/** CLI form: node staging-guard.mjs <urlOrRef> [action] */
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const kind = assertNotProduction(process.argv[2], process.argv[3] ?? 'CLI check');
    console.log(`ok: target is safe (${kind})`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
