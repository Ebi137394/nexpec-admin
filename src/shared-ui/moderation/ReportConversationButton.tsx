// ════════════════════════════════════════════════════════════════════════════
//  ReportConversationButton — UGC moderation entry point (Apple 1.2 / Play UGC)
//
//  A small flag control for any chat surface. Tapping it offers the standard
//  report reasons and files through public.report_conversation(), which routes
//  the report into the reporter's staffed NEXPEC support lane and writes an
//  audit_events row. Works for pending accounts too — support is the one lane
//  they keep.
//
//  Deliberately self-contained: no navigation assumptions, no styling deps
//  beyond a hit-slopped emoji glyph, so every chat screen can mount it in its
//  own header row without layout surgery.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback } from 'react';
import { Alert, Pressable, Text, StyleSheet } from 'react-native';
import { supabase } from '@/lib/supabase';

const REASONS = [
  'Inappropriate or offensive content',
  'Harassment or abusive behaviour',
  'Spam or misleading content',
] as const;

export function ReportConversationButton({ conversationId }: { conversationId?: string | null }) {
  const file = useCallback(
    async (reason: string) => {
      if (!conversationId) return;
      const { error } = await supabase.rpc('report_conversation', {
        p_conversation_id: conversationId,
        p_reason: reason,
      });
      if (error) {
        Alert.alert('Could not send report', error.message);
      } else {
        Alert.alert(
          'Report sent',
          'Thank you. The NEXPEC moderation team reviews every report and will follow up in your Support conversation.',
        );
      }
    },
    [conversationId],
  );

  const open = useCallback(() => {
    if (!conversationId) return;
    Alert.alert('Report this conversation', 'What is the problem?', [
      ...REASONS.map((r) => ({ text: r, onPress: () => void file(r) })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, [conversationId, file]);

  if (!conversationId) return null;
  return (
    <Pressable
      onPress={open}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel="Report this conversation"
      style={styles.btn}
    >
      <Text style={styles.glyph}>⚑</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { paddingHorizontal: 8, paddingVertical: 4 },
  glyph: { fontSize: 18, color: '#94A3B8' },
});
