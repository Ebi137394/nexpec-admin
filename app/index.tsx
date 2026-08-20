// app/index.tsx
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, View, Text, StyleSheet } from 'react-native';
import { useRouter, useRootNavigationState } from 'expo-router';
import { useAuth } from '@/src/contexts/AuthContext';

export default function Index() {
  const { session, role, loading } = useAuth();
  const router = useRouter();
  const navigationState = useRootNavigationState();

  // This acts as our "lock" so the redirect only happens ONCE
  const hasRedirected = useRef(false);

  // Reset the lock if they log out
  useEffect(() => {
    if (!session) {
      hasRedirected.current = false;
    }
  }, [session]);

  useEffect(() => {
    // 1. Wait for Expo Router to be fully ready
    if (!navigationState?.key) return;

    // 2. Wait for auth to load
    if (loading) return;

    // 3. If we already redirected them, DO NOTHING. (This stops the loop!)
    if (hasRedirected.current) return;

    // Lock the door!
    hasRedirected.current = true;

    // Not logged in? Send to login
    if (!session) {
      router.replace('/(auth)/sign-in');
      return;
    }

    // Logged in? Route by exactly your role logic
    console.log('Current user role:', role);
    
    if (role === 'admin' || role === 'super_admin') {
      router.replace('/(admin)/dashboard');
    } else if (role === 'client') {
      router.replace('/(tabs)/client-dashboard');
    } else if (role === 'inspector') {
      router.replace('/(tabs)');
    } else if (role === 'agency') {
      router.replace('/(tabs)/agency-dashboard');
    } else if (role === 'enterprise') {
      // Enterprise is an organization BUYER. It previously fell through to the
      // else branch and was routed to the inspector dashboard with an "Unknown
      // role" warning, so an enterprise buyer could not reach its own finance
      // surfaces on mobile at all. enterprise-dashboard.tsx already existed.
      router.replace('/(tabs)/enterprise-dashboard');
    } else {
      console.warn('Unknown role detected:', role, 'Routing to inspector dashboard');
      router.replace('/(tabs)');
    }

  }, [loading, session, role, navigationState?.key]);

  // While it calculates, show your exact loading screen
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#10B981" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: '#0B1426' 
  }
});