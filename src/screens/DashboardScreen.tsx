import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Dimensions,
  Animated,
  FlatList,
  StatusBar,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { LineChart } from 'react-native-gifted-charts';
import {
  Bell,
  ClipboardList,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Calendar,
  ChevronRight,
  TrendingUp,
  Activity,
  Search,
  Filter,
  MoreVertical,
  Clock,
  Building2,
  Wrench,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Scan,
} from 'lucide-react-native';

// Import theme
import { COLORS, SIZES } from '../constants/theme';

// Get screen dimensions
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.42;

// ============================================
// TYPES & INTERFACES
// ============================================
interface StatCard {
  id: string;
  title: string;
  value: number;
  change: number;
  changeType: 'positive' | 'negative' | 'neutral';
  color: string;
  bgColor: string;
  icon: React.ReactNode;
}

interface Inspection {
  id: string;
  inspectionId: string;
  location: string;
  facility: string;
  date: string;
  time: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  priority: 'low' | 'medium' | 'high' | 'critical';
  inspector?: string;
  issuesFound?: number;
}

interface ChartDataPoint {
  value: number;
  label?: string;
  dataPointText?: string;
}

// ============================================
// MOCK DATA
// ============================================
const USER_DATA = {
  name: 'Alex Mitchell',
  role: 'Senior Inspector',
  avatar: 'https://randomuser.me/api/portraits/men/32.jpg',
  notifications: 5,
};

const STATS_DATA: StatCard[] = [
  {
    id: '1',
    title: 'Pending',
    value: 12,
    change: 8,
    changeType: 'negative',
    color: '#F59E0B',
    bgColor: 'rgba(245, 158, 11, 0.15)',
    icon: <ClipboardList size={24} color="#F59E0B" strokeWidth={2} />,
  },
  {
    id: '2',
    title: 'Completed',
    value: 85,
    change: 12,
    changeType: 'positive',
    color: '#10B981',
    bgColor: 'rgba(16, 185, 129, 0.15)',
    icon: <CheckCircle2 size={24} color="#10B981" strokeWidth={2} />,
  },
  {
    id: '3',
    title: 'Total Issues',
    value: 4,
    change: 2,
    changeType: 'negative',
    color: '#EF4444',
    bgColor: 'rgba(239, 68, 68, 0.15)',
    icon: <AlertTriangle size={24} color="#EF4444" strokeWidth={2} />,
  },
];

const CHART_DATA: ChartDataPoint[] = [
  { value: 15, label: 'Mon' },
  { value: 28, label: 'Tue' },
  { value: 22, label: 'Wed' },
  { value: 35, label: 'Thu' },
  { value: 30, label: 'Fri' },
  { value: 42, label: 'Sat' },
  { value: 38, label: 'Sun' },
];

const RECENT_INSPECTIONS: Inspection[] = [
  {
    id: '1',
    inspectionId: 'INS-204',
    location: 'Building A - Floor 3',
    facility: 'Manufacturing Plant',
    date: '2024-01-15',
    time: '09:30 AM',
    status: 'completed',
    priority: 'high',
    inspector: 'Alex Mitchell',
    issuesFound: 2,
  },
  {
    id: '2',
    inspectionId: 'INS-205',
    location: 'Warehouse Section B',
    facility: 'Storage Facility',
    date: '2024-01-15',
    time: '11:00 AM',
    status: 'in-progress',
    priority: 'medium',
    inspector: 'Alex Mitchell',
  },
  {
    id: '3',
    inspectionId: 'INS-206',
    location: 'Control Room',
    facility: 'Power Station',
    date: '2024-01-15',
    time: '02:30 PM',
    status: 'pending',
    priority: 'critical',
  },
  {
    id: '4',
    inspectionId: 'INS-207',
    location: 'Assembly Line 4',
    facility: 'Manufacturing Plant',
    date: '2024-01-14',
    time: '04:00 PM',
    status: 'failed',
    priority: 'high',
    issuesFound: 5,
  },
  {
    id: '5',
    inspectionId: 'INS-208',
    location: 'Server Room',
    facility: 'Data Center',
    date: '2024-01-14',
    time: '10:00 AM',
    status: 'completed',
    priority: 'low',
    issuesFound: 0,
  },
];

const QUICK_ACTIONS = [
  { id: '1', title: 'New Inspection', icon: ClipboardList, color: COLORS.primary },
  { id: '2', title: 'Scan QR', icon: Zap, color: '#8B5CF6' },
  { id: '3', title: 'Reports', icon: Activity, color: '#F59E0B' },
  { id: '4', title: 'Equipment', icon: Wrench, color: '#10B981' },
];

// ============================================
// HELPER FUNCTIONS
// ============================================
const getStatusColor = (status: Inspection['status']): string => {
  switch (status) {
    case 'completed':
      return '#10B981';
    case 'in-progress':
      return '#3B82F6';
    case 'pending':
      return '#F59E0B';
    case 'failed':
      return '#EF4444';
    default:
      return COLORS.textSecondary;
  }
};

const getStatusLabel = (status: Inspection['status']): string => {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'in-progress':
      return 'In Progress';
    case 'pending':
      return 'Pending';
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
};

const getPriorityColor = (priority: Inspection['priority']): string => {
  switch (priority) {
    case 'critical':
      return '#EF4444';
    case 'high':
      return '#F59E0B';
    case 'medium':
      return '#3B82F6';
    case 'low':
      return '#10B981';
    default:
      return COLORS.textSecondary;
  }
};

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
};

// ============================================
// SUB-COMPONENTS
// ============================================

// Avatar Component with Fallback
const AvatarWithFallback: React.FC<{ uri: string | null; name: string }> = ({ uri, name }) => {
  const [imageError, setImageError] = useState(false);
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  if (uri && !imageError) {
    return (
      <Image
        source={{ uri }}
        style={styles.avatar}
        onError={() => setImageError(true)}
      />
    );
  }

  return (
    <View style={[styles.avatar, styles.avatarPlaceholder]}>
      <Text style={styles.avatarInitials}>{initials || 'U'}</Text>
    </View>
  );
};

// Header Component
const Header: React.FC<{ userData: typeof USER_DATA }> = ({ userData }) => {
  const navigation = useNavigation<any>();
  const currentHour = new Date().getHours();
  const greeting =
    currentHour < 12 ? 'Good Morning' : currentHour < 18 ? 'Good Afternoon' : 'Good Evening';

  const handleNotifications = () => {
    navigation.navigate('Notifications' as never);
  };

  const handleScan = () => {
    navigation.navigate('AssetScanner' as never);
  };

  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <View style={styles.greetingContainer}>
          <Text style={styles.greetingText}>{greeting} 👋</Text>
          <Text style={styles.userName}>{userData.name}</Text>
          <View style={styles.roleContainer}>
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{userData.role}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.headerRight}>
        {/* Scan Button */}
        <TouchableOpacity style={styles.iconButton} onPress={handleScan}>
          <Scan size={24} color={COLORS.primary} strokeWidth={2} />
        </TouchableOpacity>

        {/* Search Button */}
        <TouchableOpacity style={styles.iconButton}>
          <Search size={22} color={COLORS.text} strokeWidth={2} />
        </TouchableOpacity>

        {/* Notification Bell */}
        <TouchableOpacity style={styles.iconButton} onPress={handleNotifications}>
          <Bell size={22} color={COLORS.text} strokeWidth={2} />
          {userData.notifications > 0 && (
            <View style={styles.notificationBadge}>
              <Text style={styles.notificationText}>
                {userData.notifications > 9 ? '9+' : userData.notifications}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {/* User Avatar */}
        <TouchableOpacity style={styles.avatarContainer}>
          <AvatarWithFallback uri={userData.avatar} name={userData.name} />
          <View style={styles.onlineIndicator} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

// Stat Card Component (Glassmorphic)
const StatCard: React.FC<{ stat: StatCard; index: number }> = ({ stat, index }) => {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        delay: index * 100,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 400,
        delay: index * 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const ChangeIcon = stat.changeType === 'positive' ? ArrowUpRight : ArrowDownRight;

  return (
    <Animated.View
      style={[
        styles.statCard,
        {
          opacity: opacityAnim,
          transform: [{ scale: scaleAnim }],
        },
      ]}
    >
      {/* Glassmorphic background */}
      <View style={styles.glassBackground} />

      {/* Top section with icon */}
      <View style={styles.statCardHeader}>
        <View style={[styles.statIconContainer, { backgroundColor: stat.bgColor }]}>
          {stat.icon}
        </View>
        <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MoreVertical size={18} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Value */}
      <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>

      {/* Title */}
      <Text style={styles.statTitle}>{stat.title}</Text>

      {/* Change indicator */}
      <View style={styles.statChangeContainer}>
        <ChangeIcon
          size={14}
          color={stat.changeType === 'positive' ? '#10B981' : '#EF4444'}
          strokeWidth={2.5}
        />
        <Text
          style={[
            styles.statChangeText,
            { color: stat.changeType === 'positive' ? '#10B981' : '#EF4444' },
          ]}
        >
          {stat.change}% from last week
        </Text>
      </View>
    </Animated.View>
  );
};

// Quick Action Button
const QuickActionButton: React.FC<{
  action: (typeof QUICK_ACTIONS)[0];
  index: number;
}> = ({ action, index }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      useNativeDriver: true,
    }).start();
  };

  const IconComponent = action.icon;

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View
        style={[styles.quickActionButton, { transform: [{ scale: scaleAnim }] }]}
      >
        <View style={[styles.quickActionIcon, { backgroundColor: `${action.color}20` }]}>
          <IconComponent size={22} color={action.color} strokeWidth={2} />
        </View>
        <Text style={styles.quickActionText}>{action.title}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
};

// Performance Chart Component
const PerformanceChart: React.FC = () => {
  return (
    <View style={styles.chartContainer}>
      {/* Chart Header */}
      <View style={styles.chartHeader}>
        <View>
          <Text style={styles.chartTitle}>Weekly Performance</Text>
          <Text style={styles.chartSubtitle}>Inspection activity overview</Text>
        </View>
        <View style={styles.chartLegend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: COLORS.primary }]} />
            <Text style={styles.legendText}>Inspections</Text>
          </View>
        </View>
      </View>

      {/* Summary Stats */}
      <View style={styles.chartSummary}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>210</Text>
          <Text style={styles.summaryLabel}>Total This Week</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <View style={styles.summaryTrend}>
            <TrendingUp size={16} color="#10B981" strokeWidth={2.5} />
            <Text style={[styles.summaryValue, { color: '#10B981' }]}>+18%</Text>
          </View>
          <Text style={styles.summaryLabel}>vs Last Week</Text>
        </View>
      </View>

      {/* Chart */}
      <View style={styles.chartWrapper}>
        <LineChart
          data={CHART_DATA}
          width={SCREEN_WIDTH - 80}
          height={180}
          curved
          areaChart
          hideDataPoints={false}
          dataPointsColor={COLORS.primary}
          dataPointsRadius={5}
          color={COLORS.primary}
          thickness={3}
          startFillColor={COLORS.primary}
          endFillColor="transparent"
          startOpacity={0.4}
          endOpacity={0.05}
          spacing={50}
          backgroundColor="transparent"
          rulesColor="rgba(255,255,255,0.05)"
          rulesType="solid"
          yAxisColor="transparent"
          xAxisColor="rgba(255,255,255,0.1)"
          yAxisTextStyle={styles.chartAxisText}
          xAxisLabelTextStyle={styles.chartAxisText}
          hideYAxisText
          noOfSections={4}
          pointerConfig={{
            pointerStripHeight: 140,
            pointerStripColor: 'rgba(0, 245, 255, 0.2)',
            pointerStripWidth: 2,
            pointerColor: COLORS.primary,
            radius: 6,
            pointerLabelWidth: 100,
            pointerLabelHeight: 90,
            activatePointersOnLongPress: true,
            autoAdjustPointerLabelPosition: true,
            pointerLabelComponent: (items: any) => {
              return (
                <View style={styles.pointerLabel}>
                  <Text style={styles.pointerLabelText}>{items[0].value}</Text>
                  <Text style={styles.pointerLabelSubtext}>Inspections</Text>
                </View>
              );
            },
          }}
        />
      </View>
    </View>
  );
};

// Inspection Item Component
const InspectionItem: React.FC<{ item: Inspection; index: number }> = ({ item, index }) => {
  const navigation = useNavigation<any>();
  const translateX = useRef(new Animated.Value(50)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0,
        duration: 400,
        delay: index * 80,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 400,
        delay: index * 80,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const statusColor = getStatusColor(item.status);
  const priorityColor = getPriorityColor(item.priority);

  const handlePress = () => {
    navigation.navigate('InspectionDetail', { inspectionId: item.inspectionId });
  };

  return (
    <Animated.View
      style={[
        styles.inspectionItem,
        {
          opacity,
          transform: [{ translateX }],
        },
      ]}
    >
      <TouchableOpacity 
        style={styles.inspectionContent} 
        activeOpacity={0.7}
        onPress={handlePress}
      >
        {/* Priority Indicator */}
        <View style={[styles.priorityIndicator, { backgroundColor: priorityColor }]} />

        {/* Main Content */}
        <View style={styles.inspectionMain}>
          {/* Header Row */}
          <View style={styles.inspectionHeader}>
            <View style={styles.inspectionIdContainer}>
              <Text style={styles.inspectionId}>#{item.inspectionId}</Text>
              {item.priority === 'critical' && (
                <View style={styles.criticalBadge}>
                  <AlertTriangle size={10} color="#FFF" strokeWidth={2.5} />
                </View>
              )}
            </View>
            <View style={[styles.statusBadge, { backgroundColor: `${statusColor}20` }]}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusText, { color: statusColor }]}>
                {getStatusLabel(item.status)}
              </Text>
            </View>
          </View>

          {/* Location */}
          <View style={styles.inspectionLocation}>
            <MapPin size={14} color={COLORS.textSecondary} strokeWidth={2} />
            <Text style={styles.locationText}>{item.location}</Text>
          </View>

          {/* Facility */}
          <View style={styles.inspectionFacility}>
            <Building2 size={14} color={COLORS.textSecondary} strokeWidth={2} />
            <Text style={styles.facilityText}>{item.facility}</Text>
          </View>

          {/* Footer Row */}
          <View style={styles.inspectionFooter}>
            <View style={styles.dateTimeContainer}>
              <Calendar size={12} color={COLORS.textSecondary} strokeWidth={2} />
              <Text style={styles.dateText}>{formatDate(item.date)}</Text>
              <Clock size={12} color={COLORS.textSecondary} strokeWidth={2} />
              <Text style={styles.timeText}>{item.time}</Text>
            </View>

            {item.issuesFound !== undefined && item.issuesFound > 0 && (
              <View style={styles.issuesContainer}>
                <AlertTriangle size={12} color="#EF4444" strokeWidth={2} />
                <Text style={styles.issuesText}>{item.issuesFound} issues</Text>
              </View>
            )}
          </View>
        </View>

        {/* Arrow */}
        <View style={styles.arrowContainer}>
          <ChevronRight size={20} color={COLORS.textSecondary} strokeWidth={2} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Section Header Component
const SectionHeader: React.FC<{
  title: string;
  actionText?: string;
  onActionPress?: () => void;
}> = ({ title, actionText = 'See All', onActionPress }) => (
  <View style={styles.sectionHeader}>
    <Text style={styles.sectionTitle}>{title}</Text>
    <TouchableOpacity onPress={onActionPress} style={styles.seeAllButton}>
      <Text style={styles.seeAllText}>{actionText}</Text>
      <ChevronRight size={16} color={COLORS.primary} strokeWidth={2.5} />
    </TouchableOpacity>
  </View>
);

// ============================================
// MAIN DASHBOARD COMPONENT
// ============================================
const DashboardScreen: React.FC = () => {
  const [refreshing, setRefreshing] = useState(false);
  const scrollY = useRef(new Animated.Value(0)).current;

  const onRefresh = async () => {
    setRefreshing(true);
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 2000));
    setRefreshing(false);
  };

  // Header animation based on scroll
  const headerOpacity = scrollY.interpolate({
    inputRange: [0, 100],
    outputRange: [1, 0.9],
    extrapolate: 'clamp',
  });

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />

      {/* Animated Header */}
      <Animated.View style={[styles.headerWrapper, { opacity: headerOpacity }]}>
        <Header userData={USER_DATA} />
      </Animated.View>

      <Animated.ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: false }
        )}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
            progressBackgroundColor={COLORS.surface}
          />
        }
      >
        {/* ========== QUICK ACTIONS ========== */}
        <View style={styles.quickActionsContainer}>
          <Text style={styles.quickActionsTitle}>Quick Actions</Text>
          <View style={styles.quickActionsGrid}>
            {QUICK_ACTIONS.map((action, index) => (
              <QuickActionButton key={action.id} action={action} index={index} />
            ))}
          </View>
        </View>

        {/* ========== STATS OVERVIEW ========== */}
        <SectionHeader title="Overview" actionText="This Week" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statsContainer}
          decelerationRate="fast"
          snapToInterval={CARD_WIDTH + 16}
        >
          {STATS_DATA.map((stat, index) => (
            <StatCard key={stat.id} stat={stat} index={index} />
          ))}
        </ScrollView>

        {/* ========== PERFORMANCE CHART ========== */}
        <SectionHeader title="Analytics" actionText="Details" />
        <PerformanceChart />

        {/* ========== RECENT INSPECTIONS ========== */}
        <SectionHeader title="Recent Inspections" onActionPress={() => {}} />
        <View style={styles.inspectionsContainer}>
          {RECENT_INSPECTIONS.map((inspection, index) => (
            <InspectionItem key={inspection.id} item={inspection} index={index} />
          ))}
        </View>

        {/* Bottom Spacing */}
        <View style={styles.bottomSpacing} />
      </Animated.ScrollView>
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
    paddingBottom: 100,
  },

  // Header Styles
  headerWrapper: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flex: 1,
  },
  greetingContainer: {
    gap: 2,
  },
  greetingText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  userName: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 2,
  },
  roleContainer: {
    marginTop: 6,
  },
  roleBadge: {
    backgroundColor: `${COLORS.primary}20`,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  roleText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  notificationBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.surface,
  },
  notificationText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFF',
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  avatarPlaceholder: {
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.background,
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#10B981',
    borderWidth: 2,
    borderColor: COLORS.background,
  },

  // Quick Actions
  quickActionsContainer: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  quickActionsTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  quickActionsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  quickActionButton: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  quickActionIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  quickActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
  },

  // Section Header
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 28,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  seeAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },

  // Stats Cards
  statsContainer: {
    paddingHorizontal: 20,
    gap: 16,
  },
  statCard: {
    width: CARD_WIDTH,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 18,
    marginRight: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  glassBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 20,
  },
  statCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  statIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statValue: {
    fontSize: 36,
    fontWeight: '800',
    marginBottom: 4,
  },
  statTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  statChangeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statChangeText: {
    fontSize: 12,
    fontWeight: '500',
  },

  // Chart Styles
  chartContainer: {
    marginHorizontal: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  chartTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  chartSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  chartLegend: {
    flexDirection: 'row',
    gap: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  chartSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
  },
  summaryLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  summaryTrend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  summaryDivider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  chartWrapper: {
    marginLeft: -10,
  },
  chartAxisText: {
    color: COLORS.textSecondary,
    fontSize: 11,
  },
  pointerLabel: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  pointerLabelText: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.primary,
    textAlign: 'center',
  },
  pointerLabelSubtext: {
    fontSize: 11,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },

  // Inspections List
  inspectionsContainer: {
    paddingHorizontal: 20,
    gap: 12,
  },
  inspectionItem: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  inspectionContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  priorityIndicator: {
    width: 4,
    height: '100%',
    minHeight: 100,
  },
  inspectionMain: {
    flex: 1,
    padding: 16,
    paddingLeft: 14,
  },
  inspectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  inspectionIdContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inspectionId: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  criticalBadge: {
    backgroundColor: '#EF4444',
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  inspectionLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  locationText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  inspectionFacility: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  facilityText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  inspectionFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dateTimeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginRight: 8,
  },
  timeText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  issuesContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  issuesText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#EF4444',
  },
  arrowContainer: {
    padding: 16,
  },

  // Bottom Spacing
  bottomSpacing: {
    height: 40,
  },
});

export default DashboardScreen;
