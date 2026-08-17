// ════════════════════════════════════════════════════════════════════════════
//  app/(inspector)/reviews/[reportId].tsx — Senior Inspector review detail
//
//  P1-4. index.tsx:259 has been pushing to this route since the mobile inbox
//  shipped, and the route did not exist — every tap was a dead navigation. It
//  also means enqueueSeniorReviewDecide had no production caller: the offline
//  decide path was built and tested but unreachable from any surface. This is
//  where both are closed.
//
//  ── AUTHORITY BOUNDARIES, ENFORCED BY OMISSION ─────────────────────────────
//  NO DELIVERY CONTROL. deliverReportToClient / nx_admin_deliver_report are not
//  imported here and must never be. Final delivery to the Client is an Admin
//  act; a Senior Inspector surface must not render the control at all, quite
//  apart from the server refusing it (20260801458000's delivery guard).
//
//  NO MONEY. No client price, no inspector payout, no platform spread, no
//  funding figure is read or displayed. Review is not a commercial surface.
//
//  NO PAYMENT MUTATION. Nothing here writes a wallet, transaction, payout or
//  funding stage.
//
//  ── DECISIONS GO THROUGH THE OUTBOX, ALWAYS ────────────────────────────────
//  Even online. Site connectivity is unreliable and a half-sent decision is
//  worse than a queued one — the queue is durable, idempotent on client_op_id,
//  and drains on reconnect. The decision carries `expectedRound`
//  (20260801460000), so an approval composed against one round can never land
//  on a later one; the server refuses with REVIEW_ROUND_CHANGED, which the
//  classifier treats as fatal and surfaces rather than retrying.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { fetchReviewRounds } from '@nexpec/shared-core/src/net/fundingReview';
import {
  isLiveRound,
  latestRound,
  isDecisionSubmittable,
  REVIEW_DECISION,
  type ReviewDecision,
  type SeniorReviewRound,
} from '@nexpec/shared-core/src/domain/seniorReview';

import { enqueueSeniorReviewDecide } from '@/src/core/offline';
import { flushQueue } from '@/src/core/offline/sync';

import {
  currentUserId,
  errorMessage,
  fetchReportUnderReview,
  formatTimestamp,
  mintEvidenceUrls,
  type EvidenceItem,
  type ReportUnderReview,
} from '@/src/features/reviews/mobile/reviewClient';
import { roundState, ROUND_STATE_META } from '@/src/features/reviews/mobile/roundState';

const C = {
  bg: '#020420', card: '#0B1138',
  border: 'rgba(255,255,255,0.06)',
  text: '#FFFFFF', textSec: '#A8B2C7', textMute: '#6B7390',
  primary: '#7C3AED',
  cyan: '#00FFFF', green: '#10B981', amber: '#F59E0B', red: '#EF4444',
};

type Phase = 'loading' | 'ready' | 'error' | 'denied';

export default function SeniorReviewDetailScreen() {
  const { reportId } = useLocalSearchParams<{ reportId: string }>();

  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [report, setReport] = useState<ReportUnderReview | null>(null);
  const [rounds, setRounds] = useState<SeniorReviewRound[]>([]);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);

  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState<ReviewDecision | null>(null);
  const [done, setDone] = useState<ReviewDecision | null>(null);

  const load = useCallback(async () => {
    if (!reportId) return;
    setPhase('loading');
    setError(null);
    try {
      const me = await currentUserId();
      if (!me) {
        setError('You must be signed in to review reports.');
        setPhase('error');
        return;
      }
      setUid(me);

      const [rep, rds] = await Promise.all([
        fetchReportUnderReview(reportId),
        fetchReviewRounds(reportId),
      ]);

      // RLS is the authority. No body means it is not released to this
      // account — say so plainly rather than retrying with a wider query.
      if (!rep) {
        setPhase('denied');
        return;
      }

      setReport(rep);
      setRounds([...rds]);
      setEvidence(await mintEvidenceUrls(rep.doc));
      setPhase('ready');
    } catch (e) {
      setError(errorMessage(e, 'Could not load this review.'));
      setPhase('error');
    }
  }, [reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  const live = rounds.find(isLiveRound) ?? null;
  const shown = live ?? latestRound(rounds);
  const isMyLiveRound = live != null && uid != null && live.reviewerId === uid;

  async function decide(decision: ReviewDecision) {
    if (!live || !reportId) return;
    if (!isDecisionSubmittable(decision, comments)) {
      setError('A returned report needs a comment saying what must change.');
      return;
    }
    setSubmitting(decision);
    setError(null);
    try {
      await enqueueSeniorReviewDecide({
        reportId: String(reportId),
        decision,
        comments: comments.trim() || null,
        // pins the decision to the round actually read — 20260801460000
        expectedRound: live.round,
      });
      // Best effort: if there is signal it lands now, otherwise it drains later.
      await flushQueue().catch(() => undefined);
      setDone(decision);
      await load();
    } catch (e) {
      setError(errorMessage(e, 'Could not record your decision.'));
    } finally {
      setSubmitting(null);
    }
  }

  // ── states ────────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <View style={s.center} accessibilityRole="progressbar" accessibilityLabel="Loading review">
        <ActivityIndicator color={C.cyan} />
        <Text style={s.centerText}>Loading review…</Text>
      </View>
    );
  }

  if (phase === 'denied') {
    return (
      <View style={s.center}>
        <Text style={s.centerTitle} accessibilityRole="header">
          Not available to your account
        </Text>
        <Text style={s.centerText}>
          This report has not been released to you for review. If you were
          recently assigned, pull back and reopen your inbox.
        </Text>
        <TouchableOpacity style={s.btnGhost} onPress={() => router.back()} accessibilityRole="button">
          <Text style={s.btnGhostText}>Back to inbox</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={s.center}>
        <Text style={s.centerTitle} accessibilityRole="alert">Something went wrong</Text>
        <Text style={s.centerText}>{error}</Text>
        <TouchableOpacity style={s.btnGhost} onPress={() => void load()} accessibilityRole="button">
          <Text style={s.btnGhostText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const meta = shown ? ROUND_STATE_META[roundState(shown)] : null;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back to inbox">
        <Text style={s.back}>‹ Inbox</Text>
      </TouchableOpacity>

      <Text style={s.h1} accessibilityRole="header">Report under review</Text>

      {meta && shown && (
        <View style={[s.pill, { borderColor: meta.tone + '55', backgroundColor: meta.tone + '1A' }]}>
          <Text style={[s.pillText, { color: meta.tone }]}>
            {meta.label.toUpperCase()} · ROUND {shown.round}
          </Text>
        </View>
      )}
      {meta && <Text style={s.muted}>{meta.description}</Text>}

      {/* Replacement / supersession messaging */}
      {live && !isMyLiveRound && (
        <View style={s.notice} accessibilityRole="alert">
          <Text style={s.noticeText}>
            The live round is assigned to another Senior Inspector. You can read
            the history, but you cannot decide this round.
          </Text>
        </View>
      )}
      {!live && (
        <View style={s.notice}>
          <Text style={s.noticeText}>
            There is no live round on this report. Nothing is awaiting your
            decision.
          </Text>
        </View>
      )}

      {/* Report body */}
      <Text style={s.h2}>Summary</Text>
      <Text style={s.body}>
        {report?.doc?.summary ?? report?.notes ?? 'No summary provided.'}
      </Text>
      {report?.doc?.result ? (
        <Text style={s.muted}>Result: {report.doc.result}</Text>
      ) : null}
      <Text style={s.muted}>Updated {formatTimestamp(report?.updatedAt)}</Text>

      {/* Evidence */}
      <Text style={s.h2}>Evidence</Text>
      {evidence.length === 0 ? (
        <Text style={s.muted}>No photo evidence attached.</Text>
      ) : (
        evidence.map((e) => (
          <View key={e.path} style={s.evidence}>
            {e.url ? (
              <Image
                source={{ uri: e.url }}
                style={s.photo}
                accessibilityLabel={e.caption ?? 'Report evidence photo'}
              />
            ) : (
              <Text style={s.muted}>
                This photo is not authorised for your account.
              </Text>
            )}
            {e.caption ? <Text style={s.caption}>{e.caption}</Text> : null}
          </View>
        ))
      )}

      {/* Decision */}
      {isMyLiveRound && !done && (
        <>
          <Text style={s.h2}>Your decision</Text>
          <Text style={s.muted}>
            A returned report must say what has to change. Approving sends it to
            an Admin for final delivery — you do not deliver to the Client.
          </Text>

          <TextInput
            style={s.input}
            value={comments}
            onChangeText={setComments}
            placeholder="Comments for the Inspector"
            placeholderTextColor={C.textMute}
            multiline
            accessibilityLabel="Comments for the Inspector"
          />

          {error ? (
            <Text style={s.error} accessibilityRole="alert">{error}</Text>
          ) : null}

          <TouchableOpacity
            style={[s.btn, { backgroundColor: C.green }]}
            disabled={submitting !== null}
            onPress={() => void decide(REVIEW_DECISION.APPROVED)}
            accessibilityRole="button"
            accessibilityLabel="Approve this report"
          >
            <Text style={s.btnText}>
              {submitting === 'approved' ? 'Approving…' : 'Approve'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.btn, { backgroundColor: C.amber }]}
            disabled={submitting !== null || comments.trim().length === 0}
            onPress={() => void decide(REVIEW_DECISION.RETURNED)}
            accessibilityRole="button"
            accessibilityLabel="Return this report with comments"
          >
            <Text style={s.btnText}>
              {submitting === 'returned' ? 'Returning…' : 'Return with comments'}
            </Text>
          </TouchableOpacity>
        </>
      )}

      {done && (
        <View style={s.notice} accessibilityRole="alert">
          <Text style={s.noticeText}>
            Your decision is recorded and will sync if you are offline. An Admin
            handles final delivery to the Client.
          </Text>
        </View>
      )}

      {/* Immutable history */}
      <Text style={s.h2}>Decision history</Text>
      {rounds.length === 0 ? (
        <Text style={s.muted}>No rounds yet.</Text>
      ) : (
        rounds
          .slice()
          .sort((a, b) => b.round - a.round)
          .map((r) => {
            const m = ROUND_STATE_META[roundState(r)];
            return (
              <View key={r.id} style={s.historyRow}>
                <Text style={[s.historyLabel, { color: m.tone }]}>
                  Round {r.round} · {m.label}
                </Text>
                {r.comments ? <Text style={s.body}>{r.comments}</Text> : null}
                <Text style={s.muted}>
                  {r.decidedAt
                    ? `Decided ${formatTimestamp(r.decidedAt)}`
                    : `Assigned ${formatTimestamp(r.assignedAt)}`}
                </Text>
              </View>
            );
          })
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 20, paddingBottom: 64, gap: 10 },
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  centerTitle: { color: C.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  centerText: { color: C.textSec, fontSize: 14, textAlign: 'center' },
  back: { color: C.textSec, fontSize: 14, marginBottom: 4 },
  h1: { color: C.text, fontSize: 24, fontWeight: '700' },
  h2: { color: C.text, fontSize: 16, fontWeight: '700', marginTop: 18 },
  body: { color: C.textSec, fontSize: 14, lineHeight: 20 },
  muted: { color: C.textMute, fontSize: 12 },
  caption: { color: C.textMute, fontSize: 12, marginTop: 4 },
  pill: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  notice: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 14, padding: 12 },
  noticeText: { color: C.textSec, fontSize: 13, lineHeight: 19 },
  evidence: { marginTop: 8 },
  photo: { width: '100%', height: 200, borderRadius: 12, backgroundColor: C.card },
  input: {
    backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12,
    color: C.text, padding: 12, minHeight: 96, textAlignVertical: 'top', marginTop: 8,
  },
  btn: { borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  btnText: { color: '#04121B', fontSize: 15, fontWeight: '700' },
  btnGhost: { borderColor: C.border, borderWidth: 1, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 20, marginTop: 8 },
  btnGhostText: { color: C.text, fontSize: 14, fontWeight: '600' },
  error: { color: C.red, fontSize: 13, marginTop: 8 },
  historyRow: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 8, gap: 4 },
  historyLabel: { fontSize: 13, fontWeight: '700' },
});
