import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Lock,
  CreditCard,
  Globe,
  FileText,
  Info,
  ChevronRight,
  Bell,
  Shield,
  HelpCircle,
  LogOut,
  Smartphone,
  Briefcase,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

interface SettingItem {
  id: string;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onPress: () => void;
  showBadge?: boolean;
  badgeText?: string;
  destructive?: boolean;
}

interface SettingsSection {
  title: string;
  items: SettingItem[];
}

export default function SettingsScreen() {
  const router = useRouter();
  const { signOut } = useAuth();

  const showComingSoon = (feature: string) => {
    Alert.alert(
      'Coming Soon',
      `${feature} will be available in a future update.`,
      [{ text: 'OK', style: 'default' }]
    );
  };

  const handleLogout = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Sign Out', 
          style: 'destructive',
          onPress: async () => {
            await signOut();
            // Canonical NEXPEC sign-in (cyan, SSO/Enterprise). /auth was a
            // legacy duplicate landing on an off-theme orange screen.
            router.replace('/(auth)/sign-in');
          }
        },
      ]
    );
  };

  const settingsSections: SettingsSection[] = [
    {
      title: 'Account',
      items: [
        {
          id: 'password',
          icon: <Lock size={22} color="#00D4AA" />,
          title: 'Change Password',
          subtitle: 'Update your account password',
          onPress: () => showComingSoon('Change Password'),
        },
        {
          id: 'payment',
          icon: <CreditCard size={22} color="#3B82F6" />,
          title: 'Payment Methods',
          subtitle: 'Manage payout & billing',
          onPress: () => showComingSoon('Payment Methods'),
        },
        {
          id: 'security',
          icon: <Shield size={22} color="#8B5CF6" />,
          title: 'Security',
          subtitle: '2FA & Login Activity',
          onPress: () => showComingSoon('Security Settings'),
        },
      ],
    },
    {
      title: 'Preferences',
      items: [
        {
          id: 'notifications',
          icon: <Bell size={22} color="#F59E0B" />,
          title: 'Notifications',
          subtitle: 'Job alerts & messages',
          onPress: () => showComingSoon('Notifications Settings'),
        },
      ],
    },
    {
      title: 'Support',
      items: [
        {
          id: 'help',
          icon: <HelpCircle size={22} color="#EC4899" />,
          title: 'Help Center',
          subtitle: 'FAQs and support',
          onPress: () => showComingSoon('Help Center'),
        },
        {
          id: 'terms',
          icon: <FileText size={22} color="#94A3B8" />,
          title: 'Terms of Service',
          subtitle: 'Legal information',
          onPress: () => router.push('/profile/terms' as any),
        },
        {
          id: 'about',
          icon: <Info size={22} color="#7C3AED" />,
          title: 'About NEXPEC',
          subtitle: 'Version 1.0.0',
          onPress: () => showComingSoon('About'),
        },
      ],
    },
    {
      title: '',
      items: [
        {
          id: 'logout',
          icon: <LogOut size={22} color="#EF4444" />,
          title: 'Sign Out',
          onPress: handleLogout,
          destructive: true,
        },
      ],
    },
  ];

  const renderSettingItem = (item: SettingItem, index: number, sectionIndex: number) => (
    <Animated.View
      key={item.id}
      entering={FadeInDown.delay((sectionIndex * 100) + (index * 50)).duration(400)}
    >
      <TouchableOpacity
        testID={`settings-item-${item.id}`}
        style={[
          styles.settingItem,
          item.destructive && styles.destructiveItem,
        ]}
        onPress={item.onPress}
        activeOpacity={0.7}
      >
        <View style={[
          styles.iconContainer,
          item.destructive && styles.destructiveIconContainer,
        ]}>
          {item.icon}
        </View>
        
        <View style={styles.settingContent}>
          <Text style={[
            styles.settingTitle,
            item.destructive && styles.destructiveText,
          ]}>
            {item.title}
          </Text>
          {item.subtitle && (
            <Text style={styles.settingSubtitle}>{item.subtitle}</Text>
          )}
        </View>

        {!item.destructive && (
          <ChevronRight size={20} color="#4B5563" />
        )}

        {item.showBadge && item.badgeText && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{item.badgeText}</Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#020420" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <ArrowLeft size={24} color="#FFFFFF" />
        </TouchableOpacity>
        
        <Text style={styles.headerTitle}>Settings</Text>
        
        <View style={styles.headerRight} />
      </View>

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* App Info Card - BRANDED FOR NEXPEC */}
        <Animated.View entering={FadeInDown.delay(100).duration(500)}>
          <LinearGradient
            colors={['rgba(139, 92, 246, 0.15)', 'rgba(139, 92, 246, 0.05)']}
            style={styles.appInfoCard}
          >
            <View style={styles.appIconContainer}>
              <Smartphone size={28} color="#8B5CF6" />
            </View>
            <View style={styles.appInfoContent}>
              <Text style={styles.appName}>NEXPEC</Text>
              <Text style={styles.appVersion}>Version 1.0.0 (Next-Gen Hub)</Text>
            </View>
          </LinearGradient>
        </Animated.View>

        {/* Settings Sections */}
        {settingsSections.map((section, sectionIndex) => (
          <View key={section.title || `section-${sectionIndex}`} style={styles.section}>
            {section.title ? (
              <Animated.Text 
                style={styles.sectionTitle}
                entering={FadeInDown.delay(sectionIndex * 100).duration(400)}
              >
                {section.title}
              </Animated.Text>
            ) : null}
            
            <View style={styles.sectionContent}>
              {section.items.map((item, index) => renderSettingItem(item, index, sectionIndex))}
            </View>
          </View>
        ))}

        {/* Footer */}
        <Animated.View 
          style={styles.footer}
          entering={FadeInDown.delay(500).duration(400)}
        >
          <Text style={styles.footerText}>
            Next Generation Inspection Hub
          </Text>
          <Text style={styles.copyrightText}>
            © 2026 NEXPEC Technology Group.
          </Text>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020420',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerRight: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  appInfoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderRadius: 16,
    marginTop: 20,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)', // Purple border
  },
  appIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  appInfoContent: {
    marginLeft: 16,
  },
  appName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  appVersion: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  section: {
    marginTop: 28,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
    marginLeft: 4,
  },
  sectionContent: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  destructiveItem: {
    borderBottomWidth: 0,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  destructiveIconContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  settingContent: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  destructiveText: {
    color: '#EF4444',
  },
  settingSubtitle: {
    fontSize: 13,
    color: '#6B7280',
  },
  badge: {
    backgroundColor: '#00D4AA',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginLeft: 8,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#020420',
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 32,
    marginTop: 20,
  },
  footerText: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 8,
  },
  copyrightText: {
    fontSize: 12,
    color: '#4B5563',
  },
});

