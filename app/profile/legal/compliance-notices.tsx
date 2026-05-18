// ════════════════════════════════════════════════════════════════════════════
//  app/profile/legal/compliance-notices.tsx — Compliance Notices sub-page
//  (Checkpoint 5)
//
//  Surfaces five categories of public-facing compliance content as separate
//  cards, exactly as designed in COMPLIANCE-NOTICES-001:
//      1. Data-Residency Disclosure
//      2. Subprocessor List
//      3. Bill 96 French-Translation Status
//      4. Country-Addendum Status
//      5. Regulatory IDs & Contacts
//
//  Content is v1-static. The COMPLIANCE-NOTICES-001 doc names a future
//  legal_compliance_state Supabase table that could drive these sections
//  dynamically; for v1 we ship static content that matches the document
//  exactly, with a Reload affordance for when we wire the dynamic table.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import {
  Linking,
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

interface SectionCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  isDarkMode: boolean;
  colors: ReturnType<typeof getColors>;
}

const SectionCard: React.FC<SectionCardProps> = ({
  icon,
  title,
  subtitle,
  children,
  isDarkMode,
  colors,
}) => {
  const surfaceBg = isDarkMode
    ? 'rgba(255, 255, 255, 0.03)'
    : 'rgba(0, 0, 0, 0.03)';
  const surfaceBorder = isDarkMode
    ? 'rgba(255, 255, 255, 0.08)'
    : 'rgba(0, 0, 0, 0.08)';

  return (
    <View
      style={[
        styles.sectionCard,
        { backgroundColor: surfaceBg, borderColor: surfaceBorder },
      ]}
    >
      <View style={styles.sectionHeader}>
        <View
          style={[
            styles.sectionIcon,
            {
              backgroundColor: colors.primary + '22',
              borderColor: colors.primary + '40',
            },
          ]}
        >
          <Ionicons name={icon} size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {title}
          </Text>
          <Text
            style={[styles.sectionSubtitle, { color: colors.textSecondary }]}
          >
            {subtitle}
          </Text>
        </View>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
};

type Row = { label: string; value: string; emphasized?: boolean };

const KvRow: React.FC<{ row: Row; colors: ReturnType<typeof getColors> }> = ({
  row,
  colors,
}) => (
  <View style={styles.kvRow}>
    <Text
      style={[styles.kvLabel, { color: colors.textSecondary }]}
      numberOfLines={2}
    >
      {row.label}
    </Text>
    <Text
      style={[
        styles.kvValue,
        {
          color: row.emphasized ? colors.primary : colors.text,
          fontWeight: row.emphasized ? '700' : '500',
        },
      ]}
    >
      {row.value}
    </Text>
  </View>
);

export default function ComplianceNoticesScreen() {
  const router = useRouter();
  const { isDarkMode } = useTheme();
  const colors = getColors(isDarkMode);

  const surfaceBorder = isDarkMode
    ? 'rgba(255, 255, 255, 0.08)'
    : 'rgba(0, 0, 0, 0.08)';

  return (
    <SafeAreaView
      style={[styles.flex, { backgroundColor: colors.background }]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: surfaceBorder }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Compliance Notices
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.lede, { color: colors.textSecondary }]}>
          Public-facing compliance disclosures: where your data sits, who
          else touches it, what languages we're translated into, what
          country overlays are active, and how to reach us. Sourced from
          COMPLIANCE-NOTICES-001 v1.0.
        </Text>

        {/* §1 Data-Residency Disclosure */}
        <SectionCard
          icon="server-outline"
          title="Data-Residency Disclosure"
          subtitle="Where each category of data lives"
          isDarkMode={isDarkMode}
          colors={colors}
        >
          <Text style={[styles.paraText, { color: colors.text }]}>
            NEXPEC operates globally via Supabase on AWS. Data is hosted
            across multiple AWS regions and is not committed to a specific
            localized region for v1 unless an Enterprise Order Form
            (ORDER-FORM-001) expressly so provides.
          </Text>
          <View style={styles.tableWrap}>
            <KvRow
              colors={colors}
              row={{
                label: 'Account & Verification Data',
                value: 'us-east-1 · backup ca-central-1',
              }}
            />
            <KvRow
              colors={colors}
              row={{ label: 'Job Data & Inspector Output', value: 'us-east-1 · backup ca-central-1' }}
            />
            <KvRow
              colors={colors}
              row={{ label: 'Payment Data', value: 'held by Stripe' }}
            />
            <KvRow
              colors={colors}
              row={{ label: 'Logs & Telemetry', value: 'us-east-1 · backup ca-central-1' }}
            />
          </View>
          <Text style={[styles.smallNote, { color: colors.textSecondary }]}>
            Transfer mechanisms: EU SCCs · UK IDTA · PIPEDA contractual
            safeguards · Law 25 §17.
          </Text>
        </SectionCard>

        {/* §2 Subprocessor List */}
        <SectionCard
          icon="people-outline"
          title="Subprocessor List"
          subtitle="Service providers that process your data"
          isDarkMode={isDarkMode}
          colors={colors}
        >
          <View style={styles.tableWrap}>
            <KvRow
              colors={colors}
              row={{
                label: 'Stripe, Inc.',
                value: 'Payments, escrow, payout, currency conversion, tax',
              }}
            />
            <KvRow
              colors={colors}
              row={{
                label: 'Supabase, Inc.',
                value: 'Database, auth, file storage, edge functions',
              }}
            />
            <KvRow
              colors={colors}
              row={{
                label: 'Amazon Web Services',
                value: 'Underlying compute, storage, network',
              }}
            />
            <KvRow
              colors={colors}
              row={{ label: 'Email delivery provider', value: 'TBD — vendor pending' }}
            />
            <KvRow
              colors={colors}
              row={{ label: 'SMS delivery provider', value: 'TBD — vendor pending' }}
            />
            <KvRow
              colors={colors}
              row={{ label: 'Crash & analytics provider', value: 'TBD — vendor pending' }}
            />
            <KvRow
              colors={colors}
              row={{ label: 'Customer support tooling', value: 'TBD — vendor pending' }}
            />
          </View>
          <Text style={[styles.smallNote, { color: colors.textSecondary }]}>
            Material changes are notified in-app; Organization customers get
            a 15-business-day objection window per DPA-001 §5.
          </Text>
        </SectionCard>

        {/* §3 Bill 96 French Translation Status */}
        <SectionCard
          icon="language-outline"
          title="Bill 96 — French-Translation Status"
          subtitle="Charter of the French Language compliance"
          isDarkMode={isDarkMode}
          colors={colors}
        >
          <Text style={[styles.paraText, { color: colors.text }]}>
            Under the Charter of the French Language (Bill 96), NEXPEC
            offers French-language versions of consumer-facing legal
            documents to Québec-resident users. Current status:
          </Text>
          <View style={styles.tableWrap}>
            {[
              'TOS-001',
              'PRIV-001',
              'AUP-001',
              'INSP-AGR-001',
              'AGN-AGR-001',
              'CLI-AGR-001',
              'ORG-AGR-001',
              'JOB-TPL-001',
              'ESCROW-001',
              'ADDENDUM-FRAMEWORK-001',
            ].map((id) => (
              <KvRow
                colors={colors}
                key={id}
                row={{ label: `${id} v1.0`, value: 'Pending translation' }}
              />
            ))}
          </View>
          <Text style={[styles.smallNote, { color: colors.textSecondary }]}>
            Until the French versions are published, Québec users may rely
            on the English version they accepted. In case of conflict
            between language versions when French is published, the version
            you accepted controls (TOS-001 §12).
          </Text>
        </SectionCard>

        {/* §4 Country Addendum Status */}
        <SectionCard
          icon="globe-outline"
          title="Country-Addendum Status"
          subtitle="Priority-market activation tracker"
          isDarkMode={isDarkMode}
          colors={colors}
        >
          <View style={styles.tableWrap}>
            <KvRow
              colors={colors}
              row={{ label: 'CA — Canada', value: 'Active (self-signed)', emphasized: true }}
            />
            <KvRow
              colors={colors}
              row={{ label: 'EU — European Union / EEA', value: 'Draft · pending EU Rep' }}
            />
            <KvRow
              colors={colors}
              row={{ label: 'UK — United Kingdom', value: 'Draft · pending UK Rep' }}
            />
            <KvRow
              colors={colors}
              row={{ label: 'US — United States', value: 'Draft · pending US counsel' }}
            />
            <KvRow
              colors={colors}
              row={{ label: 'GCC — KSA, UAE, Qatar', value: 'Draft · pending Arabic + NDMO' }}
            />
            <KvRow
              colors={colors}
              row={{ label: 'JP — Japan', value: 'Draft · pending JP translation' }}
            />
            <KvRow
              colors={colors}
              row={{ label: 'KR — South Korea', value: 'Draft · pending PIPA Rep + KR translation' }}
            />
            <KvRow
              colors={colors}
              row={{ label: 'IN — India', value: 'Draft · pending Grievance Officer' }}
            />
            <KvRow
              colors={colors}
              row={{ label: 'CN — China', value: 'NOT-FOR-ACTIVATION (signup-blocked)', emphasized: true }}
            />
          </View>
          <Text style={[styles.smallNote, { color: colors.textSecondary }]}>
            Status transitions are gated by ADDENDUM-FRAMEWORK-001 §8:
            local-counsel review → publication in required languages →
            platform-side flag flip.
          </Text>
        </SectionCard>

        {/* §5 Regulatory IDs & Contacts */}
        <SectionCard
          icon="mail-outline"
          title="Regulatory IDs & Contacts"
          subtitle="Who to reach for what"
          isDarkMode={isDarkMode}
          colors={colors}
        >
          <View style={styles.tableWrap}>
            <KvRow
              colors={colors}
              row={{
                label: 'Operator',
                value: 'NEXPEC Technologies, Montréal, QC, Canada',
              }}
            />
            <TouchableOpacity
              onPress={() => Linking.openURL('mailto:privacy@nexpec.com')}
            >
              <KvRow
                colors={colors}
                row={{
                  label: 'Privacy / DPO function',
                  value: 'privacy@nexpec.com',
                  emphasized: true,
                }}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => Linking.openURL('mailto:abuse@nexpec.com')}
            >
              <KvRow
                colors={colors}
                row={{
                  label: 'Grievance / abuse',
                  value: 'abuse@nexpec.com',
                  emphasized: true,
                }}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => Linking.openURL('mailto:legal@nexpec.com')}
            >
              <KvRow
                colors={colors}
                row={{
                  label: 'Legal notices',
                  value: 'legal@nexpec.com',
                  emphasized: true,
                }}
              />
            </TouchableOpacity>
            <KvRow
              colors={colors}
              row={{
                label: 'EU Article 27 Representative',
                value: 'TBD — appoint before EU activation',
              }}
            />
            <KvRow
              colors={colors}
              row={{
                label: 'UK GDPR Article 27 Representative',
                value: 'TBD — appoint before UK activation',
              }}
            />
            <KvRow
              colors={colors}
              row={{
                label: 'PIPA Korean local representative',
                value: 'TBD — appoint before KR activation',
              }}
            />
            <KvRow
              colors={colors}
              row={{
                label: 'India Grievance Officer',
                value: 'TBD — appoint before IN activation',
              }}
            />
            <KvRow
              colors={colors}
              row={{
                label: 'KSA NDMO controller registration',
                value: 'TBD before GCC-KSA activation',
              }}
            />
          </View>
        </SectionCard>

        <Text style={[styles.footer, { color: colors.textSecondary }]}>
          Sourced from COMPLIANCE-NOTICES-001 v1.0. Updates flow through this
          page without re-papering the master legal stack.
        </Text>

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
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
  scroll: { paddingHorizontal: 18, paddingVertical: 16 },
  lede: { fontSize: 13.5, lineHeight: 20, marginBottom: 14 },

  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  sectionSubtitle: { fontSize: 12, lineHeight: 16 },
  sectionBody: {},

  paraText: { fontSize: 13.5, lineHeight: 19, marginBottom: 10 },
  smallNote: {
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 8,
    fontStyle: 'italic',
  },

  tableWrap: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  kvRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  kvLabel: { flex: 1.2, fontSize: 12.5, lineHeight: 18, paddingRight: 8 },
  kvValue: { flex: 1.6, fontSize: 12.5, lineHeight: 18 },
  footer: { fontSize: 11.5, lineHeight: 16, marginTop: 8, textAlign: 'center' },
});
