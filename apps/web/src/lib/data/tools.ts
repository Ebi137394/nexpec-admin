// ════════════════════════════════════════════════════════════════════════════
//  lib/data/tools.ts — web data layer for the Engineering Tool Foundry
//
//  Mirrors the mobile hooks (src/hooks/useEngineeringTools.ts + useToolRunner.ts)
//  against the SAME platform-agnostic backend — identical table
//  (engineering_tools), identical RPC (tool_invoke) and edge function
//  (tool-document). The only difference is the transport: the web browser
//  Supabase client. The DSL math, validation, sealing and logging all happen in
//  Postgres, so this layer is just transport + types.
// ════════════════════════════════════════════════════════════════════════════
'use client';

import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

const sb = () => createSupabaseBrowserClient();

// ── Field schema (mirror of mobile DynamicForm FormField) ──
export interface ToolFieldOption {
  label: string;
  value: string;
}
export interface ToolField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'photo' | 'video' | 'signature' | 'date' | 'document';
  required?: boolean;
  placeholder?: string;
  options?: ToolFieldOption[];
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    patternMessage?: string;
  };
  defaultValue?: string | number;
  helperText?: string;
}

// ── Tool row (mirror of EngineeringTool) ──
export interface EngineeringTool {
  key: string;
  category: string;
  title: string;
  subtitle: string | null;
  icon_token: string | null;
  access_tier: 'free' | 'pro';
  engine: 'dsl' | 'edge'; // 'dsl' = in-DB calculator; 'edge' = document generator
  input_schema: ToolField[];
  output_schema: { cards?: Array<Record<string, unknown>> };
  standards_refs: string[];
}

// ── Result envelope (mirror of useToolRunner.ToolResult) ──
export interface ToolResultCard {
  label: string;
  value: string; // already formatted/rounded by the server
  unit?: string;
  tone?: 'default' | 'success' | 'warn' | 'danger' | string;
}
export interface ToolResult {
  ok: boolean;
  locked?: boolean; // pro tool, user lacks entitlement
  error?: string;
  detail?: string; // human-readable validation/engine message
  tool?: string;
  title?: string;
  version?: number;
  computed_at?: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  result_cards?: ToolResultCard[];
  citations?: string[];
  document?: Record<string, unknown>;
  result_sha256?: string; // the trust-spine seal of this computation
}

/**
 * Lists all active tools (they are few; one fetch). Every row already carries
 * its own input_schema + output_schema, so listing also gives everything needed
 * to render each form and project each result — no second round-trip.
 */
export async function fetchEngineeringTools(): Promise<EngineeringTool[]> {
  const { data, error } = await sb()
    .from('engineering_tools')
    .select('key,category,title,subtitle,icon_token,access_tier,engine,input_schema,output_schema,standards_refs')
    .eq('is_active', true)
    .order('category', { ascending: true })
    .order('title', { ascending: true });
  if (error) throw error;
  return (data ?? []) as EngineeringTool[];
}

/**
 * Runs any tool through the single server entry point. engine='edge' tools
 * (Auto WPS, ITP) execute in the tool-document edge function; DSL calculators
 * run in-database via tool_invoke. Same shape back either way.
 */
export async function runTool(
  toolKey: string,
  inputs: Record<string, unknown>,
  engine: 'dsl' | 'edge' = 'dsl',
): Promise<ToolResult> {
  const client = sb();
  const { data, error } =
    engine === 'edge'
      ? await client.functions.invoke('tool-document', {
          body: { tool_key: toolKey, inputs: inputs ?? {} },
        })
      : await client.rpc('tool_invoke', { p_tool_key: toolKey, p_inputs: inputs ?? {} });
  if (error) {
    return { ok: false, error: 'network_error', detail: (error as { message?: string }).message };
  }
  return data as ToolResult;
}

// ── Presentation helpers (mirror mobile CAT_LABEL / CAT_COLOR) ──
export const CAT_LABEL: Record<string, string> = {
  all: 'All',
  ndt: 'NDT',
  welding: 'Welding',
  mechanical: 'Mechanical',
  civil: 'Civil',
  electrical: 'Electrical',
  chemical: 'Chemical',
  industrial: 'Industrial',
  general: 'General',
  document: 'Document',
};
export const CAT_COLOR: Record<string, string> = {
  ndt: '#7C3AED',
  welding: '#F59E0B',
  mechanical: '#3B82F6',
  civil: '#10B981',
  electrical: '#06B6D4',
  chemical: '#EF4444',
  industrial: '#8B5CF6',
  general: '#64748B',
  document: '#0EA5E9',
};
export const catLabel = (c: string): string => CAT_LABEL[c] ?? c;
export const catColor = (c: string): string => CAT_COLOR[c] ?? '#7C3AED';
