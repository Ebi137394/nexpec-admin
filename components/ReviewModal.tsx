import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  X,
  Star,
  CheckCircle2,
  AlertCircle,
  User,
  Sparkles,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { showAlert } from '@/lib/alert';

// ============================================================================
// TYPES
// ============================================================================

export interface ReviewModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  jobId: string;
  jobTitle: string;
  inspectorId: string;
  inspectorName: string;
  inspectorAvatar?: string | null;
}

interface StarRatingProps {
  rating: number;
  onRatingChange: (rating: number) => void;
  disabled?: boolean;
  size?: number;
}

// ============================================================================
// RATING CONFIG
// ============================================================================

const RATING_LABELS: Record<number, { text: string; color: string; emoji: string }> = {
  0: { text: 'Tap a star to rate', color: '#94A3B8', emoji: '' },
  1: { text: 'Poor', color: '#EF4444', emoji: '😞' },
  2: { text: 'Below Average', color: '#F97316', emoji: '😕' },
  3: { text: 'Average', color: '#F59E0B', emoji: '😊' },
  4: { text: 'Good', color: '#22C55E', emoji: '😄' },
  5: { text: 'Excellent!', color: '#10B981', emoji: '🤩' },
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

const StarRating: React.FC<StarRatingProps> = ({
  rating,
  onRatingChange,
  disabled = false,
  size = 48,
}) => {
  const stars = [1, 2, 3, 4, 5];

  return (
    <View style={styles.starRow}>
      {stars.map((star) => {
        const isFilled = star <= rating;

        return (
          <TouchableOpacity
            key={star}
            onPress={() => !disabled && onRatingChange(star)}
            activeOpacity={disabled ? 1 : 0.6}
            style={styles.starTouchable}
            disabled={disabled}
          >
            <Star
              size={size}
              color={isFilled ? '#FBBF24' : '#E2E8F0'}
              fill={isFilled ? '#FBBF24' : 'transparent'}
              strokeWidth={1.5}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const RatingFeedback: React.FC<{ rating: number }> = ({ rating }) => {
  const config = RATING_LABELS[rating] || RATING_LABELS[0];

  return (
    <View style={styles.ratingFeedback}>
      {config.emoji ? (
        <Text style={styles.ratingEmoji}>{config.emoji}</Text>
      ) : null}
      <Text style={[styles.ratingText, { color: config.color }]}>
        {config.text}
      </Text>
    </View>
  );
};

interface InspectorCardProps {
  name: string;
  avatar?: string | null;
}

const InspectorCard: React.FC<InspectorCardProps> = ({ name, avatar }) => (
  <View style={styles.inspectorCard}>
    {avatar ? (
      <Image source={{ uri: avatar }} style={styles.inspectorAvatar} />
    ) : (
      <View style={[styles.inspectorAvatar, styles.inspectorAvatarPlaceholder]}>
        <User size={28} color="#64748B" />
      </View>
    )}
    <View style={styles.inspectorInfo}>
      <Text style={styles.inspectorLabel}>Rate your experience with</Text>
      <Text style={styles.inspectorName}>{name}</Text>
    </View>
  </View>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const ReviewModal: React.FC<ReviewModalProps> = ({
  visible,
  onClose,
  onSuccess,
  jobId,
  jobTitle,
  inspectorId,
  inspectorName,
  inspectorAvatar,
}) => {
  // State
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal visibility changes
  useEffect(() => {
    if (visible) {
      setRating(0);
      setComment('');
      setError(null);
      setIsSubmitting(false);
    }
  }, [visible]);

  // Handle close
  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    onClose();
  }, [isSubmitting, onClose]);

  // Validate before submit
  const canSubmit = rating > 0 && !isSubmitting;

  // Submit handler
  const handleSubmit = useCallback(async () => {
    if (!canSubmit) {
      setError('Please select a rating');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('You must be signed in to submit a review');
      }

      // Check if review already exists
      const { data: existingReview } = await supabase
        .from('reviews')
        .select('id')
        .eq('job_id', jobId)
        .eq('reviewer_id', user.id)
        .eq('reviewee_id', inspectorId)
        .maybeSingle();

      if (existingReview) {
        // Update existing review
        const { error: updateError } = await supabase
          .from('reviews')
          .update({
            rating,
            comment: comment.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingReview.id);

        if (updateError) {
          console.error('Review update error:', updateError);
          throw new Error('Failed to update review. Please try again.');
        }

        showAlert(
          'Review Updated!',
          `Your review for ${inspectorName} has been updated successfully.`,
          () => {
            onClose();
            onSuccess?.();
          }
        );
        return;
      }

      // TRANSACTION: Update job status + Insert review
      // Step 1: Update job status to 'completed'
      const { error: jobUpdateError } = await supabase
        .from('jobs')
        .update({ 
          status: 'completed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)
        .eq('client_id', user.id); // Ensure user owns this job

      if (jobUpdateError) {
        console.error('Job update error:', jobUpdateError);
        throw new Error('Failed to complete the job. Please try again.');
      }

      // Step 2: Insert review
      const { error: reviewError } = await supabase.from('reviews').insert({
        job_id: jobId,
        reviewer_id: user.id,
        reviewee_id: inspectorId,
        rating,
        comment: comment.trim() || null,
      });

      if (reviewError) {
        console.error('Review insert error:', reviewError);
        
        // Attempt rollback
        await supabase
          .from('jobs')
          .update({ status: 'in_progress' })
          .eq('id', jobId);

        throw new Error('Failed to submit review. Please try again.');
      }

      // Success!
      showAlert(
        '🎉 Job Completed!',
        `Thank you for rating ${inspectorName}. Your review helps other clients make informed decisions.`,
        () => {
          onClose();
          onSuccess?.();
        }
      );
    } catch (err) {
      console.error('Submit error:', err);
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }, [canSubmit, jobId, inspectorId, rating, comment, inspectorName, onClose, onSuccess]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleClose}
            style={styles.closeButton}
            disabled={isSubmitting}
            activeOpacity={0.7}
          >
            <X size={24} color={isSubmitting ? '#CBD5E1' : '#0F172A'} />
          </TouchableOpacity>
          
          <Text style={styles.headerTitle}>Complete Job</Text>
          
          <View style={styles.headerPlaceholder} />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
        >
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            {/* Success Banner */}
            <View style={styles.successBanner}>
              <View style={styles.successIconContainer}>
                <Sparkles size={24} color="#22C55E" />
              </View>
              <View style={styles.successTextContainer}>
                <Text style={styles.successTitle}>Great news!</Text>
                <Text style={styles.successSubtitle} numberOfLines={2}>
                  {jobTitle}
                </Text>
              </View>
            </View>

            {/* Inspector Card */}
            <InspectorCard name={inspectorName} avatar={inspectorAvatar} />

            {/* Star Rating Section */}
            <View style={styles.ratingSection}>
              <StarRating
                rating={rating}
                onRatingChange={setRating}
                disabled={isSubmitting}
              />
              <RatingFeedback rating={rating} />
            </View>

            {/* Comment Input */}
            <View style={styles.commentSection}>
              <View style={styles.commentLabelRow}>
                <Text style={styles.commentLabel}>Write a review</Text>
                <Text style={styles.optionalBadge}>Optional</Text>
              </View>
              
              <TextInput
                style={[
                  styles.commentInput,
                  isSubmitting && styles.commentInputDisabled,
                ]}
                placeholder="Share details about your experience..."
                placeholderTextColor="#94A3B8"
                value={comment}
                onChangeText={setComment}
                multiline
                numberOfLines={4}
                maxLength={500}
                editable={!isSubmitting}
                textAlignVertical="top"
              />
              
              <Text style={styles.charCounter}>
                {comment.length}/500
              </Text>
            </View>

            {/* Error Display */}
            {error && (
              <View style={styles.errorBanner}>
                <AlertCircle size={18} color="#EF4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </ScrollView>

          {/* Footer with Submit Button */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[
                styles.submitButton,
                !canSubmit && styles.submitButtonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={!canSubmit}
              activeOpacity={0.8}
            >
              {isSubmitting ? (
                <View style={styles.submitButtonContent}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.submitButtonText}>Submitting...</Text>
                </View>
              ) : (
                <View style={styles.submitButtonContent}>
                  <CheckCircle2 size={22} color="#FFFFFF" />
                  <Text style={styles.submitButtonText}>Complete & Submit Review</Text>
                </View>
              )}
            </TouchableOpacity>

            <Text style={styles.footerDisclaimer}>
              This will mark the job as complete and send your rating to {inspectorName}
            </Text>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  closeButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#0F172A',
  },
  headerPlaceholder: {
    width: 40,
  },

  // Keyboard & Scroll
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 32,
  },

  // Success Banner
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  successIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#DCFCE7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  successTextContainer: {
    flex: 1,
    marginLeft: 14,
  },
  successTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#16A34A',
    marginBottom: 2,
  },
  successSubtitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0F172A',
    lineHeight: 20,
  },

  // Inspector Card
  inspectorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 16,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  inspectorAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  inspectorAvatarPlaceholder: {
    backgroundColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  inspectorInfo: {
    flex: 1,
    marginLeft: 14,
  },
  inspectorLabel: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 3,
  },
  inspectorName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },

  // Rating Section
  ratingSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  starRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  starTouchable: {
    padding: 4,
  },
  ratingFeedback: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ratingEmoji: {
    fontSize: 24,
  },
  ratingText: {
    fontSize: 18,
    fontWeight: '600',
  },

  // Comment Section
  commentSection: {
    marginBottom: 20,
  },
  commentLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  commentLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1E293B',
  },
  optionalBadge: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94A3B8',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginLeft: 8,
    overflow: 'hidden',
  },
  commentInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    fontSize: 15,
    lineHeight: 22,
    color: '#1E293B',
    minHeight: 120,
  },
  commentInputDisabled: {
    backgroundColor: '#F1F5F9',
    color: '#94A3B8',
  },
  charCounter: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'right',
    marginTop: 8,
  },

  // Error
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorText: {
    fontSize: 14,
    color: '#DC2626',
    flex: 1,
    lineHeight: 20,
  },

  // Footer
  footer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 8 : 20,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  submitButton: {
    backgroundColor: '#22C55E',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#CBD5E1',
  },
  submitButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  submitButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  footerDisclaimer: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 18,
  },
});

export default ReviewModal;
