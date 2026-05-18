// ════════════════════════════════════════════════════════════════════════════
//  app/profile/legal.tsx — Legal & Compliance section (Checkpoint 4)
//
//  NEW screen. Renders three groups:
//    1. Acceptable Use Policy (AUP-001) + the user's role-resolved Tier-2
//       Role Agreement (inspector → INSP-AGR-001, agency → AGN-AGR-001, etc.)
//       + the Country Addendum Framework.
//    2. "Job Contract Documents" subsection — JOB-TPL-001 + ESCROW-001 as
//       reference docs so users can see exactly what a Job Contract looks
//       like before they have one.
//    3. (Reserved for Compliance Notices sub-page — Checkpoint 5.)
//
//  Replaces the previously broken `/(inspector)/legal` route (the file
//  didn't exist on disk and was role-locked to the (inspector) group).
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

export default function LegalComplianceScreen() {
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

  const { legalCompliance, jobContractReference, countryAddenda, enterpriseDocuments } =
    useResolvedLegalStack(role);
  const { getAcceptance } = useAcceptances(session?.user?.id ?? null);

  const surfaceBg = isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)';
  const surfaceBorder = isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: surfaceBorder }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Legal & Compliance
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Role banner */}
        {role ? (
          <View
            style={[
              styles.roleBanner,
              {
                backgroundColor: colors.primary + '12',
                borderColor: colors.primary + '40',
              },
            ]}
          >
            <Ionicons name="person-circle-outline" size={18} color={colors.primary} />
            <Text style={[styles.roleBannerText, { color: colors.primary }]}>
              Showing documents resolved for your role:{' '}
              <Text style={{ fontWeight: '800' }}>
                {prettyRole(role)}
              </Text>
            </Text>
          </View>
        ) : (
          <View
            style={[
              styles.roleBanner,
              {
                backgroundColor: '#F59E0B' + '12',
                borderColor: '#F59E0B' + '40',
              },
            ]}
          >
            <Ionicons name="alert-circle-outline" size={18} color="#F59E0B" />
            <Text style={[styles.roleBannerText, { color: '#F59E0B' }]}>
              No active role detected — showing universal documents only.
            </Text>
          </View>
        )}

        {/* Section: Compliance documents */}
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          Compliance Documents
        </Text>
        {legalCompliance.map((doc) => {
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

        {/* Section: Job Contract reference */}
        <Text
          style={[styles.sectionTitle, { color: colors.textSecondary, marginTop: 18 }]}
        >
          Job Contract Documents
        </Text>
        <Text style={[styles.sectionLede, { color: colors.textSecondary }]}>
          Reference copies of the documents that make up every Job you accept on
          NEXPEC. The platform attaches these to each Job Contract automatically.
        </Text>
        {jobContractReference.map((doc) => {
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

        {/* Section: Country Addenda (Checkpoint 5) */}
        <Text
          style={[styles.sectionTitle, { color: colors.textSecondary, marginTop: 18 }]}
        >
          Country Addenda
        </Text>
        <Text style={[styles.sectionLede, { color: colors.textSecondary }]}>
          Country-specific legal overlays. The platform automatically applies
          the addendum for your jurisdiction; this list is provided for
          transparency across all priority markets.
        </Text>
        {countryAddenda.map((doc) => {
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

        {/* Section: Enterprise Documents (Organization users only) */}
        {enterpriseDocuments.length > 0 ? (
          <>
            <Text
              style={[styles.sectionTitle, { color: colors.textSecondary, marginTop: 18 }]}
            >
              Enterprise Documents
            </Text>
            <Text style={[styles.sectionLede, { color: colors.textSecondary }]}>
              Reference copies of the controller-processor Data Processing
              Addendum and the Enterprise Order Form template. These attach
              to your Organization Agreement.
            </Text>
            {enterpriseDocuments.map((doc) => {
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
          </>
        ) : null}

        {/* Section: Compliance Notices — routes to sub-page (Checkpoint 5) */}
        <Text
          style={[styles.sectionTitle, { color: colors.textSecondary, marginTop: 18 }]}
        >
          Compliance Notices
        </Text>
        {/* ★ LEGAL-WIRING-004 — Pre-Checkpoint-5 this card was a
            "Coming soon" placeholder. Now it routes to the new
            /profile/legal/compliance-notices sub-page surface
            (Data residency, subprocessor list, Bill 96 status,
            country status, regulatory IDs). */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => router.push('/profile/legal/compliance-notices' as any)}
          style={[
            styles.placeholderCard,
            { backgroundColor: surfaceBg, borderColor: surfaceBorder },
          ]}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: colors.primary + '40',
              backgroundColor: colors.primary + '22',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: 2,
            }}
          >
            <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text
              style={[
                styles.placeholderTitle,
                { color: colors.text, marginBottom: 4 },
              ]}
            >
              Compliance Notices
            </Text>
            <Text style={[styles.placeholderText, { color: colors.textSecondary }]}>
              Data-residency disclosure, subprocessor list, Bill 96 French-translation
              status, country-addendum status, and regulatory IDs.
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={20}
            color={colors.textSecondary}
            style={{ marginLeft: 8, marginTop: 12 }}
          />
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function prettyRole(role: LegalUserRole): string {
  switch (role) {
    case 'inspector':
      return 'Inspector';
    case 'agency':
      return 'Agency';
    case 'client':
      return 'Client';
    case 'organization':
      return 'Organization';
    default:
      return role;
  }
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
  roleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
  },
  roleBannerText: { fontSize: 13, flex: 1 },
  sectionTitle: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  sectionLede: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  placeholderCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  placeholderTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    marginBottom: 4,
  },
  placeholderText: {
    fontSize: 12.5,
    lineHeight: 18,
  },
});
