import React, { ReactNode } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useAuth } from '@/src/contexts/AuthContext';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface RoleContentProps {
  children: ReactNode;
  role: 'inspector' | 'client' | 'admin';
  fallback?: ReactNode;
}

/**
 * RoleContent - A wrapper component to conditionally render content based on user role.
 * Usage:
 * <RoleContent role="client">
 *   <Text>Only visible to Clients</Text>
 * </RoleContent>
 */
export function RoleContent({ children, role, fallback = null }: RoleContentProps): JSX.Element | null {
  const { user } = useAuth();

  // If no user is logged in, show nothing or fallback
  if (!user) return <>{fallback}</>;

  // Check role match based on user.role
  const hasAccess = user.role === role;

  if (hasAccess) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}

/**
 * ClientOnly - Specialized wrapper for client-only features
 */
export function ClientOnly({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const { user } = useAuth();
  return user?.role === 'client' ? <>{children}</> : <>{fallback}</>;
}

/**
 * InspectorOnly - Specialized wrapper for inspector-only features
 */
export function InspectorOnly({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const { user } = useAuth();
  return user?.role === 'inspector' ? <>{children}</> : <>{fallback}</>;
}

// =============================================================================
// EXAMPLE USAGE COMPONENT (For testing purposes)
// =============================================================================

export default function RoleBasedExample() {
  return (
    <View style={styles.container}>
      <ClientOnly>
        <View style={styles.clientBox}>
          <Text style={styles.text}>💼 This section is ONLY for Clients</Text>
        </View>
      </ClientOnly>

      <InspectorOnly>
        <View style={styles.inspectorBox}>
          <Text style={styles.text}>👷 This section is ONLY for Inspectors</Text>
        </View>
      </InspectorOnly>
      
      <RoleContent role="admin" fallback={<Text>Not an Admin</Text>}>
        <Text>🛡️ Admin Controls Enabled</Text>
      </RoleContent>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  clientBox: { padding: 16, backgroundColor: '#E0F7FA', borderRadius: 12, borderWidth: 1, borderColor: '#0891B2' },
  inspectorBox: { padding: 16, backgroundColor: '#E8F2FF', borderRadius: 12, borderWidth: 1, borderColor: '#007AFF' },
  text: { fontWeight: '600', fontSize: 14 }
});

