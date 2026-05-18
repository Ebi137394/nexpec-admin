// ════════════════════════════════════════════════════════════════════════════
//  src/legal/useAcceptances.ts
//
//  Read + write hook for the legal_document_acceptances ledger. Powers the
//  "Accepted v1.0 · 2026-MM-DD" version badge on each document viewer.
//
//  Write semantics: append-only, unique on (user_id, document_id, version,
//  language). Re-accepting an already-accepted (id, version) is a no-op
//  (Supabase upsert with ON CONFLICT DO NOTHING via the unique constraint).
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type {
  LegalDocumentAcceptance,
  LegalDocumentId,
  LegalLanguage,
  LegalUserRole,
} from './types';

interface UseAcceptancesResult {
  acceptances: LegalDocumentAcceptance[];
  loading: boolean;
  error: string | null;
  /** True if the user has accepted (documentId, version, language). */
  hasAccepted: (
    documentId: LegalDocumentId,
    version: string,
    language?: LegalLanguage,
  ) => boolean;
  /** Get the acceptance record for (documentId, version, language) or null. */
  getAcceptance: (
    documentId: LegalDocumentId,
    version: string,
    language?: LegalLanguage,
  ) => LegalDocumentAcceptance | null;
  /** Record an acceptance. Idempotent. */
  accept: (
    documentId: LegalDocumentId,
    version: string,
    opts?: {
      language?: LegalLanguage;
      roleAtAcceptance?: LegalUserRole | null;
    },
  ) => Promise<void>;
  /** Re-fetch acceptances from the server. */
  refresh: () => Promise<void>;
}

export function useAcceptances(userId: string | null | undefined): UseAcceptancesResult {
  const [acceptances, setAcceptances] = useState<LegalDocumentAcceptance[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAcceptances = useCallback(async () => {
    if (!userId) {
      setAcceptances([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: dbErr } = await supabase
        .from('legal_document_acceptances')
        .select(
          'id,user_id,document_id,document_version,language,accepted_at,role_at_acceptance',
        )
        .eq('user_id', userId)
        .order('accepted_at', { ascending: false });

      if (dbErr) throw dbErr;

      const mapped: LegalDocumentAcceptance[] = (data ?? []).map((row: any) => ({
        id: row.id,
        userId: row.user_id,
        documentId: row.document_id as LegalDocumentId,
        documentVersion: row.document_version,
        language: (row.language ?? 'en') as LegalLanguage,
        acceptedAt: row.accepted_at,
        roleAtAcceptance: row.role_at_acceptance ?? null,
      }));
      setAcceptances(mapped);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load acceptances');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void fetchAcceptances();
  }, [fetchAcceptances]);

  const hasAccepted = useCallback(
    (
      documentId: LegalDocumentId,
      version: string,
      language: LegalLanguage = 'en',
    ): boolean =>
      acceptances.some(
        (a) =>
          a.documentId === documentId &&
          a.documentVersion === version &&
          a.language === language,
      ),
    [acceptances],
  );

  const getAcceptance = useCallback(
    (
      documentId: LegalDocumentId,
      version: string,
      language: LegalLanguage = 'en',
    ): LegalDocumentAcceptance | null =>
      acceptances.find(
        (a) =>
          a.documentId === documentId &&
          a.documentVersion === version &&
          a.language === language,
      ) ?? null,
    [acceptances],
  );

  const accept = useCallback(
    async (
      documentId: LegalDocumentId,
      version: string,
      opts?: {
        language?: LegalLanguage;
        roleAtAcceptance?: LegalUserRole | null;
      },
    ) => {
      if (!userId) {
        throw new Error('[legal/useAcceptances] cannot accept without userId');
      }
      const language = opts?.language ?? 'en';
      // Insert is idempotent thanks to the UNIQUE (user_id, document_id,
      // document_version, language) constraint — duplicate inserts return a
      // 23505 which we swallow.
      const { error: dbErr } = await supabase
        .from('legal_document_acceptances')
        .insert({
          user_id: userId,
          document_id: documentId,
          document_version: version,
          language,
          role_at_acceptance: opts?.roleAtAcceptance ?? null,
        });

      if (dbErr && (dbErr as any).code !== '23505') {
        throw dbErr;
      }
      await fetchAcceptances();
    },
    [userId, fetchAcceptances],
  );

  return {
    acceptances,
    loading,
    error,
    hasAccepted,
    getAcceptance,
    accept,
    refresh: fetchAcceptances,
  };
}
