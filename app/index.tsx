// app/index.tsx
import { ActivityIndicator, View, Text } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/src/contexts/AuthContext';

export default function Index() {
  const { session, role, loading } = useAuth();

  // 1. Wait for auth to load
  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0B1426' }}>
        <ActivityIndicator size="large" color="#10B981" />
      </View>
    );
  }

  // 2. Not logged in? Send to login
  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  // 3. Logged in? Route by role using declarative redirects
  // Debug: Log the role to console for troubleshooting
  console.log('Current user role:', role);
  
  // Handle admin role (for senior workspace)
  if (role === 'admin') {
    return <Redirect href="/(senior)/inbox" />;
  }
  
  // Handle client role (for client dashboard)
  if (role === 'client') {
    return <Redirect href="/(tabs)/client-dashboard" />;
  }
  
  // Handle inspector role (for inspector dashboard)
  if (role === 'inspector') {
    return <Redirect href="/(tabs)" />;
  }

  // Fallback for unknown roles - route to inspector dashboard
  console.warn('Unknown role detected:', role, 'Routing to inspector dashboard');
  return <Redirect href="/(tabs)" />;
}
