// lib/chat.ts
import { supabase } from '@/src/core/supabase/supabase';

export async function startOrGetConversation(
  jobId: string,
  clientId: string, // Changed from employerId to match DB concept
  workerId: string
): Promise<string | null> {
  try {
    // 1. Check if conversation already exists
    // Note: We use .maybeSingle() instead of .single() to avoid error if not found
    const { data: existing, error: fetchError } = await supabase
      .from('conversations')
      .select('id')
      .eq('job_id', jobId)
      .eq('client_id', clientId) // ✅ Correct column name
      .eq('contractor_id', workerId)
      .maybeSingle(); 

    if (existing) {
      return existing.id;
    }

    // 2. Create new conversation if none exists
    const { data: newConversation, error } = await supabase
      .from('conversations')
      .insert({
        job_id: jobId,
        client_id: clientId, // ✅ Correct column name
        worker_id: workerId,
        last_message: 'Conversation started', // Optional initial state
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      // If error is unique constraint violation (race condition), try fetching again
      if (error.code === '23505') {
        const { data: retry } = await supabase
          .from('conversations')
          .select('id')
          .eq('job_id', jobId)
          .eq('client_id', clientId)
          .eq('contractor_id', workerId)
          .single();
        return retry?.id || null;
      }
      throw error;
    }

    return newConversation?.id || null;
  } catch (error) {
    console.error('Error starting conversation:', error);
    return null;
  }
}

