// ================================================================
//  ClientDashboard.tsx  –  Advanced Operations Center (Live-Wire)
// ================================================================

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Easing,
  Dimensions,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Platform,
  StatusBar,
  Image,
} from 'react-native';

// ── External ───────────────────────────────────────────────────
import { BlurView } from 'expo-blur';
import Svg, {
  Path,
  Line,
  Circle as SvgCircle,
  Defs,
  LinearGradient as SvgLinGrad,
  Stop,
  Text as SvgText,
  G,
} from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';

// ── Internal ───────────────────────────────────────────────────
import { useAuth, useOrganizationId } from '../../contexts/AuthContext';
import { useCriticalAlerts } from '../../hooks/useCriticalAlerts';
import { useOperationsData } from '../../hooks/useOperationsData';
import { useSpendingDashboard } from '../../hooks/useSpendingDashboard';
import { useAssetIntelligence } from '../../hooks/useAssetIntelligence';
import { useTeamTracker } from '../../hooks/useTeamTracker';
import { StatusPipeline } from '../../components/client/operations/components/StatusPipeline';

// ════════════════════════════════════════════════════════════════
//  CONSTANTS
// ════════════════════════════════════════════════════════════════

const { width: SCREEN_W } = Dimensions.get('window');

type TabKey = 'operations' | 'assets' | 'team' | 'finance';

interface TabDef {
  key: TabKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const TABS: TabDef[] = [
  { key: 'operations', label: 'Operations', icon: 'pulse-outline' },
  { key: 'assets', label: 'Assets', icon: 'cube-outline' },
  { key: 'team', label: 'Team', icon: 'people-outline' },
  { key: 'finance', label: 'Finance', icon: 'stats-chart-outline' },
];

const C = {
  bg: '#060A14',
  surface: 'rgba(255,255,255,0.04)',
  surfaceHover: 'rgba(255,255,255,0.08)',
  border: 'rgba(255,255,255,0.08)',
  cyan: '#00E5FF',
  green: '#00E676',
  yellow: '#FFD600',
  orange: '#FF9100',
  red: '#FF1744',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.55)',
  textTertiary: 'rgba(255,255,255,0.3)',
} as const;

// ════════════════════════════════════════════════════════════════
//  PULSE ANIMATION HOOK
// ════════════════════════════════════════════════════════════════

function usePulse(active = true, speed = 1000) {
  const anim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active) {
      anim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 0.2,
          duration: speed,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 1,
          duration: speed,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active, speed, anim]);

  return anim;
}

// ════════════════════════════════════════════════════════════════
//  SUB-COMPONENTS
// ════════════════════════════════════════════════════════════════

// ── Live Indicator ─────────────────────────────────────────────

const LiveIndicator: React.FC = () => {
  const pulse = usePulse(true, 1200);
  return (
    <View style={s.liveRow}>
      <Animated.View style={[s.liveDot, { opacity: pulse }]} />
      <Text style={s.liveText}>LIVE</Text>
    </View>
  );
};

// ── Critical Ticker ────────────────────────────────────────────

interface CriticalTickerProps {
  alerts: any[];
  onAcknowledge: (id: string) => void;
}

const CriticalTicker: React.FC<CriticalTickerProps> = ({
  alerts,
  onAcknowledge,
}) => {
  const isGreen = alerts.length === 0;
  const alertPulse = usePulse(!isGreen, 700);
  const accent = isGreen ? C.green : C.red;

  return (
    <View style={[s.ticker, { borderColor: accent }]}>
      <View style={s.tickerInner}>
        <Animated.View
          style={[
            s.tickerDot,
            { backgroundColor: accent, opacity: isGreen ? 1 : alertPulse },
          ]}
        />
        {isGreen ? (
          <Text style={[s.tickerLabel, { color: C.green }]}>
            SYSTEMS OPERATIONAL
          </Text>
        ) : (
          <View style={s.tickerAlertRow}>
            <Text
              style={[s.tickerLabel, { color: C.red }]}
              numberOfLines={1}
            >
              {alerts.length} ALERT{alerts.length > 1 ? 'S' : ''} —{' '}
              {alerts[0]?.title}
            </Text>
            <TouchableOpacity
              onPress={() => onAcknowledge(alerts[0].id)}
              style={s.tickerAckBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={s.tickerAckText}>ACK</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
};

// ── Glass Tab Bar ──────────────────────────────────────────────

interface GlassTabBarProps {
  active: TabKey;
  onSelect: (key: TabKey) => void;
}

const GlassTabBar: React.FC<GlassTabBarProps> = ({ active, onSelect }) => (
  <BlurView intensity={40} tint="dark" style={s.tabBarBlur}>
    <View style={s.tabBarInner}>
      {TABS.map((tab) => {
        const isActive = active === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            onPress={() => onSelect(tab.key)}
            activeOpacity={0.7}
            style={[s.tab, isActive && s.tabActive]}
          >
            <Ionicons
              name={tab.icon}
              size={16}
              color={isActive ? C.cyan : C.textSecondary}
            />
            <Text
              style={[s.tabLabel, isActive && s.tabLabelActive]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  </BlurView>
);

// ── Metric Card ────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  accent?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  unit,
  accent = C.cyan,
  icon,
}) => (
  <View style={s.metricCard}>
    {icon && (
      <Ionicons
        name={icon}
        size={18}
        color={accent}
        style={{ marginBottom: 6 }}
      />
    )}
    <Text style={s.metricLabel}>{label}</Text>
    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
      <Text style={[s.metricValue, { color: accent }]}>{value}</Text>
      {unit && <Text style={s.metricUnit}>{unit}</Text>}
    </View>
  </View>
);

// ════════════════════════════════════════════════════════════════
//  DOMAIN VIEWS
// ════════════════════════════════════════════════════════════════

// ── Operations View ────────────────────────────────────────────

interface OperationsViewProps {
  loading: boolean;
}

const OperationsView: React.FC<OperationsViewProps> = ({ loading }) => {
  if (loading) return (
    <View style={s.domainLoader}>
      <ActivityIndicator size="large" color={C.cyan} />
    </View>
  );

  return (
    <View>
        <View style={s.section}>
          <Text style={s.sectionLabel}>OPERATIONAL OVERVIEW</Text>
          <View style={s.metricsRow}>
            <MetricCard
              label="Active Orders"
              value={0}
              icon="construct-outline"
              accent={C.cyan}
            />
            <MetricCard
              label="Completion"
              value={0}
              unit="%"
              icon="checkmark-done-outline"
              accent={C.green}
            />
            <MetricCard
              label="Avg Cycle"
              value={0}
              unit="d"
              icon="time-outline"
              accent={C.yellow}
            />
          </View>
        </View>

        <StatusPipeline />
    </View>
  );
};

// ── Assets View ────────────────────────────────────────────────

interface AssetsViewProps {
  loading: boolean;
  searching: boolean;
}

const AssetsView: React.FC<AssetsViewProps> = ({ loading, searching }) => {
  if (loading) return (
    <View style={s.domainLoader}>
      <ActivityIndicator size="large" color={C.cyan} />
    </View>
  );

  return (
    <View>
      <View style={s.section}>
        <Text style={s.sectionLabel}>ASSET VAULT</Text>
        {/* Search */}
        <View style={s.searchRow}>
          <Ionicons
            name="search-outline"
            size={18}
            color={C.textSecondary}
            style={{ marginRight: 8 }}
          />
          <TextInput
            style={s.searchInput}
            placeholder="Search serial, name, type, location…"
            placeholderTextColor={C.textTertiary}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {searching && (
            <ActivityIndicator
              size="small"
              color={C.cyan}
              style={{ marginLeft: 8 }}
            />
          )}
        </View>

        {/* Results */}
        <View style={s.emptyDomain}>
          <Ionicons
            name="file-tray-outline"
            size={32}
            color={C.textTertiary}
          />
          <Text style={s.emptyDomainText}>No assets registered</Text>
        </View>
      </View>
    </View>
  );
};

// ── Finance View ───────────────────────────────────────────────

interface FinanceViewProps {
  loading: boolean;
}

const FinanceView: React.FC<FinanceViewProps> = ({ loading }) => {
  if (loading) return (
    <View style={s.domainLoader}>
      <ActivityIndicator size="large" color={C.cyan} />
    </View>
  );

  return (
    <View>
      <View style={s.section}>
        <Text style={s.sectionLabel}>SPENDING ANALYTICS</Text>
        <View style={s.metricsRow}>
          <MetricCard
            label="Total Spend"
            value="$0"
            icon="wallet-outline"
            accent={C.cyan}
          />
          <MetricCard
            label="Monthly Burn"
            value="$0"
            icon="flame-outline"
            accent={C.orange}
          />
          <MetricCard
            label="Budget"
            value="$0"
            icon="cash-outline"
            accent={C.green}
          />
        </View>
      </View>

      <View style={s.section}>
        <Text style={s.sectionLabel}>BURN RATE</Text>
        <View style={s.chartContainer}>
          <View style={[s.chartPlaceholder, { height: 200 }]}>
            <Ionicons
              name="trending-up-outline"
              size={32}
              color={C.textTertiary}
            />
            <Text style={s.chartPlaceholderText}>
              Awaiting spend data…
            </Text>
          </View>
        </View>
      </View>

      <View style={s.section}>
        <Text style={s.sectionLabel}>BUDGET UTILIZATION</Text>
        <View style={s.utilContainer}>
          <View style={s.utilHeader}>
            <Text style={s.utilLabel}>Overall Budget</Text>
            <Text style={[s.utilPct, { color: C.cyan }]}>0%</Text>
          </View>
          <View style={s.utilTrack}>
            <View
              style={[
                s.utilFill,
                { width: '0%', backgroundColor: C.cyan },
              ]}
            />
          </View>
        </View>
      </View>
    </View>
  );
};

// ── Team View ──────────────────────────────────────────────────

interface TeamViewProps {
  loading: boolean;
}

const TeamView: React.FC<TeamViewProps> = ({ loading }) => {
  if (loading) return (
    <View style={s.domainLoader}>
      <ActivityIndicator size="large" color={C.cyan} />
    </View>
  );

  return (
    <View>
      <View style={s.section}>
        <Text style={s.sectionLabel}>TEAM TRACKER</Text>
        
        {/* Summary badges */}
        <View style={s.teamSummaryRow}>
          <View style={s.teamSummaryBadge}>
            <View
              style={[
                s.legendDot,
                { backgroundColor: C.green },
              ]}
            />
            <Text style={s.teamSummaryText}>
              ACTIVE: 0
            </Text>
          </View>
          <View style={s.teamSummaryBadge}>
            <View
              style={[
                s.legendDot,
                { backgroundColor: C.cyan },
              ]}
            />
            <Text style={s.teamSummaryText}>
              ON_SITE: 0
            </Text>
          </View>
          <View style={s.teamSummaryBadge}>
            <View
              style={[
                s.legendDot,
                { backgroundColor: C.yellow },
              ]}
            />
            <Text style={s.teamSummaryText}>
              IDLE: 0
            </Text>
          </View>
          <View style={s.teamSummaryBadge}>
            <View
              style={[
                s.legendDot,
                { backgroundColor: C.textTertiary },
              ]}
            />
            <Text style={s.teamSummaryText}>
              OFFLINE: 0
            </Text>
          </View>
        </View>

        {/* Member cards */}
        <View style={s.emptyDomain}>
          <Ionicons
            name="people-outline"
            size={32}
            color={C.textTertiary}
          />
          <Text style={s.emptyDomainText}>No team members found</Text>
        </View>
      </View>
    </View>
  );
};

// ════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ════════════════════════════════════════════════════════════════

const ClientDashboard: React.FC = () => {
  // ── Auth guard ─────────────────────────────────────────────
  const { user } = useAuth();
  const organizationId = useOrganizationId();

  // ── Tab state ──────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabKey>('operations');

  // ── Refreshing ─────────────────────────────────────────────
  const [refreshing, setRefreshing] = useState(false);

  // ── Hooks (all scoped to organizationId) ───────────────────
  const criticalAlerts = useCriticalAlerts(organizationId ?? undefined);
  const opsData = useOperationsData(organizationId ?? undefined);
  const spending = useSpendingDashboard(organizationId ?? undefined);
  const assetIntel = useAssetIntelligence(organizationId ?? undefined);
  const team = useTeamTracker(organizationId ?? undefined);

  // ── Pull-to-refresh ────────────────────────────────────────
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      criticalAlerts.refresh(),
      opsData.refresh(),
      spending.refresh(),
      assetIntel.refresh(),
      team.refresh(),
    ]);
    setRefreshing(false);
  }, [criticalAlerts, opsData, spending, assetIntel, team]);

  // ── Organization guard ─────────────────────────────────────
  if (!organizationId) {
    return (
      <View style={s.guardScreen}>
        <ActivityIndicator size="large" color={C.cyan} />
        <Text style={s.guardText}>
          Establishing secure connection…
        </Text>
      </View>
    );
  }

  // ── Render active domain ───────────────────────────────────
  const renderDomain = () => {
    switch (activeTab) {
      case 'operations':
        return (
          <OperationsView
            loading={opsData.loading}
          />
        );

      case 'assets':
        return (
          <AssetsView
            loading={assetIntel.loading}
            searching={assetIntel.searching}
          />
        );

      case 'finance':
        return (
          <FinanceView
            loading={spending.loading}
          />
        );

      case 'team':
        return (
          <TeamView
            loading={team.loading}
          />
        );
    }
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.cyan}
            colors={[C.cyan]}
            progressBackgroundColor={C.bg}
          />
        }
      >
        {/* ── Header ──────────────────────────────────────── */}
        <View style={s.header}>
          <View>
            <Text style={s.headerTitle}>Operations Center</Text>
            <Text style={s.headerSubtitle}>
              {user?.email ?? 'Commander'}
            </Text>
          </View>
          <LiveIndicator />
        </View>

        {/* ── Critical Ticker ─────────────────────────────── */}
        <CriticalTicker
          alerts={criticalAlerts.alerts}
          onAcknowledge={criticalAlerts.acknowledgeAlert}
        />

        {/* ── Tab Bar ─────────────────────────────────────── */}
        <GlassTabBar active={activeTab} onSelect={setActiveTab} />

        {/* ── Domain View ─────────────────────────────────── */}
        <View style={s.domainContainer}>{renderDomain()}</View>
      </ScrollView>
    </View>
  );
};

// ════════════════════════════════════════════════════════════════
//  STYLES
// ════════════════════════════════════════════════════════════════

const s = StyleSheet.create({
  // ── Root ──
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingBottom: 60,
  },

  // ── Guard ──
  guardScreen: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  guardText: {
    color: C.textSecondary,
    fontSize: 14,
    marginTop: 16,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: C.textPrimary,
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // ── Live ──
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,229,255,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.2)',
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.cyan,
    marginRight: 6,
  },
  liveText: {
    fontSize: 11,
    fontWeight: '700',
    color: C.cyan,
    letterSpacing: 1.5,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // ── Ticker ──
  ticker: {
    marginHorizontal: 20,
    marginBottom: 14,
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  tickerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  tickerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  tickerLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    flex: 1,
  },
  tickerAlertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  tickerAckBtn: {
    marginLeft: 10,
    backgroundColor: 'rgba(255,23,68,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,23,68,0.3)',
  },
  tickerAckText: {
    color: C.red,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },

  // ── Tab Bar ──
  tabBarBlur: {
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
  },
  tabBarInner: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 5,
  },
  tabActive: {
    backgroundColor: 'rgba(0,229,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.25)',
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: C.textSecondary,
    letterSpacing: 0.3,
  },
  tabLabelActive: {
    color: C.cyan,
    fontWeight: '700',
  },

  // ── Domain Container ──
  domainContainer: {
    paddingHorizontal: 20,
  },
  domainLoader: {
    paddingVertical: 80,
    alignItems: 'center',
  },

  // ── Section ──
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: C.textTertiary,
    letterSpacing: 2,
    marginBottom: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // ── Metrics ──
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metricCard: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: C.textSecondary,
    letterSpacing: 0.5,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  metricValue: {
    fontSize: 24,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  metricUnit: {
    fontSize: 12,
    color: C.textSecondary,
    marginLeft: 2,
    fontWeight: '600',
  },

  // ── Chart ──
  chartContainer: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 8,
    alignItems: 'center',
  },
  chartPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  chartPlaceholderText: {
    color: C.textTertiary,
    fontSize: 13,
    marginTop: 8,
  },

  // ── Utilization ──
  utilContainer: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
  },
  utilHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  utilLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textPrimary,
  },
  utilPct: {
    fontSize: 16,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  utilTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  utilFill: {
    height: '100%',
    borderRadius: 4,
  },

  // ── Search ──
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 6,
    marginBottom: 14,
  },
  searchInput: {
    flex: 1,
    color: C.textPrimary,
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // ── Empty ──
  emptyDomain: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyDomainText: {
    color: C.textTertiary,
    fontSize: 13,
    marginTop: 10,
  },

  // ── Team Summary ──
  teamSummaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 14,
    gap: 8,
  },
  teamSummaryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: C.border,
  },
  teamSummaryText: {
    fontSize: 11,
    color: C.textSecondary,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 5,
  },
});

export default ClientDashboard;