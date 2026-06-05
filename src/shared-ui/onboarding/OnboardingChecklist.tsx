// ════════════════════════════════════════════════════════════════════════════
//  src/shared-ui/onboarding/OnboardingChecklist.tsx
//
//  Sprint 13.M1 — React Native onboarding checklist card.
//
//  Mirrors the web widget's behaviour exactly:
//    1. Loading       — skeleton row
//    2. Hidden        — admin / no user / dismissed-when-complete
//    3. Active        — gradient card with progress bar + 5-7 step rows
//    4. Dismissed     — tiny restore strip
//
//  Self-suppressing. Caller mounts unconditionally at the top of its
//  dashboard ScrollView and the component decides whether to render.
//
//  Aesthetic: pulls from the dark/violet palette already in use across
//  the mobile dashboards (LinearGradient surfaces, #7C3AED accent,
//  Ionicons). Matches the SA theme's spirit without depending on the
//  SA constants directly (this card lands on client dashboards too,
//  not just super-admin).
// ════════════════════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  useOnboardingChecklist,
  type ChecklistStep,
} from '@/src/hooks/useOnboardingChecklist';

const COLORS = {
  text: '#FFFFFF',
  textMuted: '#94A3B8',
  textDim: '#64748B',
  textBright: '#E2E8F0',
  border: 'rgba(255,255,255,0.08)',
  borderViolet: 'rgba(124,58,237,0.32)',
  surface: 'rgba(30,41,59,0.55)',
  surfaceDeeper: 'rgba(15,23,42,0.55)',
  violet: '#7C3AED',
  violetGlow: '#A78BFA',
  violetSoft: 'rgba(124,58,237,0.12)',
  emerald: '#10B981',
  emeraldSoft: 'rgba(16,185,129,0.16)',
  amber: '#FBBF24',
};

interface Props {
  kicker?: string;
  title?: string;
}

export function OnboardingChecklist({
  kicker = 'Get started',
  title = 'Finish setting up your account',
}: Props) {
  const { data, loading, dismiss, restore } = useOnboardingChecklist();
  const [dismissing, setDismissing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  if (loading) {
    return (
      <View style={styles.skeletonCard}>
        <ActivityIndicator size="small" color={COLORS.violetGlow} />
      </View>
    );
  }

  if (!data || data.total === 0) return null;

  const allComplete = data.completed === data.total;

  // Dismissed pre-completion → tiny restore strip.
  if (data.dismissed && !allComplete) {
    return (
      <View style={styles.restoreStrip}>
        <Text style={styles.restoreText}>
          Onboarding hidden ({data.completed}/{data.total} done)
        </Text>
        <TouchableOpacity
          disabled={restoring}
          onPress={async () => {
            setRestoring(true);
            await restore();
            setRestoring(false);
          }}
        >
          <Text style={styles.restoreLink}>
            {restoring ? 'Restoring…' : 'Show'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Dismissed AND complete → render nothing.
  if (data.dismissed && allComplete) return null;

  return (
    <LinearGradient
      colors={['rgba(124,58,237,0.16)', 'rgba(15,23,42,0.5)']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.headerTextWrap}>
          <View style={styles.kickerRow}>
            <Ionicons
              name="sparkles"
              size={11}
              color={COLORS.violetGlow}
              style={styles.kickerIcon}
            />
            <Text style={styles.kicker}>{kicker}</Text>
          </View>
          <Text style={styles.title}>
            {allComplete ? 'You are all set!' : title}
          </Text>
          {!allComplete && (
            <Text style={styles.subtitle}>
              A short, role-specific checklist. Steps tick automatically.
            </Text>
          )}
        </View>

        <View style={styles.headerRight}>
          <ProgressPill
            completed={data.completed}
            total={data.total}
            percent={data.percent}
            allDone={allComplete}
          />
          <TouchableOpacity
            disabled={dismissing}
            onPress={async () => {
              setDismissing(true);
              await dismiss();
              setDismissing(false);
            }}
            style={styles.dismissBtn}
            accessibilityLabel="Dismiss onboarding checklist"
          >
            {dismissing ? (
              <ActivityIndicator size="small" color={COLORS.textMuted} />
            ) : (
              <Ionicons name="close" size={14} color={COLORS.textMuted} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { width: `${data.percent}%` },
          ]}
        />
      </View>

      {/* Steps */}
      <View style={styles.stepList}>
        {data.steps.map((s, i) => (
          <StepRow key={s.key} step={s} index={i + 1} />
        ))}
      </View>
    </LinearGradient>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function ProgressPill({
  completed,
  total,
  percent,
  allDone,
}: {
  completed: number;
  total: number;
  percent: number;
  allDone: boolean;
}) {
  const wrapStyle = allDone ? styles.pillDone : styles.pillIdle;
  const textStyle = allDone ? styles.pillTextDone : styles.pillTextIdle;
  return (
    <View style={[styles.pill, wrapStyle]}>
      <Text style={[styles.pillCount, textStyle]}>
        {completed}/{total}
      </Text>
      <Text style={[styles.pillPercent, textStyle]}>{percent}%</Text>
    </View>
  );
}

function StepRow({ step, index }: { step: ChecklistStep; index: number }) {
  const onPress = step.href ? () => router.push(step.href as any) : undefined;
  const containerStyle = step.completed ? styles.stepDone : styles.stepTodo;
  return (
    <View style={[styles.stepRow, containerStyle]}>
      <View style={styles.stepIconWrap}>
        {step.completed ? (
          <Ionicons
            name="checkmark-circle"
            size={20}
            color={COLORS.emerald}
          />
        ) : (
          <Ionicons name="ellipse-outline" size={20} color={COLORS.textDim} />
        )}
      </View>
      <View style={styles.stepTextWrap}>
        <Text style={styles.stepTitle}>
          <Text style={styles.stepIndex}>
            {String(index).padStart(2, '0')}
          </Text>
          {step.title}
        </Text>
        {step.description && (
          <Text style={styles.stepDescription}>{step.description}</Text>
        )}
      </View>
      {!step.completed && onPress && (
        <TouchableOpacity onPress={onPress} style={styles.ctaBtn}>
          <Text style={styles.ctaText}>
            {step.ctaLabel ?? 'Open'}
          </Text>
          <Ionicons
            name="arrow-forward"
            size={11}
            color={COLORS.violetGlow}
            style={styles.ctaArrow}
          />
        </TouchableOpacity>
      )}
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  skeletonCard: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.borderViolet,
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerTextWrap: {
    flex: 1,
    paddingRight: 8,
  },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  kickerIcon: {
    marginRight: 4,
  },
  kicker: {
    color: COLORS.violetGlow,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  title: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillIdle: {
    borderColor: COLORS.border,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  pillDone: {
    borderColor: 'rgba(16,185,129,0.36)',
    backgroundColor: COLORS.emeraldSoft,
  },
  pillCount: {
    fontSize: 11,
    fontWeight: '700',
  },
  pillDot: {
    marginHorizontal: 4,
    fontSize: 11,
    opacity: 0.6,
  },
  pillPercent: {
    fontSize: 10,
    letterSpacing: 0.8,
  },
  pillTextIdle: { color: COLORS.textBright },
  pillTextDone: { color: COLORS.emerald },
  dismissBtn: {
    height: 28,
    width: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  barTrack: {
    marginTop: 14,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: COLORS.violet,
    borderRadius: 3,
  },
  stepList: {
    marginTop: 14,
    gap: 8,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  stepTodo: {
    borderColor: COLORS.border,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  stepDone: {
    borderColor: COLORS.border,
    backgroundColor: 'rgba(16,185,129,0.05)',
  },
  stepIconWrap: {
    marginRight: 10,
    marginTop: 1,
  },
  stepTextWrap: {
    flex: 1,
    paddingRight: 8,
  },
  stepTitle: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  stepIndex: {
    color: COLORS.textDim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  stepDescription: {
    color: COLORS.textMuted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.borderViolet,
    backgroundColor: COLORS.violetSoft,
  },
  ctaText: {
    color: COLORS.violetGlow,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  ctaArrow: {
    marginLeft: 4,
  },
  restoreStrip: {
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'rgba(255,255,255,0.02)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  restoreText: {
    color: COLORS.textMuted,
    fontSize: 11,
  },
  restoreLink: {
    color: COLORS.violetGlow,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
});
