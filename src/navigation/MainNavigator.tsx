import React, { useCallback, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Home,
  ClipboardList,
  User,
  Plus, // Import Plus for the FAB
} from 'lucide-react-native';

// Import Screens
import DashboardScreen from '../screens/DashboardScreen';
import InspectionListScreen from '../screens/InspectionListScreen';
import ProfileScreen from '../screens/ProfileScreen';

// ============================================
// THEME & CONFIG
// ============================================
const COLORS = {
  background: '#0A0E17',
  primary: '#7C3AED',
  primaryDark: '#6D28D9',
  surfaceDark: '#0D1321',
  textMuted: '#64748B',
  tabBarBg: 'rgba(20, 27, 45, 0.95)',
  borderLight: 'rgba(255, 255, 255, 0.08)',
};

const TAB_BAR_HEIGHT = 70;
const TAB_BAR_MARGIN = 20;
const TAB_BAR_RADIUS = 25;

// ============================================
// TYPES & PLACEHOLDERS
// ============================================
export type MainTabParamList = {
  Home: undefined;
  Inspections: undefined;
  Profile: undefined;
};


// ============================================
// COMPONENT: TAB BUTTON (Standard)
// ============================================
const TabBarButton: React.FC<any> = ({ focused, onPress, icon: Icon, label }) => {
  const anim = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: focused ? 1 : 0,
      useNativeDriver: true,
      friction: 8,
    }).start();
  }, [focused]);

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -4],
  });

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.tabButton}>
      <Animated.View style={{ alignItems: 'center', transform: [{ translateY }] }}>
        <View style={styles.iconWrapper}>
          <Icon size={24} color={focused ? COLORS.primary : COLORS.textMuted} />
          {/* Active Dot */}
          <Animated.View style={[styles.activeDot, { opacity: anim, transform: [{ scale: anim }] }]} />
        </View>
        <Animated.Text style={[styles.tabLabel, { color: focused ? COLORS.primary : COLORS.textMuted }]}>
          {label}
        </Animated.Text>
      </Animated.View>
    </TouchableOpacity>
  );
};

// ============================================
// COMPONENT: ENHANCED TAB BAR WITH FAB
// ============================================
const EnhancedCustomTabBar: React.FC<BottomTabBarProps> = ({ state, descriptors, navigation }) => {
  const insets = useSafeAreaInsets();
  const fabScaleAnim = useRef(new Animated.Value(1)).current;
  
  const bottomPadding = Math.max(insets.bottom, 10);

  const tabConfig: Record<string, { icon: any; label: string }> = {
    Home: { icon: Home, label: 'Home' },
    Inspections: { icon: ClipboardList, label: 'List' }, // Shortened label
    Profile: { icon: User, label: 'Profile' },
  };

  const handleFabPress = useCallback(() => {
    // 1. Animate Button
    Animated.sequence([
      Animated.spring(fabScaleAnim, { toValue: 0.85, useNativeDriver: true }),
      Animated.spring(fabScaleAnim, { toValue: 1, useNativeDriver: true }),
    ]).start();

    // 2. Action: Navigate to ContractSign first, then to InspectionExecution after signing
    // Note: Since we are in the TabNavigator, we need to access the parent stack to navigate
    navigation.navigate('ContractSign' as any, { 
      nextScreen: 'InspectionExecution'
    }); 
    
  }, [fabScaleAnim, navigation]);

  return (
    <View style={[styles.tabBarWrapper, { paddingBottom: bottomPadding }]}>
      
      {/* --- FLOATING ACTION BUTTON (Center) --- */}
      <Animated.View style={[styles.fabContainer, { transform: [{ scale: fabScaleAnim }] }]}>
        <TouchableOpacity
          style={styles.fabButton}
          onPress={handleFabPress}
          activeOpacity={0.9}
        >
          <LinearGradient
            colors={[COLORS.primary, COLORS.primaryDark]}
            style={styles.fabGradient}
          >
            <Plus size={32} color="#FFFFFF" strokeWidth={3} />
          </LinearGradient>
        </TouchableOpacity>
        {/* Glow behind FAB */}
        <View style={styles.fabGlow} />
      </Animated.View>

      {/* --- TAB BAR BACKGROUND --- */}
      <View style={styles.tabBarContainer}>
        <View style={styles.glassBackground}>
          <LinearGradient
            colors={['rgba(124, 58, 237, 0.3)', 'transparent']}
            style={styles.topBorderGlow}
          />
        </View>

        {/* --- TAB BUTTONS --- */}
        <View style={styles.tabButtonsRow}>
          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key];
            const isFocused = state.index === index;
            const config = tabConfig[route.name];

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
            };

            // LOGIC: If this is the middle tab (Inspections), we render it differently
            // layout: [Home] [Spacer] [Spacer] [Profile] -> The FAB sits in the middle
            // To allow 3 tabs AND a FAB, we place "Inspections" slightly to the right or left?
            // BETTER UX: Keep 3 tabs evenly spaced, FAB floats *above* content, not blocking tabs.
            
            return (
              <View key={route.key} style={styles.tabItemWrapper}>
                 {/* Add spacing around the middle item to make room for FAB if needed */}
                 {index === 1 && <View style={{ width: 40 }} />} 
                 
                 <TabBarButton
                    focused={isFocused}
                    onPress={onPress}
                    icon={config.icon}
                    label={config.label}
                 />
                 
                 {index === 1 && <View style={{ width: 40 }} />} 
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
};

// ============================================
// MAIN NAVIGATOR EXPORT
// ============================================
const Tab = createBottomTabNavigator<MainTabParamList>();

const MainNavigator = () => {
  return (
    <Tab.Navigator
      tabBar={(props) => <EnhancedCustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Home" component={DashboardScreen} />
      <Tab.Screen name="Inspections" component={InspectionListScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
};

// ============================================
// STYLES
// ============================================
const styles = StyleSheet.create({
  tabBarWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: TAB_BAR_MARGIN,
    alignItems: 'center',
    pointerEvents: 'box-none', // Lets clicks pass through to content behind the wrapper space
  },
  tabBarContainer: {
    width: '100%',
    height: TAB_BAR_HEIGHT,
    borderRadius: TAB_BAR_RADIUS,
    overflow: 'hidden',
  },
  glassBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.tabBarBg,
    borderRadius: TAB_BAR_RADIUS,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  topBorderGlow: {
    height: 2,
    width: '100%',
    opacity: 0.5,
  },
  tabButtonsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between', // Spaced evenly
    paddingHorizontal: 10,
  },
  tabItemWrapper: {
    flexDirection: 'row', 
    alignItems: 'center'
  },
  tabButton: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    width: 60,
  },
  iconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 30,
  },
  activeDot: {
    position: 'absolute',
    bottom: -6,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
  },
  tabLabel: {
    fontSize: 10,
    marginTop: 4,
    fontWeight: '500',
  },
  
  // FAB Styles
  fabContainer: {
    position: 'absolute',
    top: -30, // Pushes it out of the bar
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: COLORS.background, // Creates a 'cutout' effect against the bar
    elevation: 10,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
  },
  fabGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabGlow: {
    position: 'absolute',
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: COLORS.primary,
    opacity: 0.2,
    zIndex: -1,
  },
});

export default MainNavigator;
