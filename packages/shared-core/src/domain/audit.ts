// ════════════════════════════════════════════════════════════════════════════
//  domain/audit.ts
//
//  Helpers for the Industrial Black Box. The audit_capture trigger reads
//  two GUCs (app.actor_intent + app.correlation_id) and writes them onto
//  every event row in audit_events. These helpers wrap the RPCs that set
//  those GUCs so client code never builds raw SQL.
// ════════════════════════════════════════════════════════════════════════════

import { _requireCore } from '../client/createCore';

/**
 * Set a human-readable intent for the next mutation in this transaction.
 * The audit trigger captures this verbatim onto the event row.
 *
 * Example:
 *   await auditSetIntent('Client requested fast-track quote');
 *   await supabase.from('jobs').update({...}).eq('id', jobId);
 *   → audit_events.intent = 'Client requested fast-track quote'
 */
export async function auditSetIntent(intent: string): Promise<void> {
  const { supabase } = _requireCore();
  // Errors here are non-fatal — the mutation still happens, just without
  // the intent annotation. Surface in dev logs for visibility.
  const { error } = await supabase.rpc('audit_set_intent', { p_intent: intent });
  if (error && typeof console !== 'undefined') {
    console.warn('[audit] audit_set_intent failed:', error.message);
  }
}

/**
 * Group a series of mutations under one correlation_id so the Command
 * Center can render them as a single logical user action.
 */
export async function auditSetCorrelation(correlationId: string): Promise<void> {
  const { supabase } = _requireCore();
  const { error } = await supabase.rpc('audit_set_correlation', {
    p_correlation_id: correlationId,
  });
  if (error && typeof console !== 'undefined') {
    console.warn('[audit] audit_set_correlation failed:', error.message);
  }
}

/**
 * Generate a v4-ish UUID without pulling in a runtime dependency.
 * Good enough for correlation IDs (collision odds <2^-122 across the
 * universe). Production code that needs cryptographic IDs should use
 * crypto.randomUUID() directly.
 */
export function newCorrelationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID.
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  const bytes = new Array(16).fill(0).map(() => Math.floor(Math.random() * 256));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const b = bytes.map((x) => hex(x ?? 0));
  return `${b[0]}${b[1]}${b[2]}${b[3]}-${b[4]}${b[5]}-${b[6]}${b[7]}-${b[8]}${b[9]}-${b[10]}${b[11]}${b[12]}${b[13]}${b[14]}${b[15]}`;
}
