// src/components/client/assets/AssetVault.tsx

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
} from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  FlatList,
  Animated,
  Easing,
  StyleSheet,
  Dimensions,
  LayoutAnimation,
  Platform,
  UIManager,
  TouchableOpacity,
  NativeSyntheticEvent,
  TextInputFocusEventData,
} from 'react-native';

// ─── Enable LayoutAnimation on Android ───────────────────────────────
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ═══════════════════════════════════════════════════════════════════════
// ░░░  DESIGN TOKENS  ░░░
// ═══════════════════════════════════════════════════════════════════════
const T = {
  bg: '#020617',
  surface: 'rgba(255,255,255,0.04)',
  cardBg: 'rgba(255,255,255,0.05)',
  cardBgHover: 'rgba(255,255,255,0.08)',
  border: 'rgba(255,255,255,0.08)',
  borderFocus: 'rgba(59,130,246,0.5)',
  borderSubtle: 'rgba(255,255,255,0.05)',

  textPrimary: '#F8FAFC',
  textSecondary: 'rgba(248,250,252,0.6)',
  textTertiary: 'rgba(248,250,252,0.32)',
  textMono: 'rgba(248,250,252,0.75)',

  primary: '#3B82F6',
  primaryGlow: 'rgba(59,130,246,0.25)',
  primaryFaint: 'rgba(59,130,246,0.08)',
  primaryMid: 'rgba(59,130,246,0.15)',

  success: '#10B981',
  successFaint: 'rgba(16,185,129,0.08)',
  successMid: 'rgba(16,185,129,0.15)',

  warning: '#F59E0B',
  warningFaint: 'rgba(245,158,11,0.08)',
  warningMid: 'rgba(245,158,11,0.15)',

  critical: '#EF4444',
  criticalFaint: 'rgba(239,68,68,0.08)',
  criticalMid: 'rgba(239,68,68,0.15)',

  purple: '#8B5CF6',
  purpleFaint: 'rgba(139,92,246,0.08)',
  purpleMid: 'rgba(139,92,246,0.15)',

  cyan: '#06B6D4',
  cyanFaint: 'rgba(6,182,212,0.08)',
  cyanMid: 'rgba(6,182,212,0.15)',
} as const;

// ═══════════════════════════════════════════════════════════════════════
// ░░░  TYPE DEFINITIONS  ░░░
// ═══════════════════════════════════════════════════════════════════════
type DocType = 'PDF' | 'CSV' | 'XLSX' | 'IMG' | 'DWG';
type DocCategory =
  | 'all'
  | 'reports'
  | 'contracts'
  | 'certificates'
  | 'drawings'
  | 'data';
type AssetStatus = 'operational' | 'maintenance' | 'decommissioned' | 'flagged';
type TimelineEventType =
  | 'inspection'
  | 'repair'
  | 'certification'
  | 'incident'
  | 'audit'
  | 'commissioning';

interface Asset {
  id: string;
  name: string;
  tag: string;
  type: string;
  location: string;
  status: AssetStatus;
  lastInspection: string;
  nextDue: string;
  riskScore: number; // 0–100
  manufacturer: string;
  installDate: string;
}

interface TimelineEvent {
  id: string;
  assetId: string;
  date: string;
  type: TimelineEventType;
  title: string;
  description: string;
  inspector: string;
  result: 'pass' | 'fail' | 'conditional' | 'info';
  referenceNo: string;
}

interface DocumentFile {
  id: string;
  name: string;
  type: DocType;
  category: DocCategory;
  size: string;
  modified: string;
  assetTag: string;
  classification: 'confidential' | 'internal' | 'public';
  pages?: number;
}

interface FilterChip {
  key: DocCategory;
  label: string;
  count: number;
}

// ═══════════════════════════════════════════════════════════════════════
// ░░░  MOCK DATA  ░░░
// ═══════════════════════════════════════════════════════════════════════
const ASSETS: Asset[] = [
  {
    id: 'AST-001',
    name: 'Pressure Vessel Tank',
    tag: 'TANK-101',
    type: 'Pressure Vessel',
    location: 'Platform Alpha, Level 2',
    status: 'operational',
    lastInspection: '2024-11-18',
    nextDue: '2025-05-18',
    riskScore: 34,
    manufacturer: 'Yokogawa Heavy Industries',
    installDate: '2018-03-12',
  },
  {
    id: 'AST-002',
    name: 'Centrifugal Pump B2',
    tag: 'PUMP-B2',
    type: 'Rotating Equipment',
    location: 'Platform Alpha, Engine Room',
    status: 'maintenance',
    lastInspection: '2024-10-02',
    nextDue: '2025-01-02',
    riskScore: 67,
    manufacturer: 'Sulzer AG',
    installDate: '2016-08-21',
  },
  {
    id: 'AST-003',
    name: 'Heat Exchanger E-401',
    tag: 'HX-E401',
    type: 'Static Equipment',
    location: 'Platform Bravo, Process Area',
    status: 'flagged',
    lastInspection: '2024-09-14',
    nextDue: '2024-12-14',
    riskScore: 82,
    manufacturer: 'Alfa Laval',
    installDate: '2015-11-05',
  },
];

const TIMELINE_EVENTS: TimelineEvent[] = [
  {
    id: 'EVT-001',
    assetId: 'AST-001',
    date: '2024-11-18',
    type: 'inspection',
    title: 'Scheduled API 510 Internal Inspection',
    description:
      'Full internal visual and UT thickness survey. Wall thickness readings within acceptable range. Minor pitting observed on lower shell, documented for trending.',
    inspector: 'Cpt. M. Rivera',
    result: 'pass',
    referenceNo: 'INS-2024-0847',
  },
  {
    id: 'EVT-002',
    assetId: 'AST-001',
    date: '2024-08-03',
    type: 'repair',
    title: 'Nozzle Weld Overlay, N3 Connection',
    description:
      'Weld overlay applied to nozzle N3 to address erosion pattern. Post-weld heat treatment completed. NDE passed, MT and UT satisfactory.',
    inspector: 'Lt. K. Tanaka',
    result: 'pass',
    referenceNo: 'WO-2024-0392',
  },
  {
    id: 'EVT-003',
    assetId: 'AST-001',
    date: '2024-05-22',
    type: 'certification',
    title: 'ASME Code Re-certification',
    description:
      'Vessel re-certified for continued service per ASME Section VIII Div 1. Valid until May 2029. National Board number updated.',
    inspector: 'Dr. S. Okafor',
    result: 'pass',
    referenceNo: 'CERT-2024-NB-1182',
  },
  {
    id: 'EVT-004',
    assetId: 'AST-001',
    date: '2024-02-11',
    type: 'incident',
    title: 'Pressure Relief Valve Lift Event',
    description:
      'PSV-101A lifted at 342 psig (set point 345 psig). Attributed to upstream process upset. No damage to vessel. PSV recalibrated and tested.',
    inspector: 'Eng. L. Petrov',
    result: 'conditional',
    referenceNo: 'INC-2024-0088',
  },
  {
    id: 'EVT-005',
    assetId: 'AST-001',
    date: '2023-11-15',
    type: 'inspection',
    title: 'Scheduled API 510 External Inspection',
    description:
      'External visual inspection, CUI assessment, and foundation check. Coating system intact. No corrosion under insulation detected.',
    inspector: 'Cpt. M. Rivera',
    result: 'pass',
    referenceNo: 'INS-2023-0721',
  },
  {
    id: 'EVT-006',
    assetId: 'AST-001',
    date: '2023-06-08',
    type: 'audit',
    title: 'RBI Program Audit, Class Society',
    description:
      'Risk-Based Inspection program audit by DNV GL. Methodology and documentation reviewed. Compliance confirmed. Next audit cycle: 2026.',
    inspector: 'External, DNV GL',
    result: 'pass',
    referenceNo: 'AUD-2023-DNV-044',
  },
  {
    id: 'EVT-007',
    assetId: 'AST-001',
    date: '2018-03-12',
    type: 'commissioning',
    title: 'Initial Commissioning & Hydrotest',
    description:
      'Vessel hydrotested at 1.5× MAWP (517.5 psig). Held for 2 hours with no leaks. Commissioned into service. Baseline UT readings recorded.',
    inspector: 'Yokogawa Field Eng.',
    result: 'pass',
    referenceNo: 'COM-2018-TANK101',
  },
];

const DOCUMENTS: DocumentFile[] = [
  {
    id: 'DOC-001',
    name: 'API_510_Inspection_Report_TANK101_Nov2024',
    type: 'PDF',
    category: 'reports',
    size: '4.2 MB',
    modified: '2024-11-20',
    assetTag: 'TANK-101',
    classification: 'confidential',
    pages: 42,
  },
  {
    id: 'DOC-002',
    name: 'UT_Thickness_Data_TANK101_Nov2024',
    type: 'CSV',
    category: 'data',
    size: '128 KB',
    modified: '2024-11-19',
    assetTag: 'TANK-101',
    classification: 'internal',
  },
  {
    id: 'DOC-003',
    name: 'ASME_Certificate_TANK101_2024-2029',
    type: 'PDF',
    category: 'certificates',
    size: '1.8 MB',
    modified: '2024-05-24',
    assetTag: 'TANK-101',
    classification: 'public',
    pages: 6,
  },
  {
    id: 'DOC-004',
    name: 'Vessel_GA_Drawing_TANK101_Rev4',
    type: 'DWG',
    category: 'drawings',
    size: '12.6 MB',
    modified: '2023-09-15',
    assetTag: 'TANK-101',
    classification: 'confidential',
  },
  {
    id: 'DOC-005',
    name: 'Maintenance_Contract_PlatformAlpha_2024',
    type: 'PDF',
    category: 'contracts',
    size: '2.1 MB',
    modified: '2024-01-10',
    assetTag: 'TANK-101',
    classification: 'confidential',
    pages: 28,
  },
  {
    id: 'DOC-006',
    name: 'Weld_Overlay_Procedure_N3_2024',
    type: 'PDF',
    category: 'reports',
    size: '3.4 MB',
    modified: '2024-08-05',
    assetTag: 'TANK-101',
    classification: 'internal',
    pages: 18,
  },
  {
    id: 'DOC-007',
    name: 'Corrosion_Rate_Trending_TANK101',
    type: 'XLSX',
    category: 'data',
    size: '256 KB',
    modified: '2024-11-20',
    assetTag: 'TANK-101',
    classification: 'internal',
  },
  {
    id: 'DOC-008',
    name: 'PSV_Calibration_Report_PSV101A',
    type: 'PDF',
    category: 'reports',
    size: '1.1 MB',
    modified: '2024-02-15',
    assetTag: 'TANK-101',
    classification: 'internal',
    pages: 8,
  },
  {
    id: 'DOC-009',
    name: 'Baseline_UT_Scan_TANK101_2018',
    type: 'CSV',
    category: 'data',
    size: '96 KB',
    modified: '2018-03-14',
    assetTag: 'TANK-101',
    classification: 'internal',
  },
  {
    id: 'DOC-010',
    name: 'Insulation_Detail_Drawing_TANK101',
    type: 'IMG',
    category: 'drawings',
    size: '5.8 MB',
    modified: '2019-07-22',
    assetTag: 'TANK-101',
    classification: 'internal',
  },
];

const FILTER_CHIPS: FilterChip[] = [
  { key: 'all', label: 'All Files', count: DOCUMENTS.length },
  {
    key: 'reports',
    label: 'Reports',
    count: DOCUMENTS.filter((d) => d.category === 'reports').length,
  },
  {
    key: 'contracts',
    label: 'Contracts',
    count: DOCUMENTS.filter((d) => d.category === 'contracts').length,
  },
  {
    key: 'certificates',
    label: 'Certificates',
    count: DOCUMENTS.filter((d) => d.category === 'certificates').length,
  },
  {
    key: 'drawings',
    label: 'Drawings',
    count: DOCUMENTS.filter((d) => d.category === 'drawings').length,
  },
  {
    key: 'data',
    label: 'Data',
    count: DOCUMENTS.filter((d) => d.category === 'data').length,
  },
];

// ═══════════════════════════════════════════════════════════════════════
// ░░░  UTILITY HOOKS  ░░░
// ═══════════════════════════════════════════════════════════════════════
const useSlideIn = (
  delay: number = 0,
  from: number = 24,
  duration: number = 550,
): { opacity: Animated.Value; translateY: Animated.AnimatedInterpolation<number> } => {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, delay, duration]);

  return {
    opacity: progress,
    translateY: progress.interpolate({
      inputRange: [0, 1],
      outputRange: [from, 0],
    }),
  };
};

const useFadeIn = (delay: number = 0, duration: number = 500): Animated.Value => {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [opacity, delay, duration]);

  return opacity;
};

const usePulse = (
  duration: number = 2400,
  minOpacity: number = 0.4,
): Animated.AnimatedInterpolation<number> => {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: duration / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: duration / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [anim, duration]);

  return anim.interpolate({
    inputRange: [0, 1],
    outputRange: [minOpacity, 1],
  });
};

// ═══════════════════════════════════════════════════════════════════════
// ░░░  SECTION HEADER  ░░░
// ═══════════════════════════════════════════════════════════════════════
const SectionHeader: React.FC<{
  title: string;
  subtitle?: string;
  delay?: number;
  accentColor?: string;
}> = memo(({ title, subtitle, delay = 0, accentColor = T.primary }) => {
  const { opacity, translateY } = useSlideIn(delay, 16, 450);

  return (
    <Animated.View
      style={[styles.sectionHeader, { opacity, transform: [{ translateY }] }]}
    >
      <View style={[styles.sectionAccent, { backgroundColor: accentColor }]} />
      <View style={styles.sectionHeaderText}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
      </View>
    </Animated.View>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// ░░░  COMPONENT 1: VAULT HEADER  ░░░
// ═══════════════════════════════════════════════════════════════════════
const VaultHeader: React.FC = memo(() => {
  const fadeIn = useFadeIn(0, 400);
  const scanPulse = usePulse(3000, 0.3);

  return (
    <Animated.View style={[styles.vaultHeader, { opacity: fadeIn }]}>
      <View style={styles.vaultHeaderTop}>
        <View>
          <Text style={styles.vaultTitle}>ASSET VAULT</Text>
          <Text style={styles.vaultSubtitle}>INTELLIGENCE DATABASE</Text>
        </View>
        <View style={styles.vaultSecurityBadge}>
          <Animated.View
            style={[styles.vaultSecurityDot, { opacity: scanPulse }]}
          />
          <Text style={styles.vaultSecurityText}>ENCRYPTED</Text>
        </View>
      </View>

      {/* Classification bar */}
      <View style={styles.classificationBar}>
        <View style={styles.classBarSegment}>
          <Text style={styles.classBarLabel}>CLEARANCE</Text>
          <Text style={[styles.classBarValue, { color: T.success }]}>
            LEVEL 4
          </Text>
        </View>
        <View style={styles.classBarDivider} />
        <View style={styles.classBarSegment}>
          <Text style={styles.classBarLabel}>ASSETS LOADED</Text>
          <Text style={[styles.classBarValue, { color: T.primary }]}>
            {ASSETS.length}
          </Text>
        </View>
        <View style={styles.classBarDivider} />
        <View style={styles.classBarSegment}>
          <Text style={styles.classBarLabel}>DOCUMENTS</Text>
          <Text style={[styles.classBarValue, { color: T.cyan }]}>
            {DOCUMENTS.length}
          </Text>
        </View>
        <View style={styles.classBarDivider} />
        <View style={styles.classBarSegment}>
          <Text style={styles.classBarLabel}>EVENTS</Text>
          <Text style={[styles.classBarValue, { color: T.warning }]}>
            {TIMELINE_EVENTS.length}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// ░░░  COMPONENT 2: SMART SEARCH BAR  ░░░
// ═══════════════════════════════════════════════════════════════════════
const SmartSearchBar: React.FC<{
  value: string;
  onChangeText: (text: string) => void;
}> = memo(({ value, onChangeText }) => {
  const [isFocused, setIsFocused] = useState(false);
  const widthAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const fadeIn = useFadeIn(200, 500);

  const handleFocus = useCallback(
    (_e: NativeSyntheticEvent<TextInputFocusEventData>) => {
      setIsFocused(true);
      Animated.parallel([
        Animated.spring(widthAnim, {
          toValue: 1,
          friction: 7,
          tension: 40,
          useNativeDriver: false,
        }),
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
      ]).start();
    },
    [widthAnim, glowAnim],
  );

  const handleBlur = useCallback(
    (_e: NativeSyntheticEvent<TextInputFocusEventData>) => {
      setIsFocused(false);
      Animated.parallel([
        Animated.spring(widthAnim, {
          toValue: 0,
          friction: 7,
          tension: 40,
          useNativeDriver: false,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
      ]).start();
    },
    [widthAnim, glowAnim],
  );

  const containerWidth = widthAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_WIDTH - 40, SCREEN_WIDTH - 32],
  });

  const borderColor = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(255,255,255,0.08)', 'rgba(59,130,246,0.5)'],
  });

  const bgColor = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(255,255,255,0.04)', 'rgba(59,130,246,0.06)'],
  });

  const shadowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.3],
  });

  return (
    <Animated.View style={[styles.searchWrapper, { opacity: fadeIn }]}>
      <Animated.View
        style={[
          styles.searchGlow,
          {
            opacity: shadowOpacity,
          },
        ]}
      />
      <Animated.View
        style={[
          styles.searchContainer,
          {
            width: containerWidth,
            borderColor,
            backgroundColor: bgColor,
          },
        ]}
      >
        {/* Search icon */}
        <View style={styles.searchIconContainer}>
          <Text
            style={[
              styles.searchIcon,
              { color: isFocused ? T.primary : T.textTertiary },
            ]}
          >
            ⌕
          </Text>
        </View>

        <TextInput
          style={styles.searchInput}
          value={value}
          onChangeText={onChangeText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder="Search assets, tags, documents..."
          placeholderTextColor={T.textTertiary}
          selectionColor={T.primary}
          autoCorrect={false}
          autoCapitalize="none"
        />

        {/* Query indicator */}
        {value.length > 0 && (
          <TouchableOpacity
            onPress={() => onChangeText('')}
            style={styles.searchClear}
            activeOpacity={0.6}
          >
            <Text style={styles.searchClearText}>✕</Text>
          </TouchableOpacity>
        )}

        {/* Scan line on focus */}
        {isFocused && <View style={styles.searchScanLine} />}
      </Animated.View>

      {/* Hint text */}
      <Animated.Text
        style={[
          styles.searchHint,
          {
            opacity: glowAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.6],
            }),
          },
        ]}
      >
        TIP: Use tag codes like "TANK-101" or document types like "PDF"
      </Animated.Text>
    </Animated.View>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// ░░░  COMPONENT 3: ACTIVE ASSET CARD  ░░░
// ═══════════════════════════════════════════════════════════════════════
const getStatusConfig = (
  status: AssetStatus,
): { color: string; bg: string; label: string } => {
  switch (status) {
    case 'operational':
      return { color: T.success, bg: T.successFaint, label: 'OPERATIONAL' };
    case 'maintenance':
      return { color: T.warning, bg: T.warningFaint, label: 'MAINTENANCE' };
    case 'flagged':
      return { color: T.critical, bg: T.criticalFaint, label: 'FLAGGED' };
    case 'decommissioned':
      return { color: T.textTertiary, bg: T.surface, label: 'DECOMMISSIONED' };
    default:
      return { color: T.textTertiary, bg: T.surface, label: status };
  }
};

const RiskGauge: React.FC<{ score: number }> = memo(({ score }) => {
  const barWidth = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(barWidth, {
      toValue: score,
      duration: 1200,
      delay: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [barWidth, score]);

  const color =
    score >= 75
      ? T.critical
      : score >= 50
        ? T.warning
        : score >= 25
          ? T.primary
          : T.success;

  const width = barWidth.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.riskGauge}>
      <View style={styles.riskGaugeHeader}>
        <Text style={styles.riskGaugeLabel}>RISK SCORE</Text>
        <Text style={[styles.riskGaugeValue, { color }]}>{score}</Text>
      </View>
      <View style={styles.riskGaugeTrack}>
        <Animated.View
          style={[styles.riskGaugeFill, { width, backgroundColor: color }]}
        />
        {/* Tick marks */}
        {[25, 50, 75].map((tick) => (
          <View
            key={tick}
            style={[styles.riskGaugeTick, { left: `${tick}%` }]}
          />
        ))}
      </View>
    </View>
  );
});

const ActiveAssetCard: React.FC<{ asset: Asset }> = memo(({ asset }) => {
  const { opacity, translateY } = useSlideIn(300, 20);
  const statusConfig = getStatusConfig(asset.status);

  return (
    <Animated.View
      style={[
        styles.activeAssetCard,
        { opacity, transform: [{ translateY }] },
      ]}
    >
      {/* Top bar accent */}
      <View
        style={[styles.assetCardTopBar, { backgroundColor: statusConfig.color }]}
      />

      {/* Header */}
      <View style={styles.assetCardHeader}>
        <View style={styles.assetTagContainer}>
          <Text style={styles.assetTag}>{asset.tag}</Text>
          <View
            style={[
              styles.assetStatusBadge,
              { backgroundColor: statusConfig.bg, borderColor: statusConfig.color },
            ]}
          >
            <View
              style={[
                styles.assetStatusDot,
                { backgroundColor: statusConfig.color },
              ]}
            />
            <Text style={[styles.assetStatusText, { color: statusConfig.color }]}>
              {statusConfig.label}
            </Text>
          </View>
        </View>
        <Text style={styles.assetName}>{asset.name}</Text>
        <Text style={styles.assetType}>{asset.type}</Text>
      </View>

      {/* Data grid */}
      <View style={styles.assetDataGrid}>
        <View style={styles.assetDataCell}>
          <Text style={styles.assetDataLabel}>LOCATION</Text>
          <Text style={styles.assetDataValue}>{asset.location}</Text>
        </View>
        <View style={styles.assetDataCell}>
          <Text style={styles.assetDataLabel}>MANUFACTURER</Text>
          <Text style={styles.assetDataValue}>{asset.manufacturer}</Text>
        </View>
        <View style={styles.assetDataRow}>
          <View style={styles.assetDataCellHalf}>
            <Text style={styles.assetDataLabel}>LAST INSPECTION</Text>
            <Text style={[styles.assetDataValueMono, { color: T.success }]}>
              {asset.lastInspection}
            </Text>
          </View>
          <View style={styles.assetDataCellHalf}>
            <Text style={styles.assetDataLabel}>NEXT DUE</Text>
            <Text style={[styles.assetDataValueMono, { color: T.warning }]}>
              {asset.nextDue}
            </Text>
          </View>
        </View>
        <View style={styles.assetDataCell}>
          <Text style={styles.assetDataLabel}>INSTALL DATE</Text>
          <Text style={styles.assetDataValueMono}>{asset.installDate}</Text>
        </View>
      </View>

      {/* Risk gauge */}
      <RiskGauge score={asset.riskScore} />
    </Animated.View>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// ░░░  COMPONENT 4: ASSET TIMELINE  ░░░
// ═══════════════════════════════════════════════════════════════════════
const getEventTypeConfig = (
  type: TimelineEventType,
): { color: string; bg: string; icon: string } => {
  switch (type) {
    case 'inspection':
      return { color: T.primary, bg: T.primaryFaint, icon: '◎' };
    case 'repair':
      return { color: T.warning, bg: T.warningFaint, icon: '⚙' };
    case 'certification':
      return { color: T.success, bg: T.successFaint, icon: '✦' };
    case 'incident':
      return { color: T.critical, bg: T.criticalFaint, icon: '⚡' };
    case 'audit':
      return { color: T.purple, bg: T.purpleFaint, icon: '▣' };
    case 'commissioning':
      return { color: T.cyan, bg: T.cyanFaint, icon: '◈' };
    default:
      return { color: T.textTertiary, bg: T.surface, icon: '●' };
  }
};

const getResultConfig = (
  result: TimelineEvent['result'],
): { color: string; label: string } => {
  switch (result) {
    case 'pass':
      return { color: T.success, label: 'PASS' };
    case 'fail':
      return { color: T.critical, label: 'FAIL' };
    case 'conditional':
      return { color: T.warning, label: 'CONDITIONAL' };
    case 'info':
      return { color: T.textSecondary, label: 'INFO' };
    default:
      return { color: T.textTertiary, label: result };
  }
};

const TimelineNode: React.FC<{
  event: TimelineEvent;
  index: number;
  isLast: boolean;
}> = memo(({ event, index, isLast }) => {
  const { opacity, translateY } = useSlideIn(index * 100 + 600, 18);
  const typeConfig = getEventTypeConfig(event.type);
  const resultConfig = getResultConfig(event.result);

  return (
    <Animated.View
      style={[
        styles.timelineNode,
        { opacity, transform: [{ translateY }] },
      ]}
    >
      {/* Left column: line + dot */}
      <View style={styles.timelineLeftCol}>
        {/* Hollow dot */}
        <View
          style={[
            styles.timelineDot,
            { borderColor: typeConfig.color },
          ]}
        >
          <Text style={[styles.timelineDotIcon, { color: typeConfig.color }]}>
            {typeConfig.icon}
          </Text>
        </View>

        {/* Dashed connector line */}
        {!isLast && (
          <View style={styles.timelineDashedLineContainer}>
            {Array.from({ length: 8 }).map((_, i) => (
              <View
                key={`dash-${event.id}-${i}`}
                style={[
                  styles.timelineDash,
                  {
                    backgroundColor: T.border,
                    opacity: 1 - i * 0.05,
                  },
                ]}
              />
            ))}
          </View>
        )}
      </View>

      {/* Right column: content */}
      <View style={styles.timelineContent}>
        {/* Date + Type badge */}
        <View style={styles.timelineContentHeader}>
          <Text style={styles.timelineDate}>{event.date}</Text>
          <View
            style={[
              styles.timelineTypeBadge,
              { backgroundColor: typeConfig.bg, borderColor: typeConfig.color },
            ]}
          >
            <Text
              style={[styles.timelineTypeText, { color: typeConfig.color }]}
            >
              {event.type.toUpperCase()}
            </Text>
          </View>
        </View>

        {/* Title */}
        <Text style={styles.timelineTitle}>{event.title}</Text>

        {/* Description */}
        <Text style={styles.timelineDescription}>{event.description}</Text>

        {/* Footer meta */}
        <View style={styles.timelineMeta}>
          <View style={styles.timelineMetaItem}>
            <Text style={styles.timelineMetaLabel}>Inspector</Text>
            <Text style={styles.timelineMetaValue}>{event.inspector}</Text>
          </View>
          <View style={styles.timelineMetaItem}>
            <Text style={styles.timelineMetaLabel}>Ref No.</Text>
            <Text style={styles.timelineMetaValueMono}>
              {event.referenceNo}
            </Text>
          </View>
          <View
            style={[
              styles.timelineResultBadge,
              {
                backgroundColor:
                  resultConfig.color === T.success
                    ? T.successFaint
                    : resultConfig.color === T.critical
                      ? T.criticalFaint
                      : T.warningFaint,
                borderColor: resultConfig.color,
              },
            ]}
          >
            <Text
              style={[
                styles.timelineResultText,
                { color: resultConfig.color },
              ]}
            >
              {resultConfig.label}
            </Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
});

const AssetTimeline: React.FC = memo(() => (
  <View>
    <SectionHeader
      title="ASSET TIMELINE"
      subtitle="Chronological event history, TANK-101"
      delay={500}
      accentColor={T.cyan}
    />
    <View style={styles.timelineContainer}>
      {TIMELINE_EVENTS.map((event, i) => (
        <TimelineNode
          key={event.id}
          event={event}
          index={i}
          isLast={i === TIMELINE_EVENTS.length - 1}
        />
      ))}
    </View>
  </View>
));

// ═══════════════════════════════════════════════════════════════════════
// ░░░  COMPONENT 5: DOCUMENT GRID  ░░░
// ═══════════════════════════════════════════════════════════════════════
const getDocTypeConfig = (
  type: DocType,
): { color: string; bg: string; borderColor: string; icon: string } => {
  switch (type) {
    case 'PDF':
      return {
        color: T.critical,
        bg: T.criticalFaint,
        borderColor: T.critical,
        icon: '◩',
      };
    case 'CSV':
      return {
        color: T.success,
        bg: T.successFaint,
        borderColor: T.success,
        icon: '▤',
      };
    case 'XLSX':
      return {
        color: T.success,
        bg: T.successFaint,
        borderColor: T.success,
        icon: '▦',
      };
    case 'IMG':
      return {
        color: T.purple,
        bg: T.purpleFaint,
        borderColor: T.purple,
        icon: '▨',
      };
    case 'DWG':
      return {
        color: T.cyan,
        bg: T.cyanFaint,
        borderColor: T.cyan,
        icon: '⬡',
      };
    default:
      return {
        color: T.textTertiary,
        bg: T.surface,
        borderColor: T.border,
        icon: '▢',
      };
  }
};

const getClassificationConfig = (
  classification: DocumentFile['classification'],
): { color: string; icon: string } => {
  switch (classification) {
    case 'confidential':
      return { color: T.critical, icon: '🔒' };
    case 'internal':
      return { color: T.warning, icon: '🔐' };
    case 'public':
      return { color: T.success, icon: '🔓' };
    default:
      return { color: T.textTertiary, icon: '—' };
  }
};

const DocumentCard: React.FC<{ doc: DocumentFile; index: number }> = memo(
  ({ doc, index }) => {
    const typeConfig = getDocTypeConfig(doc.type);
    const classConfig = getClassificationConfig(doc.classification);

    // Staggered fade-in
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const scaleAnim = useRef(new Animated.Value(0.92)).current;

    useEffect(() => {
      const delay = index * 60 + 900;
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 450,
          delay,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          delay,
          friction: 7,
          tension: 60,
          useNativeDriver: true,
        }),
      ]).start();
    }, [fadeAnim, scaleAnim, index]);

    return (
      <Animated.View
        style={[
          styles.docCard,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {/* Type accent bar */}
        <View
          style={[
            styles.docAccentBar,
            { backgroundColor: typeConfig.color },
          ]}
        />

        {/* File icon area */}
        <View
          style={[
            styles.docIconArea,
            { backgroundColor: typeConfig.bg },
          ]}
        >
          <Text style={[styles.docIconGlyph, { color: typeConfig.color }]}>
            {typeConfig.icon}
          </Text>
          <Text style={[styles.docTypeLabel, { color: typeConfig.color }]}>
            {doc.type}
          </Text>
        </View>

        {/* File info */}
        <View style={styles.docInfo}>
          <Text style={styles.docName} numberOfLines={2}>
            {doc.name.replace(/_/g, ' ')}
          </Text>

          <View style={styles.docMetaRow}>
            <Text style={styles.docMetaText}>{doc.size}</Text>
            <Text style={styles.docMetaText}>{doc.modified}</Text>
            {doc.pages && (
              <>
                <Text style={styles.docMetaText}>{doc.pages} pp</Text>
              </>
            )}
          </View>

          <View style={styles.docFooter}>
            <Text style={styles.docAssetTag}>{doc.assetTag}</Text>
            <Text
              style={[
                styles.docClassification,
                { color: classConfig.color },
              ]}
            >
              {classConfig.icon} {doc.classification.toUpperCase()}
            </Text>
          </View>
        </View>
      </Animated.View>
    );
  },
);

const FilterChipButton: React.FC<{
  chip: FilterChip;
  isActive: boolean;
  onPress: () => void;
}> = memo(({ chip, isActive, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={0.7}
    style={[
      styles.filterChip,
      isActive && styles.filterChipActive,
    ]}
  >
    <Text
      style={[
        styles.filterChipText,
        isActive && styles.filterChipTextActive,
      ]}
    >
      {chip.label}
    </Text>
    <View
      style={[
        styles.filterChipCount,
        isActive && styles.filterChipCountActive,
      ]}
    >
      <Text
        style={[
          styles.filterChipCountText,
          isActive && styles.filterChipCountTextActive,
        ]}
      >
        {chip.count}
      </Text>
    </View>
  </TouchableOpacity>
));

const DocumentGrid: React.FC<{
  searchQuery: string;
}> = memo(({ searchQuery }) => {
  const [activeFilter, setActiveFilter] = useState<DocCategory>('all');

  const handleFilterPress = useCallback((key: DocCategory) => {
    LayoutAnimation.configureNext(
      LayoutAnimation.create(
        350,
        LayoutAnimation.Types.easeInEaseOut,
        LayoutAnimation.Properties.opacity,
      ),
    );
    setActiveFilter(key);
  }, []);

  const filteredDocs = useMemo(() => {
    let docs = DOCUMENTS;

    if (activeFilter !== 'all') {
      docs = docs.filter((d) => d.category === activeFilter);
    }

    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase();
      docs = docs.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.type.toLowerCase().includes(q) ||
          d.assetTag.toLowerCase().includes(q) ||
          d.category.toLowerCase().includes(q),
      );
    }

    return docs;
  }, [activeFilter, searchQuery]);

  return (
    <View>
      <SectionHeader
        title="DOCUMENT VAULT"
        subtitle={`${filteredDocs.length} files in secure storage`}
        delay={800}
        accentColor={T.critical}
      />

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterChipsRow}
      >
        {FILTER_CHIPS.map((chip) => (
          <FilterChipButton
            key={chip.key}
            chip={chip}
            isActive={activeFilter === chip.key}
            onPress={() => handleFilterPress(chip.key)}
          />
        ))}
      </ScrollView>

      {/* Document list */}
      <View style={styles.docGrid}>
        {filteredDocs.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateIcon}>◇</Text>
            <Text style={styles.emptyStateTitle}>No documents found</Text>
            <Text style={styles.emptyStateSubtitle}>
              Adjust filters or refine your search query
            </Text>
          </View>
        ) : (
          filteredDocs.map((doc, i) => (
            <DocumentCard key={doc.id} doc={doc} index={i} />
          ))
        )}
      </View>
    </View>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// ░░░  COMPONENT 6: ASSET SELECTOR  ░░░
// ═══════════════════════════════════════════════════════════════════════
const AssetSelectorChip: React.FC<{
  asset: Asset;
  isActive: boolean;
  onPress: () => void;
  index: number;
}> = memo(({ asset, isActive, onPress, index }) => {
  const { opacity, translateY } = useSlideIn(index * 80 + 150, 12);
  const statusConfig = getStatusConfig(asset.status);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        style={[
          styles.assetSelectorChip,
          isActive && styles.assetSelectorChipActive,
          isActive && { borderColor: statusConfig.color },
        ]}
      >
        <View
          style={[
            styles.assetSelectorDot,
            { backgroundColor: statusConfig.color },
          ]}
        />
        <View>
          <Text
            style={[
              styles.assetSelectorTag,
              isActive && { color: T.textPrimary },
            ]}
          >
            {asset.tag}
          </Text>
          <Text style={styles.assetSelectorType}>{asset.type}</Text>
        </View>
        <View
          style={[
            styles.assetSelectorRisk,
            {
              backgroundColor:
                asset.riskScore >= 75
                  ? T.criticalFaint
                  : asset.riskScore >= 50
                    ? T.warningFaint
                    : asset.riskScore >= 25
                      ? T.primaryFaint
                      : T.successFaint,
            },
          ]}
        >
          <Text
            style={[
              styles.assetSelectorRiskText,
              {
                color:
                  asset.riskScore >= 75
                    ? T.critical
                    : asset.riskScore >= 50
                      ? T.warning
                      : asset.riskScore >= 25
                        ? T.primary
                        : T.success,
              },
            ]}
          >
            {asset.riskScore}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// ░░░  MAIN VAULT COMPONENT  ░░░
// ═══════════════════════════════════════════════════════════════════════
const AssetVault: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedAssetId, setSelectedAssetId] = useState<string>('AST-001');

  const selectedAsset = useMemo(
    () => ASSETS.find((a) => a.id === selectedAssetId) ?? ASSETS[0],
    [selectedAssetId],
  );

  const handleAssetSelect = useCallback((assetId: string) => {
    LayoutAnimation.configureNext(
      LayoutAnimation.create(
        400,
        LayoutAnimation.Types.easeInEaseOut,
        LayoutAnimation.Properties.opacity,
      ),
    );
    setSelectedAssetId(assetId);
  }, []);

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Vault Header ── */}
        <VaultHeader />

        {/* ── Smart Search ── */}
        <SmartSearchBar value={searchQuery} onChangeText={setSearchQuery} />

        {/* ── Asset Selector ── */}
        <SectionHeader
          title="ASSET REGISTRY"
          subtitle="Select an asset to view its intelligence file"
          delay={100}
          accentColor={T.success}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.assetSelectorRow}
        >
          {ASSETS.map((asset, i) => (
            <AssetSelectorChip
              key={asset.id}
              asset={asset}
              isActive={asset.id === selectedAssetId}
              onPress={() => handleAssetSelect(asset.id)}
              index={i}
            />
          ))}
        </ScrollView>

        {/* ── Active Asset Card ── */}
        <ActiveAssetCard asset={selectedAsset} />

        {/* ── Asset Timeline ── */}
        <AssetTimeline />

        {/* ── Document Grid ── */}
        <DocumentGrid searchQuery={searchQuery} />

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <View style={styles.footerLine} />
          <Text style={styles.footerText}>
            NEXPEC VAULT v3.1.0, AES-256 ENCRYPTED
          </Text>
          <View style={styles.footerLine} />
        </View>
      </ScrollView>
    </View>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// ░░░  STYLES  ░░░
// ═══════════════════════════════════════════════════════════════════════
const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

const styles = StyleSheet.create({
  // ── Root ──
  root: {
    flex: 1,
    backgroundColor: T.bg,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 60,
  },

  // ── Vault Header ──
  vaultHeader: {
    paddingHorizontal: 20,
    paddingTop: 58,
    paddingBottom: 4,
  },
  vaultHeaderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  vaultTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: T.textPrimary,
    letterSpacing: 5,
  },
  vaultSubtitle: {
    fontSize: 10,
    fontWeight: '600',
    color: T.primary,
    letterSpacing: 5,
    marginTop: 3,
  },
  vaultSecurityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.successFaint,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.25)',
    marginTop: 4,
  },
  vaultSecurityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: T.success,
    marginRight: 6,
  },
  vaultSecurityText: {
    fontSize: 8,
    fontWeight: '800',
    color: T.success,
    letterSpacing: 2,
  },
  classificationBar: {
    flexDirection: 'row',
    backgroundColor: T.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.border,
    marginTop: 18,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  classBarSegment: {
    flex: 1,
    alignItems: 'center',
  },
  classBarLabel: {
    fontSize: 7,
    fontWeight: '700',
    color: T.textTertiary,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  classBarValue: {
    fontSize: 16,
    fontWeight: '800',
    fontFamily: MONO_FONT,
  },
  classBarDivider: {
    width: 1,
    backgroundColor: T.border,
    marginVertical: 2,
  },

  // ── Section Header ──
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 28,
    marginBottom: 14,
  },
  sectionAccent: {
    width: 3,
    height: 30,
    borderRadius: 2,
    marginRight: 12,
  },
  sectionHeaderText: {},
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: T.textPrimary,
    letterSpacing: 3,
  },
  sectionSubtitle: {
    fontSize: 9,
    color: T.textTertiary,
    letterSpacing: 1,
    marginTop: 2,
  },

  // ── Smart Search ──
  searchWrapper: {
    paddingHorizontal: 16,
    marginTop: 20,
    alignItems: 'center',
  },
  searchGlow: {
    position: 'absolute',
    top: 4,
    left: 30,
    right: 30,
    height: 48,
    borderRadius: 14,
    backgroundColor: T.primaryGlow,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  searchIconContainer: {
    width: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchIcon: {
    fontSize: 22,
    fontWeight: '300',
  },
  searchInput: {
    flex: 1,
    height: '100%',
    fontSize: 14,
    color: T.textPrimary,
    fontFamily: MONO_FONT,
    letterSpacing: 0.5,
    paddingRight: 12,
  },
  searchClear: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    backgroundColor: T.surface,
  },
  searchClearText: {
    fontSize: 12,
    color: T.textSecondary,
    fontWeight: '600',
  },
  searchScanLine: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: T.primary,
    opacity: 0.4,
  },
  searchHint: {
    fontSize: 9,
    color: T.textTertiary,
    letterSpacing: 0.5,
    marginTop: 8,
    fontFamily: MONO_FONT,
  },

  // ── Asset Selector ──
  assetSelectorRow: {
    paddingHorizontal: 16,
    gap: 10,
  },
  assetSelectorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
    minWidth: 160,
  },
  assetSelectorChipActive: {
    backgroundColor: T.cardBgHover,
    borderWidth: 1.5,
  },
  assetSelectorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  assetSelectorTag: {
    fontSize: 13,
    fontWeight: '800',
    color: T.textSecondary,
    fontFamily: MONO_FONT,
    letterSpacing: 1,
  },
  assetSelectorType: {
    fontSize: 9,
    color: T.textTertiary,
    marginTop: 1,
    letterSpacing: 0.5,
  },
  assetSelectorRisk: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginLeft: 'auto',
  },
  assetSelectorRiskText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: MONO_FONT,
  },

  // ── Active Asset Card ──
  activeAssetCard: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: T.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: T.border,
    overflow: 'hidden',
  },
  assetCardTopBar: {
    height: 3,
  },
  assetCardHeader: {
    padding: 18,
    paddingBottom: 12,
  },
  assetTagContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  assetTag: {
    fontSize: 20,
    fontWeight: '900',
    color: T.textPrimary,
    fontFamily: MONO_FONT,
    letterSpacing: 2,
  },
  assetStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    gap: 5,
  },
  assetStatusDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  assetStatusText: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  assetName: {
    fontSize: 16,
    fontWeight: '700',
    color: T.textPrimary,
    marginBottom: 2,
  },
  assetType: {
    fontSize: 11,
    color: T.textTertiary,
    letterSpacing: 0.5,
  },
  assetDataGrid: {
    paddingHorizontal: 18,
    gap: 10,
  },
  assetDataCell: {
    backgroundColor: T.surface,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: T.borderSubtle,
  },
  assetDataRow: {
    flexDirection: 'row',
    gap: 10,
  },
  assetDataCellHalf: {
    flex: 1,
    backgroundColor: T.surface,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: T.borderSubtle,
  },
  assetDataLabel: {
    fontSize: 7,
    fontWeight: '700',
    color: T.textTertiary,
    letterSpacing: 2,
    marginBottom: 4,
  },
  assetDataValue: {
    fontSize: 12,
    fontWeight: '600',
    color: T.textSecondary,
    letterSpacing: 0.3,
  },
  assetDataValueMono: {
    fontSize: 12,
    fontWeight: '700',
    color: T.textMono,
    fontFamily: MONO_FONT,
    letterSpacing: 0.8,
  },

  // ── Risk Gauge ──
  riskGauge: {
    margin: 18,
    marginTop: 14,
  },
  riskGaugeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  riskGaugeLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: T.textTertiary,
    letterSpacing: 2,
  },
  riskGaugeValue: {
    fontSize: 18,
    fontWeight: '900',
    fontFamily: MONO_FONT,
  },
  riskGaugeTrack: {
    height: 6,
    backgroundColor: T.surface,
    borderRadius: 3,
    overflow: 'hidden',
  },
  riskGaugeFill: {
    height: '100%',
    borderRadius: 3,
  },
  riskGaugeTick: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },

  // ── Timeline ──
  timelineContainer: {
    paddingLeft: 20,
    paddingRight: 16,
  },
  timelineNode: {
    flexDirection: 'row',
    marginBottom: 0,
  },
  timelineLeftCol: {
    width: 40,
    alignItems: 'center',
  },
  timelineDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: T.bg,
    zIndex: 2,
  },
  timelineDotIcon: {
    fontSize: 11,
    fontWeight: '800',
  },
  timelineDashedLineContainer: {
    alignItems: 'center',
    paddingVertical: 4,
    gap: 5,
    flex: 1,
    minHeight: 60,
  },
  timelineDash: {
    width: 2,
    height: 6,
    borderRadius: 1,
  },
  timelineContent: {
    flex: 1,
    marginLeft: 12,
    backgroundColor: T.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.border,
    padding: 14,
    marginBottom: 12,
  },
  timelineContentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  timelineDate: {
    fontSize: 11,
    fontWeight: '700',
    color: T.textSecondary,
    fontFamily: MONO_FONT,
    letterSpacing: 0.5,
  },
  timelineTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: 1,
  },
  timelineTypeText: {
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  timelineTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: T.textPrimary,
    lineHeight: 18,
    marginBottom: 6,
  },
  timelineDescription: {
    fontSize: 11,
    color: T.textSecondary,
    lineHeight: 17,
    letterSpacing: 0.2,
    marginBottom: 10,
  },
  timelineMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: T.borderSubtle,
  },
  timelineMetaItem: {
    gap: 2,
  },
  timelineMetaLabel: {
    fontSize: 7,
    fontWeight: '700',
    color: T.textTertiary,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  timelineMetaValue: {
    fontSize: 10,
    fontWeight: '600',
    color: T.textSecondary,
    letterSpacing: 0.3,
  },
  timelineMetaValueMono: {
    fontSize: 9,
    fontWeight: '700',
    color: T.textMono,
    fontFamily: MONO_FONT,
    letterSpacing: 0.5,
  },
  timelineResultBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: 1,
    marginLeft: 'auto',
  },
  timelineResultText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.5,
  },

  // ── Filter Chips ──
  filterChipsRow: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 4,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: T.border,
    backgroundColor: T.cardBg,
    gap: 6,
  },
  filterChipActive: {
    backgroundColor: T.primaryFaint,
    borderColor: T.primary,
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: T.textSecondary,
    letterSpacing: 0.3,
  },
  filterChipTextActive: {
    color: T.primary,
    fontWeight: '700',
  },
  filterChipCount: {
    backgroundColor: T.surface,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 20,
    alignItems: 'center',
  },
  filterChipCountActive: {
    backgroundColor: T.primaryMid,
  },
  filterChipCountText: {
    fontSize: 9,
    fontWeight: '800',
    color: T.textTertiary,
    fontFamily: MONO_FONT,
  },
  filterChipCountTextActive: {
    color: T.primary,
  },

  // ── Document Grid ──
  docGrid: {
    paddingHorizontal: 16,
    marginTop: 12,
    gap: 8,
  },
  docCard: {
    flexDirection: 'row',
    backgroundColor: T.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.border,
    overflow: 'hidden',
  },
  docAccentBar: {
    width: 3,
  },
  docIconArea: {
    width: 60,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 4,
  },
  docIconGlyph: {
    fontSize: 22,
    fontWeight: '300',
  },
  docTypeLabel: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.5,
    fontFamily: MONO_FONT,
  },
  docInfo: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    paddingRight: 14,
    justifyContent: 'center',
  },
  docName: {
    fontSize: 12,
    fontWeight: '600',
    color: T.textPrimary,
    lineHeight: 17,
    letterSpacing: 0.2,
    marginBottom: 4,
  },
  docMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 6,
  },
  docMetaText: {
    fontSize: 9,
    color: T.textTertiary,
    fontFamily: MONO_FONT,
    letterSpacing: 0.3,
  },
  docMetaDot: {
    fontSize: 9,
    color: T.textTertiary,
  },
  docFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  docAssetTag: {
    fontSize: 9,
    fontWeight: '700',
    color: T.textSecondary,
    fontFamily: MONO_FONT,
    letterSpacing: 1,
  },
  docClassification: {
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 1.5,
  },

  // ── Empty State ──
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
  },
  emptyStateIcon: {
    fontSize: 36,
    color: T.textTertiary,
    marginBottom: 12,
  },
  emptyStateTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: T.textSecondary,
    letterSpacing: 1,
  },
  emptyStateSubtitle: {
    fontSize: 11,
    color: T.textTertiary,
    marginTop: 4,
    letterSpacing: 0.3,
  },

  // ── Footer ──
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
    gap: 12,
  },
  footerLine: {
    flex: 1,
    height: 1,
    backgroundColor: T.border,
  },
  footerText: {
    fontSize: 7,
    fontWeight: '600',
    color: T.textTertiary,
    letterSpacing: 3,
    fontFamily: MONO_FONT,
  },
});

export default AssetVault;