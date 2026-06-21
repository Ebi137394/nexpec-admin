import { Tabs } from 'expo-router';
import { useEffect, useState, useCallback } from 'react';
import { View, Text, Platform, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../src/contexts/AuthContext';
import { useLanguage } from '@/src/i18n/LanguageProvider';

const COLORS = { background: '#020420', surface: '#0F172A', border: '#1E293B', primary: '#7C3AED', textSecondary: '#94A3B8', textMuted: '#64748B', };

type UserRole = 'inspector' | 'client' | 'agency' | 'enterprise' | 'supplier';

const TabIcon = ({ name, nameOutline, color, focused }: { name: keyof typeof Ionicons.glyphMap; nameOutline: keyof typeof Ionicons.glyphMap; color: string; focused: boolean; }) => (
  <View style={styles.iconWrap}><Ionicons name={focused ? name : nameOutline} size={22} color={color} />{focused && <View style={styles.activeDot} />}</View>
);

export default function TabLayout() {
  const { user } = useAuth();
  const { t, isRTL, language } = useLanguage();
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUserRole = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    try {
      const { data, error } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (error && error.code !== 'PGRST116') { setUserRole('inspector'); }
      else {
        // Enterprise is now a first-class role — it has its own dashboard
        // tab (enterprise-dashboard.tsx) and is no longer aliased to agency.
        const fetchedRole = (data as any)?.role || 'inspector';
        setUserRole(fetchedRole as UserRole);
      }
    } catch (error) { setUserRole('inspector'); } finally { setLoading(false); }
  }, [user?.id]);

  useEffect(() => { fetchUserRole(); }, [fetchUserRole]);

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color={COLORS.primary} /><Text style={styles.loadingText}>{t('Loading NEXPEC…')}</Text></View>;

  const role: UserRole = userRole ?? 'inspector';

  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: COLORS.primary, tabBarInactiveTintColor: COLORS.textMuted, tabBarStyle: { backgroundColor: COLORS.surface, borderTopColor: COLORS.border, borderTopWidth: 1, height: Platform.OS === 'ios' ? 88 : 68, paddingBottom: Platform.OS === 'ios' ? 28 : 8, paddingTop: 8, elevation: 0, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.15, shadowRadius: 12 }, tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginTop: 2 }, tabBarIconStyle: { marginBottom: -2 } }}>
      <Tabs.Screen name="index" options={{ title: t('Dashboard'), href: role === 'inspector' ? '/' : null, tabBarIcon: ({ color, focused }) => <TabIcon name="grid" nameOutline="grid-outline" color={color} focused={focused} /> }} />
      <Tabs.Screen name="client-dashboard" options={{ title: t('Dashboard'), href: role === 'client' ? '/client-dashboard' : null, tabBarIcon: ({ color, focused }) => <TabIcon name="grid" nameOutline="grid-outline" color={color} focused={focused} /> }} />
      <Tabs.Screen name="agency-dashboard" options={{ title: t('Dashboard'), href: role === 'agency' ? '/agency-dashboard' : null, tabBarIcon: ({ color, focused }) => <TabIcon name="grid" nameOutline="grid-outline" color={color} focused={focused} /> }} />
      <Tabs.Screen name="enterprise-dashboard" options={{ title: t('Dashboard'), href: role === 'enterprise' ? '/enterprise-dashboard' : null, tabBarIcon: ({ color, focused }) => <TabIcon name="grid" nameOutline="grid-outline" color={color} focused={focused} /> }} />
      <Tabs.Screen name="supplier-dashboard" options={{ title: t('Dashboard'), href: role === 'supplier' ? '/supplier-dashboard' : null, tabBarIcon: ({ color, focused }) => <TabIcon name="grid" nameOutline="grid-outline" color={color} focused={focused} /> }} />
      
      {/* Suppliers (vendors) have a focused workspace — Dashboard + Profile only.
         Jobs / Finance / Docs are inspector/buyer surfaces; hidden for suppliers. */}
      <Tabs.Screen name="jobs" options={{ href: role === 'supplier' ? null : undefined, title: t('Jobs'), tabBarIcon: ({ color, focused }) => <TabIcon name="briefcase" nameOutline="briefcase-outline" color={color} focused={focused} /> }} />
      <Tabs.Screen name="finance" options={{ href: role === 'supplier' ? null : undefined, title: t('Finance'), tabBarIcon: ({ color, focused }) => <TabIcon name="wallet" nameOutline="wallet-outline" color={color} focused={focused} /> }} />
      <Tabs.Screen name="resources" options={{ href: role === 'supplier' ? null : undefined, title: t('Docs'), tabBarIcon: ({ color, focused }) => <TabIcon name="folder-open" nameOutline="folder-open-outline" color={color} focused={focused} /> }} />
      
      {/* 👇 این خط رو درست کردم. فقط نوشته profile 👇 */}
      <Tabs.Screen name="profile" options={{ title: t('Profile'), tabBarIcon: ({ color, focused }) => <TabIcon name="person" nameOutline="person-outline" color={color} focused={focused} /> }} />
      
      {/* Hidden Routes */}
      <Tabs.Screen name="dashboard" options={{ href: null }} />
      <Tabs.Screen name="inspector-dashboard" options={{ href: null }} />
      <Tabs.Screen name="job-details-example" options={{ href: null }} />
    </Tabs>
  );
}
const styles = StyleSheet.create({ loadingContainer: { flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center', gap: 14 }, loadingText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '500' }, iconWrap: { alignItems: 'center', justifyContent: 'center', minWidth: 28 }, activeDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: COLORS.primary, marginTop: 3 }});