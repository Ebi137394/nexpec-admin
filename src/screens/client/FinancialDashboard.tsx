import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Platform,
  Animated,
  TouchableOpacity,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

// ─── Component Imports ──────────────────────────────────────────
import BudgetOverview from '../../components/client/finance/BudgetOverview';
import InvoiceApprover from '../../components/client/finance/InvoiceApprover';
import ComplianceAudit from '../../components/client/finance/ComplianceAudit';

// ─── Colors ─────────────────────────────────────────────────────
const COLORS = {
  bg:           '#020617',
  cardDark:     '#0F172A',
  cardBorder:   '#1E293B',
  surface:      '#1E293B',
  accent:       '#3B82F6',
  success:      '#10B981',
  warning:      '#F59E0B',
  danger:       '#EF4444',
  textPrimary:  '#F8FAFC',
  textSecondary:'#94A3B8',
  textMuted:    '#475569',
  gold:         '#D4AF37',
};

// ─── Section Header Sub-Component ───────────────────────────────
const SectionHeader: React.FC<{
  icon: string;
  iconFamily?: 'ionicons' | 'material';
  title: string;
  subtitle: string;
  accentColor?: string;
}> = ({
  icon,
  iconFamily = 'ionicons',
  title,
  subtitle,
  accentColor = COLORS.accent,
}) => (
  <View style={styles.sectionHeader}>
    <View style={styles.sectionHeaderLeft}>
      <View
        style={[
          styles.sectionIcon,
          { backgroundColor: `${accentColor}15` },
        ]}
      >
        {iconFamily === 'material' ? (
          <MaterialCommunityIcons
            name={icon as any}
            size={18}
            color={accentColor}
          />
        ) : (
          <Ionicons name={icon as any} size={18} color={accentColor} />
        )}
      </View>
      <View>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionSubtitle}>{subtitle}</Text>
      </View>
    </View>
    <View
      style={[
        styles.sectionAccent,
        { backgroundColor: accentColor },
      ]}
    />
  </View>
);

// ─── Top Navigation Bar ────────────────────────────────────────
const TopBar: React.FC = () => (
  <View style={styles.topBar}>
    <View style={styles.topBarLeft}>
      <TouchableOpacity style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color={COLORS.textPrimary} />
      </TouchableOpacity>
      <View>
        <Text style={styles.topBarTitle}>Financial Command</Text>
        <Text style={styles.topBarSubtitle}>
          Client Dashboard · NEXPEC
        </Text>
      </View>
    </View>
    <View style={styles.topBarRight}>
      <TouchableOpacity style={styles.topBarAction}>
        <Ionicons
          name="notifications-outline"
          size={20}
          color={COLORS.textSecondary}
        />
        <View style={styles.notifDot} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.topBarAction}>
        <Ionicons
          name="download-outline"
          size={20}
          color={COLORS.textSecondary}
        />
      </TouchableOpacity>
    </View>
  </View>
);

// ─── Section Divider ────────────────────────────────────────────
const Divider: React.FC = () => (
  <View style={styles.divider}>
    <LinearGradient
      colors={['transparent', COLORS.cardBorder, 'transparent']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={styles.dividerLine}
    />
  </View>
);

// ═════════════════════════════════════════════════════════════════
// ─── MAIN SCREEN ────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════

const FinancialDashboard: React.FC = () => {
  const scrollY = useRef(new Animated.Value(0)).current;

  // Header parallax effect
  const headerOpacity = scrollY.interpolate({
    inputRange: [0, 80],
    outputRange: [1, 0.92],
    extrapolate: 'clamp',
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      {/* Top Navigation */}
      <Animated.View style={{ opacity: headerOpacity }}>
        <TopBar />
      </Animated.View>

      {/* Live Ticker */}
      <View style={styles.ticker}>
        <View style={styles.tickerDot} />
        <Text style={styles.tickerText}>
          Last sync: 2 min ago · All systems operational
        </Text>
      </View>

      {/* Scrollable Content */}
      <Animated.ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
        scrollEventThrottle={16}
      >
        {/* ═══════════════════════════════════════════════════════ */}
        {/* SECTION 1: Financial Command (Budget Overview)         */}
        {/* ═══════════════════════════════════════════════════════ */}
        <SectionHeader
          icon="wallet-outline"
          title="Financial Command"
          subtitle="Budget, escrow & spending analysis"
          accentColor={COLORS.accent}
        />
        <View style={styles.sectionBody}>
          <BudgetOverview />
        </View>

        <Divider />

        {/* ═══════════════════════════════════════════════════════ */}
        {/* SECTION 2: Invoice Approval Desk                       */}
        {/* ═══════════════════════════════════════════════════════ */}
        <SectionHeader
          icon="receipt-outline"
          title="Invoice Approval Desk"
          subtitle="Review, verify & authorize payments"
          accentColor={COLORS.warning}
        />
        <View style={styles.sectionBody}>
          <InvoiceApprover />
        </View>

        <Divider />

        {/* ═══════════════════════════════════════════════════════ */}
        {/* SECTION 3: Risk & Compliance                           */}
        {/* ═══════════════════════════════════════════════════════ */}
        <SectionHeader
          icon="shield-search"
          iconFamily="material"
          title="Risk & Compliance"
          subtitle="Insurance verification & audit trail"
          accentColor={COLORS.success}
        />
        <View style={styles.sectionBody}>
          <ComplianceAudit />
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.footerLine} />
          <View style={styles.footerContent}>
            <MaterialCommunityIcons
              name="shield-check"
              size={14}
              color={COLORS.textMuted}
            />
            <Text style={styles.footerText}>
              NEXPEC Financial Engine v2.1 · AES-256 Encrypted
            </Text>
          </View>
          <Text style={styles.footerDisclaimer}>
            All financial data is encrypted in transit and at rest.
            {'\n'}Audit logs are maintained for 7 years per regulatory
            requirements.
          </Text>
        </View>
      </Animated.ScrollView>
    </SafeAreaView>
  );
};

// ─── Styles ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  // Top Bar
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topBarTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  topBarSubtitle: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
  topBarRight: {
    flexDirection: 'row',
    gap: 8,
  },
  topBarAction: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  notifDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: COLORS.danger,
    borderWidth: 1.5,
    borderColor: COLORS.surface,
  },

  // Ticker
  ticker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: 'rgba(16,185,129,0.05)',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  tickerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.success,
  },
  tickerText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },

  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },

  // Section Header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 16,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  sectionSubtitle: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  sectionAccent: {
    width: 3,
    height: 28,
    borderRadius: 2,
    opacity: 0.6,
  },

  // Section Body
  sectionBody: {
    paddingHorizontal: 20,
  },

  // Divider
  divider: {
    paddingHorizontal: 40,
    paddingVertical: 8,
  },
  dividerLine: {
    height: 1,
  },

  // Footer
  footer: {
    alignItems: 'center',
    paddingTop: 32,
    paddingBottom: 20,
    paddingHorizontal: 40,
  },
  footerLine: {
    width: 40,
    height: 2,
    backgroundColor: COLORS.cardBorder,
    borderRadius: 1,
    marginBottom: 16,
  },
  footerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  footerText: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  footerDisclaimer: {
    color: COLORS.textMuted,
    fontSize: 9,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 14,
    opacity: 0.6,
  },
});

export default FinancialDashboard;