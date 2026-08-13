// ════════════════════════════════════════════════════════════════════════════
//  app/(inspector)/reviews/index.tsx — Senior Inspector review inbox (mobile)
//
//  Web parity with /inspector/reviews: the reports routed to THIS Senior
//  Inspector, bucketed by what they need —
//      Awaiting your decision | Decided | Superseded
//
//  Every bucket decision runs through the frozen contract (canDecide,
//  liveRound, latestRound, isLiveRound) and never through a local re-reading
//  of the columns. Rows come back from fetchReviewRounds(), so this screen
//  invents no round shape of its own.
//
//  NO delivery control (Admin-only; the symbol is not imported anywhere in
//  this route), NO payment control, NO money column.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, StatusBar, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useLanguage } from '@/src/i18n/LanguageProvider';
import { fetchReviewRounds } from '@nexpec/shared-core/src/net/fundingReview';
import {
  canDecide,
  latestRound,
  liveRound,
  type SeniorReviewRound,
} from '@nexpec/shared-core/src/domain/seniorReview';
import {
  currentUserId,
  errorMessage,
  fetchAssignedReportRefs,
  fetchJobTitles,
  formatTimestamp,
} from './reviewClient';
import { roundState, ROUND_STATE_META, type RoundState } from './roundState';

const C = {
  bg: '#020420', card: '#0B1138',
  border: 'rgba(255,255,255,0.06)',
  text: '#FFFFFF', textSec: '#A8B2C7', textMute: '#6B7390',
  primary: '#7C3AED',
  cyan: '#00FFFF', green: '#10B981', amber: '#F59E0B', red: '#EF4444',
};

type Bucket = 'action' | 'decided' | 'superseded';

const SECTIONS: Array<{
  key: Bucket;
  label: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
}> = [
  {
    key: 'action',
    label: 'Awaiting your decision',
    hint: 'Open rounds assigned to you.',
    icon: 'alert-circle-outline',
    tone: C.cyan,
  },
  {
    key: 'decided',
    label: 'Decided',
    hint: 'Rounds you closed. Final, and never editable.',
    icon: 'checkmark-done-outline',
    tone: C.green,
  },
  {
    key: 'superseded',
    label: 'Superseded',
    hint: 'Replaced before you decided them.',
    icon: 'swap-horizontal-outline',
    tone: C.textMute,
  },
];

interface InboxEntry {
  reportId: string;
  jobId: string;
  jobTitle: string | null;
  rounds: SeniorReviewRound[];
  /** True only when the contract says this user may decide the live round. */
  actionable: boolean;
}

function bucketOf(entry: InboxEntry): Bucket {
  if (entry.actionable) return 'action';
  const latest = latestRound(entry.rounds);
  if (latest && latest.decision != null) return 'decided';
  return 'superseded';
}

export default function SeniorReviewInboxScreen() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [entries, setEntries] = useState<InboxEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const userId = await currentUserId();
      if (!userId) {
        setError(t('You must be signed in to review reports.'));
        setEntries([]);
        return;
      }

      const refs = await fetchAssignedReportRefs(userId);

      // fetchReviewRounds() is the contract's per-report reader, so the inbox
      // hydrates each routed report through it rather than re-shaping rows.
      const rounds = await Promise.all(
        refs.map((r) => fetchReviewRounds(r.reportId)),
      );
      const titles = await fetchJobTitles(refs.map((r) => r.jobId));

      setEntries(refs.map((ref, i) => {
        const list = rounds[i] ?? [];
        return {
          reportId: ref.reportId,
          jobId: ref.jobId,
          jobTitle: titles.get(ref.jobId) ?? null,
          rounds: list,
          actionable: canDecide(list, userId),
        };
      }));
    } catch (e: unknown) {
      setError(errorMessage(e, t('Could not load your review inbox.')));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); void load(); }, [load]);

  const buckets = useMemo(() => {
    const b: Record<Bucket, InboxEntry[]> = { action: [], decided: [], superseded: [] };
    entries.forEach((e) => { b[bucketOf(e)].push(e); });
    return b;
  }, [entries]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center} accessibilityRole="progressbar" accessibilityLabel={t('Loading assigned reviews')}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={s.centerText}>{t('Loading assigned reviews…')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const actionable = buckets.action.length;

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('Go back')}
        >
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle} accessibilityRole="header">{t('Assigned reviews')}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />
        }
      >
        <Animated.View entering={FadeIn.duration(200)} style={s.heroWrap}>
          <Text style={s.kicker}>{t('SENIOR INSPECTOR, QUALITY REVIEW')}</Text>
          <Text style={s.title}>{t('Assigned reviews')}</Text>
          <Text style={s.subtitle} accessibilityLiveRegion="polite">
            {entries.length === 0
              ? t('Nothing routed to you yet.')
              : `${actionable} ${t('awaiting your decision')}, ${entries.length} ${t('total')}.`}
          </Text>
          <Text style={s.footnote}>
            {t('Your decision is a quality gate. It moves no money, and delivery of the finished report to the Client stays with Admin.')}
          </Text>
        </Animated.View>

        {error ? (
          <View style={s.errorBanner} accessibilityRole="alert">
            <Ionicons name="alert-circle" size={16} color={C.red} />
            <Text style={s.errorText}>{error}</Text>
            <TouchableOpacity
              onPress={() => { setLoading(true); void load(); }}
              accessibilityRole="button"
              accessibilityLabel={t('Try again')}
            >
              <Text style={s.retryText}>{t('Retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!error && entries.length === 0 ? (
          <View style={s.emptyState}>
            <Ionicons name="clipboard-outline" size={32} color={C.textMute} />
            <Text style={s.emptyText}>
              {t('Reports appear here when Admin assigns you as their Senior Inspector. You will never be assigned a report you authored.')}
            </Text>
          </View>
        ) : null}

        {SECTIONS.map((sec) => {
          const items = buckets[sec.key];
          if (items.length === 0) return null;
          return (
            <Animated.View key={sec.key} entering={FadeInDown.duration(220)} style={{ gap: 8 }}>
              <View style={s.sectionHead}>
                <Ionicons name={sec.icon} size={14} color={sec.tone} />
                <Text style={[s.sectionLabel, { color: sec.tone }]} accessibilityRole="header">
                  {t(sec.label)}
                </Text>
                <View style={[s.countPill, { borderColor: sec.tone + '44', backgroundColor: sec.tone + '14' }]}>
                  <Text style={[s.countPillText, { color: sec.tone }]}>{items.length}</Text>
                </View>
              </View>
              <Text style={s.sectionHint}>{t(sec.hint)}</Text>
              {items.map((entry) => <InboxCard key={entry.reportId} entry={entry} />)}
            </Animated.View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function InboxCard({ entry }: { entry: InboxEntry }) {
  const { t } = useLanguage();
  const shown = liveRound(entry.rounds) ?? latestRound(entry.rounds);
  const state: RoundState | null = shown ? roundState(shown) : null;
  const meta = state ? ROUND_STATE_META[state] : null;
  const label = entry.jobTitle ?? `${t('Report')} ${entry.reportId.slice(0, 8)}`;

  return (
    <TouchableOpacity
      style={s.card}
      activeOpacity={0.8}
      onPress={() => router.push(`/(inspector)/reviews/${entry.reportId}` as never)}
      accessibilityRole="button"
      accessibilityLabel={
        entry.actionable
          ? `${t('Review report')}: ${label}`
          : `${t('View review history')}: ${label}`
      }
      accessibilityHint={meta ? t(meta.description) : undefined}
    >
      <View style={s.cardTop}>
        <Text style={s.cardTitle} numberOfLines={1}>{label}</Text>
        {meta ? (
          <View style={[s.statusPill, { borderColor: meta.tone + '55', backgroundColor: meta.tone + '1A' }]}>
            <Text style={[s.statusPillText, { color: meta.tone }]}>{t(meta.label).toUpperCase()}</Text>
          </View>
        ) : null}
      </View>

      {!entry.jobTitle ? (
        <Text style={s.metaText}>{t('Job title not released to your account.')}</Text>
      ) : null}

      <View style={s.metaRow}>
        <Ionicons name="layers-outline" size={11} color={C.textMute} />
        <Text style={s.metaText}>{t('Round')} {shown ? shown.round : '—'}</Text>
        <Ionicons name="calendar-outline" size={11} color={C.textMute} />
        <Text style={s.metaText}>{formatTimestamp(shown?.assignedAt ?? null)}</Text>
      </View>

      <View style={s.cardBottom}>
        <Text style={[s.cta, { color: entry.actionable ? C.cyan : C.textSec }]}>
          {entry.actionable ? t('Review report') : t('View history')}
        </Text>
        <Ionicons name="chevron-forward" size={14} color={entry.actionable ? C.cyan : C.textSec} />
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { padding: 16, paddingBottom: 56, gap: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14, padding: 32 },
  centerText: { color: C.textSec, fontSize: 13 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerTitle: { color: C.text, fontSize: 16, fontWeight: '700' },

  heroWrap: { gap: 6 },
  kicker: { color: 'rgba(124,58,237,0.85)', fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: C.text, fontSize: 28, fontWeight: '700', marginTop: 4 },
  subtitle: { color: C.textSec, fontSize: 13, lineHeight: 20, marginTop: 4 },
  footnote: { color: C.textMute, fontSize: 11, lineHeight: 16, marginTop: 6 },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(239,68,68,0.14)', borderColor: 'rgba(239,68,68,0.32)',
    borderWidth: 1, padding: 12, borderRadius: 12,
  },
  errorText: { color: '#FCA5A5', fontSize: 13, flex: 1 },
  retryText: { color: '#FCA5A5', fontSize: 12, fontWeight: '800' },

  emptyState: {
    alignItems: 'center', padding: 32, gap: 12, borderRadius: 18, borderWidth: 1,
    borderColor: C.border, borderStyle: 'dashed', backgroundColor: 'rgba(255,255,255,0.01)',
  },
  emptyText: { color: C.textSec, fontSize: 13, textAlign: 'center', lineHeight: 18, maxWidth: 300 },

  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  sectionHint: { color: C.textMute, fontSize: 11 },
  countPill: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, borderWidth: 1 },
  countPillText: { fontSize: 9, fontWeight: '800' },

  card: { borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, padding: 14, gap: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { color: C.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  metaText: { color: C.textMute, fontSize: 11, flexShrink: 1 },
  statusPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  statusPillText: { fontSize: 8, fontWeight: '700', letterSpacing: 0.3 },
  cardBottom: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', paddingTop: 10,
  },
  cta: { fontSize: 12, fontWeight: '700' },
});
