import 'react-native-url-polyfill/auto'; // ✅ Must be first line here
import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { StripeProvider } from '@stripe/stripe-react-native';
import { AuthProvider, useAuth } from '@/src/contexts/AuthContext';
import { ThemeProvider, useTheme } from '@/providers/ThemeProvider';
import { getColors } from '@/src/constants/theme';
import '../global.css';

// ✅ ۱. ایمپورت کردن سیستم زبان (که در مرحله قبل ساختی)
import { LanguageProvider } from '@/src/i18n/LanguageProvider';

// =============================================================================
// AUTH GATE - هندل کردن روتینگ و جلوگیری از پرش‌های ناگهانی
// =============================================================================

function AuthGate() {
  const { session, loading, role } = useAuth();
  const { isDarkMode } = useTheme();
  const segments = useSegments();
  const router = useRouter();
  const isAuthenticated = !!session;
  const colors = getColors(isDarkMode);
  
  // Use a more robust approach to ensure navigation is ready
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Wait for both auth and navigation to be ready
    if (!loading) {
      const timer = setTimeout(() => {
        setIsReady(true);
      }, 100); // Increased delay for better stability
      
      return () => clearTimeout(timer);
    }
  }, [loading]);

  useEffect(() => {
    if (!isReady || loading) return;

    const inAuthGroup = segments[0] === 'auth' || segments[0] === '(auth)';
    const inSeniorGroup = segments[0] === '(senior)';
    const inTabsGroup = segments[0] === '(tabs)';
    const inProfileGroup = segments[0] === 'profile' || segments.includes('edit-profile');

    // Not authenticated → send to login
    if (!isAuthenticated) {
      if (!inAuthGroup) {
        try {
          router.replace('/auth/sign-in');
        } catch (error) {
          console.warn('Navigation error:', error);
        }
      }
      return;
    }

    // Authenticated but still on auth screens → route by role
    if (inAuthGroup && role) {
      try {
        if (role === 'admin') {
          router.replace('/(senior)/inbox');
        } else if (role === 'agency' || role === 'enterprise') {
          router.replace('/(tabs)/agency-dashboard');
        } else if (role === 'client') {
          router.replace('/(tabs)/client-dashboard');
        } else {
          router.replace('/(tabs)');
        }
      } catch (error) {
        console.warn('Navigation error:', error);
      }
      return;
    }

    // RBAC Guard: Inspector trying to access senior routes
    if (inSeniorGroup && role === 'inspector') {
      try {
        router.replace('/(tabs)/dashboard');
      } catch (error) {
        console.warn('Navigation error:', error);
      }
      return;
    }

    // Profile routes are allowed for all authenticated users
    if (inProfileGroup) return;

    // 🔴 Define allowed routes that should bypass default dashboard routing
    const isAllowedRoute = segments[0] === 'chat' || segments[0] === 'submit-report' || segments[0] === 'payment-screen';

    // Default to tabs dashboard for authenticated users
    // 🔴 Add !isAllowedRoute condition to prevent routing away from allowed routes
    if (isAuthenticated && !inTabsGroup && !inSeniorGroup && !inProfileGroup && !isAllowedRoute) {
      try {
        if (role === 'admin') {
          router.replace('/(senior)/inbox');
        } else if (role === 'agency' || role === 'enterprise') {
          // Route agency and enterprise users to agency dashboard
          router.replace('/(tabs)/agency-dashboard');
        } else if (role === 'client') {
          // Route client users to client dashboard
          router.replace('/(tabs)/client-dashboard');
        } else {
          // Default fallback for other roles
          router.replace('/(tabs)');
        }
      } catch (error) {
        console.warn('Navigation error:', error);
      }
      return;
    }
  }, [isAuthenticated, loading, segments, role, router, isReady]);

  if (loading || !isReady) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Slot />
    </View>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      {/* ✅ ۲. کل برنامه را اینجا با LanguageProvider بغل می‌کنیم */}
      <LanguageProvider>
        <AuthProvider>
          <StripeProvider
            publishableKey="pk_test_51SkICRL9uHtRspTiLLEeg3YLMBY9MTMIR5BbylbYFBzu7UmjoVs1BLoFUkik0DRjIPh7k7t52aXPjqwVWN2vyvWO00h8sfZE9h"
            merchantIdentifier="com.nexpec.app"
            urlScheme="nexpec"
          >
            <AuthGate />
          </StripeProvider>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: '#FFFFFF' 
  },
});