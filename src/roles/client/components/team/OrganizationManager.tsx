// src/components/client/team/OrganizationManager.tsx

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
  ScrollView,
  Animated,
  Easing,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  TextInput,
  Platform,
  UIManager,
  LayoutAnimation,
  Modal,
  KeyboardAvoidingView,
} from 'react-native';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ═══════════════════════════════════════════════════════════════════════
// ░░░  DESIGN TOKENS  ░░░
// ═══════════════════════════════════════════════════════════════════════
const TK = {
  bg: '#020617',
  bgOverlay: 'rgba(2,6,23,0.85)',
  surface: 'rgba(255,255,255,0.03)',
  cardBg: 'rgba(255,255,255,0.05)',
  cardBgElevated: 'rgba(255,255,255,0.07)',
  cardBgHover: 'rgba(255,255,255,0.09)',
  border: 'rgba(255,255,255,0.08)',
  borderFocus: 'rgba(59,130,246,0.5)',
  borderSubtle: 'rgba(255,255,255,0.04)',

  textPrimary: '#F8FAFC',
  textSecondary: 'rgba(248,250,252,0.60)',
  textTertiary: 'rgba(248,250,252,0.30)',
  textMono: 'rgba(248,250,252,0.75)',

  primary: '#3B82F6',
  primaryGlow: 'rgba(59,130,246,0.25)',
  primaryFaint: 'rgba(59,130,246,0.08)',
  primaryMid: 'rgba(59,130,246,0.18)',

  success: '#10B981',
  successGlow: 'rgba(16,185,129,0.25)',
  successFaint: 'rgba(16,185,129,0.08)',

  warning: '#F59E0B',
  warningGlow: 'rgba(245,158,11,0.25)',
  warningFaint: 'rgba(245,158,11,0.08)',

  critical: '#EF4444',
  criticalGlow: 'rgba(239,68,68,0.25)',
  criticalFaint: 'rgba(239,68,68,0.08)',

  purple: '#8B5CF6',
  purpleFaint: 'rgba(139,92,246,0.08)',
  purpleMid: 'rgba(139,92,246,0.18)',

  cyan: '#06B6D4',
  cyanFaint: 'rgba(6,182,212,0.08)',
  cyanMid: 'rgba(6,182,212,0.18)',

  gold: '#FBBF24',
  goldFaint: 'rgba(251,191,36,0.08)',

  switchOff: 'rgba(255,255,255,0.12)',
  switchTrackOff: 'rgba(255,255,255,0.06)',
} as const;

const MONO = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

// ═══════════════════════════════════════════════════════════════════════
// ░░░  TYPE DEFINITIONS  ░░░
// ═══════════════════════════════════════════════════════════════════════
type MemberRole = 'owner' | 'admin' | 'manager' | 'viewer';
type MemberStatus = 'active' | 'invited' | 'suspended' | 'offline';
type InspectorTier = 'platinum' | 'gold' | 'silver';
type PermissionKey =
  | 'canViewReports'
  | 'canEditAssets'
  | 'canManageTeam'
  | 'canApproveBids'
  | 'canAccessFinance'
  | 'canExportData';

interface TeamMember {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
  department: string;
  joinDate: string;
  lastActive: string;
  permissions: Record<PermissionKey, boolean>;
  avatarColor: string;
}

interface PreferredInspector {
  id: string;
  name: string;
  company: string;
  tier: InspectorTier;
  rating: number;
  completedJobs: number;
  specializations: string[];
  lastEngagement: string;
  avatarColor: string;
}

interface OrgStats {
  label: string;
  value: string;
  icon: string;
  color: string;
}

interface PermissionDef {
  key: PermissionKey;
  label: string;
  description: string;
  icon: string;
  critical: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// ░░░  MOCK DATA  ░░░
// ═══════════════════════════════════════════════════════════════════════
const TEAM_MEMBERS: TeamMember[] = [
  {
    id: 'MBR-001',
    firstName: 'Alexander',
    lastName: 'Rostov',
    email: 'a.rostov@petrocore.com',
    role: 'owner',
    status: 'active',
    department: 'Executive',
    joinDate: '2021-03-14',
    lastActive: '2 min ago',
    permissions: {
      canViewReports: true,
      canEditAssets: true,
      canManageTeam: true,
      canApproveBids: true,
      canAccessFinance: true,
      canExportData: true,
    },
    avatarColor: TK.primary,
  },
  {
    id: 'MBR-002',
    firstName: 'Elena',
    lastName: 'Vasquez',
    email: 'e.vasquez@petrocore.com',
    role: 'admin',
    status: 'active',
    department: 'Operations',
    joinDate: '2022-01-08',
    lastActive: '15 min ago',
    permissions: {
      canViewReports: true,
      canEditAssets: true,
      canManageTeam: true,
      canApproveBids: true,
      canAccessFinance: true,
      canExportData: true,
    },
    avatarColor: TK.purple,
  },
  {
    id: 'MBR-003',
    firstName: 'James',
    lastName: 'Thornton',
    email: 'j.thornton@petrocore.com',
    role: 'manager',
    status: 'active',
    department: 'Engineering',
    joinDate: '2022-06-22',
    lastActive: '1 hr ago',
    permissions: {
      canViewReports: true,
      canEditAssets: true,
      canManageTeam: false,
      canApproveBids: true,
      canAccessFinance: false,
      canExportData: true,
    },
    avatarColor: TK.cyan,
  },
  {
    id: 'MBR-004',
    firstName: 'Fatima',
    lastName: 'Al-Rashid',
    email: 'f.alrashid@petrocore.com',
    role: 'manager',
    status: 'active',
    department: 'Quality Assurance',
    joinDate: '2023-02-15',
    lastActive: '3 hr ago',
    permissions: {
      canViewReports: true,
      canEditAssets: false,
      canManageTeam: false,
      canApproveBids: true,
      canAccessFinance: false,
      canExportData: true,
    },
    avatarColor: TK.success,
  },
  {
    id: 'MBR-005',
    firstName: 'Chen',
    lastName: 'Wei',
    email: 'c.wei@petrocore.com',
    role: 'viewer',
    status: 'active',
    department: 'Compliance',
    joinDate: '2023-09-01',
    lastActive: '1 day ago',
    permissions: {
      canViewReports: true,
      canEditAssets: false,
      canManageTeam: false,
      canApproveBids: false,
      canAccessFinance: false,
      canExportData: false,
    },
    avatarColor: TK.warning,
  },
  {
    id: 'MBR-006',
    firstName: 'Sarah',
    lastName: 'Mitchell',
    email: 's.mitchell@petrocore.com',
    role: 'viewer',
    status: 'invited',
    department: 'Finance',
    joinDate: '—',
    lastActive: 'Pending',
    permissions: {
      canViewReports: true,
      canEditAssets: false,
      canManageTeam: false,
      canApproveBids: false,
      canAccessFinance: true,
      canExportData: false,
    },
    avatarColor: TK.critical,
  },
  {
    id: 'MBR-007',
    firstName: 'Dmitri',
    lastName: 'Volkov',
    email: 'd.volkov@petrocore.com',
    role: 'manager',
    status: 'suspended',
    department: 'Field Ops',
    joinDate: '2022-11-30',
    lastActive: '14 days ago',
    permissions: {
      canViewReports: false,
      canEditAssets: false,
      canManageTeam: false,
      canApproveBids: false,
      canAccessFinance: false,
      canExportData: false,
    },
    avatarColor: TK.switchOff,
  },
];

const PREFERRED_INSPECTORS: PreferredInspector[] = [
  {
    id: 'PI-001',
    name: 'Capt. Dimitrios Kolos',
    company: 'AquaVeritas Inspection Co.',
    tier: 'platinum',
    rating: 4.9,
    completedJobs: 247,
    specializations: ['API 510', 'API 570', 'CWI'],
    lastEngagement: '2024-11-18',
    avatarColor: TK.gold,
  },
  {
    id: 'PI-002',
    name: 'Eng. Lars Henriksen',
    company: 'Nordic Integrity Solutions',
    tier: 'gold',
    rating: 4.7,
    completedJobs: 189,
    specializations: ['API 653', 'CSWIP 3.1'],
    lastEngagement: '2024-10-02',
    avatarColor: TK.primary,
  },
  {
    id: 'PI-003',
    name: 'Dr. Amira Bashir',
    company: 'PetroSafe Global Ltd.',
    tier: 'gold',
    rating: 4.5,
    completedJobs: 132,
    specializations: ['ASNT Level III', 'API 510'],
    lastEngagement: '2024-08-14',
    avatarColor: TK.purple,
  },
  {
    id: 'PI-004',
    name: 'Eng. Yuki Tanaka',
    company: 'Pacific Marine Inspection',
    tier: 'silver',
    rating: 4.3,
    completedJobs: 87,
    specializations: ['CWI', 'NACE CIP-2'],
    lastEngagement: '2024-06-29',
    avatarColor: TK.cyan,
  },
];

const ORG_STATS: OrgStats[] = [
  { label: 'Members', value: '7', icon: '◎', color: TK.primary },
  { label: 'Active', value: '5', icon: '●', color: TK.success },
  { label: 'Invited', value: '1', icon: '◇', color: TK.warning },
  { label: 'Inspectors', value: '4', icon: '✦', color: TK.purple },
];

const PERMISSION_DEFS: PermissionDef[] = [
  {
    key: 'canViewReports',
    label: 'View Reports',
    description: 'Access inspection and audit reports',
    icon: '◎',
    critical: false,
  },
  {
    key: 'canEditAssets',
    label: 'Edit Assets',
    description: 'Modify asset records and documentation',
    icon: '⚙',
    critical: false,
  },
  {
    key: 'canManageTeam',
    label: 'Manage Team',
    description: 'Add, remove, and configure team members',
    icon: '▣',
    critical: true,
  },
  {
    key: 'canApproveBids',
    label: 'Approve Bids',
    description: 'Review and approve inspector proposals',
    icon: '✦',
    critical: false,
  },
  {
    key: 'canAccessFinance',
    label: 'Access Finance',
    description: 'View financial data and payment records',
    icon: '◈',
    critical: true,
  },
  {
    key: 'canExportData',
    label: 'Export Data',
    description: 'Download and export organizational data',
    icon: '⬡',
    critical: false,
  },
];

// ═══════════════════════════════════════════════════════════════════════
// ░░░  UTILITY FUNCTIONS  ░░░
// ═══════════════════════════════════════════════════════════════════════
const getInitials = (first: string, last: string): string =>
  `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();

const getInspectorInitials = (name: string): string => {
  const parts = name.replace(/^(Capt\.|Eng\.|Dr\.)\s*/i, '').split(' ');
  return parts
    .slice(0, 2)
    .map((p) => p.charAt(0))
    .join('')
    .toUpperCase();
};

const getRoleConfig = (
  role: MemberRole,
): { color: string; bg: string; label: string } => {
  switch (role) {
    case 'owner':
      return { color: TK.gold, bg: TK.goldFaint, label: 'OWNER' };
    case 'admin':
      return { color: TK.primary, bg: TK.primaryFaint, label: 'ADMIN' };
    case 'manager':
      return { color: TK.cyan, bg: TK.cyanFaint, label: 'MANAGER' };
    case 'viewer':
      return { color: TK.textSecondary, bg: TK.surface, label: 'VIEWER' };
    default:
      return { color: TK.textTertiary, bg: TK.surface, label: role };
  }
};

const getStatusConfig = (
  status: MemberStatus,
): { color: string; bg: string; label: string } => {
  switch (status) {
    case 'active':
      return { color: TK.success, bg: TK.successFaint, label: 'ACTIVE' };
    case 'invited':
      return { color: TK.warning, bg: TK.warningFaint, label: 'INVITED' };
    case 'suspended':
      return { color: TK.critical, bg: TK.criticalFaint, label: 'SUSPENDED' };
    case 'offline':
      return { color: TK.textTertiary, bg: TK.surface, label: 'OFFLINE' };
    default:
      return { color: TK.textTertiary, bg: TK.surface, label: status };
  }
};

const getTierConfig = (
  tier: InspectorTier,
): { color: string; bg: string; label: string; icon: string } => {
  switch (tier) {
    case 'platinum':
      return {
        color: TK.gold,
        bg: TK.goldFaint,
        label: 'PLATINUM',
        icon: '◆',
      };
    case 'gold':
      return {
        color: TK.warning,
        bg: TK.warningFaint,
        label: 'GOLD',
        icon: '◇',
      };
    case 'silver':
      return {
        color: TK.textSecondary,
        bg: TK.surface,
        label: 'SILVER',
        icon: '○',
      };
    default:
      return {
        color: TK.textTertiary,
        bg: TK.surface,
        label: tier,
        icon: '●',
      };
  }
};

// ═══════════════════════════════════════════════════════════════════════
// ░░░  ANIMATION HOOKS  ░░░
// ═══════════════════════════════════════════════════════════════════════
const useSlideIn = (
  delay: number = 0,
  from: number = 22,
  duration: number = 550,
) => {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, []);
  return {
    opacity: progress,
    translateY: progress.interpolate({
      inputRange: [0, 1],
      outputRange: [from, 0],
    }),
  };
};

const useFadeIn = (delay: number = 0, duration: number = 500) => {
  const o = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(o, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, []);
  return o;
};

const usePulse = (duration: number = 2800, low: number = 0.35) => {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(a, {
          toValue: 1,
          duration: duration / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(a, {
          toValue: 0,
          duration: duration / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, []);
  return a.interpolate({
    inputRange: [0, 1],
    outputRange: [low, 1],
  });
};

// ═══════════════════════════════════════════════════════════════════════
// ░░░  SECTION HEADER  ░░░
// ═══════════════════════════════════════════════════════════════════════
const SectionHeader: React.FC<{
  title: string;
  subtitle?: string;
  delay?: number;
  accent?: string;
  rightElement?: React.ReactNode;
}> = memo(({ title, subtitle, delay = 0, accent = TK.primary, rightElement }) => {
  const { opacity, translateY } = useSlideIn(delay, 14, 450);
  return (
    <Animated.View
      style={[st.sectionHeader, { opacity, transform: [{ translateY }] }]}
    >
      <View style={st.sectionHeaderLeft}>
        <View style={[st.sectionAccent, { backgroundColor: accent }]} />
        <View>
          <Text style={st.sectionTitle}>{title}</Text>
          {subtitle && <Text style={st.sectionSubtitle}>{subtitle}</Text>}
        </View>
      </View>
      {rightElement && rightElement}
    </Animated.View>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// ░░░  COMPONENT 1: CUSTOM ANIMATED TOGGLE SWITCH  ░░░
// ═══════════════════════════════════════════════════════════════════════
const TRACK_WIDTH = 52;
const TRACK_HEIGHT = 28;
const KNOB_SIZE = 22;
const KNOB_TRAVEL = TRACK_WIDTH - KNOB_SIZE - 6;

interface CustomToggleProps {
  value: boolean;
  onToggle: (newValue: boolean) => void;
  disabled?: boolean;
  labelOn?: string;
  labelOff?: string;
  colorOn?: string;
}

const CustomToggle: React.FC<CustomToggleProps> = memo(
  ({
    value,
    onToggle,
    disabled = false,
    labelOn = 'Admin',
    labelOff = 'View Only',
    colorOn = TK.primary,
  }) => {
    const animValue = useRef(new Animated.Value(value ? 1 : 0)).current;

    useEffect(() => {
      Animated.spring(animValue, {
        toValue: value ? 1 : 0,
        friction: 7,
        tension: 55,
        useNativeDriver: false,
      }).start();
    }, [value]);

    const handlePress = useCallback(() => {
      if (!disabled) {
        onToggle(!value);
      }
    }, [value, disabled, onToggle]);

    const translateX = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [3, KNOB_TRAVEL + 3],
    });

    const trackBg = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [TK.switchTrackOff, colorOn + '30'],
    });

    const trackBorder = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [TK.switchOff, colorOn + '60'],
    });

    const knobBg = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: ['rgba(255,255,255,0.4)', colorOn],
    });

    const knobScale = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 1.15, 1],
    });

    const knobGlowOpacity = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.6],
    });

    const labelColor = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [TK.textTertiary, colorOn],
    });

    return (
      <View style={[st.toggleContainer, disabled && { opacity: 0.4 }]}>
        <Animated.Text style={[st.toggleLabel, { color: labelColor }]}>
          {value ? labelOn : labelOff}
        </Animated.Text>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handlePress}
          disabled={disabled}
        >
          <Animated.View
            style={[
              st.toggleTrack,
              {
                backgroundColor: trackBg,
                borderColor: trackBorder,
              },
            ]}
          >
            {/* Glow behind knob when ON */}
            <Animated.View
              style={[
                st.knobGlow,
                {
                  opacity: knobGlowOpacity,
                  backgroundColor: colorOn,
                  transform: [{ translateX }, { scale: 1.5 }],
                },
              ]}
            />

            {/* Knob */}
            <Animated.View
              style={[
                st.knob,
                {
                  backgroundColor: knobBg,
                  transform: [{ translateX }, { scale: knobScale }],
                },
              ]}
            >
              {/* Inner dot */}
              <Animated.View
                style={[
                  st.knobDot,
                  {
                    opacity: animValue,
                    backgroundColor: '#fff',
                  },
                ]}
              />
            </Animated.View>
          </Animated.View>
        </TouchableOpacity>
      </View>
    );
  },
);

// ═══════════════════════════════════════════════════════════════════════
// ░░░  COMPONENT 2: CUSTOM ANIMATED BUTTON  ░░░
// ═══════════════════════════════════════════════════════════════════════
interface CustomButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: string;
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  disabled?: boolean;
}

const CustomButton: React.FC<CustomButtonProps> = memo(
  ({
    label,
    onPress,
    variant = 'primary',
    icon,
    size = 'md',
    fullWidth = false,
    disabled = false,
  }) => {
    const scaleAnim = useRef(new Animated.Value(1)).current;
    const glowAnim = useRef(new Animated.Value(0)).current;

    const handlePressIn = useCallback(() => {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 0.96,
          friction: 5,
          tension: 100,
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }, []);

    const handlePressOut = useCallback(() => {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 4,
          tension: 80,
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }, []);

    const colors = useMemo(() => {
      switch (variant) {
        case 'primary':
          return {
            bg: TK.primary,
            text: '#fff',
            border: TK.primary,
            glow: TK.primaryGlow,
          };
        case 'secondary':
          return {
            bg: 'transparent',
            text: TK.primary,
            border: TK.primary + '50',
            glow: TK.primaryFaint,
          };
        case 'danger':
          return {
            bg: TK.criticalFaint,
            text: TK.critical,
            border: TK.critical + '40',
            glow: TK.criticalGlow,
          };
        case 'ghost':
          return {
            bg: 'transparent',
            text: TK.textSecondary,
            border: TK.border,
            glow: TK.surface,
          };
        default:
          return {
            bg: TK.primary,
            text: '#fff',
            border: TK.primary,
            glow: TK.primaryGlow,
          };
      }
    }, [variant]);

    const sizeStyle = useMemo(() => {
      switch (size) {
        case 'sm':
          return { paddingVertical: 8, paddingHorizontal: 14, fontSize: 10 };
        case 'lg':
          return { paddingVertical: 16, paddingHorizontal: 28, fontSize: 14 };
        default:
          return { paddingVertical: 12, paddingHorizontal: 20, fontSize: 12 };
      }
    }, [size]);

    return (
      <TouchableOpacity
        activeOpacity={1}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        style={fullWidth ? { width: '100%' } : undefined}
      >
        <Animated.View
          style={[
            st.customButton,
            {
              backgroundColor: colors.bg,
              borderColor: colors.border,
              paddingVertical: sizeStyle.paddingVertical,
              paddingHorizontal: sizeStyle.paddingHorizontal,
              opacity: disabled ? 0.4 : 1,
              transform: [{ scale: scaleAnim }],
            },
            fullWidth && { width: '100%' },
          ]}
        >
          {/* Glow overlay */}
          <Animated.View
            style={[
              st.buttonGlow,
              { backgroundColor: colors.glow, opacity: glowAnim },
            ]}
          />
          {icon && (
            <Text
              style={[
                st.buttonIcon,
                { color: colors.text, fontSize: sizeStyle.fontSize },
              ]}
            >
              {icon}
            </Text>
          )}
          <Text
            style={[
              st.buttonLabel,
              { color: colors.text, fontSize: sizeStyle.fontSize },
            ]}
          >
            {label}
          </Text>
        </Animated.View>
      </TouchableOpacity>
    );
  },
);

// ═══════════════════════════════════════════════════════════════════════
// ░░░  COMPONENT 3: ORG HEADER + STATS  ░░░
// ═══════════════════════════════════════════════════════════════════════
const OrgHeader: React.FC<{ onInvite: () => void }> = memo(({ onInvite }) => {
  const headerFade = useFadeIn(0, 400);
  const securityPulse = usePulse(3200, 0.4);

  return (
    <Animated.View style={[st.orgHeader, { opacity: headerFade }]}>
      <View style={st.orgHeaderTop}>
        <View>
          <Text style={st.orgTitle}>ORGANIZATION</Text>
          <Text style={st.orgSubtitle}>TEAM MANAGEMENT</Text>
        </View>
        <View style={st.orgHeaderBadge}>
          <Animated.View
            style={[st.orgSecurityDot, { opacity: securityPulse }]}
          />
          <Text style={st.orgSecurityText}>SECURE</Text>
        </View>
      </View>

      {/* Org identity card */}
      <View style={st.orgIdentityCard}>
        <View style={st.orgIdentityLeft}>
          <View style={st.orgLogo}>
            <Text style={st.orgLogoText}>PC</Text>
          </View>
          <View>
            <Text style={st.orgName}>PetroCore Industries</Text>
            <Text style={st.orgId}>ORG-2024-PC-7291</Text>
          </View>
        </View>
        <CustomButton
          label="+ INVITE"
          onPress={onInvite}
          variant="primary"
          size="sm"
        />
      </View>

      {/* Stats row */}
      <View style={st.statsRow}>
        {ORG_STATS.map((stat, i) => {
          const { opacity, translateY } = useSlideIn(i * 80 + 200, 14);
          return (
            <Animated.View
              key={stat.label}
              style={[
                st.statCard,
                { opacity, transform: [{ translateY }] },
              ]}
            >
              <Text style={[st.statIcon, { color: stat.color }]}>
                {stat.icon}
              </Text>
              <Text style={[st.statValue, { color: stat.color }]}>
                {stat.value}
              </Text>
              <Text style={st.statLabel}>{stat.label}</Text>
            </Animated.View>
          );
        })}
      </View>
    </Animated.View>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// ░░░  COMPONENT 4: MEMBER CARD  ░░░
// ═══════════════════════════════════════════════════════════════════════
const MemberCard: React.FC<{
  member: TeamMember;
  index: number;
  onEdit: (id: string) => void;
  expanded: boolean;
  onToggleExpand: (id: string) => void;
}> = memo(({ member, index, onEdit, expanded, onToggleExpand }) => {
  const { opacity, translateY } = useSlideIn(index * 80 + 500, 18);
  const roleConfig = getRoleConfig(member.role);
  const statusConfig = getStatusConfig(member.status);
  const initials = getInitials(member.firstName, member.lastName);

  const invitedPulse = usePulse(2400, 0.5);
  const isInvited = member.status === 'invited';
  const isSuspended = member.status === 'suspended';

  const handleToggleExpand = useCallback(() => {
    LayoutAnimation.configureNext(
      LayoutAnimation.create(
        300,
        LayoutAnimation.Types.easeInEaseOut,
        LayoutAnimation.Properties.opacity,
      ),
    );
    onToggleExpand(member.id);
  }, [member.id, onToggleExpand]);

  return (
    <Animated.View
      style={[
        st.memberCard,
        isSuspended && st.memberCardSuspended,
        { opacity, transform: [{ translateY }] },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={handleToggleExpand}
      >
        {/* Main row */}
        <View style={st.memberMain}>
          {/* Avatar */}
          <Animated.View
            style={[
              st.memberAvatar,
              {
                borderColor: member.avatarColor,
                opacity: isInvited ? invitedPulse : isSuspended ? 0.4 : 1,
              },
            ]}
          >
            <Text style={[st.memberAvatarText, { color: member.avatarColor }]}>
              {initials}
            </Text>
            {/* Online dot */}
            {member.status === 'active' && (
              <View style={st.onlineDot} />
            )}
          </Animated.View>

          {/* Info */}
          <View style={st.memberInfo}>
            <View style={st.memberNameRow}>
              <Text
                style={[
                  st.memberName,
                  isSuspended && { color: TK.textTertiary },
                ]}
              >
                {member.firstName} {member.lastName}
              </Text>
              {member.role === 'owner' && (
                <Text style={st.ownerCrown}>♛</Text>
              )}
            </View>
            <Text style={st.memberEmail}>{member.email}</Text>
            <View style={st.memberBadgeRow}>
              <View
                style={[
                  st.roleBadge,
                  {
                    backgroundColor: roleConfig.bg,
                    borderColor: roleConfig.color + '40',
                  },
                ]}
              >
                <Text style={[st.roleBadgeText, { color: roleConfig.color }]}>
                  {roleConfig.label}
                </Text>
              </View>
              <View
                style={[
                  st.statusBadge,
                  {
                    backgroundColor: statusConfig.bg,
                    borderColor: statusConfig.color + '40',
                  },
                ]}
              >
                <View
                  style={[
                    st.statusBadgeDot,
                    { backgroundColor: statusConfig.color },
                  ]}
                />
                <Text
                  style={[st.statusBadgeText, { color: statusConfig.color }]}
                >
                  {statusConfig.label}
                </Text>
              </View>
            </View>
          </View>

          {/* Expand indicator */}
          <View style={st.expandIndicator}>
            <Text
              style={[
                st.expandArrow,
                expanded && st.expandArrowRotated,
              ]}
            >
              ▾
            </Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* Expanded section */}
      {expanded && (
        <View style={st.memberExpanded}>
          <View style={st.memberExpandedDivider} />

          {/* Meta grid */}
          <View style={st.memberMetaGrid}>
            <View style={st.memberMetaCell}>
              <Text style={st.memberMetaLabel}>DEPARTMENT</Text>
              <Text style={st.memberMetaValue}>{member.department}</Text>
            </View>
            <View style={st.memberMetaCell}>
              <Text style={st.memberMetaLabel}>JOINED</Text>
              <Text style={st.memberMetaValueMono}>{member.joinDate}</Text>
            </View>
            <View style={st.memberMetaCell}>
              <Text style={st.memberMetaLabel}>LAST ACTIVE</Text>
              <Text style={st.memberMetaValueMono}>{member.lastActive}</Text>
            </View>
          </View>

          {/* Permission toggles */}
          <View style={st.permissionsSection}>
            <Text style={st.permissionsSectionTitle}>PERMISSIONS</Text>
            {PERMISSION_DEFS.map((perm) => (
              <View key={perm.key} style={st.permissionRow}>
                <View style={st.permissionInfo}>
                  <View style={st.permissionLabelRow}>
                    <Text
                      style={[
                        st.permissionIcon,
                        {
                          color: member.permissions[perm.key]
                            ? TK.primary
                            : TK.textTertiary,
                        },
                      ]}
                    >
                      {perm.icon}
                    </Text>
                    <Text style={st.permissionLabel}>{perm.label}</Text>
                    {perm.critical && (
                      <View style={st.criticalBadge}>
                        <Text style={st.criticalBadgeText}>CRITICAL</Text>
                      </View>
                    )}
                  </View>
                  <Text style={st.permissionDesc}>{perm.description}</Text>
                </View>
                <CustomToggle
                  value={member.permissions[perm.key]}
                  onToggle={() => {
                    /* In production: dispatch permission change */
                  }}
                  disabled={member.role === 'owner' || isSuspended}
                  labelOn="On"
                  labelOff="Off"
                  colorOn={perm.critical ? TK.warning : TK.primary}
                />
              </View>
            ))}
          </View>

          {/* Actions */}
          {member.role !== 'owner' && (
            <View style={st.memberActions}>
              <CustomButton
                label="Edit Role"
                onPress={() => onEdit(member.id)}
                variant="secondary"
                icon="⚙"
                size="sm"
              />
              {isInvited && (
                <CustomButton
                  label="Resend"
                  onPress={() => {}}
                  variant="ghost"
                  icon="◇"
                  size="sm"
                />
              )}
              {!isSuspended ? (
                <CustomButton
                  label="Suspend"
                  onPress={() => {}}
                  variant="danger"
                  size="sm"
                />
              ) : (
                <CustomButton
                  label="Reactivate"
                  onPress={() => {}}
                  variant="primary"
                  size="sm"
                />
              )}
            </View>
          )}
        </View>
      )}
    </Animated.View>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// ░░░  COMPONENT 5: PREFERRED INSPECTOR CARD  ░░░
// ═══════════════════════════════════════════════════════════════════════
const InspectorCard: React.FC<{
  inspector: PreferredInspector;
  index: number;
}> = memo(({ inspector, index }) => {
  const { opacity, translateY } = useSlideIn(index * 90 + 1000, 16);
  const tierConfig = getTierConfig(inspector.tier);
  const initials = getInspectorInitials(inspector.name);

  return (
    <Animated.View
      style={[
        st.inspectorCard,
        { opacity, transform: [{ translateY }] },
      ]}
    >
      {/* Avatar */}
      <View
        style={[
          st.inspectorAvatar,
          { borderColor: inspector.avatarColor },
        ]}
      >
        <Text
          style={[st.inspectorAvatarText, { color: inspector.avatarColor }]}
        >
          {initials}
        </Text>
      </View>

      {/* Info */}
      <View style={st.inspectorInfo}>
        <Text style={st.inspectorName}>{inspector.name}</Text>
        <Text style={st.inspectorCompany}>{inspector.company}</Text>

        <View style={st.inspectorMetaRow}>
          <View
            style={[
              st.tierBadge,
              {
                backgroundColor: tierConfig.bg,
                borderColor: tierConfig.color + '40',
              },
            ]}
          >
            <Text style={[st.tierIcon, { color: tierConfig.color }]}>
              {tierConfig.icon}
            </Text>
            <Text style={[st.tierText, { color: tierConfig.color }]}>
              {tierConfig.label}
            </Text>
          </View>

          {/* Star rating inline */}
          <View style={st.miniStarRow}>
            <Text style={[st.miniStar, { color: tierConfig.color }]}>★</Text>
            <Text style={[st.miniRating, { color: tierConfig.color }]}>
              {inspector.rating}
            </Text>
          </View>

          <Text style={st.inspectorJobs}>
            {inspector.completedJobs} jobs
          </Text>
        </View>
      </View>

      {/* Right: specs */}
      <View style={st.inspectorRight}>
        {inspector.specializations.slice(0, 2).map((spec) => (
          <View key={spec} style={st.specChip}>
            <Text style={st.specChipText}>{spec}</Text>
          </View>
        ))}
        {inspector.specializations.length > 2 && (
          <Text style={st.specMore}>
            +{inspector.specializations.length - 2}
          </Text>
        )}
      </View>
    </Animated.View>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// ░░░  COMPONENT 6: INVITE BOTTOM SHEET  ░░░
// ═══════════════════════════════════════════════════════════════════════
interface InviteSheetProps {
  visible: boolean;
  onClose: () => void;
}

const InviteBottomSheet: React.FC<InviteSheetProps> = memo(
  ({ visible, onClose }) => {
    const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
    const backdropOpacity = useRef(new Animated.Value(0)).current;
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<MemberRole>('viewer');
    const [inviteSent, setInviteSent] = useState(false);

    useEffect(() => {
      if (visible) {
        setInviteSent(false);
        setInviteEmail('');
        setInviteRole('viewer');
        Animated.parallel([
          Animated.spring(slideAnim, {
            toValue: 0,
            friction: 8,
            tension: 45,
            useNativeDriver: true,
          }),
          Animated.timing(backdropOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();
      } else {
        Animated.parallel([
          Animated.timing(slideAnim, {
            toValue: SCREEN_HEIGHT,
            duration: 250,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(backdropOpacity, {
            toValue: 0,
            duration: 250,
            useNativeDriver: true,
          }),
        ]).start();
      }
    }, [visible]);

    const handleSendInvite = useCallback(() => {
      if (inviteEmail.trim().length === 0) return;

      LayoutAnimation.configureNext(
        LayoutAnimation.create(
          350,
          LayoutAnimation.Types.easeInEaseOut,
          LayoutAnimation.Properties.opacity,
        ),
      );
      setInviteSent(true);

      // Auto-close after confirmation
      setTimeout(() => {
        onClose();
      }, 2000);
    }, [inviteEmail, onClose]);

    const roles: { key: MemberRole; label: string; desc: string }[] = [
      { key: 'admin', label: 'Admin', desc: 'Full access to all features' },
      {
        key: 'manager',
        label: 'Manager',
        desc: 'Can manage assets and bids',
      },
      {
        key: 'viewer',
        label: 'Viewer',
        desc: 'Read-only access to reports',
      },
    ];

    return (
      <Modal
        transparent
        visible={visible}
        animationType="none"
        onRequestClose={onClose}
      >
        <View style={st.sheetOverlay}>
          {/* Backdrop */}
          <Animated.View
            style={[st.sheetBackdrop, { opacity: backdropOpacity }]}
          >
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={onClose}
            />
          </Animated.View>

          {/* Sheet */}
          <Animated.View
            style={[
              st.sheetContainer,
              { transform: [{ translateY: slideAnim }] },
            ]}
          >
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={{ flex: 1 }}
            >
              {/* Handle */}
              <View style={st.sheetHandle}>
                <View style={st.sheetHandleBar} />
              </View>

              {/* Header */}
              <View style={st.sheetHeader}>
                <View>
                  <Text style={st.sheetTitle}>INVITE MEMBER</Text>
                  <Text style={st.sheetSubtitle}>
                    Send a secure invitation link
                  </Text>
                </View>
                <TouchableOpacity onPress={onClose} style={st.sheetCloseBtn}>
                  <Text style={st.sheetCloseBtnText}>✕</Text>
                </TouchableOpacity>
              </View>

              {!inviteSent ? (
                <ScrollView
                  style={st.sheetBody}
                  showsVerticalScrollIndicator={false}
                >
                  {/* Email input */}
                  <View style={st.inputGroup}>
                    <Text style={st.inputLabel}>EMAIL ADDRESS</Text>
                    <View style={st.inputContainer}>
                      <Text style={st.inputIcon}>✉</Text>
                      <TextInput
                        style={st.input}
                        value={inviteEmail}
                        onChangeText={setInviteEmail}
                        placeholder="colleague@company.com"
                        placeholderTextColor={TK.textTertiary}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        selectionColor={TK.primary}
                      />
                    </View>
                  </View>

                  {/* Role selector */}
                  <View style={st.inputGroup}>
                    <Text style={st.inputLabel}>ASSIGN ROLE</Text>
                    <View style={st.roleSelector}>
                      {roles.map((role) => {
                        const isSelected = inviteRole === role.key;
                        const roleConf = getRoleConfig(role.key);
                        return (
                          <TouchableOpacity
                            key={role.key}
                            activeOpacity={0.7}
                            onPress={() => {
                              LayoutAnimation.configureNext(
                                LayoutAnimation.create(
                                  200,
                                  LayoutAnimation.Types.easeInEaseOut,
                                  LayoutAnimation.Properties.opacity,
                                ),
                              );
                              setInviteRole(role.key);
                            }}
                            style={[
                              st.roleOption,
                              isSelected && {
                                borderColor: roleConf.color + '60',
                                backgroundColor: roleConf.bg,
                              },
                            ]}
                          >
                            <View style={st.roleOptionHeader}>
                              <View
                                style={[
                                  st.roleRadio,
                                  isSelected && {
                                    borderColor: roleConf.color,
                                  },
                                ]}
                              >
                                {isSelected && (
                                  <View
                                    style={[
                                      st.roleRadioInner,
                                      { backgroundColor: roleConf.color },
                                    ]}
                                  />
                                )}
                              </View>
                              <Text
                                style={[
                                  st.roleOptionLabel,
                                  isSelected && { color: roleConf.color },
                                ]}
                              >
                                {role.label}
                              </Text>
                              <View
                                style={[
                                  st.roleOptionBadge,
                                  {
                                    backgroundColor: roleConf.bg,
                                    borderColor: roleConf.color + '30',
                                  },
                                ]}
                              >
                                <Text
                                  style={[
                                    st.roleOptionBadgeText,
                                    { color: roleConf.color },
                                  ]}
                                >
                                  {roleConf.label}
                                </Text>
                              </View>
                            </View>
                            <Text style={st.roleOptionDesc}>{role.desc}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>

                  {/* Default permissions preview */}
                  <View style={st.inputGroup}>
                    <Text style={st.inputLabel}>DEFAULT PERMISSIONS</Text>
                    <View style={st.defaultPermsGrid}>
                      {PERMISSION_DEFS.map((perm) => {
                        const isOn =
                          inviteRole === 'admin'
                            ? true
                            : inviteRole === 'manager'
                              ? !perm.critical
                              : perm.key === 'canViewReports';
                        return (
                          <View key={perm.key} style={st.defaultPermItem}>
                            <View
                              style={[
                                st.defaultPermDot,
                                {
                                  backgroundColor: isOn
                                    ? TK.success
                                    : TK.textTertiary,
                                },
                              ]}
                            />
                            <Text
                              style={[
                                st.defaultPermText,
                                { color: isOn ? TK.textSecondary : TK.textTertiary },
                              ]}
                            >
                              {perm.label}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>

                  {/* Send button */}
                  <View style={st.sheetActions}>
                    <CustomButton
                      label="SEND INVITATION"
                      onPress={handleSendInvite}
                      variant="primary"
                      icon="◇"
                      size="lg"
                      fullWidth
                      disabled={inviteEmail.trim().length === 0}
                    />
                    <CustomButton
                      label="Cancel"
                      onPress={onClose}
                      variant="ghost"
                      size="md"
                      fullWidth
                    />
                  </View>
                </ScrollView>
              ) : (
                /* Success confirmation */
                <View style={st.inviteSuccess}>
                  <View style={st.successCircle}>
                    <Text style={st.successCheck}>✓</Text>
                  </View>
                  <Text style={st.successTitle}>Invitation Sent</Text>
                  <Text style={st.successDesc}>
                    A secure invite has been sent to
                  </Text>
                  <Text style={st.successEmail}>{inviteEmail}</Text>
                  <Text style={st.successRole}>
                    Role: {getRoleConfig(inviteRole).label}
                  </Text>
                </View>
              )}
            </KeyboardAvoidingView>
          </Animated.View>
        </View>
      </Modal>
    );
  },
);

// ═══════════════════════════════════════════════════════════════════════
// ░░░  COMPONENT 7: ACTIVITY FEED  ░░░
// ═══════════════════════════════════════════════════════════════════════
interface ActivityEvent {
  id: string;
  actor: string;
  action: string;
  target: string;
  timestamp: string;
  type: 'join' | 'permission' | 'role' | 'invite' | 'remove' | 'system';
}

const RECENT_ACTIVITY: ActivityEvent[] = [
  {
    id: 'ACT-001',
    actor: 'Alexander Rostov',
    action: 'updated permissions for',
    target: 'James Thornton',
    timestamp: '2 hours ago',
    type: 'permission',
  },
  {
    id: 'ACT-002',
    actor: 'Elena Vasquez',
    action: 'sent invitation to',
    target: 's.mitchell@petrocore.com',
    timestamp: '1 day ago',
    type: 'invite',
  },
  {
    id: 'ACT-003',
    actor: 'System',
    action: 'suspended account',
    target: 'Dmitri Volkov',
    timestamp: '14 days ago',
    type: 'system',
  },
  {
    id: 'ACT-004',
    actor: 'Fatima Al-Rashid',
    action: 'joined the organization as',
    target: 'Manager',
    timestamp: '2023-02-15',
    type: 'join',
  },
];

const getActivityColor = (type: ActivityEvent['type']): string => {
  switch (type) {
    case 'join':
      return TK.success;
    case 'permission':
      return TK.primary;
    case 'role':
      return TK.cyan;
    case 'invite':
      return TK.warning;
    case 'remove':
      return TK.critical;
    case 'system':
      return TK.critical;
    default:
      return TK.textTertiary;
  }
};

const ActivityItem: React.FC<{
  event: ActivityEvent;
  index: number;
  isLast: boolean;
}> = memo(({ event, index, isLast }) => {
  const { opacity, translateY } = useSlideIn(index * 80 + 1300, 12);
  const actColor = getActivityColor(event.type);

  return (
    <Animated.View
      style={[
        st.activityItem,
        { opacity, transform: [{ translateY }] },
      ]}
    >
      {/* Dot */}
      <View style={st.activityDotCol}>
        <View style={[st.activityDot, { backgroundColor: actColor }]} />
        {!isLast && <View style={st.activityLine} />}
      </View>

      {/* Content */}
      <View style={st.activityContent}>
        <Text style={st.activityText}>
          <Text style={{ color: TK.textPrimary, fontWeight: '700' }}>
            {event.actor}
          </Text>
          <Text style={{ color: TK.textSecondary }}> {event.action} </Text>
          <Text style={{ color: actColor, fontWeight: '700' }}>
            {event.target}
          </Text>
        </Text>
        <Text style={st.activityTimestamp}>{event.timestamp}</Text>
      </View>
    </Animated.View>
  );
});

const ActivityFeed: React.FC = memo(() => (
  <View>
    <SectionHeader
      title="AUDIT LOG"
      subtitle="Recent team activity"
      delay={1200}
      accent={TK.purple}
    />
    <View style={st.activityContainer}>
      {RECENT_ACTIVITY.map((event, i) => (
        <ActivityItem
          key={event.id}
          event={event}
          index={i}
          isLast={i === RECENT_ACTIVITY.length - 1}
        />
      ))}
    </View>
  </View>
));

// ═══════════════════════════════════════════════════════════════════════
// ░░░  COMPONENT 8: SECURITY SETTINGS SECTION  ░░░
// ═══════════════════════════════════════════════════════════════════════
interface SecuritySetting {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  icon: string;
  critical: boolean;
}

const SECURITY_SETTINGS: SecuritySetting[] = [
  {
    id: 'SEC-001',
    label: 'Two-Factor Authentication',
    description: 'Require 2FA for all team members on login',
    enabled: true,
    icon: '🔐',
    critical: true,
  },
  {
    id: 'SEC-002',
    label: 'Session Timeout',
    description: 'Automatically sign out inactive users after 30 minutes',
    enabled: true,
    icon: '⏱',
    critical: false,
  },
  {
    id: 'SEC-003',
    label: 'IP Whitelist',
    description: 'Restrict access to approved IP addresses only',
    enabled: false,
    icon: '🌐',
    critical: true,
  },
  {
    id: 'SEC-004',
    label: 'Data Export Logging',
    description: 'Log all data export events for audit trail',
    enabled: true,
    icon: '📋',
    critical: false,
  },
];

const SecuritySettingsSection: React.FC = memo(() => {
  const [settings, setSettings] = useState(SECURITY_SETTINGS);

  const handleToggle = useCallback(
    (id: string, newValue: boolean) => {
      setSettings((prev) =>
        prev.map((s) => (s.id === id ? { ...s, enabled: newValue } : s)),
      );
    },
    [],
  );

  return (
    <View>
      <SectionHeader
        title="SECURITY POLICIES"
        subtitle="Organization-wide security controls"
        delay={1500}
        accent={TK.critical}
      />
      <View style={st.securityContainer}>
        {settings.map((setting, index) => {
          const { opacity, translateY } = useSlideIn(
            index * 70 + 1600,
            12,
          );
          return (
            <Animated.View
              key={setting.id}
              style={[
                st.securityRow,
                index < settings.length - 1 && st.securityRowBorder,
                { opacity, transform: [{ translateY }] },
              ]}
            >
              <View style={st.securityInfo}>
                <View style={st.securityLabelRow}>
                  <Text style={st.securityIcon}>{setting.icon}</Text>
                  <Text style={st.securityLabel}>{setting.label}</Text>
                  {setting.critical && (
                    <View style={st.secCritBadge}>
                      <Text style={st.secCritText}>REQUIRED</Text>
                    </View>
                  )}
                </View>
                <Text style={st.securityDesc}>{setting.description}</Text>
              </View>
              <CustomToggle
                value={setting.enabled}
                onToggle={(val) => handleToggle(setting.id, val)}
                labelOn="Enabled"
                labelOff="Disabled"
                colorOn={setting.critical ? TK.success : TK.primary}
              />
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// ░░░  MAIN COMPONENT  ░░░
// ═══════════════════════════════════════════════════════════════════════
const OrganizationManager: React.FC = () => {
  const [inviteVisible, setInviteVisible] = useState(false);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);

  const handleInviteOpen = useCallback(() => setInviteVisible(true), []);
  const handleInviteClose = useCallback(() => setInviteVisible(false), []);

  const handleToggleExpand = useCallback(
    (id: string) => {
      setExpandedMember((prev) => (prev === id ? null : id));
    },
    [],
  );

  const handleEditMember = useCallback((id: string) => {
    // In production: navigate to member edit screen
    console.log('Edit member:', id);
  }, []);

  return (
    <View style={st.root}>
      <ScrollView
        style={st.scrollView}
        contentContainerStyle={st.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Org Header + Stats */}
        <OrgHeader onInvite={handleInviteOpen} />

        {/* Team Members */}
        <SectionHeader
          title="TEAM MEMBERS"
          subtitle={`${TEAM_MEMBERS.length} members in organization`}
          delay={400}
          accent={TK.primary}
          rightElement={
            <CustomButton
              label="+ Add"
              onPress={handleInviteOpen}
              variant="secondary"
              size="sm"
            />
          }
        />
        {TEAM_MEMBERS.map((member, i) => (
          <MemberCard
            key={member.id}
            member={member}
            index={i}
            onEdit={handleEditMember}
            expanded={expandedMember === member.id}
            onToggleExpand={handleToggleExpand}
          />
        ))}

        {/* Preferred Inspectors */}
        <SectionHeader
          title="PREFERRED INSPECTORS"
          subtitle="Vetted inspector network"
          delay={900}
          accent={TK.gold}
        />
        {PREFERRED_INSPECTORS.map((inspector, i) => (
          <InspectorCard key={inspector.id} inspector={inspector} index={i} />
        ))}

        {/* Security Settings */}
        <SecuritySettingsSection />

        {/* Activity Feed */}
        <ActivityFeed />

        {/* Footer */}
        <View style={st.footer}>
          <View style={st.footerLine} />
          <Text style={st.footerText}>
            NEXPEC ORG v2.4.0, RBAC ENFORCED
          </Text>
          <View style={st.footerLine} />
        </View>
      </ScrollView>

      {/* Invite Bottom Sheet */}
      <InviteBottomSheet visible={inviteVisible} onClose={handleInviteClose} />
    </View>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// ░░░  STYLES  ░░░
// ═══════════════════════════════════════════════════════════════════════
const st = StyleSheet.create({
  // ── Root ──
  root: { flex: 1, backgroundColor: TK.bg },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 60 },

  // ── Section Header ──
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 28,
    marginBottom: 14,
  },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center' },
  sectionAccent: {
    width: 3,
    height: 28,
    borderRadius: 2,
    marginRight: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: TK.textPrimary,
    letterSpacing: 3,
  },
  sectionSubtitle: {
    fontSize: 9,
    color: TK.textTertiary,
    letterSpacing: 1,
    marginTop: 2,
  },

  // ── Custom Toggle ──
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toggleLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    minWidth: 44,
    textAlign: 'right',
  },
  toggleTrack: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    borderWidth: 1.5,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  knobGlow: {
    position: 'absolute',
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
  },
  knob: {
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    // Shadow for elevation
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 3,
      },
      android: { elevation: 4 },
    }),
  },
  knobDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  // ── Custom Button ──
  customButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
    overflow: 'hidden',
  },
  buttonGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 10,
  },
  buttonIcon: { fontWeight: '600' },
  buttonLabel: { fontWeight: '700', letterSpacing: 1.5 },

  // ── Org Header ──
  orgHeader: {
    paddingHorizontal: 20,
    paddingTop: 58,
  },
  orgHeaderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  orgTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: TK.textPrimary,
    letterSpacing: 5,
  },
  orgSubtitle: {
    fontSize: 10,
    fontWeight: '600',
    color: TK.primary,
    letterSpacing: 5,
    marginTop: 3,
  },
  orgHeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: TK.successFaint,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.25)',
    marginTop: 4,
  },
  orgSecurityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: TK.success,
    marginRight: 6,
  },
  orgSecurityText: {
    fontSize: 8,
    fontWeight: '800',
    color: TK.success,
    letterSpacing: 2,
  },

  // ── Org Identity Card ──
  orgIdentityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: TK.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: TK.border,
    padding: 16,
    marginBottom: 14,
  },
  orgIdentityLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  orgLogo: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: TK.primaryFaint,
    borderWidth: 1.5,
    borderColor: TK.primary + '40',
    justifyContent: 'center',
    alignItems: 'center',
  },
  orgLogoText: {
    fontSize: 16,
    fontWeight: '900',
    color: TK.primary,
    letterSpacing: 2,
  },
  orgName: {
    fontSize: 15,
    fontWeight: '700',
    color: TK.textPrimary,
    letterSpacing: 0.5,
  },
  orgId: {
    fontSize: 9,
    color: TK.textTertiary,
    fontFamily: MONO,
    letterSpacing: 0.5,
    marginTop: 2,
  },

  // ── Stats Row ──
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: TK.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: TK.border,
    paddingVertical: 14,
    alignItems: 'center',
  },
  statIcon: { fontSize: 14, marginBottom: 4 },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
    fontFamily: MONO,
  },
  statLabel: {
    fontSize: 8,
    fontWeight: '600',
    color: TK.textTertiary,
    letterSpacing: 1,
    marginTop: 2,
    textTransform: 'uppercase',
  },

  // ── Member Card ──
  memberCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: TK.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: TK.border,
    overflow: 'hidden',
  },
  memberCardSuspended: {
    borderColor: TK.critical + '20',
    backgroundColor: TK.criticalFaint,
  },
  memberMain: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  memberAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: TK.surface,
  },
  memberAvatarText: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: TK.success,
    borderWidth: 2,
    borderColor: TK.bg,
  },
  memberInfo: { flex: 1, marginLeft: 12 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  memberName: {
    fontSize: 14,
    fontWeight: '700',
    color: TK.textPrimary,
  },
  ownerCrown: { fontSize: 12, color: TK.gold },
  memberEmail: {
    fontSize: 10,
    color: TK.textTertiary,
    fontFamily: MONO,
    letterSpacing: 0.3,
    marginTop: 2,
  },
  memberBadgeRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
  },
  roleBadgeText: {
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
    gap: 4,
  },
  statusBadgeDot: { width: 4, height: 4, borderRadius: 2 },
  statusBadgeText: {
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 1,
  },
  expandIndicator: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: TK.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  expandArrow: {
    fontSize: 14,
    color: TK.textTertiary,
  },
  expandArrowRotated: {
    transform: [{ rotate: '180deg' }],
    color: TK.primary,
  },

  // ── Member Expanded ──
  memberExpanded: { paddingHorizontal: 14, paddingBottom: 14 },
  memberExpandedDivider: {
    height: 1,
    backgroundColor: TK.border,
    marginBottom: 14,
  },
  memberMetaGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  memberMetaCell: {
    flex: 1,
    backgroundColor: TK.surface,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: TK.borderSubtle,
  },
  memberMetaLabel: {
    fontSize: 7,
    fontWeight: '700',
    color: TK.textTertiary,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  memberMetaValue: {
    fontSize: 10,
    fontWeight: '600',
    color: TK.textSecondary,
  },
  memberMetaValueMono: {
    fontSize: 10,
    fontWeight: '700',
    color: TK.textMono,
    fontFamily: MONO,
  },

  // ── Permissions ──
  permissionsSection: { marginBottom: 12 },
  permissionsSectionTitle: {
    fontSize: 8,
    fontWeight: '800',
    color: TK.textTertiary,
    letterSpacing: 2,
    marginBottom: 10,
  },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: TK.borderSubtle,
  },
  permissionInfo: { flex: 1, marginRight: 12 },
  permissionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
  },
  permissionIcon: { fontSize: 11 },
  permissionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: TK.textPrimary,
    letterSpacing: 0.3,
  },
  criticalBadge: {
    backgroundColor: TK.warningFaint,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: TK.warning + '30',
  },
  criticalBadgeText: {
    fontSize: 6,
    fontWeight: '900',
    color: TK.warning,
    letterSpacing: 1,
  },
  permissionDesc: {
    fontSize: 9,
    color: TK.textTertiary,
    letterSpacing: 0.2,
  },
  memberActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },

  // ── Inspector Card ──
  inspectorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: TK.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: TK.border,
    padding: 14,
  },
  inspectorAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: TK.surface,
  },
  inspectorAvatarText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
  inspectorInfo: { flex: 1, marginLeft: 12 },
  inspectorName: {
    fontSize: 13,
    fontWeight: '700',
    color: TK.textPrimary,
  },
  inspectorCompany: {
    fontSize: 9,
    color: TK.textTertiary,
    letterSpacing: 0.3,
    marginTop: 1,
  },
  inspectorMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 5,
  },
  tierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
    gap: 3,
  },
  tierIcon: { fontSize: 8 },
  tierText: {
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 1,
  },
  miniStarRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  miniStar: { fontSize: 10 },
  miniRating: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: MONO,
  },
  inspectorJobs: {
    fontSize: 9,
    color: TK.textTertiary,
    fontFamily: MONO,
  },
  inspectorRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  specChip: {
    backgroundColor: TK.surface,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: TK.borderSubtle,
  },
  specChipText: {
    fontSize: 7,
    fontWeight: '700',
    color: TK.textSecondary,
    fontFamily: MONO,
    letterSpacing: 0.5,
  },
  specMore: {
    fontSize: 8,
    color: TK.textTertiary,
    fontFamily: MONO,
  },

  // ── Activity Feed ──
  activityContainer: {
    paddingHorizontal: 20,
  },
  activityItem: {
    flexDirection: 'row',
    minHeight: 48,
  },
  activityDotCol: {
    width: 20,
    alignItems: 'center',
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 4,
    zIndex: 2,
  },
  activityLine: {
    width: 1,
    flex: 1,
    backgroundColor: TK.border,
    marginTop: 4,
  },
  activityContent: {
    flex: 1,
    marginLeft: 10,
    paddingBottom: 16,
  },
  activityText: {
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.2,
  },
  activityTimestamp: {
    fontSize: 9,
    color: TK.textTertiary,
    fontFamily: MONO,
    marginTop: 3,
  },

  // ── Security Settings ──
  securityContainer: {
    marginHorizontal: 16,
    backgroundColor: TK.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: TK.border,
    overflow: 'hidden',
    paddingHorizontal: 16,
  },
  securityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  securityRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: TK.borderSubtle,
  },
  securityInfo: { flex: 1, marginRight: 12 },
  securityLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
  },
  securityIcon: { fontSize: 14 },
  securityLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: TK.textPrimary,
    letterSpacing: 0.3,
  },
  secCritBadge: {
    backgroundColor: TK.criticalFaint,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: TK.critical + '30',
  },
  secCritText: {
    fontSize: 6,
    fontWeight: '900',
    color: TK.critical,
    letterSpacing: 1,
  },
  securityDesc: {
    fontSize: 10,
    color: TK.textTertiary,
    letterSpacing: 0.2,
    lineHeight: 14,
  },

  // ── Bottom Sheet ──
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: TK.bgOverlay,
  },
  sheetContainer: {
    backgroundColor: TK.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: TK.border,
    maxHeight: SCREEN_HEIGHT * 0.85,
    minHeight: SCREEN_HEIGHT * 0.5,
    overflow: 'hidden',
  },
  sheetHandle: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  sheetHandleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: TK.switchOff,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: TK.border,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: TK.textPrimary,
    letterSpacing: 3,
  },
  sheetSubtitle: {
    fontSize: 10,
    color: TK.textTertiary,
    letterSpacing: 1,
    marginTop: 2,
  },
  sheetCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: TK.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: TK.border,
  },
  sheetCloseBtnText: {
    fontSize: 14,
    color: TK.textSecondary,
    fontWeight: '600',
  },
  sheetBody: {
    paddingHorizontal: 24,
    paddingTop: 20,
  },

  // ── Input Group ──
  inputGroup: { marginBottom: 20 },
  inputLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: TK.textTertiary,
    letterSpacing: 2,
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: TK.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: TK.border,
    height: 50,
    paddingHorizontal: 14,
    gap: 10,
  },
  inputIcon: { fontSize: 16, color: TK.textTertiary },
  input: {
    flex: 1,
    fontSize: 14,
    color: TK.textPrimary,
    fontFamily: MONO,
    letterSpacing: 0.5,
  },

  // ── Role Selector ──
  roleSelector: { gap: 8 },
  roleOption: {
    backgroundColor: TK.cardBg,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: TK.border,
    padding: 14,
  },
  roleOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  roleRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: TK.switchOff,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roleRadioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  roleOptionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: TK.textSecondary,
    letterSpacing: 0.5,
  },
  roleOptionBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    marginLeft: 'auto',
  },
  roleOptionBadgeText: {
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  roleOptionDesc: {
    fontSize: 10,
    color: TK.textTertiary,
    marginLeft: 28,
    letterSpacing: 0.2,
  },

  // ── Default Permissions Preview ──
  defaultPermsGrid: {
    backgroundColor: TK.surface,
    borderRadius: 10,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: TK.borderSubtle,
  },
  defaultPermItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  defaultPermDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  defaultPermText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  // ── Sheet Actions ──
  sheetActions: {
    gap: 10,
    paddingBottom: 30,
    marginTop: 10,
  },

  // ── Invite Success ──
  inviteSuccess: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
    paddingHorizontal: 24,
  },
  successCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: TK.successFaint,
    borderWidth: 2,
    borderColor: TK.success,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  successCheck: {
    fontSize: 28,
    fontWeight: '900',
    color: TK.success,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: TK.textPrimary,
    letterSpacing: 2,
    marginBottom: 8,
  },
  successDesc: {
    fontSize: 12,
    color: TK.textSecondary,
    letterSpacing: 0.3,
  },
  successEmail: {
    fontSize: 14,
    fontWeight: '700',
    color: TK.primary,
    fontFamily: MONO,
    marginTop: 4,
  },
  successRole: {
    fontSize: 10,
    color: TK.textTertiary,
    fontFamily: MONO,
    marginTop: 6,
    letterSpacing: 1,
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
  footerLine: { flex: 1, height: 1, backgroundColor: TK.border },
  footerText: {
    fontSize: 7,
    fontWeight: '600',
    color: TK.textTertiary,
    letterSpacing: 3,
    fontFamily: MONO,
  },
});

export default OrganizationManager;
