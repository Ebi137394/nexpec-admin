// ════════════════════════════════════════════════════════════════════════════
//  src/components/legal/LegalDocumentViewer.tsx
//
//  Full-screen document viewer. Renders a single legal document with:
//    - back header
//    - version + ID badge
//    - "Accepted on X" pill (or unaccepted state with optional Accept CTA)
//    - "Incorporates" chip row (cross-links to other documents)
//    - full markdown body via MarkdownView
//
//  Mounted by app/profile/document/[id].tsx. UI-frozen apart from this surface.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/providers/ThemeProvider';
import { getColors } from '@/src/constants/theme';
import MarkdownView from './MarkdownView';
import type { LegalDocument } from '@/src/legal/types';
import { formatLegalDocumentDisplayId } from '@/src/legal/registry';

interface Props {
  document: LegalDocument | null;
  acceptedAt?: string | null;
  /** Optional Accept CTA — surfaces only when not yet accepted. */
  onAccept?: () => void | Promise<void>;
  /** Loading flag for async accept. */
  accepting?: boolean;
  /** Tap handler when the user taps a related/incorporated doc chip. */
  onIncorporatedPress?: (docId: string) => void;
}

export const LegalDocumentViewer: React.FC<Props> = ({
  document,
  acceptedAt,
  onAccept,
  accepting,
  onIncorporatedPress,
}) => {
  const router = useRouter();
  const { isDarkMode } = useTheme();
  const colors = getColors(isDarkMode);

  if (!document) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
        <View style={styles.loadingWrap}>
          <Text style={{ color: colors.textSecondary }}>Document not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            borderBottomColor: isDarkMode
              ? 'rgba(255, 255, 255, 0.08)'
              : 'rgba(0, 0, 0, 0.08)',
          },
        ]}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text
          style={[styles.headerTitle, { color: colors.text }]}
          numberOfLines={1}
        >
          {document.title}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Version/ID badge row */}
        <View style={styles.metaRow}>
          <View
            style={[
              styles.metaPill,
              { borderColor: colors.primary + '40', backgroundColor: colors.primary + '14' },
            ]}
          >
            <Text style={[styles.metaPillText, { color: colors.primary }]}>
              {formatLegalDocumentDisplayId(document.id)} · v{document.version}
            </Text>
          </View>
          {acceptedAt ? (
            <View
              style={[
                styles.metaPill,
                {
                  borderColor: '#10B981' + '50',
                  backgroundColor: '#10B981' + '18',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                },
              ]}
            >
              <Ionicons name="checkmark-circle" size={13} color="#10B981" />
              <Text style={[styles.metaPillText, { color: '#10B981' }]}>
                Accepted {formatDate(acceptedAt)}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Incorporates chips */}
        {document.incorporates.length > 0 ? (
          <View style={styles.incorpRow}>
            <Text style={[styles.incorpLabel, { color: colors.textSecondary }]}>
              Incorporates:
            </Text>
            <View style={styles.incorpChips}>
              {document.incorporates.map((ref) => (
                <TouchableOpacity
                  key={`${ref.id}-${ref.version}`}
                  onPress={() => onIncorporatedPress?.(ref.id)}
                  style={[
                    styles.incorpChip,
                    {
                      borderColor: isDarkMode
                        ? 'rgba(255, 255, 255, 0.12)'
                        : 'rgba(0, 0, 0, 0.12)',
                    },
                  ]}
                >
                  <Text
                    style={[styles.incorpChipText, { color: colors.textSecondary }]}
                  >
                    {ref.id} · v{ref.version}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}

        {/* Body */}
        <View style={styles.body}>
          <MarkdownView markdown={document.bodyMd} colors={colors as any} />
        </View>

        {/* Bottom CTA — accept */}
        {onAccept && !acceptedAt ? (
          <TouchableOpacity
            onPress={() => void onAccept()}
            disabled={accepting}
            activeOpacity={0.85}
            style={[
              styles.acceptCta,
              {
                backgroundColor: colors.primary,
                opacity: accepting ? 0.7 : 1,
              },
            ]}
          >
            {accepting ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={18} color="#FFF" />
                <Text style={styles.acceptCtaText}>
                  Accept {document.id} v{document.version}
                </Text>
              </>
            )}
          </TouchableOpacity>
        ) : null}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700' },
  scroll: { paddingHorizontal: 18, paddingVertical: 16 },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  metaPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  metaPillText: { fontSize: 11.5, fontWeight: '700', letterSpacing: 0.3 },
  incorpRow: { marginTop: 4, marginBottom: 6 },
  incorpLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6 },
  incorpChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  incorpChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  incorpChipText: { fontSize: 11, fontWeight: '600' },
  body: { marginTop: 8 },
  acceptCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 16,
  },
  acceptCtaText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
});

export default LegalDocumentViewer;
