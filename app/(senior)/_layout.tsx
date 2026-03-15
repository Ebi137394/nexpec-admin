import { Tabs, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/contexts/AuthContext';

const DEEP_NAVY = '#0B1426';
const NAVY_LIGHT = '#111D35';
const NEON_GREEN = '#10B981';
const MUTED_GRAY = '#4B5563';
const WHITE = '#FFFFFF';

export default function SeniorLayout() {
  const { role, loading } = useAuth();
  const router = useRouter();

  // Extra client-side guard
  useEffect(() => {
    if (loading) return;
    if (role === 'inspector') {
      Alert.alert('Access Denied', 'Inspectors cannot access the Senior workspace.');
      router.replace('/(tabs)/dashboard');
    }
  }, [role, loading]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: NEON_GREEN,
        tabBarInactiveTintColor: MUTED_GRAY,
        tabBarStyle: {
          backgroundColor: NAVY_LIGHT,
          borderTopColor: 'rgba(16, 185, 129, 0.15)',
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingBottom: Platform.OS === 'ios' ? 28 : 8,
          paddingTop: 8,
          elevation: 20,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.3,
          shadowRadius: 12,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          letterSpacing: 0.3,
        },
        tabBarIconStyle: {
          marginBottom: -2,
        },
      }}
    >
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}