// ════════════════════════════════════════════════════════════════════════════
//  src/shared-ui/ai/DefectFindingsCard.tsx — the Universal AI Co-Inspector card
//
//  Presentational + generic over the defect taxonomy: it renders ANY
//  DefectAnalysis (corrosion, cracks, pitting, coating failure, weld defects …)
//  with no per-defect hardcoding. Swap in a better model → this UI is unchanged.
//
//  Liability-shield framing baked in: "AI drafts — you verify & seal." Each
//  detection has an explicit "Add as finding" action; nothing is auto-applied.
//  Additive + unwired (no screen imports it yet) → zero UI/UX breakage.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DefectAnalysis, DefectDetection } from '@nexpec/shared-core';
import { AI_BETA_WARNING } from './AiBetaDisclaimer';

const COLORS = {
  card: '#161C36',
  border: '#2A3354',
  violet: '#8B5CF6',
  amber: '#FBBF24',
  red: '#F87171',
  mint: '#34D399',
  text: '#F1F5F9',
  muted: '#9AA8C7',
  dim: '#64748B',
  track: '#0E1530',
};

function confColor(c: number): string {
  if (c >= 0.8) return COLORS.red;
  if (c >= 0.6) return COLORS.amber;
  return COLORS.muted;
}

interface Props {
  analysis: DefectAnalysis | null;
  loading?: boolean;
  onAddFinding?: (detection: DefectDetection) => void;
  onDismiss?: (detection: DefectDetection) => void;
  /** Long-press a finding row to reclassify it (the label morphs in place). */
  onReclassify?: (detection: DefectDetection) => void;
}

export function DefectFindingsCard({ analysis, loading, onAddFinding, onDismiss, onReclassify }: Props) {
  if (!loading && (!analysis || analysis.detections.length === 0)) {
    // Render nothing-of-substance when there's no analysis → no layout intrusion.
    if (!analysis) return null;
    return (
      <View style={styles.card}>
        <Header />
        <Text style={styles.empty}>No defects detected above threshold.</Text>
        <Attribution analysis={analysis} />
        <Text style={styles.betaWarning}>{AI_BETA_WARNING}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Header />
      {loading && <Text style={styles.empty}>Analyzing on-device…</Text>}
      {analysis?.detections.map((d) => (
        <Pressable key={d.defectId} style={styles.row} onLongPress={() => onReclassify?.(d)} delayLongPress={300}>
          <View style={styles.rowTop}>
            <Text style={styles.defectLabel}>{d.label}</Text>
            {!!d.severity && (
              <View style={styles.gradePill}>
                <Text style={styles.gradeText}>
                  {d.severity}
                  {d.severityScale ? `, ${d.severityScale}` : ''}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.confRow}>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  { width: `${Math.max(3, Math.min(100, d.confidence * 100))}%`, backgroundColor: confColor(d.confidence) },
                ]}
              />
            </View>
            <Text style={styles.confText}>{Math.round(d.confidence * 100)}%</Text>
          </View>

          {!!d.standardRefs?.length && (
            <Text style={styles.standards}>{d.standardRefs.join(', ')}</Text>
          )}

          <View style={styles.actions}>
            <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => onAddFinding?.(d)} activeOpacity={0.85}>
              <Ionicons name="add-circle-outline" size={15} color="#fff" />
              <Text style={styles.btnPrimaryText}>Add as finding</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={() => onDismiss?.(d)} activeOpacity={0.7}>
              <Text style={styles.btnText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      ))}
      {analysis && <Attribution analysis={analysis} />}
      {/* Owner release order: the Beta/advisory warning rides BESIDE every AI
          result — inside the universal card so no consumer can omit it. */}
      <Text style={styles.betaWarning}>{AI_BETA_WARNING}</Text>
    </View>
  );
}

function Header() {
  return (
    <View style={styles.header}>
      <View style={styles.headerIcon}>
        <Ionicons name="sparkles-outline" size={14} color={COLORS.violet} />
      </View>
      <Text style={styles.headerTitle}>AI Co-Inspector</Text>
      <Text style={styles.headerHint}>hold to reclassify, you seal</Text>
    </View>
  );
}

function Attribution({ analysis }: { analysis: DefectAnalysis }) {
  return (
    <Text style={styles.attribution}>
      {analysis.modelSlug} v{analysis.modelVersion}, {analysis.inferenceMs} ms, on-device, AI suggestion, verify before sealing
    </Text>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: COLORS.card, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 14, marginVertical: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  headerIcon: { width: 24, height: 24, borderRadius: 7, backgroundColor: 'rgba(124,58,237,0.16)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  headerHint: { color: COLORS.dim, fontSize: 11, marginLeft: 'auto' },
  empty: { color: COLORS.muted, fontSize: 13, paddingVertical: 8 },
  row: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', paddingTop: 10, marginTop: 6 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  defectLabel: { color: COLORS.text, fontSize: 14, fontWeight: '600', flex: 1, paddingRight: 8 },
  gradePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1, borderColor: COLORS.amber },
  gradeText: { color: COLORS.amber, fontSize: 10, fontWeight: '800' },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  track: { flex: 1, height: 7, borderRadius: 4, backgroundColor: COLORS.track, overflow: 'hidden' },
  fill: { height: '100%' },
  confText: { color: COLORS.muted, fontSize: 11, width: 38, textAlign: 'right', fontVariant: ['tabular-nums'] },
  standards: { color: COLORS.dim, fontSize: 11, marginTop: 6, fontFamily: 'Courier' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border },
  btnPrimary: { backgroundColor: COLORS.violet, borderColor: COLORS.violet },
  btnPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  btnText: { color: COLORS.muted, fontSize: 13, fontWeight: '600' },
  attribution: { color: COLORS.dim, fontSize: 10, marginTop: 12, fontFamily: 'Courier' },
  betaWarning: {
    color: '#E6D9B8',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(251,191,36,0.35)',
  },
});
