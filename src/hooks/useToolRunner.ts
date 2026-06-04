// src/hooks/useToolRunner.ts
//
// Runs any tool through the single server RPC. The DSL math, validation, sealing
// and logging all happen in Postgres — this hook is just transport + state.
//
// Wire it to your existing DynamicForm:
//   const { run, running, result } = useToolRunner();
//   <DynamicForm schema={tool.input_schema}
//                isLoading={running}
//                submitButtonText="Calculate"
//                onSubmit={(values) => run(tool.key, values)} />
//   {result?.result_cards && /* render via your JSON-driven list */}

import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export interface ToolResultCard {
  label: string;
  value: string;     // already formatted/rounded by the server
  unit: string;
  tone: 'default' | 'success' | 'warn' | 'danger' | string;
}

export interface ToolResult {
  ok: boolean;
  locked?: boolean;                       // pro tool, user lacks entitlement
  error?: string;
  detail?: string;                        // human-readable validation/engine message
  tool?: string;
  title?: string;
  version?: number;
  computed_at?: string;
  inputs?: Record<string, any>;
  outputs?: Record<string, any>;
  result_cards?: ToolResultCard[];        // → render in your existing list
  citations?: string[];                   // standards refs to show under the result
  document?: Record<string, any>;         // structured payload from engine='edge' tools
  result_sha256?: string;                 // the trust-spine seal of this computation
}

export function useToolRunner() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ToolResult | null>(null);

  const run = useCallback(async (
    toolKey: string,
    inputs: Record<string, any>,
    engine: 'dsl' | 'edge' = 'dsl',
  ): Promise<ToolResult> => {
    setRunning(true);
    try {
      // engine='edge' tools (Auto WPS, ITP) execute in the tool-document edge
      // function; DSL calculators run in-database via tool_invoke. Same shape back.
      const { data, error } = engine === 'edge'
        ? await supabase.functions.invoke('tool-document', { body: { tool_key: toolKey, inputs: inputs ?? {} } })
        : await supabase.rpc('tool_invoke', { p_tool_key: toolKey, p_inputs: inputs ?? {} });
      const res: ToolResult = error
        ? { ok: false, error: 'network_error', detail: (error as any).message }
        : (data as ToolResult);
      setResult(res);
      return res;
    } finally {
      setRunning(false);
    }
  }, []);

  const reset = useCallback(() => setResult(null), []);

  return { run, running, result, reset };
}
