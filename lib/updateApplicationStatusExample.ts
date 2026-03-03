/**
 * CORRECTED & IMPROVED VERSION: updateStatus function
 * 
 * This shows the recommended way to update application status.
 * Use this pattern in your components.
 */

import { supabase } from './supabase';
import { updateApplicationStatus } from './applications';
import { showAlert } from './alert';
import {
  ApplicationStatus,
  ApplicationStatusUpdatePayload,
  APPLICATION_STATUS_CONFIG,
} from '@/types/application';

/**
 * RECOMMENDED: Using the helper function (better practice)
 * This version uses the existing updateApplicationStatus helper which:
 * - Is type-safe
 * - Has proper error handling
 * - Can include rejection_reason
 * - Is already tested
 */
export const updateStatusRecommended = async (
  applicationId: string,
  newStatus: ApplicationStatus,
  reason?: string,
  onSuccess?: () => void
): Promise<void> => {
  try {
    const payload: ApplicationStatusUpdatePayload = {
      status: newStatus,
      rejection_reason: reason || null,
    };

    const { error } = await updateApplicationStatus(applicationId, payload);

    if (error) throw error;

    // Show success message
    const statusLabel = APPLICATION_STATUS_CONFIG[newStatus].label;
    showAlert(
      'Status Updated',
      `Application has been marked as "${statusLabel}".`,
      onSuccess
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update status';
    showAlert('Error', message);
    throw error; // Re-throw so caller can handle if needed
  }
};

/**
 * ALTERNATIVE: Direct Supabase update (simpler but less features)
 * Use this if you don't need rejection_reason or other advanced features
 */
export const updateStatusSimple = async (
  applicationId: string,
  newStatus: ApplicationStatus,
  onRefresh?: () => void
): Promise<void> => {
  try {
    // 1. Update Supabase
    const { error } = await supabase
      .from('applications')
      .update({ status: newStatus })
      .eq('id', applicationId);

    if (error) throw error;

    // 2. Show success message
    const statusLabel = APPLICATION_STATUS_CONFIG[newStatus].label;
    showAlert(
      'Status Updated',
      `Application has been marked as "${statusLabel}".`
    );

    // 3. Refresh the local list (if callback provided)
    if (onRefresh) {
      onRefresh();
    }
  } catch (error) {
    console.error('Update status error:', error);
    const message = error instanceof Error ? error.message : 'Could not update status';
    showAlert('Error', message);
    throw error;
  }
};

/**
 * EXAMPLE: Usage in a component
 * 
 * ```typescript
 * import { updateStatusRecommended } from '@/lib/updateApplicationStatusExample';
 * 
 * const ManageApplicants = () => {
 *   const [applications, setApplications] = useState<ApplicationWithProfile[]>([]);
 *   const [loading, setLoading] = useState(false);
 * 
 *   const fetchApplicants = async () => {
 *     setLoading(true);
 *     try {
 *       const { data, error } = await getJobApplications(jobId);
 *       if (error) throw error;
 *       setApplications(data || []);
 *     } catch (error) {
 *       showAlert('Error', 'Failed to load applicants');
 *     } finally {
 *       setLoading(false);
 *     }
 *   };
 * 
 *   const handleUpdateStatus = async (
 *     id: string,
 *     newStatus: ApplicationStatus,
 *     reason?: string
 *   ) => {
 *     try {
 *       // Update in database
 *       await updateStatusRecommended(id, newStatus, reason);
 * 
 *       // Optimistically update local state
 *       setApplications(prev => prev.map(app =>
 *         app.id === id
 *           ? { ...app, status: newStatus, rejection_reason: reason || null }
 *           : app
 *       ));
 * 
 *       // Optionally refresh to ensure sync
 *       // fetchApplicants();
 *     } catch (error) {
 *       // Error already shown by updateStatusRecommended
 *       // Optionally revert optimistic update here
 *     }
 *   };
 * 
 *   return (
 *     <FlatList
 *       data={applications}
 *       renderItem={({ item }) => (
 *         <ApplicantCardSimple
 *           application={item}
 *           onUpdateStatus={(id, status) => handleUpdateStatus(id, status)}
 *         />
 *       )}
 *     />
 *   );
 * };
 * ```
 */

/**
 * EXAMPLE: With optimistic updates and error recovery
 */
export const updateStatusWithOptimistic = async (
  applicationId: string,
  newStatus: ApplicationStatus,
  currentApplications: any[],
  setApplications: (apps: any[]) => void,
  onRefresh?: () => void
): Promise<void> => {
  // Store previous state for rollback
  const previousApplications = [...currentApplications];

  // 1. Optimistically update UI
  setApplications(
    currentApplications.map(app =>
      app.id === applicationId
        ? { ...app, status: newStatus }
        : app
    )
  );

  try {
    // 2. Update Supabase
    const { error } = await supabase
      .from('applications')
      .update({ status: newStatus })
      .eq('id', applicationId);

    if (error) throw error;

    // 3. Show success
    const statusLabel = APPLICATION_STATUS_CONFIG[newStatus].label;
    showAlert('Status Updated', `Application marked as "${statusLabel}".`);

    // 4. Optionally refresh to ensure sync
    if (onRefresh) {
      onRefresh();
    }
  } catch (error) {
    // 5. Rollback on error
    setApplications(previousApplications);
    
    const message = error instanceof Error ? error.message : 'Could not update status';
    showAlert('Error', message);
    throw error;
  }
};

