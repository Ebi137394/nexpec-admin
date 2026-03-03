// src/hooks/useKnowledgeBase.ts

import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import type { KnowledgeDocument } from '../types/resources';

const CACHE_KEY_DOCS = '@nexpec_knowledge_cache';

export function useKnowledgeBase(refreshTrigger: number = 0) {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [docTypes, setDocTypes] = useState<string[]>(['All']);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOfflineData, setIsOfflineData] = useState(false);
  const isMounted = useRef(true);

  const processDocuments = useCallback((docs: KnowledgeDocument[]) => {
    const types = [
      'All',
      ...Array.from(new Set(docs.map((d) => d.type))).sort(),
    ];
    if (isMounted.current) {
      setDocuments(docs);
      setDocTypes(types);
    }
  }, []);

  const loadCachedData = useCallback(async () => {
    try {
      const cached = await AsyncStorage.getItem(CACHE_KEY_DOCS);
      if (cached) {
        const docs: KnowledgeDocument[] = JSON.parse(cached);
        processDocuments(docs);
        setIsOfflineData(true);
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }, [processDocuments]);

  const fetchFromSupabase = useCallback(async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from('knowledge_base')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;

      const docs: KnowledgeDocument[] = data || [];
      processDocuments(docs);
      setIsOfflineData(false);
      setError(null);

      await AsyncStorage.setItem(CACHE_KEY_DOCS, JSON.stringify(docs));
    } catch (err: any) {
      if (isMounted.current) {
        setError(err.message || 'Failed to load documents');
      }
      if (documents.length === 0) {
        await loadCachedData();
      }
    }
  }, [processDocuments, loadCachedData, documents.length]);

  const refetch = useCallback(async () => {
    if (isMounted.current) setLoading(true);
    await fetchFromSupabase();
    if (isMounted.current) setLoading(false);
  }, [fetchFromSupabase]);

  useEffect(() => {
    isMounted.current = true;
    let cancelled = false;

    (async () => {
      const hadCache = await loadCachedData();
      if (hadCache && isMounted.current) setLoading(false);
      await fetchFromSupabase();
      if (!cancelled && isMounted.current) setLoading(false);
    })();

    return () => {
      cancelled = true;
      isMounted.current = false;
    };
  }, [refreshTrigger]);

  return {
    documents,
    docTypes,
    loading,
    error,
    isOfflineData,
    refetch,
  };
}