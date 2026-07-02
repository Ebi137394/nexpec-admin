import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Switch,
  Dimensions,
  Image,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { LinearGradient } from 'expo-linear-gradient';
import {
  User,
  Shield,
  ShieldCheck,
  Cloud,
  CloudOff,
  LogOut,
  ChevronRight,
  Bell,
  BellOff,
  HelpCircle,
  Bug,
  Settings,
  Award,
  Star,
  Clock,
  ClipboardCheck,
  CheckCircle,
  Edit3,
  Camera,
  Wifi,
  WifiOff,
  RefreshCw,
  FileText,
  Lock,
  Moon,
  Globe,
  MessageSquare,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Briefcase,
  BadgeCheck,
  Wrench,
  LucideIcon,
} from 'lucide-react-native';

// ============================================
// THEME COLORS
// ============================================
const COLORS = {
  background: '#0A0E17',
  surface: '#141B2D',
  surfaceLight: '#1E2A45',
  surfaceDark: '#0D1321',
  primary: '#7C3AED',
  primaryDark: '#6D28D9',
  secondary: '#7B61FF',
  accent: '#FF6B6B',
  success: '#00D68F',
  successDark: '#00A86B',
  warning: '#FFB800',
  error: '#FF4757',
  errorDark: '#CC3A47',
  info: '#3B82F6',
  textPrimary: '#FFFFFF',
  textSecondary: '#A0AEC0',
  textMuted: '#64748B',
  border: 'rgba(124, 58, 237, 0.2)',
  borderLight: 'rgba(255, 255, 255, 0.08)',
  glassBg: 'rgba(20, 27, 45, 0.85)',
  glassGlow: 'rgba(124, 58, 237, 0.15)',
  overlay: 'rgba(0, 0, 0, 0.5)',
  gold: '#FFD700',
  goldDark: '#B8860B',
  goldLight: '#FFF8DC',
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ============================================
// TYPE DEFINITIONS
// ============================================
interface UserProfile {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  location: string;
  department: string;
  joinDate: string;
  avatarUrl?: string;
  isVerified: boolean;
  stats: {
    inspectionsDone: number;
    hoursLogged: number;
    avgRating: number;
    totalReviews: number;
  };
}

interface Certification {
  id: string;
  name: string;
  abbreviation: string;
  issuer: string;
  expiryDate: string;
  isActive: boolean;
  level?: string;
}

interface SettingItem {
  id: string;
  icon: LucideIcon | React.ComponentType<{ size: number; color: string }>;
  title: string;
  subtitle?: string;
  type: 'toggle' | 'navigation' | 'action';
  value?: boolean;
  status?: string;
  onPress?: () => void;
  dangerous?: boolean;
}

// ============================================
// MOCK DATA
// ============================================
const MOCK_USER: UserProfile = {
  id: 'usr-001',
  name: 'Alexander Mitchell',
  role: 'Senior QA/QC Inspector',
  email: 'a.mitchell@nexpec.com',
  phone: '+1 (555) 123-4567',
  location: 'Houston, Texas',
  department: 'Pipeline Integrity',
  joinDate: 'March 2019',
  isVerified: true,
  stats: {
    inspectionsDone: 142,
    hoursLogged: 350,
    avgRating: 4.9,
    totalReviews: 87,
  },
};

const MOCK_CERTIFICATIONS: Certification[] = [
  {
    id: 'cert-1',
    name: 'Non-Destructive Testing',
    abbreviation: 'ASNT Level II',
    issuer: 'American Society for NDT',
    expiryDate: 'Dec 2025',
    isActive: true,
    level: 'Level II',
  },
  {
    id: 'cert-2',
    name: 'Coating Inspector',
    abbreviation: 'NACE CIP-2',
    issuer: 'NACE International',
    expiryDate: 'Jun 2025',
    isActive: true,
    level: 'Level 2',
  },
  {
    id: 'cert-3',
    name: 'Welding Inspector',
    abbreviation: 'AWS CWI',
    issuer: 'American Welding Society',
    expiryDate: 'Sep 2024',
    isActive: true,
  },
  {
    id: 'cert-4',
    name: 'API 510',
    abbreviation: 'API 510',
    issuer: 'American Petroleum Institute',
    expiryDate: 'Mar 2025',
    isActive: true,
  },
  {
    id: 'cert-5',
    name: 'Safety Certified',
    abbreviation: 'OSHA 30',
    issuer: 'OSHA',
    expiryDate: 'Never',
    isActive: true,
  },
];

// ============================================
// SUB-COMPONENTS
// ============================================

// Profile Header with Avatar
interface ProfileHeaderProps {
  user: UserProfile;
  onEditPress: () => void;
}

const ProfileHeader: React.FC<ProfileHeaderProps> = ({ user, onEditPress }) => (
  <View style={styles.profileHeader}>
    {/* Background Gradient */}
    <LinearGradient
      colors={['rgba(124, 58, 237, 0.15)', 'rgba(124, 58, 237, 0.02)', 'transparent']}
      style={styles.headerGradient}
    />
    
    {/* Avatar Section */}
    <View style={styles.avatarContainer}>
      <View style={styles.avatarWrapper}>
        <LinearGradient
          colors={[COLORS.primary, COLORS.secondary]}
          style={styles.avatarBorder}
        >
          <View style={styles.avatarInner}>
            {user.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <User size={48} color={COLORS.primary} />
              </View>
            )}
          </View>
        </LinearGradient>
        
        {/* Verified Badge */}
        {user.isVerified && (
          <View style={styles.verifiedBadge}>
            <LinearGradient
              colors={[COLORS.success, COLORS.successDark]}
              style={styles.verifiedGradient}
            >
              <CheckCircle size={16} color={COLORS.textPrimary} />
            </LinearGradient>
          </View>
        )}
        
        {/* Edit Button */}
        <TouchableOpacity style={styles.editAvatarButton} onPress={onEditPress}>
          <Camera size={14} color={COLORS.textPrimary} />
        </TouchableOpacity>
      </View>
    </View>
    
    {/* User Info */}
    <View style={styles.userInfo}>
      <View style={styles.nameRow}>
        <Text style={styles.userName}>{user.name}</Text>
        {user.isVerified && (
          <BadgeCheck size={20} color={COLORS.success} />
        )}
      </View>
      <Text style={styles.userRole}>{user.role}</Text>
      <View style={styles.departmentBadge}>
        <Briefcase size={12} color={COLORS.primary} />
        <Text style={styles.departmentText}>{user.department}</Text>
      </View>
    </View>
    
    {/* Stats Row */}
    <View style={styles.statsContainer}>
      <View style={styles.statItem}>
        <View style={styles.statIconContainer}>
          <ClipboardCheck size={20} color={COLORS.primary} />
        </View>
        <Text style={styles.statValue}>{user.stats.inspectionsDone}</Text>
        <Text style={styles.statLabel}>Inspections</Text>
      </View>
      
      <View style={styles.statDivider} />
      
      <View style={styles.statItem}>
        <View style={styles.statIconContainer}>
          <Clock size={20} color={COLORS.secondary} />
        </View>
        <Text style={styles.statValue}>{user.stats.hoursLogged}</Text>
        <Text style={styles.statLabel}>Hours Logged</Text>
      </View>
      
      <View style={styles.statDivider} />
      
      <View style={styles.statItem}>
        <View style={styles.statIconContainer}>
          <Star size={20} color={COLORS.warning} />
        </View>
        <View style={styles.ratingContainer}>
          <Text style={styles.statValue}>{user.stats.avgRating}</Text>
          <Text style={styles.ratingMax}>/5</Text>
        </View>
        <Text style={styles.statLabel}>Avg Rating</Text>
      </View>
    </View>
  </View>
);

// Certification Card
interface CertificationCardProps {
  certification: Certification;
  onPress: () => void;
}

const CertificationCard: React.FC<CertificationCardProps> = ({ certification, onPress }) => (
  <TouchableOpacity
    style={styles.certCard}
    onPress={onPress}
    activeOpacity={0.8}
  >
    {/* Gold Border Effect */}
    <LinearGradient
      colors={[COLORS.gold, COLORS.goldDark, COLORS.gold]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.certBorder}
    >
      <View style={styles.certInner}>
        {/* Certificate Icon */}
        <View style={styles.certIconContainer}>
          <Award size={28} color={COLORS.gold} />
        </View>
        
        {/* Certificate Info */}
        <Text style={styles.certAbbreviation}>{certification.abbreviation}</Text>
        <Text style={styles.certName} numberOfLines={2}>{certification.name}</Text>
        
        {/* Issuer & Expiry */}
        <View style={styles.certMeta}>
          <Text style={styles.certIssuer} numberOfLines={1}>{certification.issuer}</Text>
          <View style={styles.certExpiryBadge}>
            <Calendar size={10} color={COLORS.success} />
            <Text style={styles.certExpiry}>{certification.expiryDate}</Text>
          </View>
        </View>
        
        {/* Active Badge */}
        {certification.isActive && (
          <View style={styles.activeBadge}>
            <View style={styles.activeDot} />
            <Text style={styles.activeText}>Active</Text>
          </View>
        )}
      </View>
    </LinearGradient>
  </TouchableOpacity>
);

// Certifications Section
interface CertificationsSectionProps {
  certifications: Certification[];
}

const CertificationsSection: React.FC<CertificationsSectionProps> = ({ certifications }) => (
  <View style={styles.certificationsSection}>
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleRow}>
        <Award size={20} color={COLORS.gold} />
        <Text style={styles.sectionTitle}>Certifications & Licenses</Text>
      </View>
      <TouchableOpacity style={styles.seeAllButton}>
        <Text style={styles.seeAllText}>See All</Text>
        <ChevronRight size={16} color={COLORS.primary} />
      </TouchableOpacity>
    </View>
    
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.certificationsScroll}
    >
      {certifications.map((cert) => (
        <CertificationCard
          key={cert.id}
          certification={cert}
          onPress={() => console.log('Cert pressed:', cert.id)}
        />
      ))}
    </ScrollView>
  </View>
);

// Custom Toggle Switch
interface CustomToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

const CustomToggle: React.FC<CustomToggleProps> = ({ value, onValueChange, disabled }) => (
  <Switch
    value={value}
    onValueChange={onValueChange}
    disabled={disabled}
    trackColor={{
      false: COLORS.surfaceLight,
      true: 'rgba(124, 58, 237, 0.3)',
    }}
    thumbColor={value ? COLORS.primary : COLORS.textMuted}
    ios_backgroundColor={COLORS.surfaceLight}
  />
);

// Settings Row Item
interface SettingsRowProps {
  item: SettingItem;
  onToggle?: (value: boolean) => void;
}

const SettingsRow: React.FC<SettingsRowProps> = ({ item, onToggle }) => {
  const Icon = item.icon;
  
  return (
    <TouchableOpacity
      style={[styles.settingsRow, item.dangerous && styles.settingsRowDanger]}
      onPress={item.type !== 'toggle' ? item.onPress : undefined}
      activeOpacity={item.type === 'toggle' ? 1 : 0.7}
    >
      <View style={styles.settingsRowLeft}>
        <View style={[
          styles.settingsIconContainer,
          item.dangerous && styles.settingsIconDanger,
        ]}>
          <Icon size={20} color={item.dangerous ? COLORS.error : COLORS.primary} />
        </View>
        <View style={styles.settingsTextContainer}>
          <Text style={[
            styles.settingsTitle,
            item.dangerous && styles.settingsTitleDanger,
          ]}>
            {item.title}
          </Text>
          {item.subtitle && (
            <Text style={styles.settingsSubtitle}>{item.subtitle}</Text>
          )}
          {item.status && (
            <View style={styles.statusContainer}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>{item.status}</Text>
            </View>
          )}
        </View>
      </View>
      
      <View style={styles.settingsRowRight}>
        {item.type === 'toggle' && (
          <CustomToggle
            value={item.value || false}
            onValueChange={(value) => onToggle?.(value)}
          />
        )}
        {item.type === 'navigation' && (
          <ChevronRight size={20} color={COLORS.textMuted} />
        )}
        {item.type === 'action' && !item.dangerous && (
          <ChevronRight size={20} color={COLORS.textMuted} />
        )}
      </View>
    </TouchableOpacity>
  );
};

// Settings Group
interface SettingsGroupProps {
  title: string;
  icon: LucideIcon | React.ComponentType<{ size: number; color: string }>;
  items: SettingItem[];
  onToggle: (itemId: string, value: boolean) => void;
}

const SettingsGroup: React.FC<SettingsGroupProps> = ({ title, icon: Icon, items, onToggle }) => (
  <View style={styles.settingsGroup}>
    <View style={styles.groupHeader}>
      <Icon size={16} color={COLORS.textMuted} />
      <Text style={styles.groupTitle}>{title}</Text>
    </View>
    <View style={styles.groupContent}>
      {items.map((item, index) => (
        <View key={item.id}>
          <SettingsRow
            item={item}
            onToggle={(value) => onToggle(item.id, value)}
          />
          {index < items.length - 1 && <View style={styles.rowDivider} />}
        </View>
      ))}
    </View>
  </View>
);

// Quick Contact Bar
interface QuickContactBarProps {
  email: string;
  phone: string;
  location: string;
}

const QuickContactBar: React.FC<QuickContactBarProps> = ({ email, phone, location }) => (
  <View style={styles.contactBar}>
    <TouchableOpacity style={styles.contactItem}>
      <Mail size={18} color={COLORS.primary} />
      <Text style={styles.contactText} numberOfLines={1}>{email}</Text>
    </TouchableOpacity>
    <View style={styles.contactDivider} />
    <TouchableOpacity style={styles.contactItem}>
      <MapPin size={18} color={COLORS.secondary} />
      <Text style={styles.contactText} numberOfLines={1}>{location}</Text>
    </TouchableOpacity>
  </View>
);

// ============================================
// MAIN SCREEN COMPONENT
// ============================================
const ProfileScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  
  // State for toggles
  const [offlineMode, setOfflineMode] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [autoSync, setAutoSync] = useState(true);
  
  // Handlers
  const handleEditProfile = useCallback(() => {
    console.log('Edit profile pressed');
  }, []);
  
  const handleLogout = useCallback(() => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: () => {
            console.log('User logged out');
            // navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
          },
        },
      ]
    );
  }, []);
  
  const handleSyncData = useCallback(() => {
    Alert.alert('Sync Data', 'Syncing your data with the server...');
  }, []);
  
  const handleEquipment = useCallback(() => {
    navigation.navigate('Equipment');
  }, [navigation]);
  
  const handleToggleChange = useCallback((itemId: string, value: boolean) => {
    switch (itemId) {
      case 'offline':
        setOfflineMode(value);
        break;
      case 'notifications':
        setNotifications(value);
        break;
      case 'autoSync':
        setAutoSync(value);
        break;
    }
  }, []);
  
  // Settings Data
  const appSettings: SettingItem[] = [
    {
      id: 'offline',
      icon: offlineMode ? WifiOff : Wifi,
      title: 'Offline Mode',
      subtitle: 'Work without internet connection',
      type: 'toggle',
      value: offlineMode,
    },
    {
      id: 'sync',
      icon: Cloud,
      title: 'Sync Data',
      subtitle: 'Sync your inspection data',
      status: 'Last synced: 2m ago',
      type: 'action',
      onPress: handleSyncData,
    },
    {
      id: 'notifications',
      icon: notifications ? Bell : BellOff,
      title: 'Notifications',
      subtitle: 'Receive push notifications',
      type: 'toggle',
      value: notifications,
    },
    {
      id: 'autoSync',
      icon: RefreshCw,
      title: 'Auto Sync',
      subtitle: 'Automatically sync when online',
      type: 'toggle',
      value: autoSync,
    },
    {
      id: 'equipment',
      icon: Wrench,
      title: 'My Equipment',
      subtitle: 'Manage tools & calibration',
      type: 'navigation',
      onPress: handleEquipment,
    },
  ];
  
  const preferencesSettings: SettingItem[] = [
    {
      id: 'language',
      icon: Globe,
      title: 'Language',
      subtitle: 'English (US)',
      type: 'navigation',
      onPress: () => console.log('Language settings'),
    },
  ];
  
  const supportSettings: SettingItem[] = [
    {
      id: 'help',
      icon: HelpCircle,
      title: 'Help & Support',
      subtitle: 'Get help with the app',
      type: 'navigation',
      onPress: () => console.log('Help & Support'),
    },
    {
      id: 'feedback',
      icon: MessageSquare,
      title: 'Send Feedback',
      subtitle: 'Share your thoughts',
      type: 'navigation',
      onPress: () => console.log('Send Feedback'),
    },
    {
      id: 'bug',
      icon: Bug,
      title: 'Report a Bug',
      subtitle: 'Help us improve',
      type: 'navigation',
      onPress: () => console.log('Report a Bug'),
    },
    {
      id: 'docs',
      icon: FileText,
      title: 'Documentation',
      subtitle: 'Read the user guide',
      type: 'navigation',
      onPress: () => console.log('Documentation'),
    },
  ];
  
  const securitySettings: SettingItem[] = [
    {
      id: 'security',
      icon: Lock,
      title: 'Security Settings',
      subtitle: 'Password, biometrics',
      type: 'navigation',
      onPress: () => console.log('Security Settings'),
    },
    {
      id: 'privacy',
      icon: Shield,
      title: 'Privacy Policy',
      type: 'navigation',
      onPress: () => console.log('Privacy Policy'),
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Header */}
        <ProfileHeader user={MOCK_USER} onEditPress={handleEditProfile} />
        
        {/* Quick Contact Bar */}
        <QuickContactBar
          email={MOCK_USER.email}
          phone={MOCK_USER.phone}
          location={MOCK_USER.location}
        />
        
        {/* Certifications Section */}
        <CertificationsSection certifications={MOCK_CERTIFICATIONS} />
        
        {/* Settings Groups */}
        <View style={styles.settingsContainer}>
          <SettingsGroup
            title="APP SETTINGS"
            icon={Settings}
            items={appSettings}
            onToggle={handleToggleChange}
          />
          
          <SettingsGroup
            title="PREFERENCES"
            icon={Settings}
            items={preferencesSettings}
            onToggle={handleToggleChange}
          />
          
          <SettingsGroup
            title="SECURITY"
            icon={Shield}
            items={securitySettings}
            onToggle={handleToggleChange}
          />
          
          <SettingsGroup
            title="SUPPORT"
            icon={HelpCircle}
            items={supportSettings}
            onToggle={handleToggleChange}
          />
          
          {/* Logout Button */}
          <TouchableOpacity
            style={styles.logoutButton}
            onPress={handleLogout}
            activeOpacity={0.8}
          >
            <View style={styles.logoutContent}>
              <LogOut size={20} color={COLORS.error} />
              <Text style={styles.logoutText}>Logout</Text>
            </View>
          </TouchableOpacity>
        </View>
        
        {/* Version Info */}
        <View style={styles.versionContainer}>
          <Text style={styles.versionText}>NEXPEC Inspection App</Text>
          <Text style={styles.versionNumber}>Version 1.0.0 (Build 2024.12.28)</Text>
          <Text style={styles.copyrightText}>© 2024 NEXPEC Industries</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

// ============================================
// STYLES
// ============================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  
  // Profile Header Styles
  profileHeader: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 24,
    paddingHorizontal: 20,
    position: 'relative',
  },
  headerGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 200,
  },
  avatarContainer: {
    marginBottom: 16,
  },
  avatarWrapper: {
    position: 'relative',
  },
  avatarBorder: {
    width: 110,
    height: 110,
    borderRadius: 55,
    padding: 3,
  },
  avatarInner: {
    flex: 1,
    borderRadius: 52,
    backgroundColor: COLORS.surface,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceLight,
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    borderRadius: 14,
    overflow: 'hidden',
  },
  verifiedGradient: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.background,
    borderRadius: 14,
  },
  editAvatarButton: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.background,
  },
  userInfo: {
    alignItems: 'center',
    marginBottom: 20,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  userName: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  userRole: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  departmentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  departmentText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
  },
  
  // Stats Container
  statsContainer: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    width: '100%',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: COLORS.borderLight,
    marginHorizontal: 8,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  ratingMax: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  
  // Contact Bar
  contactBar: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 24,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    overflow: 'hidden',
  },
  contactItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    gap: 8,
  },
  contactText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    flex: 1,
  },
  contactDivider: {
    width: 1,
    backgroundColor: COLORS.borderLight,
  },
  
  // Certifications Section
  certificationsSection: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  seeAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  seeAllText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  certificationsScroll: {
    paddingHorizontal: 20,
    gap: 12,
  },
  
  // Certification Card
  certCard: {
    width: 160,
    marginRight: 12,
  },
  certBorder: {
    borderRadius: 16,
    padding: 2,
  },
  certInner: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    minHeight: 180,
  },
  certIconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.3)',
  },
  certAbbreviation: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gold,
    marginBottom: 4,
    textAlign: 'center',
  },
  certName: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 16,
  },
  certMeta: {
    alignItems: 'center',
    gap: 6,
    marginTop: 'auto',
  },
  certIssuer: {
    fontSize: 10,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  certExpiryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 214, 143, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  certExpiry: {
    fontSize: 10,
    color: COLORS.success,
    fontWeight: '600',
  },
  activeBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 214, 143, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.success,
  },
  activeText: {
    fontSize: 9,
    color: COLORS.success,
    fontWeight: '600',
  },
  
  // Settings Container
  settingsContainer: {
    paddingHorizontal: 20,
    gap: 20,
  },
  
  // Settings Group
  settingsGroup: {
    gap: 8,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 4,
  },
  groupTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
    letterSpacing: 1,
  },
  groupContent: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  
  // Settings Row
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  settingsRowDanger: {
    backgroundColor: 'rgba(255, 71, 87, 0.05)',
  },
  settingsRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 14,
  },
  settingsIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsIconDanger: {
    backgroundColor: 'rgba(255, 71, 87, 0.1)',
  },
  settingsTextContainer: {
    flex: 1,
  },
  settingsTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  settingsTitleDanger: {
    color: COLORS.error,
  },
  settingsSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.success,
  },
  statusText: {
    fontSize: 11,
    color: COLORS.success,
    fontWeight: '500',
  },
  settingsRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowDivider: {
    height: 1,
    backgroundColor: COLORS.borderLight,
    marginLeft: 70,
  },
  
  // Logout Button
  logoutButton: {
    marginTop: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 71, 87, 0.3)',
    overflow: 'hidden',
  },
  logoutContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 10,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.error,
  },
  
  // Version Info
  versionContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
  },
  versionText: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
    marginBottom: 4,
  },
  versionNumber: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  copyrightText: {
    fontSize: 11,
    color: COLORS.textMuted,
    opacity: 0.7,
  },
});

export default ProfileScreen;
