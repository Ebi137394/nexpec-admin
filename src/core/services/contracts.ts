// lib/contracts.ts
// Utility functions for contract operations

import { supabase } from '@/src/core/supabase/supabase';

interface HireContractorParams {
  jobId: string;
  contractorId: string;
  propertyOwnerId: string;
  proposalId?: string;
  bidAmount?: number; // In your app this is passed, but we save it to 'price' DB column
  jobPrice?: number;
}

export async function hireContractor(params: HireContractorParams) {
  const { jobId, contractorId, propertyOwnerId, proposalId, bidAmount } = params;

  try {
    // 1. Calculate Price Logic
    let finalPrice = bidAmount;

    // If no price passed from UI, fetch from Job Budget in DB
    if (!finalPrice || finalPrice <= 0) {
      console.log('Price is missing/zero, fetching job budget...');
      const { data: job } = await supabase
        .from('jobs')
        .select('client_price_cents, budget_cents')  // SCHEMA: jobs has no price/budget; the real columns are *_cents.
        .eq('id', jobId)
        .single();
      
      // Use Price, then Budget, then fallback to 100 to prevent crash
      // The real columns are CENTS; `price`/`budget` never existed, so this
      // fallback silently always resolved to the hard-coded 100.
      finalPrice = (job as any)?.client_price_cents || (job as any)?.budget_cents || 100;
    }

    const safePrice = finalPrice && finalPrice > 0 ? finalPrice : 100;
    console.log(`Hiring with price: ${safePrice}`);

    // 2. Insert Contract
    // We send data to BOTH 'price' and 'amount' to satisfy the app's requirements
    const { data, error } = await supabase
      .from('contracts')
      .insert({
        job_id: jobId,
        contractor_id: contractorId,
        worker_id: contractorId,     // For legacy app code
        client_id: propertyOwnerId,
        status: 'in_progress',
        price: safePrice,
        amount: safePrice,           // For legacy app code
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Contract Insert Error:', error);
      
      // RETRY LOGIC: If 'amount' or 'worker_id' columns are missing in DB, try insertion without them
      if (error.message?.includes('amount') || error.message?.includes('worker_id')) {
         console.log('Retrying insert with minimal columns...');
         const { data: retryData, error: retryError } = await supabase.from('contracts').insert({
            job_id: jobId,
            contractor_id: contractorId,
            client_id: propertyOwnerId,
            status: 'in_progress',
            price: safePrice,
         }).select().single();
         
         if (retryError) return { success: false, error: retryError.message };
         return { success: true, contractId: retryData?.id };
      }
      return { success: false, error: error.message };
    }

    // 3. Update Statuses
    if (proposalId) {
      await supabase.from('proposals').update({ status: 'accepted' }).eq('id', proposalId);
    }
    await supabase.from('jobs').update({ status: 'in_progress' }).eq('id', jobId);

    return { success: true, contractId: data.id };

  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function handleHirePress(
  jobId: string,
  contractorId: string,
  propertyOwnerId: string,
  proposalId: string,
  bidAmount: number,
  onSuccess?: () => void,
  onError?: (msg: string) => void
) {
  const result = await hireContractor({ jobId, contractorId, propertyOwnerId, proposalId, bidAmount });
  if (result.success) onSuccess?.();
  else onError?.(result.error || 'Failed');
}
