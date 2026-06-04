// src/hooks/useEngineeringTools.ts
//
// Data layer for the Tool Foundry (Phase 1). Pure hooks — no UI, no new screens.
// Feed the results straight into your existing JSON-driven list + DynamicForm.
//
// A tool row already carries its own input_schema (FormField[]) and output_schema,
// so listing the tools also gives you everything needed to render each form and
// project each result — no second round-trip.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import type { FormField } from '../components/DynamicForm/types';

export interface EngineeringTool {
  key: string;
  category: string;
  title: string;
  subtitle: string | null;
  icon_token: string | null;
  access_tier: 'free' | 'pro';
  engine: 'dsl' | 'edge';                  // 'dsl' = in-DB calculator; 'edge' = document generator
  input_schema: FormField[];               // renders directly through <DynamicForm/>
  output_schema: { cards?: Array<Record<string, any>> };
  standards_refs: string[];
}

/**
 * Lists all active tools (they are few; one fetch). Exposes the distinct
 * categories so your existing chip/filter row is fully data-driven — civil,
 * electrical, chemical chips appear automatically as you seed more rows.
 */
export function useEngineeringTools() {
  const [tools, setTools] = useState<EngineeringTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('engineering_tools')
      .select('key,category,title,subtitle,icon_token,access_tier,engine,input_schema,output_schema,standards_refs')
      .eq('is_active', true)
      .order('category', { ascending: true })
      .order('title', { ascending: true });
    if (error) setError(error.message);
    else setTools((data ?? []) as EngineeringTool[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const categories = useMemo(
    () => Array.from(new Set(tools.map((t) => t.category))).sort(),
    [tools],
  );

  /** Convenience client-side filter for a selected chip ('all' = everything). */
  const filterByCategory = useCallback(
    (category: string) => (category === 'all' ? tools : tools.filter((t) => t.category === category)),
    [tools],
  );

  return { tools, categories, filterByCategory, loading, error, refetch: load };
}
