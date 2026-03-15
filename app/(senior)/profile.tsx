import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/contexts/AuthContext';

const DEEP_NAVY = '#0B1426';
const NAVY_CARD = '#111D35';
const NEON_GREEN = '#10B981';
const NEON_GREEN_DIM = 'rgba(16, 185, 129, 0.15)';
const WHITE = '#FFFFFF';
const GRAY_400 = '#9CA3AF';
const GRAY_500 = '#6B7280';

export default function SeniorProfile() {
  const { signOut } = useAuth();

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <View style={styles.content}>
        {/* Avatar */}
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>SR</Text>
          </View>
          <Text style={styles.name}>Senior Staff</Text>
          <Text style={styles.email}>senior@nexpec.com</Text>
          <View style={styles.roleBadge}>
            <Ionicons name="shield-checkmark" size={14} color={NEON_GREEN} />
            <Text style={styles.roleText}>Administrator</Text>
          </View>
        </View>

        {/* Info Cards */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Ionicons name="mail-outline" size={20} color={GRAY_400} />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Email</Text>
              <Text style={styles.infoValue}>senior@nexpec.com</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="person-outline" size={20} color={GRAY_400} />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Full Name</Text>
              <Text style={styles.infoValue}>Senior Staff</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="shield-checkmark-outline" size={20} color={GRAY_400} />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Role</Text>
              <Text style={styles.infoValue}>Administrator</Text>
            </View>
          </View>
        </View>

        {/* Sign Out */}
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={20} color="#EF4444" />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DEEP_NAVY,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 48 : 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: NEON_GREEN_DIM,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: WHITE,
    letterSpacing: -0.5,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  avatarContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: NEON_GREEN_DIM,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: NEON_GREEN,
  },
  avatarText: {
    color: NEON_GREEN,
    fontSize: 28,
    fontWeight: '800',
  },
  name: {
    color: WHITE,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  email: {
    color: GRAY_400,
    fontSize: 14,
    marginBottom: 12,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: NEON_GREEN_DIM,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  roleText: {
    color: NEON_GREEN,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoCard: {
    backgroundColor: NAVY_CARD,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    color: GRAY_500,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  infoValue: {
    color: WHITE,
    fontSize: 15,
    fontWeight: '500',
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    gap: 8,
  },
  signOutText: {
    color: '#EF4444',
    fontSize: 15,
    fontWeight: '600',
  },
});