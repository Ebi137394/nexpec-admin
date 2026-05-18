// ════════════════════════════════════════════════════════════════════════════
//  app/profile/document/[id].tsx — Single legal document viewer (Checkpoint 4)
//
//  Resolves the document by its `id` URL param (e.g. /profile/document/TOS-001)
//  against the in-app registry, fetches the user's acceptance state for that
//  (id, version) tuple, and renders via LegalDocumentViewer. Incorporated-doc
//  chips deep-link back into this same screen.
// ════════════════════════════════════════════════════════════════════════════

import React, { useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/src/contexts/AuthContext';
import { LegalDocumentViewer } from '@/src/components/legal/LegalDocumentViewer';
import { getLegalDocument } from '@/src/legal/registry';
import { useAcceptances } from '@/src/legal/useAcceptances';
import type { LegalDocumentId, LegalUserRole } from '@/src/legal/types';
import { supabase } from '@/lib/supabase';

export default function LegalDocumentRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();

  const document = useMemo(
    () => (id ? getLegalDocument(id as LegalDocumentId) : null),
    [id],
  );

  const userId = session?.user?.id ?? null;
  const { getAcceptance, accept } = useAcceptances(userId);

  const [accepting, setAccepting] = useState<boolean>(false);

  const acceptedAt = document
    ? getAcceptance(document.id, document.version)?.acceptedAt ?? null
    : null;

  const handleAccept = async () => {
    if (!document || !userId) return;
    setAccepting(true);
    try {
      // Snapshot the user's role at acceptance time for the audit ledger.
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();
      const role = (data?.role as LegalUserRole | null) ?? null;

      await accept(document.id, document.version, {
        language: document.language,
        roleAtAcceptance: role,
      });
    } finally {
      setAccepting(false);
    }
  };

  return (
    <LegalDocumentViewer
      document={document}
      acceptedAt={acceptedAt}
      accepting={accepting}
      onAccept={userId ? handleAccept : undefined}
      onIncorporatedPress={(docId) =>
        router.push(`/profile/document/${docId}` as any)
      }
    />
  );
}
