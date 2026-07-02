import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  Animated,
  Dimensions,
  StatusBar,
  Platform,
  Vibration,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Swipeable,
  GestureHandlerRootView,
  RectButton,
} from 'react-native-gesture-handler';
import {
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Info,
  ClipboardCheck,
  Settings,
  BellOff,
  CheckCircle2,
  Trash2,
} from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';

// ============================================
// TYPES & INTERFACES
// ============================================

type NotificationType = 'alert' | 'info' | 'task' | 'system';
type NotificationPriority = 'high' | 'medium' | 'low';

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  time: Date;
  isRead: boolean;
  priority: NotificationPriority;
  targetScreen?: keyof RootStackParamList;
  targetParams?: Record<string, any>;
}

interface NotificationSection {
  title: string;
  data: Notification[];
}

// ============================================
// THEME CONSTANTS
// ============================================

const THEME = {
  // Primary Colors
  darkBg: '#0A0E17',
  neonCyan: '#7C3AED',
  
  // Surface Colors
  surfaceDark: '#0D1520',
  surfaceLight: '#141B2B',
  cardBg: '#161E2E',
  
  // Text Colors
  textPrimary: '#FFFFFF',
  textSecondary: '#8B95A5',
  textMuted: '#5A6577',
  
  // Accent Colors
  alertRed: '#FF4757',
  warningOrange: '#FFA502',
  successGreen: '#2ED573',
  infoBlue: '#3498DB',
  
  // Gradient helpers
  cyanGlow: 'rgba(124, 58, 237, 0.15)',
  cyanGlowIntense: 'rgba(124, 58, 237, 0.3)',
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_ACTION_WIDTH = 80;

// ============================================
// MOCK DATA
// ============================================

const generateMockNotifications = (): Notification[] => [
  {
    id: '1',
    type: 'alert',
    title: 'Critical Inspection Required',
    body: 'Unit #A-2847 has exceeded the safety threshold. Immediate attention required.',
    time: new Date(Date.now() - 2 * 60 * 1000), // 2 minutes ago
    isRead: false,
    priority: 'high',
    targetScreen: 'InspectionDetail',
    targetParams: { inspectionId: 'INS-2847' },
  },
  {
    id: '2',
    type: 'task',
    title: 'New Task Assigned',
    body: 'You have been assigned to inspect Sector B equipment.',
    time: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago
    isRead: false,
    priority: 'medium',
    targetScreen: 'InspectionDetail',
    targetParams: { inspectionId: 'INS-001' },
  },
  {
    id: '3',
    type: 'info',
    title: 'Inspection Completed',
    body: 'Your inspection report for Unit #C-1923 has been submitted successfully.',
    time: new Date(Date.now() - 45 * 60 * 1000), // 45 minutes ago
    isRead: false,
    priority: 'low',
    targetScreen: 'InspectionDetail',
    targetParams: { inspectionId: 'INS-1923' },
  },
  {
    id: '4',
    type: 'system',
    title: 'System Maintenance',
    body: 'Scheduled maintenance window: Tomorrow 2:00 AM - 4:00 AM EST.',
    time: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    isRead: true,
    priority: 'low',
  },
  {
    id: '5',
    type: 'alert',
    title: 'Anomaly Detected',
    body: 'Unusual readings detected in Pipeline Section 7. Review recommended.',
    time: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 hours ago
    isRead: true,
    priority: 'medium',
    targetScreen: 'InspectionDetail',
    targetParams: { inspectionId: 'INS-7001' },
  },
  {
    id: '6',
    type: 'task',
    title: 'Task Deadline Approaching',
    body: 'Quarterly equipment review due in 2 days.',
    time: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
    isRead: true,
    priority: 'medium',
    targetScreen: 'InspectionDetail',
    targetParams: { inspectionId: 'INS-002' },
  },
  {
    id: '7',
    type: 'info',
    title: 'Report Available',
    body: 'Your weekly inspection summary is now available for download.',
    time: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    isRead: true,
    priority: 'low',
  },
  {
    id: '8',
    type: 'system',
    title: 'App Update Available',
    body: 'Version 2.5.0 is now available with new features and improvements.',
    time: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
    isRead: true,
    priority: 'low',
  },
];

// ============================================
// UTILITY FUNCTIONS
// ============================================

const formatTimeAgo = (date: Date): string => {
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return 'Just now';
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes}m ago`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours}h ago`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) {
    return `${diffInDays}d ago`;
  }

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const getNotificationIcon = (type: NotificationType) => {
  switch (type) {
    case 'alert':
      return AlertTriangle;
    case 'info':
      return Info;
    case 'task':
      return ClipboardCheck;
    case 'system':
      return Settings;
    default:
      return BellOff;
  }
};

const getNotificationColor = (type: NotificationType, priority: NotificationPriority): string => {
  if (priority === 'high') return THEME.alertRed;
  
  switch (type) {
    case 'alert':
      return THEME.warningOrange;
    case 'info':
      return THEME.infoBlue;
    case 'task':
      return THEME.successGreen;
    case 'system':
      return THEME.textSecondary;
    default:
      return THEME.neonCyan;
  }
};

// ============================================
// COMPONENTS
// ============================================

// Header Component
interface HeaderProps {
  onBack: () => void;
  onMarkAllRead: () => void;
  hasUnread: boolean;
}

const Header: React.FC<HeaderProps> = ({ onBack, onMarkAllRead, hasUnread }) => {
  return (
    <View style={styles.header}>
      <TouchableOpacity 
        style={styles.backButton} 
        onPress={onBack}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <ChevronLeft size={24} color={THEME.textPrimary} />
      </TouchableOpacity>
      
      <Text style={styles.headerTitle}>Notifications</Text>
      
      <TouchableOpacity 
        style={[styles.markReadButton, !hasUnread && styles.markReadButtonDisabled]}
        onPress={onMarkAllRead}
        disabled={!hasUnread}
      >
        <Text style={[
          styles.markReadText,
          !hasUnread && styles.markReadTextDisabled
        ]}>
          Mark all as read
        </Text>
      </TouchableOpacity>
    </View>
  );
};

// Notification Item Component
interface NotificationItemProps {
  notification: Notification;
  onPress: (notification: Notification) => void;
  onDismiss: (id: string) => void;
}

const NotificationItem: React.FC<NotificationItemProps> = ({
  notification,
  onPress,
  onDismiss,
}) => {
  const swipeableRef = useRef<Swipeable>(null);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  
  const IconComponent = getNotificationIcon(notification.type);
  const iconColor = getNotificationColor(notification.type, notification.priority);

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.98,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 50,
        useNativeDriver: true,
      }),
    ]).start();
    
    onPress(notification);
  };

  const handleDismiss = () => {
    if (Platform.OS === 'ios') {
      Vibration.vibrate(50);
    } else {
      Vibration.vibrate(50);
    }
    swipeableRef.current?.close();
    onDismiss(notification.id);
  };

  const renderRightActions = (
    progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>
  ) => {
    const translateX = dragX.interpolate({
      inputRange: [-SWIPE_ACTION_WIDTH, 0],
      outputRange: [0, SWIPE_ACTION_WIDTH],
      extrapolate: 'clamp',
    });

    const opacity = dragX.interpolate({
      inputRange: [-SWIPE_ACTION_WIDTH, -20, 0],
      outputRange: [1, 0.8, 0],
      extrapolate: 'clamp',
    });

    return (
      <Animated.View 
        style={[
          styles.swipeActionContainer,
          { transform: [{ translateX }], opacity }
        ]}
      >
        <RectButton style={styles.deleteAction} onPress={handleDismiss}>
          <Trash2 size={22} color={THEME.textPrimary} />
          <Text style={styles.deleteActionText}>Delete</Text>
        </RectButton>
      </Animated.View>
    );
  };

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      rightThreshold={40}
      friction={2}
      overshootRight={false}
    >
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <TouchableOpacity
          style={[
            styles.notificationItem,
            !notification.isRead && styles.notificationItemUnread,
          ]}
          onPress={handlePress}
          activeOpacity={0.7}
        >
          {/* Unread Indicator */}
          {!notification.isRead && (
            <View style={styles.unreadIndicator}>
              <View style={styles.unreadDot} />
            </View>
          )}

          {/* Icon Container */}
          <View style={[styles.iconContainer, { backgroundColor: `${iconColor}20` }]}>
            <IconComponent size={22} color={iconColor} />
          </View>

          {/* Content */}
          <View style={styles.contentContainer}>
            <View style={styles.contentHeader}>
              <Text 
                style={[
                  styles.notificationTitle,
                  !notification.isRead && styles.notificationTitleUnread
                ]} 
                numberOfLines={1}
              >
                {notification.title}
              </Text>
              <Text style={styles.timeText}>{formatTimeAgo(notification.time)}</Text>
            </View>
            <Text style={styles.notificationBody} numberOfLines={2}>
              {notification.body}
            </Text>
          </View>

          {/* Chevron for actionable items */}
          {notification.targetScreen && (
            <ChevronRight 
              size={18} 
              color={THEME.textMuted} 
              style={styles.chevronIcon}
            />
          )}
        </TouchableOpacity>
      </Animated.View>
    </Swipeable>
  );
};

// Section Header Component
interface SectionHeaderProps {
  title: string;
  count: number;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ title, count }) => (
  <View style={styles.sectionHeader}>
    <Text style={styles.sectionTitle}>{title}</Text>
    <View style={styles.countBadge}>
      <Text style={styles.countText}>{count}</Text>
    </View>
  </View>
);

// Empty State Component
const EmptyState: React.FC = () => {
  const bounceAnim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(bounceAnim, {
          toValue: -10,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(bounceAnim, {
          toValue: 0,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [bounceAnim]);

  return (
    <View style={styles.emptyStateContainer}>
      <Animated.View 
        style={[
          styles.emptyIconContainer,
          { transform: [{ translateY: bounceAnim }] }
        ]}
      >
        {/* Sleeping Bell Illustration */}
        <View style={styles.sleepingBellContainer}>
          <BellOff size={60} color={THEME.neonCyan} />
          {/* Zzz animation */}
          <View style={styles.zzzContainer}>
            <Text style={[styles.zzzText, styles.zzz1]}>z</Text>
            <Text style={[styles.zzzText, styles.zzz2]}>z</Text>
            <Text style={[styles.zzzText, styles.zzz3]}>z</Text>
          </View>
        </View>
        
        {/* Checkmark overlay */}
        <View style={styles.checkmarkOverlay}>
          <CheckCircle2 size={30} color={THEME.successGreen} />
        </View>
      </Animated.View>
      
      <Text style={styles.emptyStateTitle}>You're all caught up!</Text>
      <Text style={styles.emptyStateSubtitle}>
        No new notifications at the moment.{'\n'}We'll let you know when something needs your attention.
      </Text>
      
      {/* Decorative glow effect */}
      <View style={styles.glowEffect} />
    </View>
  );
};

// ============================================
// MAIN SCREEN COMPONENT
// ============================================

const NotificationsScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [notifications, setNotifications] = useState<Notification[]>(
    generateMockNotifications()
  );

  // Organize notifications into sections
  const sections: NotificationSection[] = React.useMemo(() => {
    const newNotifications = notifications.filter(n => !n.isRead);
    const earlierNotifications = notifications.filter(n => n.isRead);

    const result: NotificationSection[] = [];
    
    if (newNotifications.length > 0) {
      result.push({ title: 'New', data: newNotifications });
    }
    
    if (earlierNotifications.length > 0) {
      result.push({ title: 'Earlier', data: earlierNotifications });
    }

    return result;
  }, [notifications]);

  const hasUnread = React.useMemo(
    () => notifications.some(n => !n.isRead),
    [notifications]
  );

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleMarkAllRead = useCallback(() => {
    if (Platform.OS === 'ios') {
      Vibration.vibrate(30);
    } else {
      Vibration.vibrate(30);
    }
    setNotifications(prev =>
      prev.map(notification => ({ ...notification, isRead: true }))
    );
  }, []);

  const handleNotificationPress = useCallback((notification: Notification) => {
    // Mark as read
    setNotifications(prev =>
      prev.map(n =>
        n.id === notification.id ? { ...n, isRead: true } : n
      )
    );

    // Navigate to target screen if specified
    if (notification.targetScreen) {
      navigation.navigate(notification.targetScreen as any, notification.targetParams);
    }
  }, [navigation]);

  const handleDismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Notification }) => (
      <NotificationItem
        notification={item}
        onPress={handleNotificationPress}
        onDismiss={handleDismiss}
      />
    ),
    [handleNotificationPress, handleDismiss]
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: NotificationSection }) => (
      <SectionHeader title={section.title} count={section.data.length} />
    ),
    []
  );

  const keyExtractor = useCallback((item: Notification) => item.id, []);

  const ItemSeparatorComponent = useCallback(
    () => <View style={styles.separator} />,
    []
  );

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={THEME.darkBg} />
        
        <Header
          onBack={handleBack}
          onMarkAllRead={handleMarkAllRead}
          hasUnread={hasUnread}
        />

        {notifications.length === 0 ? (
          <EmptyState />
        ) : (
          <SectionList
            sections={sections}
            renderItem={renderItem}
            renderSectionHeader={renderSectionHeader}
            keyExtractor={keyExtractor}
            ItemSeparatorComponent={ItemSeparatorComponent}
            stickySectionHeadersEnabled={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            style={styles.list}
          />
        )}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
};

// ============================================
// STYLES
// ============================================

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: THEME.darkBg,
  },
  
  // Header Styles
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: THEME.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: THEME.textPrimary,
    letterSpacing: 0.3,
  },
  markReadButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  markReadButtonDisabled: {
    opacity: 0.5,
  },
  markReadText: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME.neonCyan,
  },
  markReadTextDisabled: {
    color: THEME.textMuted,
  },

  // List Styles
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
  },

  // Section Header Styles
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    backgroundColor: THEME.darkBg,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: THEME.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  countBadge: {
    marginLeft: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: THEME.surfaceLight,
  },
  countText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.textSecondary,
  },

  // Notification Item Styles
  notificationItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: THEME.darkBg,
    position: 'relative',
  },
  notificationItemUnread: {
    backgroundColor: 'rgba(124, 58, 237, 0.03)',
  },
  unreadIndicator: {
    position: 'absolute',
    left: 8,
    top: 26,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: THEME.neonCyan,
    shadowColor: THEME.neonCyan,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 4,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  contentContainer: {
    flex: 1,
  },
  contentHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  notificationTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: THEME.textPrimary,
    marginRight: 8,
    lineHeight: 20,
  },
  notificationTitleUnread: {
    fontWeight: '700',
  },
  timeText: {
    fontSize: 12,
    fontWeight: '500',
    color: THEME.textMuted,
  },
  notificationBody: {
    fontSize: 14,
    color: THEME.textSecondary,
    lineHeight: 20,
    marginTop: 2,
  },
  chevronIcon: {
    marginLeft: 8,
    marginTop: 2,
  },

  // Swipe Action Styles
  swipeActionContainer: {
    width: SWIPE_ACTION_WIDTH,
    flexDirection: 'row',
  },
  deleteAction: {
    flex: 1,
    backgroundColor: THEME.alertRed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteActionText: {
    fontSize: 11,
    fontWeight: '600',
    color: THEME.textPrimary,
    marginTop: 4,
  },

  // Separator
  separator: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    marginLeft: 78,
    marginRight: 20,
  },

  // Empty State Styles
  emptyStateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    position: 'relative',
  },
  emptyIconContainer: {
    position: 'relative',
    marginBottom: 32,
  },
  sleepingBellContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: THEME.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(124, 58, 237, 0.2)',
  },
  zzzContainer: {
    position: 'absolute',
    top: -10,
    right: -15,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  zzzText: {
    fontWeight: '700',
    fontStyle: 'italic',
    color: THEME.neonCyan,
  },
  zzz1: {
    fontSize: 12,
    opacity: 0.5,
  },
  zzz2: {
    fontSize: 16,
    opacity: 0.7,
    marginLeft: 2,
  },
  zzz3: {
    fontSize: 20,
    opacity: 0.9,
    marginLeft: 2,
  },
  checkmarkOverlay: {
    position: 'absolute',
    bottom: -5,
    right: -5,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: THEME.darkBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: THEME.successGreen,
  },
  emptyStateTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: THEME.textPrimary,
    textAlign: 'center',
    marginBottom: 12,
  },
  emptyStateSubtitle: {
    fontSize: 15,
    color: THEME.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  glowEffect: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: THEME.cyanGlow,
    opacity: 0.3,
    top: '30%',
  },
});

export default NotificationsScreen;
