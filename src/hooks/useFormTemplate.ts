// src/hooks/useFormTemplate.ts

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { FormField } from '../components/DynamicForm/types';

// Initialize Supabase client
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface FormTemplate {
  id: string;
  name: string;
  description?: string;
  fields: FormField[];
  created_at: string;
  updated_at: string;
}

interface UseFormTemplateReturn {
  template: FormTemplate | null;
  schema: FormField[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export const useFormTemplate = (templateId: string): UseFormTemplateReturn => {
  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplate = useCallback(async () => {
    if (!templateId) {
      setError('Template ID is required');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: supabaseError } = await supabase
        .from('form_templates')
        .select('*')
        .eq('id', templateId)
        .single();

      if (supabaseError) {
        throw new Error(supabaseError.message);
      }

      if (!data) {
        throw new Error('Template not found');
      }

      setTemplate(data as FormTemplate);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to fetch template';
      setError(errorMessage);
      console.error('Error fetching form template:', err);
    } finally {
      setIsLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    fetchTemplate();
  }, [fetchTemplate]);

  return {
    template,
    schema: template?.fields || [],
    isLoading,
    error,
    refetch: fetchTemplate,
  };
};

// Hook to fetch all templates (for listing)
export const useFormTemplates = () => {
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: supabaseError } = await supabase
        .from('form_templates')
        .select('*')
        .order('created_at', { ascending: false });

      if (supabaseError) {
        throw new Error(supabaseError.message);
      }

      setTemplates((data as FormTemplate[]) || []);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to fetch templates';
      setError(errorMessage);
      console.error('Error fetching form templates:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  return {
    templates,
    isLoading,
    error,
    refetch: fetchTemplates,
  };
};