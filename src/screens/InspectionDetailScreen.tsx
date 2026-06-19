import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Dimensions,
  Animated,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Users,
  Wrench,
  FileText,
  Play,
  Clock,
  CheckCircle,
  AlertCircle,
  Navigation,
  ChevronRight,
  Clipboard,
  History,
  Eye,
  DollarSign,
  LucideIcon,
} from 'lucide-react-native';

// Import navigation types
import { RootStackParamList } from '../navigation/types';

// ============================================
// THEME COLORS
// ============================================
const COLORS = {
  background: '#0A0E17',
  surface: '#141B2D',
  surfaceLight: '#1E2A45',
  surfaceDark: '#0D1321',
  primary: '#00F5FF',
  primaryDark: '#00C8D4',
  secondary: '#7B61FF',
  accent: '#FF6B6B',
  success: '#00D68F',
  warning: '#FFB800',
  error: '#FF4757',
  info: '#3B82F6',
  textPrimary: '#FFFFFF',
  textSecondary: '#A0AEC0',
  textMuted: '#64748B',
  border: 'rgba(0, 245, 255, 0.2)',
  borderLight: 'rgba(255, 255, 255, 0.08)',
  glassBg: 'rgba(20, 27, 45, 0.85)',
  glassGlow: 'rgba(0, 245, 255, 0.15)',
  overlay: 'rgba(0, 0, 0, 0.5)',
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ============================================
// TYPE DEFINITIONS
// ============================================
type InspectionDetailRouteProp = RouteProp<RootStackParamList, 'InspectionDetail'>;

interface InspectionData {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'on_hold';
  location: string;
  address: string;
  date: string;
  time: string;
  team: string[];
  equipmentType: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  progress: number;
  coordinates: {
    latitude: number;
    longitude: number;
  };
}

interface HistoryItem {
  id: string;
  action: string;
  user: string;
  timestamp: string;
  type: 'update' | 'note' | 'status_change';
}

// ============================================
// MOCK DATA
// ============================================
const getMockInspectionData = (id: string): InspectionData => ({
  id,
  title: 'Pipeline Integrity Check',
  status: 'in_progress',
  location: 'Sector 7 - North Wing',
  address: '1234 Industrial Park, Building A',
  date: 'Dec 28, 2024',
  time: '09:00 AM',
  team: ['John Doe', 'Sarah Smith', 'Mike Johnson'],
  equipmentType: 'Ultrasonic Testing Equipment',
  description:
    'Conduct comprehensive pipeline integrity assessment including wall thickness measurements, corrosion detection, and weld inspection. Document all findings and flag any anomalies for immediate review. Ensure all safety protocols are followed during the inspection process.',
  priority: 'high',
  progress: 35,
  coordinates: {
    latitude: 40.7128,
    longitude: -74.006,
  },
});

const getMockHistoryData = (): HistoryItem[] => [
  {
    id: '1',
    action: 'Inspection started',
    user: 'John Doe',
    timestamp: '2 hours ago',
    type: 'status_change',
  },
  {
    id: '2',
    action: 'Added checkpoint notes for Section A',
    user: 'Sarah Smith',
    timestamp: '1 hour ago',
    type: 'note',
  },
  {
    id: '3',
    action: 'Updated equipment calibration status',
    user: 'Mike Johnson',
    timestamp: '45 mins ago',
    type: 'update',
  },
  {
    id: '4',
    action: 'Flagged anomaly at junction point B-7',
    user: 'John Doe',
    timestamp: '30 mins ago',
    type: 'note',
  },
];

// ============================================
// STATUS CONFIGURATION
// ============================================
const getStatusConfig = (status: InspectionData['status']) => {
  const configs = {
    pending: {
      label: 'Pending',
      color: COLORS.warning,
      bgColor: 'rgba(255, 184, 0, 0.15)',
      icon: Clock,
    },
    in_progress: {
      label: 'In Progress',
      color: COLORS.info,
      bgColor: 'rgba(59, 130, 246, 0.15)',
      icon: Play,
    },
    completed: {
      label: 'Completed',
      color: COLORS.success,
      bgColor: 'rgba(0, 214, 143, 0.15)',
      icon: CheckCircle,
    },
    on_hold: {
      label: 'On Hold',
      color: COLORS.error,
      bgColor: 'rgba(255, 71, 87, 0.15)',
      icon: AlertCircle,
    },
  };
  return configs[status];
};

// ============================================
// SUB-COMPONENTS
// ============================================

// Custom Header Component
interface HeaderProps {
  inspectionId: string;
  onBack: () => void;
}

const Header: React.FC<HeaderProps> = ({ inspectionId, onBack }) => (
  <View style={styles.header}>
    <TouchableOpacity
      style={styles.backButton}
      onPress={onBack}
      activeOpacity={0.7}
    >
      <ArrowLeft size={24} color={COLORS.textPrimary} />
    </TouchableOpacity>
    <View style={styles.headerTitleContainer}>
      <Text style={styles.headerLabel}>Inspection</Text>
      <Text style={styles.headerTitle}>#{inspectionId}</Text>
    </View>
    <View style={styles.headerSpacer} />
  </View>
);

// Tab Selector Component
interface TabSelectorProps {
  activeTab: 'overview' | 'history';
  onTabChange: (tab: 'overview' | 'history') => void;
}

const TabSelector: React.FC<TabSelectorProps> = ({ activeTab, onTabChange }) => (
  <View style={styles.tabContainer}>
    <TouchableOpacity
      style={[styles.tab, activeTab === 'overview' && styles.tabActive]}
      onPress={() => onTabChange('overview')}
      activeOpacity={0.7}
    >
      <Eye
        size={18}
        color={activeTab === 'overview' ? COLORS.primary : COLORS.textMuted}
      />
      <Text
        style={[styles.tabText, activeTab === 'overview' && styles.tabTextActive]}
      >
        Overview
      </Text>
      {activeTab === 'overview' && <View style={styles.tabIndicator} />}
    </TouchableOpacity>
    <TouchableOpacity
      style={[styles.tab, activeTab === 'history' && styles.tabActive]}
      onPress={() => onTabChange('history')}
      activeOpacity={0.7}
    >
      <History
        size={18}
        color={activeTab === 'history' ? COLORS.primary : COLORS.textMuted}
      />
      <Text
        style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}
      >
        History
      </Text>
      {activeTab === 'history' && <View style={styles.tabIndicator} />}
    </TouchableOpacity>
  </View>
);

// Status Banner Component
interface StatusBannerProps {
  status: InspectionData['status'];
  progress: number;
}

const StatusBanner: React.FC<StatusBannerProps> = ({ status, progress }) => {
  const config = getStatusConfig(status);
  const IconComponent = config.icon;

  return (
    <View style={[styles.statusBanner, { backgroundColor: config.bgColor }]}>
      <View style={[styles.statusBannerGlow, { backgroundColor: config.color }]} />
      <View style={styles.statusBannerContent}>
        <View style={styles.statusBannerLeft}>
          <View style={[styles.statusIconContainer, { backgroundColor: config.color }]}>
            <IconComponent size={24} color={COLORS.surfaceDark} />
          </View>
          <View style={styles.statusTextContainer}>
            <Text style={styles.statusLabel}>Current Status</Text>
            <Text style={[styles.statusValue, { color: config.color }]}>
              {config.label}
            </Text>
          </View>
        </View>
        {status === 'in_progress' && (
          <View style={styles.progressContainer}>
            <Text style={styles.progressText}>{progress}%</Text>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${progress}%`, backgroundColor: config.color },
                ]}
              />
            </View>
          </View>
        )}
      </View>
    </View>
  );
};

// Glassmorphic Info Card Component
interface InfoCardProps {
  icon: LucideIcon | React.ComponentType<{ size: number; color: string }>;
  label: string;
  value: string;
  subtitle?: string;
  accentColor?: string;
}

const InfoCard: React.FC<InfoCardProps> = ({
  icon: Icon,
  label,
  value,
  subtitle,
  accentColor = COLORS.primary,
}) => (
  <View style={styles.infoCard}>
    <View style={[styles.infoCardGlow, { backgroundColor: accentColor }]} />
    <View style={styles.infoCardHeader}>
      <View style={[styles.infoCardIcon, { backgroundColor: `${accentColor}20` }]}>
        <Icon size={20} color={accentColor} />
      </View>
      <Text style={styles.infoCardLabel}>{label}</Text>
    </View>
    <Text style={styles.infoCardValue} numberOfLines={2}>
      {value}
    </Text>
    {subtitle && (
      <Text style={styles.infoCardSubtitle} numberOfLines={1}>
        {subtitle}
      </Text>
    )}
  </View>
);

// Map Placeholder Component
interface MapPlaceholderProps {
  location: string;
  address: string;
}

const MapPlaceholder: React.FC<MapPlaceholderProps> = ({ location, address }) => (
  <View style={styles.mapContainer}>
    <View style={styles.mapPlaceholder}>
      {/* Simulated map grid pattern */}
      <View style={styles.mapGrid}>
        {[...Array(20)].map((_, i) => (
          <View key={i} style={styles.mapGridLine} />
        ))}
      </View>
      {/* Map pin marker */}
      <View style={styles.mapMarker}>
        <View style={styles.mapMarkerPulse} />
        <View style={styles.mapMarkerDot}>
          <Navigation size={16} color={COLORS.surfaceDark} />
        </View>
      </View>
      {/* Location label */}
      <View style={styles.mapLocationBadge}>
        <MapPin size={14} color={COLORS.primary} />
        <Text style={styles.mapLocationText}>{location}</Text>
      </View>
    </View>
    <View style={styles.mapInfoBar}>
      <View style={styles.mapInfoContent}>
        <MapPin size={16} color={COLORS.primary} />
        <View style={styles.mapInfoText}>
          <Text style={styles.mapInfoLocation}>{location}</Text>
          <Text style={styles.mapInfoAddress}>{address}</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.mapDirectionsButton}>
        <Text style={styles.mapDirectionsText}>Directions</Text>
        <ChevronRight size={16} color={COLORS.primary} />
      </TouchableOpacity>
    </View>
  </View>
);

// Description Section Component
interface DescriptionSectionProps {
  description: string;
}

const DescriptionSection: React.FC<DescriptionSectionProps> = ({ description }) => (
  <View style={styles.descriptionContainer}>
    <View style={styles.sectionHeader}>
      <FileText size={20} color={COLORS.primary} />
      <Text style={styles.sectionTitle}>Description & Notes</Text>
    </View>
    <View style={styles.descriptionCard}>
      <Text style={styles.descriptionText}>{description}</Text>
    </View>
  </View>
);

// History Item Component
interface HistoryItemComponentProps {
  item: HistoryItem;
  isLast: boolean;
}

const HistoryItemComponent: React.FC<HistoryItemComponentProps> = ({ item, isLast }) => {
  const getTypeIcon = (type: HistoryItem['type']) => {
    switch (type) {
      case 'status_change':
        return { icon: CheckCircle, color: COLORS.success };
      case 'note':
        return { icon: Clipboard, color: COLORS.warning };
      case 'update':
        return { icon: Clock, color: COLORS.info };
      default:
        return { icon: Clock, color: COLORS.textMuted };
    }
  };

  const typeConfig = getTypeIcon(item.type);
  const IconComponent = typeConfig.icon;

  return (
    <View style={styles.historyItem}>
      <View style={styles.historyTimeline}>
        <View style={[styles.historyDot, { backgroundColor: typeConfig.color }]}>
          <IconComponent size={12} color={COLORS.surfaceDark} />
        </View>
        {!isLast && <View style={styles.historyLine} />}
      </View>
      <View style={styles.historyContent}>
        <Text style={styles.historyAction}>{item.action}</Text>
        <View style={styles.historyMeta}>
          <Text style={styles.historyUser}>{item.user}</Text>
          <Text style={styles.historyDivider}>•</Text>
          <Text style={styles.historyTime}>{item.timestamp}</Text>
        </View>
      </View>
    </View>
  );
};

// History Tab Content
interface HistoryTabProps {
  history: HistoryItem[];
}

const HistoryTab: React.FC<HistoryTabProps> = ({ history }) => (
  <View style={styles.historyContainer}>
    <View style={styles.sectionHeader}>
      <History size={20} color={COLORS.primary} />
      <Text style={styles.sectionTitle}>Activity History</Text>
    </View>
    <View style={styles.historyList}>
      {history.map((item, index) => (
        <HistoryItemComponent
          key={item.id}
          item={item}
          isLast={index === history.length - 1}
        />
      ))}
    </View>
  </View>
);

// Action Footer Component
interface ActionFooterProps {
  status: InspectionData['status'];
  onStartInspection: () => void;
}

const ActionFooter: React.FC<ActionFooterProps> = ({ status, onStartInspection }) => {
  const getButtonConfig = () => {
    switch (status) {
      case 'pending':
        return { label: 'Start Inspection', icon: Play };
      case 'in_progress':
        return { label: 'Resume Inspection', icon: Play };
      case 'completed':
        return { label: 'View Report', icon: FileText };
      default:
        return { label: 'Start Inspection', icon: Play };
    }
  };

  const buttonConfig = getButtonConfig();
  const IconComponent = buttonConfig.icon;

  return (
    <View style={styles.footerContainer}>
      <View style={styles.footerGlow} />
      <TouchableOpacity
        style={styles.actionButton}
        onPress={onStartInspection}
        activeOpacity={0.85}
      >
        <LinearGradient
          colors={[COLORS.primary, COLORS.info, '#4F46E5']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.actionButtonGradient}
        >
          <IconComponent size={22} color={COLORS.surfaceDark} />
          <Text style={styles.actionButtonText}>{buttonConfig.label}</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
};

// ============================================
// MAIN SCREEN COMPONENT
// ============================================
const InspectionDetailScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<InspectionDetailRouteProp>();
  
  // Get inspectionId from route params with fallback
  const inspectionId = route.params?.inspectionId || 'INS-001';
  
  // State
  const [activeTab, setActiveTab] = useState<'overview' | 'history'>('overview');
  
  // Fetch mock data
  const inspection = getMockInspectionData(inspectionId);
  const history = getMockHistoryData();

  // Handlers
  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleTabChange = useCallback((tab: 'overview' | 'history') => {
    setActiveTab(tab);
  }, []);

  const handleStartInspection = useCallback(() => {
    // Navigate to ContractSign first, then to InspectionExecution after signing
    navigation.navigate('ContractSign', { 
      inspectionId: inspectionId,
      nextScreen: 'InspectionExecution'
    });
  }, [navigation, inspectionId]);

  const handleExpenses = useCallback(() => {
    navigation.navigate('Expenses' as never);
  }, [navigation]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      
      {/* Header */}
      <Header inspectionId={inspectionId} onBack={handleBack} />
      
      {/* Tab Selector */}
      <TabSelector activeTab={activeTab} onTabChange={handleTabChange} />
      
      {/* Scrollable Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'overview' ? (
          <>
            {/* Status Banner */}
            <StatusBanner status={inspection.status} progress={inspection.progress} />
            
            {/* Info Cards Grid */}
            <View style={styles.infoCardsGrid}>
              <InfoCard
                icon={MapPin}
                label="Location"
                value={inspection.location}
                subtitle={inspection.address}
                accentColor={COLORS.primary}
              />
              <InfoCard
                icon={Calendar}
                label="Scheduled"
                value={inspection.date}
                subtitle={inspection.time}
                accentColor={COLORS.secondary}
              />
              <InfoCard
                icon={Users}
                label="Assigned Team"
                value={inspection.team[0]}
                subtitle={`+${inspection.team.length - 1} more members`}
                accentColor={COLORS.success}
              />
              <InfoCard
                icon={Wrench}
                label="Equipment"
                value={inspection.equipmentType}
                accentColor={COLORS.warning}
              />
            </View>
            
            {/* Map Placeholder */}
            <MapPlaceholder
              location={inspection.location}
              address={inspection.address}
            />
            
            {/* Description Section */}
            <DescriptionSection description={inspection.description} />
            
            {/* Quick Actions Section */}
            <View style={styles.quickActionsContainer}>
              <View style={styles.sectionHeader}>
                <FileText size={20} color={COLORS.primary} />
                <Text style={styles.sectionTitle}>Quick Actions</Text>
              </View>
              <TouchableOpacity 
                style={styles.quickActionButton}
                onPress={handleExpenses}
                activeOpacity={0.7}
              >
                <View style={styles.quickActionIconContainer}>
                  <DollarSign size={20} color={COLORS.primary} />
                </View>
                <Text style={styles.quickActionText}>Manage Expenses</Text>
                <ChevronRight size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <HistoryTab history={history} />
        )}
        
        {/* Bottom spacing for footer */}
        <View style={styles.bottomSpacer} />
      </ScrollView>
      
      {/* Fixed Action Footer */}
      <ActionFooter
        status={inspection.status}
        onStartInspection={handleStartInspection}
      />
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
  
  // Header Styles
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  headerTitleContainer: {
    alignItems: 'center',
  },
  headerLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  headerTitle: {
    fontSize: 18,
    color: COLORS.textPrimary,
    fontWeight: '700',
    marginTop: 2,
  },
  headerSpacer: {
    width: 44,
  },
  
  // Tab Styles
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 8,
    position: 'relative',
  },
  tabActive: {
    // Active state handled by indicator
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  tabTextActive: {
    color: COLORS.primary,
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: '20%',
    right: '20%',
    height: 3,
    backgroundColor: COLORS.primary,
    borderRadius: 2,
  },
  
  // Scroll View
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 120,
  },
  
  // Status Banner Styles
  statusBanner: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  statusBannerGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    opacity: 0.8,
  },
  statusBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  statusBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  statusIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTextContainer: {
    gap: 2,
  },
  statusLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  statusValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  progressContainer: {
    alignItems: 'flex-end',
    gap: 6,
  },
  progressText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  progressBar: {
    width: 80,
    height: 6,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  
  // Info Cards Grid
  infoCardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  infoCard: {
    width: (SCREEN_WIDTH - 44) / 2,
    backgroundColor: COLORS.glassBg,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    overflow: 'hidden',
    position: 'relative',
  },
  infoCardGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 60,
    height: 60,
    borderRadius: 30,
    opacity: 0.1,
    transform: [{ translateX: -20 }, { translateY: -20 }],
  },
  infoCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  infoCardIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCardLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoCardValue: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  infoCardSubtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  
  // Map Styles
  mapContainer: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  mapPlaceholder: {
    height: 180,
    backgroundColor: COLORS.surfaceDark,
    position: 'relative',
    overflow: 'hidden',
  },
  mapGrid: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  mapGridLine: {
    width: '10%',
    height: 30,
    borderWidth: 0.5,
    borderColor: 'rgba(0, 245, 255, 0.1)',
  },
  mapMarker: {
    position: 'absolute',
    top: '40%',
    left: '50%',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateX: -20 }, { translateY: -20 }],
  },
  mapMarkerPulse: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.primary,
    opacity: 0.2,
  },
  mapMarkerDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 15,
    elevation: 10,
  },
  mapLocationBadge: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.glassBg,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
  },
  mapLocationText: {
    fontSize: 12,
    color: COLORS.textPrimary,
    fontWeight: '500',
  },
  mapInfoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    backgroundColor: COLORS.surface,
  },
  mapInfoContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  mapInfoText: {
    flex: 1,
  },
  mapInfoLocation: {
    fontSize: 14,
    color: COLORS.textPrimary,
    fontWeight: '600',
  },
  mapInfoAddress: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  mapDirectionsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  mapDirectionsText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '600',
  },
  
  // Description Styles
  descriptionContainer: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  descriptionCard: {
    backgroundColor: COLORS.glassBg,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  descriptionText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 22,
  },
  
  // Quick Actions Styles
  quickActionsContainer: {
    marginBottom: 20,
  },
  quickActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.glassBg,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    gap: 12,
  },
  quickActionIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: `${COLORS.primary}15`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  
  // History Styles
  historyContainer: {
    marginTop: 4,
  },
  historyList: {
    backgroundColor: COLORS.glassBg,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  historyItem: {
    flexDirection: 'row',
    gap: 12,
  },
  historyTimeline: {
    alignItems: 'center',
    width: 24,
  },
  historyDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyLine: {
    width: 2,
    flex: 1,
    backgroundColor: COLORS.borderLight,
    marginVertical: 4,
  },
  historyContent: {
    flex: 1,
    paddingBottom: 20,
  },
  historyAction: {
    fontSize: 14,
    color: COLORS.textPrimary,
    fontWeight: '500',
    marginBottom: 4,
  },
  historyMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  historyUser: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  historyDivider: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  historyTime: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  
  // Bottom Spacer
  bottomSpacer: {
    height: 20,
  },
  
  // Footer Styles
  footerContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingBottom: 24,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  footerGlow: {
    position: 'absolute',
    top: -30,
    left: 0,
    right: 0,
    height: 30,
    backgroundColor: COLORS.background,
    opacity: 0.95,
  },
  actionButton: {
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  actionButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 10,
  },
  actionButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.surfaceDark,
    letterSpacing: 0.5,
  },
});

export default InspectionDetailScreen;
