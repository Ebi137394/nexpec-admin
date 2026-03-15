import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  Animated,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
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
  ThumbsDown,
  MessageSquare,
  Award,
  Clock,
  Briefcase,
  X,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { showAlert, showConfirm } from '@/lib/alert';

// ============================================================================
// TYPES
// ============================================================================

interface ReviewabilityResult {
  can_review: boolean;
  reason: string | null;
  job_title: string | null;
  inspector_id: string | null;
  inspector_name: string | null;
  inspector_avatar: string | null;
  existing_review_id: string | null;
}

interface InspectorInfo {
  id: string;
  name: string;
  avatar: string | null;
  jobTitle: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const RATING_CONFIG = {
  1: { label: 'Poor', emoji: '😞', color: '#EF4444', description: 'Very unsatisfied' },
  2: { label: 'Fair', emoji: '😕', color: '#F97316', description: 'Below expectations' },
  3: { label: 'Good', emoji: '😊', color: '#EAB308', description: 'Met expectations' },
  4: { label: 'Very Good', emoji: '😄', color: '#22C55E', description: 'Above expectations' },
  5: { label: 'Excellent', emoji: '🤩', color: '#10B981', description: 'Exceeded expectations' },
};

const QUICK_TAGS = [
  { id: 'professional', label: 'Professional', icon: '👔' },
  { id: 'on_time', label: 'On Time', icon: '⏰' },
  { id: 'thorough', label: 'Thorough', icon: '🔍' },
  { id: 'great_communication', label: 'Great Communication', icon: '💬' },
  { id: 'detailed_report', label: 'Detailed Report', icon: '📋' },
  { id: 'knowledgeable', label: 'Knowledgeable', icon: '🧠' },
  { id: 'friendly', label: 'Friendly', icon: '😊' },
  { id: 'efficient', label: 'Efficient', icon: '⚡' },
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const getInitials = (name: string): string => {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// Header Component
interface HeaderProps {
  onBack: () => void;
  onSkip?: () => void;
  showSkip?: boolean;
}

const Header: React.FC<HeaderProps> = ({ onBack, onSkip, showSkip = true }) => (
  <View style={styles.header}>
    <TouchableOpacity onPress={onBack} style={styles.headerButton} activeOpacity={0.7}>
      <ChevronLeft size={28} color="#0F172A" />
    </TouchableOpacity>
    
    <Text style={styles.headerTitle}>Rate & Review</Text>
    
    {showSkip ? (
      <TouchableOpacity onPress={onSkip} style={styles.skipButton} activeOpacity={0.7}>
        <Text style={styles.skipButtonText}>Skip</Text>
      </TouchableOpacity>
    ) : (
      <View style={styles.headerButton} />
    )}
  </View>
);

// Inspector Profile Card
interface InspectorProfileProps {
  inspector: InspectorInfo;
}

const InspectorProfile: React.FC<InspectorProfileProps> = ({ inspector }) => (
  <View style={styles.inspectorCard}>
    <View style={styles.inspectorAvatarWrapper}>
      {inspector.avatar ? (
        <Image source={{ uri: inspector.avatar }} style={styles.inspectorAvatar} />
      ) : (
        <View style={[styles.inspectorAvatar, styles.avatarPlaceholder]}>
          <Text style={styles.avatarInitials}>{getInitials(inspector.name)}</Text>
        </View>
      )}
      <View style={styles.completedBadge}>
        <CheckCircle2 size={20} color="#22C55E" fill="#FFFFFF" />
      </View>
    </View>
    
    <Text style={styles.inspectorName}>{inspector.name}</Text>
    
    <View style={styles.jobBadge}>
      <Briefcase size={14} color="#64748B" />
      <Text style={styles.jobBadgeText} numberOfLines={1}>{inspector.jobTitle}</Text>
    </View>

    <View style={styles.completedLabel}>
      <CheckCircle2 size={14} color="#22C55E" />
      <Text style={styles.completedLabelText}>Job Completed</Text>
    </View>
  </View>
);

// Animated Star Rating Component
interface StarRatingProps {
  rating: number;
  onRatingChange: (rating: number) => void;
  disabled?: boolean;
}

const StarRating: React.FC<StarRatingProps> = ({ rating, onRatingChange, disabled }) => {
  const scaleAnims = useRef([1, 2, 3, 4, 5].map(() => new Animated.Value(1))).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  const handleStarPress = (starValue: number) => {
    if (disabled) return;

    // Animate pressed star
    Animated.sequence([
      Animated.timing(scaleAnims[starValue - 1], {
        toValue: 1.4,
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

    // Glow effect
    Animated.sequence([
      Animated.timing(glowAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(glowAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    onRatingChange(starValue);
  };

  const config = rating > 0 ? RATING_CONFIG[rating as keyof typeof RATING_CONFIG] : null;

  return (
    <View style={styles.starRatingContainer}>
      <Text style={styles.ratingPrompt}>How was your experience?</Text>
      
      <View style={styles.starsRow}>
        {[1, 2, 3, 4, 5].map((star) => {
          const isFilled = star <= rating;
          return (
            <TouchableOpacity
              key={star}
              onPress={() => handleStarPress(star)}
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
                  size={48}
                  color={isFilled ? '#FBBF24' : '#E2E8F0'}
                  fill={isFilled ? '#FBBF24' : 'transparent'}
                  strokeWidth={1.5}
                />
              </Animated.View>
            </TouchableOpacity>
          );
        })}
      </View>

      {config && (
        <Animated.View style={[styles.ratingFeedback, { opacity: glowAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 0.7],
        })}]}>
          <Text style={styles.ratingEmoji}>{config.emoji}</Text>
          <Text style={[styles.ratingLabel, { color: config.color }]}>{config.label}</Text>
          <Text style={styles.ratingDescription}>{config.description}</Text>
        </Animated.View>
      )}
      
      {!config && (
        <View style={styles.ratingFeedback}>
          <Text style={styles.ratingPlaceholder}>Tap a star to rate</Text>
        </View>
      )}
    </View>
  );
};

// Would Recommend Toggle
interface RecommendToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
}

const RecommendToggle: React.FC<RecommendToggleProps> = ({ value, onChange }) => (
  <View style={styles.recommendSection}>
    <Text style={styles.recommendQuestion}>Would you recommend this inspector?</Text>
    
    <View style={styles.recommendButtons}>
      <TouchableOpacity
        style={[styles.recommendButton, value && styles.recommendButtonActive]}
        onPress={() => onChange(true)}
        activeOpacity={0.7}
      >
        <ThumbsUp size={24} color={value ? '#FFFFFF' : '#22C55E'} fill={value ? '#FFFFFF' : 'transparent'} />
        <Text style={[styles.recommendButtonText, value && styles.recommendButtonTextActive]}>
          Yes
        </Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={[styles.recommendButton, styles.recommendButtonNo, !value && styles.recommendButtonNoActive]}
        onPress={() => onChange(false)}
        activeOpacity={0.7}
      >
        <ThumbsDown size={24} color={!value ? '#FFFFFF' : '#EF4444'} fill={!value ? '#FFFFFF' : 'transparent'} />
        <Text style={[styles.recommendButtonText, !value && styles.recommendButtonTextActive]}>
          No
        </Text>
      </TouchableOpacity>
    </View>
  </View>
);

// Quick Tags Section
interface QuickTagsProps {
  selectedTags: Set<string>;
  onToggle: (tag: string) => void;
}

const QuickTags: React.FC<QuickTagsProps> = ({ selectedTags, onToggle }) => (
  <View style={styles.tagsSection}>
    <Text style={styles.tagsSectionTitle}>What stood out?</Text>
    <Text style={styles.tagsSectionSubtitle}>Select all that apply</Text>
    
    <View style={styles.tagsGrid}>
      {QUICK_TAGS.map((tag) => {
        const isSelected = selectedTags.has(tag.id);
        return (
          <TouchableOpacity
            key={tag.id}
            style={[styles.tagChip, isSelected && styles.tagChipSelected]}
            onPress={() => onToggle(tag.id)}
            activeOpacity={0.7}
          >
            <Text style={styles.tagIcon}>{tag.icon}</Text>
            <Text style={[styles.tagLabel, isSelected && styles.tagLabelSelected]}>
              {tag.label}
            </Text>
            {isSelected && <CheckCircle2 size={14} color="#3B82F6" />}
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
  rating: number;
}

const CommentInput: React.FC<CommentInputProps> = ({ value, onChange, rating }) => {
  const placeholders: Record<number, string> = {
    1: "What went wrong? Your feedback helps us improve...",
    2: "What could have been better?",
    3: "Share what you liked and what could improve...",
    4: "What did you enjoy about the experience?",
    5: "Tell us what made this experience excellent!",
  };

  return (
    <View style={styles.commentSection}>
      <View style={styles.commentHeader}>
        <MessageSquare size={20} color="#64748B" />
        <Text style={styles.commentLabel}>Write a Review</Text>
        <Text style={styles.commentOptional}>(Optional)</Text>
      </View>
      
      <TextInput
        style={styles.commentInput}
        placeholder={placeholders[rating] || "Share your experience..."}
        placeholderTextColor="#94A3B8"
        value={value}
        onChangeText={onChange}
        multiline
        maxLength={2000}
        textAlignVertical="top"
      />
      
      <View style={styles.commentFooter}>
        <Text style={styles.commentCharCount}>{value.length}/2000</Text>
      </View>
    </View>
  );
};

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
  <View style={styles.submitContainer}>
    <TouchableOpacity
      style={[styles.submitButton, disabled && styles.submitButtonDisabled]}
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
            Submit {rating > 0 ? `${rating}-Star` : ''} Review
          </Text>
        </>
      )}
    </TouchableOpacity>
    
    <Text style={styles.submitDisclaimer}>
      Your review is public and helps other clients
    </Text>
  </View>
);

// Success Screen
interface SuccessScreenProps {
  inspectorName: string;
  rating: number;
  onDone: () => void;
}

const SuccessScreen: React.FC<SuccessScreenProps> = ({ inspectorName, rating, onDone }) => {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const starsAnim = useRef(new Animated.Value(0)).current;

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
      Animated.timing(starsAnim, {
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
              styles.successSparkle,
              {
                opacity: starsAnim,
                transform: [
                  { scale: starsAnim },
                  {
                    rotate: starsAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '360deg'],
                    }),
                  },
                ],
              },
            ]}
          >
            <Sparkles size={28} color="#FBBF24" />
          </Animated.View>
        </View>

        {/* Title */}
        <Text style={styles.successTitle}>Thank You! 🎉</Text>
        <Text style={styles.successSubtitle}>
          Your {rating}-star review for{'\n'}{inspectorName} has been submitted
        </Text>

        {/* Stars Display */}
        <Animated.View style={[styles.successStars, { opacity: starsAnim }]}>
          {[1, 2, 3, 4, 5].map((star) => (
            <Star
              key={star}
              size={32}
              color={star <= rating ? '#FBBF24' : '#E2E8F0'}
              fill={star <= rating ? '#FBBF24' : 'transparent'}
            />
          ))}
        </Animated.View>

        {/* Impact Message */}
        <View style={styles.successImpact}>
          <Award size={20} color="#3B82F6" />
          <Text style={styles.successImpactText}>
            Your feedback helps build trust in our community
          </Text>
        </View>

        {/* Done Button */}
        <TouchableOpacity
          style={styles.successDoneButton}
          onPress={onDone}
          activeOpacity={0.8}
        >
          <Text style={styles.successDoneButtonText}>Back to Jobs</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

// Loading State
const LoadingState: React.FC = () => (
  <View style={styles.centerContainer}>
    <ActivityIndicator size="large" color="#3B82F6" />
    <Text style={styles.loadingText}>Loading...</Text>
  </View>
);

// Error State
interface ErrorStateProps {
  title: string;
  message: string;
  onBack: () => void;
  showViewReview?: boolean;
  onViewReview?: () => void;
}

const ErrorState: React.FC<ErrorStateProps> = ({
  title,
  message,
  onBack,
  showViewReview,
  onViewReview,
}) => (
  <View style={styles.centerContainer}>
    <View style={styles.errorIconWrapper}>
      <AlertCircle size={64} color="#F59E0B" />
    </View>
    <Text style={styles.errorTitle}>{title}</Text>
    <Text style={styles.errorMessage}>{message}</Text>
    
    <View style={styles.errorButtons}>
      {showViewReview && onViewReview && (
        <TouchableOpacity
          style={styles.viewReviewButton}
          onPress={onViewReview}
          activeOpacity={0.8}
        >
          <Text style={styles.viewReviewButtonText}>View Your Review</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={[styles.backButton, showViewReview && styles.backButtonSecondary]}
        onPress={onBack}
        activeOpacity={0.7}
      >
        <Text style={[styles.backButtonText, showViewReview && styles.backButtonTextSecondary]}>
          Go Back
        </Text>
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
  const [inspector, setInspector] = useState<InspectorInfo | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [errorState, setErrorState] = useState<{
    title: string;
    message: string;
    showViewReview?: boolean;
  } | null>(null);

  // Form State
  const [rating, setRating] = useState(0);
  const [wouldRecommend, setWouldRecommend] = useState(true);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // ========================================
  // DATA FETCHING
  // ========================================

  const checkReviewability = useCallback(async () => {
    setLoading(true);
    setErrorState(null);

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
              avatar_url
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
        setErrorState({
          title: 'Already Reviewed',
          message: 'You have already submitted a review for this job.',
          showViewReview: true,
        });
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

      const inspectorProfile = hiredApp.applicant as any;

      setInspector({
        id: inspectorProfile.id,
        name: `${inspectorProfile.first_name || ''} ${inspectorProfile.last_name || ''}`.trim() || 'Inspector',
        avatar: inspectorProfile.avatar_url,
        jobTitle: jobData.title || 'Inspection Job',
      });

      setCanReview(true);
    } catch (err: any) {
      console.error('Check reviewability error:', err);
      setErrorState({
        title: 'Error',
        message: err.message || 'Failed to load review data',
      });
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

  const handleTagToggle = (tagId: string) => {
    setSelectedTags((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(tagId)) {
        newSet.delete(tagId);
      } else {
        newSet.add(tagId);
      }
      return newSet;
    });
  };

  const handleSubmit = async () => {
    if (rating === 0) {
      showAlert('Rating Required', 'Please select a star rating before submitting.');
      return;
    }

    if (!inspector) return;

    Keyboard.dismiss();
    setIsSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Please sign in to submit a review');

      const { error } = await supabase.from('reviews').insert({
        job_id: jobId,
        inspector_id: inspector.id,
        client_id: user.id,
        rating,
        comment: comment.trim() || null,
        would_recommend: wouldRecommend,
        tags: Array.from(selectedTags),
        is_public: true,
      });

      if (error) {
        if (error.code === '23505') {
          throw new Error('You have already reviewed this job');
        }
        throw error;
      }

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
      'Your feedback helps other clients make better decisions. Are you sure you want to skip?',
      () => router.back()
    );
  };

  const handleBack = () => {
    if (rating > 0 || comment.trim() || selectedTags.size > 0) {
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
    router.replace('/(client)/jobs');
  };

  // ========================================
  // RENDER
  // ========================================

  // Loading State
  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header onBack={() => router.back()} showSkip={false} />
        <LoadingState />
      </SafeAreaView>
    );
  }

  // Error State
  if (errorState) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header onBack={() => router.back()} showSkip={false} />
        <ErrorState
          title={errorState.title}
          message={errorState.message}
          onBack={() => router.back()}
          showViewReview={errorState.showViewReview}
          onViewReview={() => router.back()}
        />
      </SafeAreaView>
    );
  }

  // Success State
  if (showSuccess && inspector) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <SuccessScreen
          inspectorName={inspector.name}
          rating={rating}
          onDone={handleSuccessDone}
        />
      </SafeAreaView>
    );
  }

  // Main Rating Form
  if (!canReview || !inspector) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header onBack={handleBack} onSkip={handleSkip} showSkip={true} />

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
          {/* Inspector Profile */}
          <InspectorProfile inspector={inspector} />

          {/* Star Rating */}
          <StarRating
            rating={rating}
            onRatingChange={setRating}
            disabled={isSubmitting}
          />

          {/* Would Recommend */}
          {rating > 0 && (
            <RecommendToggle
              value={wouldRecommend}
              onChange={setWouldRecommend}
            />
          )}

          {/* Quick Tags */}
          {rating > 0 && (
            <QuickTags
              selectedTags={selectedTags}
              onToggle={handleTagToggle}
            />
          )}

          {/* Comment Input */}
          {rating > 0 && (
            <CommentInput
              value={comment}
              onChange={setComment}
              rating={rating}
            />
          )}

          {/* Bottom Spacer */}
          <View style={{ height: 120 }} />
        </ScrollView>

        {/* Submit Button */}
        <SubmitButton
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          disabled={rating === 0 || isSubmitting}
          rating={rating}
        />
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
  headerButton: {
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
  skipButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  skipButtonText: {
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
  inspectorAvatarWrapper: {
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
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    fontSize: 36,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  completedBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 2,
  },
  inspectorName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  jobBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 8,
    marginBottom: 12,
    maxWidth: '80%',
  },
  jobBadgeText: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  completedLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  completedLabelText: {
    fontSize: 13,
    color: '#22C55E',
    fontWeight: '600',
  },

  // Star Rating
  starRatingContainer: {
    alignItems: 'center',
    marginBottom: 28,
  },
  ratingPrompt: {
    fontSize: 20,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 20,
  },
  starsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  starTouchable: {
    padding: 4,
  },
  starWrapper: {
    // For animation
  },
  ratingFeedback: {
    alignItems: 'center',
    minHeight: 60,
  },
  ratingEmoji: {
    fontSize: 40,
    marginBottom: 8,
  },
  ratingLabel: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  ratingDescription: {
    fontSize: 14,
    color: '#64748B',
  },
  ratingPlaceholder: {
    fontSize: 16,
    color: '#94A3B8',
    fontStyle: 'italic',
  },

  // Recommend Section
  recommendSection: {
    marginBottom: 28,
  },
  recommendQuestion: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 16,
  },
  recommendButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  recommendButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#22C55E',
    backgroundColor: '#FFFFFF',
    gap: 10,
  },
  recommendButtonActive: {
    backgroundColor: '#22C55E',
    borderColor: '#22C55E',
  },
  recommendButtonNo: {
    borderColor: '#EF4444',
  },
  recommendButtonNoActive: {
    backgroundColor: '#EF4444',
    borderColor: '#EF4444',
  },
  recommendButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
  },
  recommendButtonTextActive: {
    color: '#FFFFFF',
  },

  // Tags Section
  tagsSection: {
    marginBottom: 28,
  },
  tagsSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 4,
  },
  tagsSectionSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 16,
  },
  tagsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  tagChipSelected: {
    backgroundColor: '#EFF6FF',
    borderColor: '#3B82F6',
  },
  tagIcon: {
    fontSize: 16,
  },
  tagLabel: {
    fontSize: 14,
    color: '#475569',
    fontWeight: '500',
  },
  tagLabelSelected: {
    color: '#1D4ED8',
    fontWeight: '600',
  },

  // Comment Section
  commentSection: {
    marginBottom: 28,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  commentLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
  },
  commentOptional: {
    fontSize: 14,
    color: '#94A3B8',
  },
  commentInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 16,
    fontSize: 15,
    color: '#0F172A',
    minHeight: 140,
    lineHeight: 22,
  },
  commentFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  commentCharCount: {
    fontSize: 12,
    color: '#94A3B8',
  },

  // Submit Container
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
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3B82F6',
    paddingVertical: 18,
    borderRadius: 16,
    gap: 12,
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
    textAlign: 'center',
    marginTop: 12,
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
  successSparkle: {
    position: 'absolute',
    top: -12,
    right: -12,
  },
  successTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 12,
  },
  successSubtitle: {
    fontSize: 16,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
  },
  successStars: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 28,
  },
  successImpact: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 14,
    gap: 12,
    marginBottom: 28,
  },
  successImpactText: {
    flex: 1,
    fontSize: 14,
    color: '#1D4ED8',
    fontWeight: '500',
    lineHeight: 20,
  },
  successDoneButton: {
    backgroundColor: '#22C55E',
    paddingVertical: 18,
    paddingHorizontal: 48,
    borderRadius: 16,
    width: '100%',
    alignItems: 'center',
  },
  successDoneButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Center Container (Loading/Error)
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    fontSize: 16,
    color: '#64748B',
    marginTop: 16,
    fontWeight: '500',
  },

  // Error State
  errorIconWrapper: {
    marginBottom: 20,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 12,
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: 15,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  errorButtons: {
    width: '100%',
    gap: 12,
  },
  viewReviewButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    width: '100%',
  },
  viewReviewButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  backButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    width: '100%',
  },
  backButtonSecondary: {
    backgroundColor: 'transparent',
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  backButtonTextSecondary: {
    color: '#64748B',
  },
});

