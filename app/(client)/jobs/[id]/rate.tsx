import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Image,
  Platform,
  Keyboard,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Star,
  ChevronLeft,
  Send,
  User,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Heart,
  ThumbsUp,
  MessageSquare,
  Award,
  X,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { showAlert, showConfirm } from '@/lib/alert';

// ============================================================================
// TYPES
// ============================================================================

interface InspectorInfo {
  inspector_id: string;
  inspector_name: string;
  inspector_avatar: string | null;
  inspector_rating: number;
  inspector_reviews: number;
  job_id: string;
  job_title: string;
}

interface ReviewabilityCheck {
  can_review: boolean;
  reason?: string;
  review_id?: string;
  job_id?: string;
  job_title?: string;
  inspector_id?: string;
  inspector_name?: string;
  inspector_avatar?: string;
  inspector_rating?: number;
  inspector_reviews?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const RATING_LABELS: Record<number, { label: string; emoji: string; color: string }> = {
  0: { label: 'Tap to rate', emoji: '', color: '#94A3B8' },
  1: { label: 'Poor', emoji: '😞', color: '#EF4444' },
  2: { label: 'Fair', emoji: '😕', color: '#F97316' },
  3: { label: 'Good', emoji: '😊', color: '#EAB308' },
  4: { label: 'Very Good', emoji: '😄', color: '#22C55E' },
  5: { label: 'Excellent!', emoji: '🤩', color: '#10B981' },
};

const QUICK_COMMENTS = [
  'Very professional and thorough',
  'Great communication throughout',
  'On time and efficient',
  'Detailed inspection report',
  'Highly recommend!',
  'Excellent attention to detail',
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// Header Component
interface HeaderProps {
  onBack: () => void;
  onSkip: () => void;
  canSkip: boolean;
}

const Header: React.FC<HeaderProps> = ({ onBack, onSkip, canSkip }) => (
  <View style={styles.header}>
    <TouchableOpacity onPress={onBack} style={styles.headerBtn} activeOpacity={0.7}>
      <ChevronLeft size={28} color="#0F172A" />
    </TouchableOpacity>
    
    <Text style={styles.headerTitle}>Rate Inspector</Text>
    
    {canSkip ? (
      <TouchableOpacity onPress={onSkip} style={styles.skipBtn} activeOpacity={0.7}>
        <Text style={styles.skipBtnText}>Skip</Text>
      </TouchableOpacity>
    ) : (
      <View style={styles.headerBtn} />
    )}
  </View>
);

// Inspector Profile Card
interface InspectorCardProps {
  inspector: InspectorInfo;
}

const InspectorCard: React.FC<InspectorCardProps> = ({ inspector }) => (
  <View style={styles.inspectorCard}>
    <View style={styles.inspectorAvatarContainer}>
      {inspector.inspector_avatar ? (
        <Image source={{ uri: inspector.inspector_avatar }} style={styles.inspectorAvatar} />
      ) : (
        <View style={[styles.inspectorAvatar, styles.avatarPlaceholder]}>
          <User size={40} color="#64748B" />
        </View>
      )}
      <View style={styles.avatarBadge}>
        <CheckCircle2 size={20} color="#22C55E" fill="#FFFFFF" />
      </View>
    </View>

    <Text style={styles.inspectorName}>{inspector.inspector_name}</Text>
    
    <View style={styles.inspectorStats}>
      <View style={styles.statItem}>
        <Star size={16} color="#FBBF24" fill="#FBBF24" />
        <Text style={styles.statValue}>
          {(inspector.inspector_rating || 0).toFixed(1)}
        </Text>
      </View>
      <View style={styles.statDivider} />
      <Text style={styles.statLabel}>
        {inspector.inspector_reviews || 0} reviews
      </Text>
    </View>

    <View style={styles.jobBadge}>
      <Text style={styles.jobBadgeText} numberOfLines={1}>
        {inspector.job_title}
      </Text>
    </View>
  </View>
);

// Animated Star Rating Component
interface StarRatingProps {
  rating: number;
  onRatingChange: (rating: number) => void;
  disabled?: boolean;
  size?: number;
}

const StarRating: React.FC<StarRatingProps> = ({
  rating,
  onRatingChange,
  disabled = false,
  size = 48,
}) => {
  const stars = [1, 2, 3, 4, 5];
  const scaleAnims = useRef(stars.map(() => new Animated.Value(1))).current;

  const handlePress = (starValue: number) => {
    if (disabled) return;

    // Animate the pressed star
    Animated.sequence([
      Animated.timing(scaleAnims[starValue - 1], {
        toValue: 1.3,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnims[starValue - 1], {
        toValue: 1,
        friction: 3,
        tension: 100,
        useNativeDriver: true,
      }),
    ]).start();

    onRatingChange(starValue);
  };

  const ratingConfig = RATING_LABELS[rating];

  return (
    <View style={styles.starRatingContainer}>
      <View style={styles.starsRow}>
        {stars.map((star) => {
          const isFilled = star <= rating;

          return (
            <TouchableOpacity
              key={star}
              onPress={() => handlePress(star)}
              disabled={disabled}
              activeOpacity={0.7}
              style={styles.starTouchable}
            >
              <Animated.View
                style={[
                  styles.starWrapper,
                  { transform: [{ scale: scaleAnims[star - 1] }] },
                ]}
              >
                <Star
                  size={size}
                  color={isFilled ? '#FBBF24' : '#E2E8F0'}
                  fill={isFilled ? '#FBBF24' : 'transparent'}
                  strokeWidth={1.5}
                />
              </Animated.View>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.ratingLabelContainer}>
        {ratingConfig.emoji ? (
          <Text style={styles.ratingEmoji}>{ratingConfig.emoji}</Text>
        ) : null}
        <Text style={[styles.ratingLabel, { color: ratingConfig.color }]}>
          {ratingConfig.label}
        </Text>
      </View>
    </View>
  );
};

// Quick Comment Chips
interface QuickCommentsProps {
  selectedComments: Set<string>;
  onToggle: (comment: string) => void;
}

const QuickComments: React.FC<QuickCommentsProps> = ({ selectedComments, onToggle }) => (
  <View style={styles.quickCommentsSection}>
    <Text style={styles.quickCommentsTitle}>Quick Add</Text>
    <View style={styles.quickCommentsGrid}>
      {QUICK_COMMENTS.map((comment, index) => {
        const isSelected = selectedComments.has(comment);
        return (
          <TouchableOpacity
            key={index}
            style={[styles.quickCommentChip, isSelected && styles.quickCommentChipSelected]}
            onPress={() => onToggle(comment)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.quickCommentText,
                isSelected && styles.quickCommentTextSelected,
              ]}
            >
              {comment}
            </Text>
            {isSelected && (
              <CheckCircle2 size={14} color="#3B82F6" style={{ marginLeft: 4 }} />
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  </View>
);

// Comment Input Section
interface CommentInputProps {
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  maxLength?: number;
}

const CommentInput: React.FC<CommentInputProps> = ({
  value,
  onChange,
  placeholder = 'Share your experience...',
  maxLength = 1000,
}) => (
  <View style={styles.commentSection}>
    <View style={styles.commentHeader}>
      <MessageSquare size={20} color="#64748B" />
      <Text style={styles.commentLabel}>Your Review</Text>
      <Text style={styles.commentOptional}>(Optional)</Text>
    </View>
    
    <View style={styles.commentInputWrapper}>
      <TextInput
        style={styles.commentInput}
        placeholder={placeholder}
        placeholderTextColor="#94A3B8"
        value={value}
        onChangeText={onChange}
        multiline
        maxLength={maxLength}
        textAlignVertical="top"
      />
      <Text style={styles.commentCharCount}>
        {value.length}/{maxLength}
      </Text>
    </View>
  </View>
);

// Submit Button
interface SubmitButtonProps {
  onSubmit: () => void;
  isSubmitting: boolean;
  disabled: boolean;
  rating: number;
}

const SubmitButton: React.FC<SubmitButtonProps> = ({
  onSubmit,
  isSubmitting,
  disabled,
  rating,
}) => (
  <View style={styles.submitSection}>
    <TouchableOpacity
      style={[
        styles.submitButton,
        disabled && styles.submitButtonDisabled,
      ]}
      onPress={onSubmit}
      disabled={disabled || isSubmitting}
      activeOpacity={0.8}
    >
      {isSubmitting ? (
        <ActivityIndicator size="small" color="#FFFFFF" />
      ) : (
        <>
          <Send size={22} color="#FFFFFF" />
          <Text style={styles.submitButtonText}>
            Submit {rating > 0 ? `${rating}-Star ` : ''}Review
          </Text>
        </>
      )}
    </TouchableOpacity>

    <Text style={styles.submitDisclaimer}>
      Your review will be public and help other clients
    </Text>
  </View>
);

// Success Screen Component
interface SuccessScreenProps {
  inspectorName: string;
  rating: number;
  onDone: () => void;
}

const SuccessScreen: React.FC<SuccessScreenProps> = ({ inspectorName, rating, onDone }) => {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const confettiAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(confettiAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <View style={styles.successContainer}>
      <Animated.View
        style={[
          styles.successContent,
          {
            opacity: opacityAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {/* Success Icon */}
        <View style={styles.successIconWrapper}>
          <View style={styles.successIconGradient}>
            <Heart size={48} color="#FFFFFF" fill="#FFFFFF" />
          </View>
          
          <Animated.View
            style={[
              styles.sparkle1,
              {
                opacity: confettiAnim,
                transform: [
                  { scale: confettiAnim },
                  {
                    rotate: confettiAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '360deg'],
                    }),
                  },
                ],
              },
            ]}
          >
            <Sparkles size={24} color="#FBBF24" />
          </Animated.View>
          
          <Animated.View
            style={[
              styles.sparkle2,
              {
                opacity: confettiAnim,
                transform: [{ scale: confettiAnim }],
              },
            ]}
          >
            <Star size={20} color="#F472B6" fill="#F472B6" />
          </Animated.View>
        </View>

        {/* Title */}
        <Text style={styles.successTitle}>Thank You! 🎉</Text>
        <Text style={styles.successSubtitle}>
          Your {rating}-star review for {inspectorName} has been submitted
        </Text>

        {/* Rating Display */}
        <View style={styles.successRating}>
          {[1, 2, 3, 4, 5].map((star) => (
            <Star
              key={star}
              size={32}
              color={star <= rating ? '#FBBF24' : '#E2E8F0'}
              fill={star <= rating ? '#FBBF24' : 'transparent'}
            />
          ))}
        </View>

        {/* Impact Message */}
        <View style={styles.successImpact}>
          <ThumbsUp size={20} color="#3B82F6" />
          <Text style={styles.successImpactText}>
            Your feedback helps others find great inspectors
          </Text>
        </View>

        {/* Done Button */}
        <TouchableOpacity
          style={styles.successDoneBtn}
          onPress={onDone}
          activeOpacity={0.8}
        >
          <Text style={styles.successDoneText}>Back to Dashboard</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

// Loading State
const LoadingState: React.FC = () => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color="#3B82F6" />
    <Text style={styles.loadingText}>Loading...</Text>
  </View>
);

// Error State
interface ErrorStateProps {
  message: string;
  onBack: () => void;
}

const ErrorState: React.FC<ErrorStateProps> = ({ message, onBack }) => (
  <View style={styles.errorContainer}>
    <View style={styles.errorIconWrapper}>
      <AlertCircle size={64} color="#F59E0B" />
    </View>
    <Text style={styles.errorTitle}>Can't Review Yet</Text>
    <Text style={styles.errorMessage}>{message}</Text>
    <TouchableOpacity style={styles.errorBackBtn} onPress={onBack} activeOpacity={0.8}>
      <Text style={styles.errorBackText}>Go Back</Text>
    </TouchableOpacity>
  </View>
);

// Already Reviewed State
interface AlreadyReviewedProps {
  onViewReview: () => void;
  onBack: () => void;
}

const AlreadyReviewedState: React.FC<AlreadyReviewedProps> = ({ onViewReview, onBack }) => (
  <View style={styles.alreadyReviewedContainer}>
    <View style={styles.alreadyReviewedIcon}>
      <Award size={64} color="#22C55E" />
    </View>
    <Text style={styles.alreadyReviewedTitle}>Already Reviewed</Text>
    <Text style={styles.alreadyReviewedText}>
      You've already submitted a review for this job
    </Text>
    <View style={styles.alreadyReviewedButtons}>
      <TouchableOpacity 
        style={styles.viewReviewBtn} 
        onPress={onViewReview}
        activeOpacity={0.8}
      >
        <Text style={styles.viewReviewText}>View Your Review</Text>
      </TouchableOpacity>
      <TouchableOpacity 
        style={styles.goBackBtn} 
        onPress={onBack}
        activeOpacity={0.7}
      >
        <Text style={styles.goBackText}>Go Back</Text>
      </TouchableOpacity>
    </View>
  </View>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function RateInspectorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const jobId = id ? (Array.isArray(id) ? id[0] : id) : null;
  const router = useRouter();

  // State
  const [loading, setLoading] = useState(true);
  const [inspectorInfo, setInspectorInfo] = useState<InspectorInfo | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [alreadyReviewed, setAlreadyReviewed] = useState(false);
  const [existingReviewId, setExistingReviewId] = useState<string | null>(null);

  // Form State
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [selectedQuickComments, setSelectedQuickComments] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // ========================================
  // DATA FETCHING
  // ========================================

  const checkReviewability = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Please sign in to continue');

      // Check if job exists and is completed
      const { data: jobData, error: jobError } = await supabase
        .from('jobs')
        .select(`
          id,
          title,
          status,
          client_id,
          applications!inner (
            id,
            status,
            applicant_id,
            applicant:profiles (
              id,
              first_name,
              last_name,
              avatar_url,
              rating_average,
              rating_count
            )
          )
        `)
        .eq('id', jobId)
        .eq('client_id', user.id)
        .eq('status', 'completed')
        .eq('applications.status', 'hired')
        .maybeSingle();

      if (jobError) throw jobError;
      if (!jobData) {
        throw new Error('Job not found or not completed');
      }

      // Check if already reviewed
      const { data: existingReview, error: reviewError } = await supabase
        .from('reviews')
        .select('id')
        .eq('job_id', jobId)
        .eq('client_id', user.id)
        .maybeSingle();

      if (reviewError && reviewError.code !== 'PGRST116') throw reviewError;

      if (existingReview) {
        setAlreadyReviewed(true);
        setExistingReviewId(existingReview.id);
        setCanReview(false);
        setLoading(false);
        return;
      }

      // Get hired inspector info
      const applications = jobData.applications as any[];
      const hiredApp = applications.find((app: any) => app.status === 'hired');
      
      if (!hiredApp || !hiredApp.applicant) {
        throw new Error('No hired inspector found for this job');
      }

      const inspector = hiredApp.applicant as any;

      setInspectorInfo({
        inspector_id: inspector.id,
        inspector_name: `${inspector.first_name || ''} ${inspector.last_name || ''}`.trim() || 'Inspector',
        inspector_avatar: inspector.avatar_url,
        inspector_rating: inspector.rating_average || 0,
        inspector_reviews: inspector.rating_count || 0,
        job_id: jobData.id,
        job_title: jobData.title || 'Job',
      });

      setCanReview(true);
    } catch (err: any) {
      console.error('Check reviewability error:', err);
      setErrorMessage(err.message || 'Failed to load review data');
      setCanReview(false);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    checkReviewability();
  }, [checkReviewability]);

  // ========================================
  // HANDLERS
  // ========================================

  const handleQuickCommentToggle = (comment: string) => {
    const newSelected = new Set(selectedQuickComments);
    if (newSelected.has(comment)) {
      newSelected.delete(comment);
      // Remove from comment text
      setComment((prev) => prev.replace(comment, '').replace(/\s+/g, ' ').trim());
    } else {
      newSelected.add(comment);
      // Add to comment text
      setComment((prev) => {
        const separator = prev.trim() ? '. ' : '';
        return (prev.trim() + separator + comment).trim();
      });
    }
    setSelectedQuickComments(newSelected);
  };

  const handleSubmit = async () => {
    if (rating === 0) {
      showAlert('Rating Required', 'Please select a star rating before submitting.');
      return;
    }

    if (!inspectorInfo) return;

    Keyboard.dismiss();
    setIsSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Please sign in to submit a review');

      // Canonical review path: submit_review RPC. A raw reviews insert omits
      // the NOT NULL reviewer_id/reviewee_id columns and always fails; the RPC
      // validates job completion + party membership and snapshots reviewer
      // attributes server-side (reviewer = auth.uid()).
      const { error } = await supabase.rpc('submit_review', {
        p_job_id: jobId,
        p_reviewee_id: inspectorInfo.inspector_id,
        p_rating: rating,
        p_comment: comment.trim() || null,
        p_is_public: true,
      });

      if (error) {
        if (error.code === '23505') {
          // Unique constraint violation - already reviewed
          throw new Error('You have already reviewed this job');
        }
        throw error;
      }

      // Show success screen
      setShowSuccess(true);
    } catch (err: any) {
      console.error('Submit review error:', err);
      showAlert('Error', err.message || 'Failed to submit review. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = () => {
    showConfirm(
      'Skip Review?',
      'Your feedback helps other clients find great inspectors. Are you sure you want to skip?',
      // '/(client)/jobs' has no index route (dead link) — go to the client home tab.
      () => router.replace('/(tabs)/client-dashboard')
    );
  };

  const handleBack = () => {
    if (rating > 0 || comment.trim()) {
      showConfirm(
        'Discard Review?',
        'You have unsaved changes. Are you sure you want to go back?',
        () => router.back()
      );
    } else {
      router.back();
    }
  };

  const handleSuccessDone = () => {
    // '/(client)/jobs' has no index route (dead link) — go to the client home tab.
    router.replace('/(tabs)/client-dashboard');
  };

  const handleViewExistingReview = () => {
    // Navigate to review details if you have that screen
    // For now, just go back
    router.back();
  };

  // ========================================
  // RENDER
  // ========================================

  // Loading State
  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header onBack={() => router.back()} onSkip={() => {}} canSkip={false} />
        <LoadingState />
      </SafeAreaView>
    );
  }

  // Error State
  if (errorMessage) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header onBack={() => router.back()} onSkip={() => {}} canSkip={false} />
        <ErrorState message={errorMessage} onBack={() => router.back()} />
      </SafeAreaView>
    );
  }

  // Already Reviewed State
  if (alreadyReviewed) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header onBack={() => router.back()} onSkip={() => {}} canSkip={false} />
        <AlreadyReviewedState 
          onViewReview={handleViewExistingReview}
          onBack={() => router.back()}
        />
      </SafeAreaView>
    );
  }

  // Success State
  if (showSuccess && inspectorInfo) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <SuccessScreen
          inspectorName={inspectorInfo.inspector_name}
          rating={rating}
          onDone={handleSuccessDone}
        />
      </SafeAreaView>
    );
  }

  // Main Rating Form
  if (!inspectorInfo) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header onBack={handleBack} onSkip={handleSkip} canSkip={true} />

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Inspector Card */}
          <InspectorCard inspector={inspectorInfo} />

          {/* Star Rating */}
          <View style={styles.ratingSection}>
            <Text style={styles.ratingSectionTitle}>How was your experience?</Text>
            <StarRating
              rating={rating}
              onRatingChange={setRating}
              disabled={isSubmitting}
            />
          </View>

          {/* Quick Comments */}
          <QuickComments
            selectedComments={selectedQuickComments}
            onToggle={handleQuickCommentToggle}
          />

          {/* Comment Input */}
          <CommentInput
            value={comment}
            onChange={setComment}
            placeholder="Tell us more about your experience with this inspector..."
          />

          {/* Spacer for button */}
          <View style={{ height: 120 }} />
        </ScrollView>

        {/* Fixed Submit Button */}
        <View style={styles.submitContainer}>
          <SubmitButton
            onSubmit={handleSubmit}
            isSubmitting={isSubmitting}
            disabled={rating === 0 || isSubmitting}
            rating={rating}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#0F172A',
  },
  skipBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  skipBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748B',
  },

  // Keyboard View
  keyboardView: {
    flex: 1,
  },

  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },

  // Inspector Card
  inspectorCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 28,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  inspectorAvatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  inspectorAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    borderColor: '#F1F5F9',
  },
  avatarPlaceholder: {
    backgroundColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 2,
  },
  inspectorName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  inspectorStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  statDivider: {
    width: 1,
    height: 16,
    backgroundColor: '#E2E8F0',
    marginHorizontal: 12,
  },
  statLabel: {
    fontSize: 14,
    color: '#64748B',
  },
  jobBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    maxWidth: '80%',
  },
  jobBadgeText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },

  // Rating Section
  ratingSection: {
    alignItems: 'center',
    marginBottom: 28,
  },
  ratingSectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 20,
  },

  // Star Rating
  starRatingContainer: {
    alignItems: 'center',
  },
  starsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  starTouchable: {
    padding: 4,
  },
  starWrapper: {
    // For animation
  },
  ratingLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ratingEmoji: {
    fontSize: 28,
  },
  ratingLabel: {
    fontSize: 18,
    fontWeight: '600',
  },

  // Quick Comments
  quickCommentsSection: {
    marginBottom: 24,
  },
  quickCommentsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 12,
  },
  quickCommentsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  quickCommentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  quickCommentChipSelected: {
    backgroundColor: '#EFF6FF',
    borderColor: '#3B82F6',
  },
  quickCommentText: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '500',
  },
  quickCommentTextSelected: {
    color: '#1D4ED8',
  },

  // Comment Section
  commentSection: {
    marginBottom: 24,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  commentLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0F172A',
  },
  commentOptional: {
    fontSize: 13,
    color: '#94A3B8',
  },
  commentInputWrapper: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  commentInput: {
    padding: 16,
    fontSize: 15,
    color: '#0F172A',
    minHeight: 120,
    lineHeight: 22,
  },
  commentCharCount: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'right',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },

  // Submit Section
  submitContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 10,
  },
  submitSection: {
    alignItems: 'center',
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3B82F6',
    paddingVertical: 18,
    paddingHorizontal: 32,
    borderRadius: 16,
    gap: 12,
    width: '100%',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  submitButtonDisabled: {
    backgroundColor: '#CBD5E1',
    shadowOpacity: 0,
  },
  submitButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  submitDisclaimer: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 12,
    textAlign: 'center',
  },

  // Success Screen
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#F8FAFC',
  },
  successContent: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 32,
    padding: 40,
    width: '100%',
    maxWidth: 360,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 8,
  },
  successIconWrapper: {
    position: 'relative',
    marginBottom: 28,
  },
  successIconGradient: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#22C55E',
  },
  sparkle1: {
    position: 'absolute',
    top: -8,
    right: -12,
  },
  sparkle2: {
    position: 'absolute',
    bottom: 0,
    left: -16,
  },
  successTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 15,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  successRating: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 28,
  },
  successImpact: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 10,
    marginBottom: 28,
  },
  successImpactText: {
    fontSize: 13,
    color: '#1D4ED8',
    fontWeight: '500',
    flex: 1,
  },
  successDoneBtn: {
    backgroundColor: '#22C55E',
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 14,
    width: '100%',
    alignItems: 'center',
  },
  successDoneText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Loading State
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: '#64748B',
    fontWeight: '500',
  },

  // Error State
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorIconWrapper: {
    marginBottom: 24,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 12,
  },
  errorMessage: {
    fontSize: 15,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  errorBackBtn: {
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
  },
  errorBackText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // Already Reviewed State
  alreadyReviewedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  alreadyReviewedIcon: {
    marginBottom: 24,
  },
  alreadyReviewedTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 12,
  },
  alreadyReviewedText: {
    fontSize: 15,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  alreadyReviewedButtons: {
    gap: 12,
    width: '100%',
    alignItems: 'center',
  },
  viewReviewBtn: {
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  viewReviewText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  goBackBtn: {
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  goBackText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748B',
  },
});

