// ════════════════════════════════════════════════════════════════════════════
//  src/components/reviews/ReviewSubmissionScreen.tsx
//  NEXPEC — Premium Review & Reputation Engine
//
//  Single-screen review submission flow. Minimalist:
//    1. Header — "Rate <Reviewee>" with avatar + role
//    2. Five big tap-stars (1–5)
//    3. Optional comment textarea
//    4. "Share publicly on their profile" toggle (default ON)
//    5. Optional "Send private feedback to admin only" expandable
//    6. Submit
//
//  Pre-flight checks:
//    • Loads the job & resolves the reviewee (other party) via
//      resolveRevieweeForJob.
//    • Fails fast if job isn't admin-confirmed completed.
//    • Detects duplicate submissions and shows the existing review state
//      instead of the form.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Switch,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/contexts/AuthContext';
import {
  resolveRevieweeForJob,
  fetchExistingReview,
  submitReview,
  formatReviewerName,
  formatInitials,
  formatRoleLabel,
  ReviewProfileLite,
  JobPartyContext,
  ReviewRow,
} from '@/src/lib/reviews';

const C = {
  bg:            '#020420',
  surface:       '#0A0E2E',
  surfaceDeep:   '#070A24',
  surfaceLight:  '#111640',
  border:        '#1A1F4E',
  primary:       '#7C3AED',
  primaryLight:  '#8B5CF6',
  primaryBg:     'rgba(124,58,237,0.12)',
  primaryBorder: 'rgba(124,58,237,0.40)',
  amber:         '#F59E0B',
  green:         '#10B981',
  red:           '#EF4444',
  textPrimary:   '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted:     '#64748B',
};

export interface ReviewSubmissionScreenProps {
  jobId: string;
}

const ReviewSubmissionScreen: React.FC<ReviewSubmissionScreenProps> = ({ jobId }) => {
  const router = useRouter();
  const { user } = useAuth();
  const reviewerId = user?.id ?? null;

  // ── Pre-flight state ──────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [ctx, setCtx]         = useState<JobPartyContext | null>(null);
  const [reviewee, setReviewee] = useState<ReviewProfileLite | null>(null);
  const [existing, setExisting] = useState<ReviewRow | null>(null);

  // ── Form state ────────────────────────────────────────────────
  const [rating, setRating]                   = useState<number>(0);
  const [comment, setComment]                 = useState('');
  const [isPublic, setIsPublic]               = useState(true);
  const [showPrivateField, setShowPrivateField] = useState(false);
  const [privateNote, setPrivateNote]         = useState('');
  const [submitting, setSubmitting]           = useState(false);
  const [submitted, setSubmitted]             = useState(false);

  // ─── Load preflight ───────────────────────────────────────────
  useEffect(() => {
    if (!reviewerId || !jobId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // 1. Existing review check first (cheap, single column)
        const existingRow = await fetchExistingReview(jobId, reviewerId);
        if (cancelled) return;
        if (existingRow) {
          setExisting(existingRow);
          // Still attempt to resolve reviewee for nicer display
          try {
            const { ctx: resolvedCtx, reviewee: resolvedReviewee } =
              await resolveRevieweeForJob(jobId, reviewerId);
            if (!cancelled) {
              setCtx(resolvedCtx);
              setReviewee(resolvedReviewee);
            }
          } catch {
            /* okay — we have the existing row, that's enough */
          }
          setLoading(false);
          return;
        }

        // 2. Resolve reviewee from job (also validates completion + party)
        const { ctx: resolvedCtx, reviewee: resolvedReviewee } =
          await resolveRevieweeForJob(jobId, reviewerId);
        if (cancelled) return;
        setCtx(resolvedCtx);
        setReviewee(resolvedReviewee);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Could not load review form');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, reviewerId]);

  // ─── Submit ───────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!ctx || !reviewee) return;
    if (rating < 1 || rating > 5) {
      Alert.alert('Rating required', 'Tap a star to rate this job from 1 to 5.');
      return;
    }
    setSubmitting(true);
    try {
      await submitReview({
        jobId: ctx.jobId,
        revieweeId: reviewee.id,
        rating,
        comment: comment.trim() || null,
        isPublic,
        privateAdminNote: showPrivateField && privateNote.trim()
          ? privateNote.trim()
          : null,
      });
      setSubmitted(true);
    } catch (e: any) {
      const msg = e?.message ?? 'Could not submit review';
      Alert.alert('Submission failed', msg);
    } finally {
      setSubmitting(false);
    }
  }, [ctx, reviewee, rating, comment, isPublic, showPrivateField, privateNote]);

  const revieweeName = useMemo(() => formatReviewerName(reviewee), [reviewee]);
  const revieweeInitials = useMemo(() => formatInitials(reviewee), [reviewee]);
  const revieweeRole = useMemo(() => formatRoleLabel(reviewee?.role), [reviewee]);

  // ─── Loading ──────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={s.root} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Submit Review' }} />
        <View style={s.centeredFlex}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Error pre-flight ─────────────────────────────────────────
  if (error && !existing) {
    return (
      <SafeAreaView style={s.root} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Submit Review' }} />
        <View style={s.errorWrap}>
          <View style={s.errorIcon}>
            <Ionicons name="alert-circle" size={28} color={C.red} />
          </View>
          <Text style={s.errorTitle}>Cannot leave a review</Text>
          <Text style={s.errorSubtitle}>{error}</Text>
          <TouchableOpacity
            style={s.errorBack}
            onPress={() => router.back()}
            activeOpacity={0.8}
          >
            <Text style={s.errorBackText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Already reviewed ─────────────────────────────────────────
  if (existing) {
    return (
      <SafeAreaView style={s.root} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Review Submitted' }} />
        <View style={s.successWrap}>
          <View style={s.successIcon}>
            <Ionicons name="checkmark-circle" size={36} color={C.green} />
          </View>
          <Text style={s.successTitle}>You already reviewed this job</Text>
          <Text style={s.successSubtitle}>
            One review per party per job — that's the rule. You rated{' '}
            <Text style={{ color: C.amber, fontWeight: '800' }}>
              {existing.rating} ★
            </Text>.
          </Text>
          <TouchableOpacity
            style={s.primaryBtn}
            onPress={() => router.back()}
            activeOpacity={0.85}
          >
            <Text style={s.primaryBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Success ──────────────────────────────────────────────────
  if (submitted) {
    return (
      <SafeAreaView style={s.root} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Review Submitted' }} />
        <View style={s.successWrap}>
          <View style={s.successIcon}>
            <Ionicons name="checkmark-circle" size={36} color={C.green} />
          </View>
          <Text style={s.successTitle}>Review submitted</Text>
          <Text style={s.successSubtitle}>
            Thank you. Your feedback strengthens the NEXPEC community.
          </Text>
          <TouchableOpacity
            style={s.primaryBtn}
            onPress={() => router.back()}
            activeOpacity={0.85}
          >
            <Text style={s.primaryBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Form ─────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.root} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Submit Review' }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Reviewee card ─────────────────────────────── */}
          <View style={s.revieweeCard}>
            {reviewee?.avatar_url ? (
              <Image source={{ uri: reviewee.avatar_url }} style={s.revieweeAvatar} />
            ) : (
              <View style={s.revieweeAvatarFallback}>
                <Text style={s.revieweeInitials}>{revieweeInitials}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={s.revieweeLabel}>Rating</Text>
              <Text style={s.revieweeName} numberOfLines={1}>{revieweeName}</Text>
              <Text style={s.revieweeMeta} numberOfLines={1}>
                {revieweeRole}{ctx?.jobTitle ? `  ·  ${ctx.jobTitle}` : ''}
              </Text>
            </View>
            {reviewee?.is_verified && (
              <View style={s.verifiedBadge}>
                <Ionicons name="shield-checkmark" size={11} color={C.green} />
              </View>
            )}
          </View>

          {/* ── Star picker ───────────────────────────────── */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Your rating</Text>
            <View style={s.starPickerRow}>
              {[1, 2, 3, 4, 5].map((n) => {
                const active = rating >= n;
                return (
                  <TouchableOpacity
                    key={n}
                    onPress={() => setRating(n)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  >
                    <Ionicons
                      name={active ? 'star' : 'star-outline'}
                      size={44}
                      color={active ? C.amber : C.textMuted}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={s.starHint}>
              {rating === 0 && 'Tap a star to rate'}
              {rating === 1 && 'Poor — significant issues'}
              {rating === 2 && 'Below expectations'}
              {rating === 3 && 'Met expectations'}
              {rating === 4 && 'Above expectations'}
              {rating === 5 && 'Outstanding'}
            </Text>
          </View>

          {/* ── Comment ───────────────────────────────────── */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Comment <Text style={s.optional}>(optional)</Text></Text>
            <TextInput
              style={s.textarea}
              value={comment}
              onChangeText={setComment}
              multiline
              numberOfLines={4}
              placeholder="Share what stood out. Specific, professional, and useful for others."
              placeholderTextColor={C.textMuted}
              maxLength={1000}
              textAlignVertical="top"
            />
            <Text style={s.charCount}>{comment.length} / 1000</Text>
          </View>

          {/* ── Public toggle ─────────────────────────────── */}
          <View style={[s.section, s.toggleRow]}>
            <View style={{ flex: 1 }}>
              <Text style={s.toggleTitle}>Share publicly</Text>
              <Text style={s.toggleSub}>
                Visible on {revieweeName}'s profile. Off = only you and admins see it.
              </Text>
            </View>
            <Switch
              value={isPublic}
              onValueChange={setIsPublic}
              trackColor={{ false: '#374151', true: C.primary }}
              thumbColor="#FFF"
            />
          </View>

          {/* ── Private admin note (collapsible) ──────────── */}
          <TouchableOpacity
            style={s.privateToggle}
            onPress={() => setShowPrivateField((v) => !v)}
            activeOpacity={0.75}
          >
            <Ionicons
              name={showPrivateField ? 'chevron-down' : 'chevron-forward'}
              size={14}
              color={C.textSecondary}
            />
            <View style={{ flex: 1 }}>
              <Text style={s.privateToggleTitle}>
                Send private feedback to admin only
              </Text>
              <Text style={s.privateToggleSub}>
                Not visible to {revieweeName}. Use for safety or quality concerns.
              </Text>
            </View>
          </TouchableOpacity>
          {showPrivateField && (
            <View style={s.section}>
              <TextInput
                style={[s.textarea, { borderColor: C.primaryBorder }]}
                value={privateNote}
                onChangeText={setPrivateNote}
                multiline
                numberOfLines={3}
                placeholder="Confidential. Sent only to NEXPEC admins."
                placeholderTextColor={C.textMuted}
                maxLength={1000}
                textAlignVertical="top"
              />
            </View>
          )}

          {/* ── Submit ────────────────────────────────────── */}
          <TouchableOpacity
            style={[
              s.primaryBtn,
              (rating === 0 || submitting) && s.primaryBtnDisabled,
            ]}
            onPress={handleSubmit}
            disabled={rating === 0 || submitting}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Ionicons name="send" size={16} color="#FFF" />
                <Text style={s.primaryBtnText}>Submit Review</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={s.footerNote}>
            Reviews are immutable once submitted. Admins can moderate abusive content.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default ReviewSubmissionScreen;

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  centeredFlex: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },

  // ── Reviewee header card ────────────────────────────────
  revieweeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 18,
  },
  revieweeAvatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: C.surfaceDeep,
  },
  revieweeAvatarFallback: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: C.primaryBg,
    borderWidth: 1,
    borderColor: C.primaryBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  revieweeInitials: {
    fontSize: 16,
    fontWeight: '800',
    color: C.primaryLight,
    letterSpacing: 0.3,
  },
  revieweeLabel: {
    fontSize: 10,
    color: C.textMuted,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  revieweeName: {
    fontSize: 16,
    fontWeight: '800',
    color: C.textPrimary,
    marginTop: 2,
    letterSpacing: -0.1,
  },
  revieweeMeta: {
    fontSize: 11,
    color: C.textSecondary,
    marginTop: 2,
    fontWeight: '600',
  },
  verifiedBadge: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(16,185,129,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Section blocks ───────────────────────────────────────
  section: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: C.textPrimary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  optional: {
    color: C.textMuted,
    fontWeight: '500',
    textTransform: 'none',
    letterSpacing: 0,
  },

  // ── Star picker ──────────────────────────────────────────
  starPickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    marginVertical: 6,
  },
  starHint: {
    fontSize: 12,
    color: C.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    fontWeight: '600',
    letterSpacing: 0.2,
    minHeight: 16,
  },

  // ── Textarea ─────────────────────────────────────────────
  textarea: {
    minHeight: 96,
    backgroundColor: C.surfaceDeep,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    color: C.textPrimary,
    fontSize: 14,
    padding: 12,
    lineHeight: 20,
  },
  charCount: {
    fontSize: 10,
    color: C.textMuted,
    textAlign: 'right',
    marginTop: 6,
    fontVariant: ['tabular-nums'],
  },

  // ── Public toggle row ───────────────────────────────────
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toggleTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: C.textPrimary,
    letterSpacing: 0.2,
  },
  toggleSub: {
    fontSize: 11,
    color: C.textMuted,
    marginTop: 3,
    lineHeight: 15,
  },

  // ── Private collapsible ─────────────────────────────────
  privateToggle: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 12,
  },
  privateToggleTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: C.textPrimary,
    letterSpacing: 0.1,
  },
  privateToggleSub: {
    fontSize: 11,
    color: C.textMuted,
    marginTop: 3,
    lineHeight: 15,
  },

  // ── Primary CTA ──────────────────────────────────────────
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 15,
    marginTop: 4,
  },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  footerNote: {
    fontSize: 11,
    color: C.textMuted,
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 16,
  },

  // ── Error state ──────────────────────────────────────────
  errorWrap: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 28,
  },
  errorIcon: {
    width: 64, height: 64, borderRadius: 18,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: C.textPrimary,
    marginBottom: 6,
  },
  errorSubtitle: {
    fontSize: 13,
    color: C.textMuted,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 320,
    marginBottom: 22,
  },
  errorBack: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: C.primaryBg,
    borderWidth: 1,
    borderColor: C.primaryBorder,
    borderRadius: 10,
  },
  errorBackText: {
    color: C.primaryLight,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // ── Success state ────────────────────────────────────────
  successWrap: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 28,
  },
  successIcon: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: 'rgba(16,185,129,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.35)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 18,
  },
  successTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: C.textPrimary,
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 13,
    color: C.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 320,
    marginBottom: 26,
  },
});
