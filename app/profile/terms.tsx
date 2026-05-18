// ════════════════════════════════════════════════════════════════════════════
//  app/profile/terms.tsx — Terms & Privacy section (Checkpoint 4)
//
//  REPLACES the pre-Checkpoint-4 plain-scroll terms page. Renders the
//  Tier-1 platform docs (TOS-001 + PRIV-001) as version-pinned cards,
//  with the user's acceptance state surfaced as a pill on each card.
//  Tap a card → /profile/document/[id] viewer.
// ════════════════════════════════════════════════════════════════════════════

import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { getColors } from '@/src/constants/theme';
import { useAuth } from '@/src/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { useResolvedLegalStack } from '@/src/legal/useResolvedLegalStack';
import { useAcceptances } from '@/src/legal/useAcceptances';
import { LegalDocumentCard } from '@/src/components/legal/LegalDocumentCard';
import type { LegalUserRole } from '@/src/legal/types';

export default function TermsPrivacyScreen() {
  const router = useRouter();
  const { isDarkMode } = useTheme();
  const colors = getColors(isDarkMode);
  const { session } = useAuth();

  const [role, setRole] = useState<LegalUserRole | null>(null);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) {
      setRole(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();
      if (!cancelled) {
        setRole((data?.role as LegalUserRole | null) ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const { termsPrivacy } = useResolvedLegalStack(role);
  const { getAcceptance } = useAcceptances(session?.user?.id ?? null);

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
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Terms & Privacy
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.lede, { color: colors.textSecondary }]}>
          These platform-level documents apply to every NEXPEC user. Tap any
          card to read the full text.
        </Text>

        {termsPrivacy.map((doc) => {
          const acceptance = getAcceptance(doc.id, doc.version);
          return (
            <LegalDocumentCard
              key={doc.id}
              document={doc}
              acceptedAt={acceptance?.acceptedAt ?? null}
              colors={{ ...(colors as any), isDarkMode }}
              onPress={() =>
                router.push(`/profile/document/${doc.id}` as any)
              }
            />
          );
        })}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  lede: { fontSize: 13.5, lineHeight: 20, marginBottom: 14 },
});
