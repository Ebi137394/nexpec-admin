// ─────────────────────────────────────────────────────────────────
//  src/shared-ui/ai/AiBetaDisclaimer.tsx — mandatory Beta/Advisory
//  labelling for every AI Co-Inspector surface (owner release order,
//  2026-08-18): the AI ships ENABLED but advisory-only.
//
//  Two pieces:
//   • AI_BETA_WARNING — the exact required wording, rendered BESIDE
//     every AI result (AiBetaDisclaimer) and inside the findings card.
//   • AiBetaFirstUseNotice — a one-time, non-blocking acknowledgement
//     banner on first use (AsyncStorage-backed). It never gates the
//     manual inspection flow; dismissing it is purely an acknowledgement.
// ─────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const AI_BETA_WARNING =
  'AI Co-Inspector (Beta): Results may be incomplete or incorrect. A qualified ' +
  'inspector must independently verify all findings. Do not use AI as the sole ' +
  'basis for safety, acceptance, rejection, or code-compliance decisions.';

const ACK_KEY = 'nexpec.ai_beta_ack.v1';

/** Compact persistent warning — render beside every AI result. */
export function AiBetaDisclaimer() {
  return (
    <View style={st.box} testID="ai-beta-disclaimer">
      <Text style={st.badge}>BETA · ADVISORY ONLY</Text>
      <Text style={st.text}>{AI_BETA_WARNING}</Text>
    </View>
  );
}

/** One-time first-use notice. Non-blocking: the AI panel and the manual flow
 *  render regardless; the button only records the acknowledgement. */
export function AiBetaFirstUseNotice() {
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(ACK_KEY)
      .then((v) => alive && setSeen(v === '1'))
      .catch(() => alive && setSeen(false));
    return () => {
      alive = false;
    };
  }, []);

  if (seen !== false) return null; // unknown-yet or already acknowledged

  return (
    <View style={[st.box, st.firstUse]} testID="ai-beta-first-use">
      <Text style={st.badge}>FIRST USE — PLEASE READ</Text>
      <Text style={st.text}>{AI_BETA_WARNING}</Text>
      <TouchableOpacity
        style={st.ackBtn}
        activeOpacity={0.85}
        testID="ai-beta-ack"
        onPress={() => {
          setSeen(true);
          AsyncStorage.setItem(ACK_KEY, '1').catch(() => {
            /* best-effort; the persistent per-result warning still renders */
          });
        }}
      >
        <Text style={st.ackText}>I understand — findings require my verification</Text>
      </TouchableOpacity>
    </View>
  );
}

const st = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderColor: '#FBBF24',
    backgroundColor: 'rgba(251,191,36,0.08)',
    borderRadius: 10,
    padding: 10,
    marginVertical: 8,
    gap: 6,
  },
  firstUse: { borderColor: '#F87171', backgroundColor: 'rgba(248,113,113,0.08)' },
  badge: { color: '#FBBF24', fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  text: { color: '#E6D9B8', fontSize: 11, lineHeight: 16 },
  ackBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#FBBF24',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 2,
  },
  ackText: { color: '#FBBF24', fontSize: 11, fontWeight: '700' },
});
