// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/scopeTemplates.types.ts — non-server companion to
//  scopeTemplates.ts.
//
//  Next.js 15 strictly forbids non-async exports from any file marked
//  `'use server'`. The state shape + initial-state constant for the
//  scope-template form actions live here so the sibling server file
//  can stay async-only.
// ════════════════════════════════════════════════════════════════════════════

export interface ScopeTemplateFormState {
  ok: boolean;
  error: string | null;
  fieldErrors: Partial<Record<string, string>>;
  created?: { id: string; slug: string };
  updated?: { id: string; slug: string; newVersion: number };
}

export const scopeTemplateInitialState: ScopeTemplateFormState = {
  ok: false,
  error: null,
  fieldErrors: {},
};
