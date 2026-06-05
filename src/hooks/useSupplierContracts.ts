// src/hooks/useSupplierContracts.ts
//
// Data + actions for the Supplier Agreement (the signed Supplier↔NEXPEC contract
// that must be EXECUTED before any brokered release fires). Mirrors the web
// lib/data + lib/actions supplierContracts layer. RLS scopes reads to the
// authenticated supplier (supplier_id = auth.uid()); the sign RPC enforces the
// state machine server-side.

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export type SupplierContractStatus =
  | 'draft'
  | 'pending_supplier_signature'
  | 'pending_admin_countersignature'
  | 'executed'
  | 'voided';

export interface SupplierContract {
  id: string;
  quote_id: string;
  rfq_id: string | null;
  job_id: string | null;
  supplier_id: string;
  amount_cents: number;
  status: SupplierContractStatus;
  contract_text_md: string | null;
  custom_contract_url: string | null;
  supplier_signed_at: string | null;
  supplier_signed_name: string | null;
  admin_signed_at: string | null;
  admin_signed_name: string | null;
  content_sha256: string | null;
  executed_at: string | null;
  created_at: string;
  rfq_title?: string | null;
}

const COLS =
  'id, quote_id, rfq_id, job_id, supplier_id, amount_cents, status, contract_text_md, custom_contract_url, supplier_signed_at, supplier_signed_name, admin_signed_at, admin_signed_name, content_sha256, executed_at, created_at';

async function hydrateTitles(rows: SupplierContract[]): Promise<SupplierContract[]> {
  const ids = Array.from(
    new Set(rows.map((r) => r.rfq_id).filter((x): x is string => !!x)),
  );
  if (ids.length === 0) return rows;
  try {
    const { data } = await supabase
      .from('supplier_rfqs')
      .select('id, title')
      .in('id', ids);
    const map = new Map(
      ((data ?? []) as Array<{ id: string; title: string | null }>).map((r) => [
        r.id,
        r.title,
      ]),
    );
    return rows.map((r) => ({
      ...r,
      rfq_title: r.rfq_id ? map.get(r.rfq_id) ?? null : null,
    }));
  } catch {
    return rows;
  }
}

export function useMySupplierContracts() {
  const [items, setItems] = useState<SupplierContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('supplier_contracts')
      .select(COLS)
      .neq('status', 'voided')
      .order('created_at', { ascending: false });
    if (err) {
      setError(err.message);
      setItems([]);
    } else {
      setItems(await hydrateTitles((data ?? []) as SupplierContract[]));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { items, loading, error, refetch: load };
}

export function useSupplierContract(id?: string) {
  const [contract, setContract] = useState<SupplierContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('supplier_contracts')
      .select(COLS)
      .eq('id', id)
      .maybeSingle();
    if (err) {
      setError(err.message);
      setContract(null);
    } else if (data) {
      const [hydrated] = await hydrateTitles([data as SupplierContract]);
      setContract(hydrated ?? (data as SupplierContract));
    } else {
      setContract(null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return { contract, loading, error, refetch: load };
}

/** Supplier e-signs the agreement. Server enforces party + state + name length. */
export async function signSupplierContract(
  contractId: string,
  typedName: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = (typedName ?? '').trim();
  if (trimmed.length < 2) {
    return { ok: false, error: 'Enter your full legal name to sign.' };
  }
  const { error } = await supabase.rpc('supplier_sign_contract', {
    p_contract_id: contractId,
    p_typed_name: trimmed,
    p_ip: null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
