// src/navigation/AppNavigator.tsx

import React from 'react';
import { Platform } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import {
  createNativeStackNavigator,
  NativeStackNavigationOptions,
} from '@react-navigation/native-stack';

// Import types
import { RootStackParamList } from './types';

// Import screens
import SplashScreen from '../screens/SplashScreen';
import LoginScreen from '../screens/LoginScreen';
import InspectionDetailScreen from '../screens/InspectionDetailScreen';
import InspectionExecutionScreen from '../screens/InspectionExecutionScreen';
import InspectionSuccessScreen from '../screens/InspectionSuccessScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import ReportViewerScreen from '../screens/ReportViewerScreen';
import EquipmentScreen from '../screens/EquipmentScreen';
import ContractSignScreen from '../screens/ContractSignScreen';
import ExpenseTrackerScreen from '../screens/ExpenseTrackerScreen';
import AssetScannerScreen from '../screens/AssetScannerScreen';
import MainNavigator from './MainNavigator';

// Import theme
import { COLORS } from '../constants/theme';

// Create the stack navigator
const Stack = createNativeStackNavigator<RootStackParamList>();

// ============================================
// CUSTOM THEME FOR NAVIGATION
// ============================================
const NexpecNavigationTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    primary: COLORS.primary,
    background: COLORS.background,
    card: COLORS.surface,
    text: COLORS.text,
    border: COLORS.border,
    notification: COLORS.primary,
  },
};

// ============================================
// CUSTOM TRANSITION ANIMATIONS
// ============================================

// Fade transition configuration
const fadeTransition: NativeStackNavigationOptions = {
  animation: 'fade',
  animationDuration: 500,
};

// Slide from right (default-like but customized)
const slideTransition: NativeStackNavigationOptions = {
  animation: 'slide_from_right',
  animationDuration: 300,
};

// Fade from bottom (for modals)
const modalTransition: NativeStackNavigationOptions = {
  animation: 'fade_from_bottom',
  animationDuration: 350,
  presentation: 'modal',
};

// Custom iOS-style transition
const customTransition: NativeStackNavigationOptions = {
  animation: 'ios',
  animationDuration: 350,
};

// ============================================
// DEFAULT SCREEN OPTIONS
// ============================================
const defaultScreenOptions: NativeStackNavigationOptions = {
  headerShown: false,
  contentStyle: {
    backgroundColor: COLORS.background,
  },
  // Gesture settings
  gestureEnabled: true,
  fullScreenGestureEnabled: true,
  // Animation
  animation: 'fade',
  animationDuration: 400,
  // Status bar
  statusBarStyle: 'light',
  statusBarColor: COLORS.background,
  statusBarAnimation: 'fade',
};

// ============================================
// APP NAVIGATOR COMPONENT
// ============================================
const AppNavigator: React.FC = () => {
  return (
    <NavigationContainer theme={NexpecNavigationTheme}>
      <Stack.Navigator
        initialRouteName="Splash"
        screenOptions={defaultScreenOptions}
      >
        {/* ========== SPLASH SCREEN ========== */}
        <Stack.Screen
          name="Splash"
          component={SplashScreen}
          options={{
            headerShown: false,
            animation: 'none', // No animation for initial screen
            gestureEnabled: false, // Prevent going back from splash
          }}
        />

        {/* ========== LOGIN SCREEN ========== */}
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{
            headerShown: false,
            animation: 'fade', // Smooth fade from splash
            animationDuration: 600,
            gestureEnabled: false, // Prevent going back to splash
          }}
        />

        {/* ========== MAIN NAVIGATOR (TAB BAR) ========== */}
        <Stack.Screen
          name="Main"
          component={MainNavigator}
          options={{
            headerShown: false,
            animation: 'fade', // فید نرم از لاگین به اپ اصلی
          }}
        />

        {/* ========== INSPECTION DETAIL SCREEN ========== */}
        <Stack.Screen
          name="InspectionDetail"
          component={InspectionDetailScreen}
          options={{
            headerShown: false,
            animation: 'slide_from_right',
          }}
        />

        {/* ========== INSPECTION EXECUTION SCREEN ========== */}
        <Stack.Screen
          name="InspectionExecution"
          component={InspectionExecutionScreen}
          options={{
            headerShown: false,
            animation: 'slide_from_bottom', // Feels like opening a workbook
          }}
        />

        {/* ========== INSPECTION SUCCESS SCREEN ========== */}
        <Stack.Screen
          name="InspectionSuccess"
          component={InspectionSuccessScreen}
          options={{
            headerShown: false,
            animation: 'fade',
            gestureEnabled: false, // Prevent going back
          }}
        />

        {/* ========== PROFILE SCREEN ========== */}
        <Stack.Screen
          name="Profile"
          component={ProfileScreen}
          options={{
            headerShown: false,
            animation: 'slide_from_right',
          }}
        />

        {/* ========== NOTIFICATIONS SCREEN ========== */}
        <Stack.Screen
          name="Notifications"
          component={NotificationsScreen}
          options={{
            headerShown: false,
            animation: 'slide_from_right',
          }}
        />

        {/* ========== REPORT VIEWER SCREEN ========== */}
        <Stack.Screen
          name="ReportViewer"
          component={ReportViewerScreen}
          options={{
            headerShown: false,
            animation: 'slide_from_bottom',
            presentation: 'modal',
          }}
        />

        {/* ========== EQUIPMENT SCREEN ========== */}
        <Stack.Screen
          name="Equipment"
          component={EquipmentScreen}
          options={{
            headerShown: false,
            animation: 'slide_from_right',
          }}
        />

        {/* ========== CONTRACT SIGN SCREEN ========== */}
        <Stack.Screen
          name="ContractSign"
          component={ContractSignScreen}
          options={{
            headerShown: false,
            animation: 'slide_from_bottom',
          }}
        />

        {/* ========== EXPENSE TRACKER SCREEN ========== */}
        <Stack.Screen
          name="Expenses"
          component={ExpenseTrackerScreen}
          options={{
            headerShown: false,
            animation: 'slide_from_bottom',
          }}
        />

        {/* ========== ASSET SCANNER SCREEN ========== */}
        <Stack.Screen
          name="AssetScanner"
          component={AssetScannerScreen}
          options={{
            headerShown: false,
            animation: 'fade', // Fade feels more like opening a camera
            presentation: 'fullScreenModal',
          }}
        />

        {/* ========== FUTURE SCREENS (commented for now) ========== */}
        {/*
        <Stack.Screen
          name="SignUp"
          component={SignUpScreen}
          options={{
            headerShown: false,
            animation: 'slide_from_right',
          }}
        />

        <Stack.Screen
          name="ForgotPassword"
          component={ForgotPasswordScreen}
          options={{
            headerShown: true,
            headerTitle: 'Reset Password',
            headerStyle: {
              backgroundColor: COLORS.background,
            },
            headerTintColor: COLORS.text,
            animation: 'slide_from_bottom',
            presentation: 'modal',
          }}
        />

        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{
            headerShown: false,
            animation: 'fade',
            gestureEnabled: false,
          }}
        />
        */}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;
