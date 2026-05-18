import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Platform,
  Alert,
  Switch,
  Linking,
  ActivityIndicator, // ✅ ADDED THIS BACK IN!
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import {
  ArrowLeft,
  Bell,
  BellRing,
  Briefcase,
  FileCheck,
  DollarSign,
  UserCheck,
  Shield,
  Mail,
  Smartphone,
  MessageSquare,
  Upload,
  Receipt,
  AlertTriangle,
  MapPin,
  ClipboardCheck,
  Building2,
  Activity,
  Info,
  ShieldAlert,
  Award,
  BarChart3,
  CloudUpload,
  type LucideIcon,
} from 'lucide-react-native';
import Animated, { 
  FadeInDown, 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring, 
  withRepeat, 
  withTiming, 
  interpolate 
} from 'react-native-reanimated';
import { supabase } from '../lib/supabase';
import { useAuth } from '../src/contexts/AuthContext';

// ── 1. Elite Neon Theme ──────────────────────────────────────────
const COLORS = {
  background: '#070716', 
  surface: 'rgba(255, 255, 255, 0.03)',
  border: 'rgba(255, 255, 255, 0.1)',
  primary: '#00FFFF', // Neon Cyan
  textPrimary: '#FFFFFF',
  textSecondary: '#9CA3AF',
  textMuted: '#64748B',
  
  purple: '#7C3AED',
  purpleBg: 'rgba(124, 58, 237, 0.12)',
  blue: '#3B82F6',
  blueBg: 'rgba(59, 130, 246, 0.12)',
  green: '#10B981',
  greenBg: 'rgba(16, 185, 129, 0.12)',
  amber: '#F59E0B',
  amberBg: 'rgba(245, 158, 11, 0.12)',
  cyan: '#06B6D4',
  cyanBg: 'rgba(6, 182, 212, 0.12)',
  red: '#EF4444',
  redBg: 'rgba(239, 68, 68, 0.12)',
};

type UserRole = 'inspector' | 'client' | 'agency';

interface NotificationToggle { id: string; label: string; description: string; icon: LucideIcon; iconColor: string; iconBg: string; roles: UserRole[] | 'all'; defaultValue: boolean; }
interface ToggleGroup { id: string; title: string; subtitle: string; icon: LucideIcon; iconColor: string; iconBg: string; toggles: NotificationToggle[]; }

// ── 2. Enterprise Feature Set ────────────────────────────────────
const NOTIFICATION_GROUPS: ToggleGroup[] = [
  {
    id: 'job_alerts', title: 'Work & Safety', subtitle: 'Stay updated on jobs and critical operations', icon: Briefcase, iconColor: COLORS.purple, iconBg: COLORS.purpleBg,
    toggles: [
      { id: 'new_jobs_area', label: 'New Job Alerts', description: 'Get notified when new jobs are posted near you', icon: Bell, iconColor: COLORS.purple, iconBg: COLORS.purpleBg, roles: ['inspector'], defaultValue: true },
      { id: 'contract_assigned', label: 'Contract Assigned', description: 'Receive alerts when a client assigns you a contract', icon: ClipboardCheck, iconColor: COLORS.blue, iconBg: COLORS.blueBg, roles: ['inspector'], defaultValue: true },
      { id: 'urgent_safety', label: 'Urgent Safety Warnings', description: 'Critical safety notices regarding your active sites', icon: ShieldAlert, iconColor: COLORS.red, iconBg: COLORS.redBg, roles: ['inspector', 'agency'], defaultValue: true },
      { id: 'location_alerts', label: 'Location Updates', description: 'Changes to inspection sites or schedule times', icon: MapPin, iconColor: COLORS.amber, iconBg: COLORS.amberBg, roles: ['inspector'], defaultValue: true },
      { id: 'new_applicant', label: 'New Applicant', description: 'Get notified when an inspector applies to your job post', icon: UserCheck, iconColor: COLORS.primary, iconBg: 'rgba(0, 255, 255, 0.1)', roles: ['client'], defaultValue: true },
      { id: 'inspection_started', label: 'Inspection Started', description: 'Know when your assigned inspector begins an inspection', icon: Activity, iconColor: COLORS.cyan, iconBg: COLORS.cyanBg, roles: ['client'], defaultValue: true },
      { id: 'new_enterprise_contract', label: 'New Enterprise Contract', description: 'Get notified about new enterprise-level contracts', icon: Building2, iconColor: COLORS.amber, iconBg: COLORS.amberBg, roles: ['agency'], defaultValue: true },
    ],
  },
  {
    id: 'docs_financial', title: 'Reports & Analytics', subtitle: 'Alerts for documents, approvals, and insights', icon: FileCheck, iconColor: COLORS.green, iconBg: COLORS.greenBg,
    toggles: [
      { id: 'report_approved_rejected', label: 'Report Approvals', description: 'When reports are approved or rejected by clients', icon: FileCheck, iconColor: COLORS.green, iconBg: COLORS.greenBg, roles: 'all', defaultValue: true },
      { id: 'cert_expiry', label: 'Certification Expiry', description: 'Warnings when your CSWIP or NDT certs are expiring soon', icon: Award, iconColor: COLORS.amber, iconBg: COLORS.amberBg, roles: ['inspector'], defaultValue: true },
      { id: 'document_uploaded', label: 'Document Uploaded', description: 'Get notified when new documents are uploaded to your projects', icon: Upload, iconColor: COLORS.blue, iconBg: COLORS.blueBg, roles: ['client', 'agency'], defaultValue: true },
      { id: 'weekly_summary', label: 'Weekly Performance Digest', description: 'A weekly summary of inspections, ratings, and stats', icon: BarChart3, iconColor: COLORS.purple, iconBg: COLORS.purpleBg, roles: ['agency', 'client'], defaultValue: false },
    ],
  },
  {
    id: 'account', title: 'Account & Finance', subtitle: 'Payments, messages, and security', icon: UserCheck, iconColor: COLORS.red, iconBg: COLORS.redBg,
    toggles: [
      { id: 'payout_processed', label: 'Payment Alerts', description: 'Know when your earnings have been transferred', icon: DollarSign, iconColor: COLORS.green, iconBg: COLORS.greenBg, roles: ['inspector'], defaultValue: true },
      { id: 'invoice_generated', label: 'Invoice Generated', description: 'Receive alerts when a new invoice is created', icon: Receipt, iconColor: COLORS.blue, iconBg: COLORS.blueBg, roles: ['client', 'agency'], defaultValue: true },
      { id: 'new_message', label: 'Direct Messages', description: 'Get notified when someone sends you a message', icon: MessageSquare, iconColor: COLORS.purple, iconBg: COLORS.purpleBg, roles: 'all', defaultValue: true },
      { id: 'system_updates', label: 'Security Alerts', description: 'Critical platform announcements and logins', icon: AlertTriangle, iconColor: COLORS.red, iconBg: COLORS.redBg, roles: 'all', defaultValue: true },
    ],
  },
  {
    id: 'delivery_methods', title: 'Delivery Methods', subtitle: 'Choose how you receive these alerts', icon: Smartphone, iconColor: COLORS.cyan, iconBg: COLORS.cyanBg,
    toggles: [
      { id: 'push_notifications', label: 'Push Notifications', description: 'Receive instant alerts on your device', icon: Bell, iconColor: COLORS.primary, iconBg: 'rgba(0, 255, 255, 0.1)', roles: 'all', defaultValue: true },
      { id: 'email_notifications', label: 'Email Notifications', description: 'Get notification summaries via email', icon: Mail, iconColor: COLORS.blue, iconBg: COLORS.blueBg, roles: 'all', defaultValue: true },
      { id: 'sms_alerts', label: 'SMS Alerts', description: 'Receive text messages for urgent security and job alerts', icon: Smartphone, iconColor: COLORS.green, iconBg: COLORS.greenBg, roles: 'all', defaultValue: false },
    ],
  },
];

// ── 3. Sub-Components ──────────────────────────────────────────

// World-Class Skeleton Loader
const SkeletonLoader = () => {
  const opacity = useSharedValue(0.3);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.7, { duration: 800 }), -1, true);
  }, []);
  
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View style={{ padding: 16, gap: 16 }}>
      {[1, 2, 3].map((i) => (
        <Animated.View key={i} style={[st.groupCard, animatedStyle, { height: 180, backgroundColor: 'rgba(255,255,255,0.05)' }]} />
      ))}
    </View>
  );
};

const ToggleRow: React.FC<{ toggle: NotificationToggle; value: boolean; onToggle: (id: string, val: boolean) => void; index: number; }> = React.memo(({ toggle, value, onToggle, index }) => {
  const IconComponent = toggle.icon;
  return (
    <Animated.View entering={FadeInDown.duration(300).delay(index * 60)} style={st.toggleRow}>
      <View style={st.toggleLeft}>
        <View style={[st.toggleIconWrap, { backgroundColor: toggle.iconBg }]}><IconComponent size={18} color={toggle.iconColor} /></View>
        <View style={st.toggleTextWrap}>
          <Text style={st.toggleLabel}>{toggle.label}</Text>
          <Text style={st.toggleDesc} numberOfLines={2}>{toggle.description}</Text>
        </View>
      </View>
      <Switch
        value={value}
        onValueChange={(val) => onToggle(toggle.id, val)}
        trackColor={{ false: 'rgba(255,255,255,0.1)', true: COLORS.primary }}
        thumbColor={'#FFFFFF'}
        ios_backgroundColor="rgba(255,255,255,0.1)"
        accessibilityRole="switch"
        accessibilityLabel={`Toggle ${toggle.label}`}
        accessibilityState={{ checked: value }}
        style={Platform.OS === 'android' ? { transform: [{ scaleX: 1.1 }, { scaleY: 1.1 }] } : undefined}
      />
    </Animated.View>
  );
});

const GroupCard: React.FC<{ group: ToggleGroup; role: UserRole; values: Record<string, boolean>; onToggle: (id: string, val: boolean) => void; groupIndex: number; }> = React.memo(({ group, role, values, onToggle, groupIndex }) => {
  const GroupIcon = group.icon;
  const visibleToggles = useMemo(() => group.toggles.filter((t) => t.roles === 'all' || t.roles.includes(role)), [group.toggles, role]);
  if (visibleToggles.length === 0) return null;
  const activeCount = visibleToggles.filter((t) => values[t.id]).length;

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(groupIndex * 100)} style={st.groupCard}>
      <View style={st.groupHeader}>
        <View style={st.groupHeaderLeft}>
          <View style={[st.groupIcon, { backgroundColor: group.iconBg }]}><GroupIcon size={20} color={group.iconColor} /></View>
          <View>
            <Text style={st.groupTitle}>{group.title}</Text>
            <Text style={st.groupSubtitle}>{group.subtitle}</Text>
          </View>
        </View>
        <View style={[st.activeCounter, { backgroundColor: `${group.iconColor}15` }]}>
          <Text style={[st.activeCounterText, { color: group.iconColor }]}>{activeCount}/{visibleToggles.length}</Text>
        </View>
      </View>
      <View style={st.groupDivider} />
      <View style={st.togglesList}>
        {visibleToggles.map((toggle, idx) => (
          <React.Fragment key={toggle.id}>
            <ToggleRow toggle={toggle} value={values[toggle.id] ?? toggle.defaultValue} onToggle={onToggle} index={idx} />
            {idx < visibleToggles.length - 1 && <View style={st.toggleDivider} />}
          </React.Fragment>
        ))}
      </View>
    </Animated.View>
  );
});

const RoleBadge: React.FC<{ role: UserRole }> = ({ role }) => {
  const config = {
    inspector: { label: 'Inspector', icon: Shield, color: COLORS.primary },
    client: { label: 'Client', icon: Briefcase, color: COLORS.blue },
    agency: { label: 'Agency', icon: Building2, color: COLORS.amber },
  }[role];
  const Icon = config.icon;
  return (
    <View style={[st.roleBadge, { backgroundColor: `${config.color}15`, borderColor: `${config.color}30` }]}>
      <Icon size={12} color={config.color} />
      <Text style={[st.roleBadgeText, { color: config.color }]}>{config.label}</Text>
    </View>
  );
};

// ── 4. Main Screen ─────────────────────────────────────────────
export default function NotificationSettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [userRole, setUserRole] = useState<UserRole>('inspector');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [toggleValues, setToggleValues] = useState<Record<string, boolean>>({});
  
  const initialValuesRef = useRef<Record<string, boolean>>({});
  
  // 120fps UI Thread Animation for Save Button
  const saveButtonAnim = useSharedValue(0);

  useEffect(() => {
    saveButtonAnim.value = withSpring(hasChanges ? 1 : 0, { damping: 14, stiffness: 100 });
  }, [hasChanges]);

  const saveBtnStyle = useAnimatedStyle(() => ({
    opacity: saveButtonAnim.value,
    transform: [{ translateY: interpolate(saveButtonAnim.value, [0, 1], [100, 0]) }],
  }));

  // Load Data
  const loadData = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    try {
      setLoading(true);
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      const activeRole = ((prof as any)?.role === 'enterprise' ? 'agency' : (prof as any)?.role) || 'inspector';
      setUserRole(activeRole);

      const { data: prefs } = await supabase.from('notification_preferences').select('preferences').eq('user_id', user.id).maybeSingle();
      
      const defaults: Record<string, boolean> = {};
      NOTIFICATION_GROUPS.forEach((group) => {
        group.toggles.forEach((toggle) => {
          if (toggle.roles === 'all' || toggle.roles.includes(activeRole)) {
            defaults[toggle.id] = prefs?.preferences?.[toggle.id] ?? toggle.defaultValue;
          }
        });
      });
      setToggleValues(defaults);
      initialValuesRef.current = { ...defaults };
    } catch (err) {
      console.error('Error loading settings:', err);
    } finally {
      // Slight delay to ensure smooth transition from skeleton to actual UI
      setTimeout(() => setLoading(false), 300);
    }
  }, [user?.id]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  // ── OS Level Check & Haptics ──
  const handleToggle = useCallback(async (id: string, value: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (id === 'push_notifications' && value === true) {
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') {
        const { status: newStatus } = await Notifications.requestPermissionsAsync();
        if (newStatus !== 'granted') {
          Alert.alert(
            'Permissions Required', 
            'Your device settings are blocking NEXPEC from sending push notifications. Please enable them in your phone settings.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() }
            ]
          );
          return; 
        }
      }
    }

    setToggleValues((prev) => {
      const next = { ...prev, [id]: value };
      const changed = Object.keys(next).some((key) => next[key] !== initialValuesRef.current[key]);
      
      // Haptic bump when changes appear/disappear
      if (changed !== hasChanges) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      
      setHasChanges(changed);
      return next;
    });
  }, [hasChanges]);

  const handleEnableAll = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setToggleValues((prev) => {
      const next: Record<string, boolean> = {};
      Object.keys(prev).forEach((key) => { next[key] = true; });
      setHasChanges(true); return next;
    });
  }, []);

  const handleDisableAll = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert('Disable All', 'Are you sure you want to turn off all notifications?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disable All', style: 'destructive', onPress: () => {
          setToggleValues((prev) => {
            const next: Record<string, boolean> = {};
            Object.keys(prev).forEach((key) => { next[key] = false; });
            setHasChanges(true); return next;
          });
      }},
    ]);
  }, []);

  // ── SUPABASE SYNC LOGIC ──
  const handleSave = useCallback(async () => {
    if (!user?.id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setSaving(true);
    try {
      const { error } = await supabase
        .from('notification_preferences')
        .upsert({ user_id: user.id, preferences: toggleValues, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });

      if (error) throw error;

      initialValuesRef.current = { ...toggleValues };
      setHasChanges(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Synced Successfully', 'Your notification preferences are now saved to the cloud.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Sync Error', err.message || 'Failed to save preferences to database.');
    } finally {
      setSaving(false);
    }
  }, [toggleValues, router, user?.id]);

  return (
    <SafeAreaView style={st.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />

      <View style={st.header}>
        <TouchableOpacity 
          style={st.backButton} 
          onPress={() => { Haptics.selectionAsync(); router.back(); }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={st.headerCenter}>
          <Text style={st.headerTitle}>Notification Settings</Text>
          <RoleBadge role={userRole} />
        </View>
        <View style={{ width: 42 }} />
      </View>

      {loading ? (
        <SkeletonLoader />
      ) : (
        <ScrollView contentContainerStyle={[st.scrollContent, { paddingBottom: Math.max(insets.bottom + 100, 100) }]} showsVerticalScrollIndicator={false}>
          
          <Animated.View entering={FadeInDown.duration(400).delay(80)} style={st.infoBanner}>
            <View style={st.infoBannerIcon}><Info size={16} color={COLORS.primary} /></View>
            <Text style={st.infoBannerText}>These settings dictate how NEXPEC contacts you. Changes must be synced to the cloud.</Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(400).delay(60)} style={st.quickActions}>
            <TouchableOpacity style={st.quickActionBtn} onPress={handleEnableAll} accessibilityRole="button"><BellRing size={14} color={COLORS.green} /><Text style={[st.quickActionText, { color: COLORS.green }]}>Enable All</Text></TouchableOpacity>
            <View style={st.quickActionDivider} />
            <TouchableOpacity style={st.quickActionBtn} onPress={handleDisableAll} accessibilityRole="button"><Bell size={14} color={COLORS.textMuted} /><Text style={[st.quickActionText, { color: COLORS.textMuted }]}>Disable All</Text></TouchableOpacity>
          </Animated.View>

          {NOTIFICATION_GROUPS.map((group, gIdx) => (
            <GroupCard key={group.id} group={group} role={userRole} values={toggleValues} onToggle={handleToggle} groupIndex={gIdx} />
          ))}
        </ScrollView>
      )}

      {/* Modern Reanimated Floating Sync Button */}
      <Animated.View style={[st.saveButtonWrap, saveBtnStyle, { paddingBottom: Math.max(insets.bottom, 20) }]} pointerEvents={hasChanges ? 'auto' : 'none'}>
        <TouchableOpacity 
          style={st.saveButton} 
          onPress={handleSave} 
          disabled={saving || !hasChanges} 
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Sync Preferences"
        >
          {saving ? <ActivityIndicator size="small" color="#000" /> : 
          <>
            <CloudUpload size={20} color="#000" />
            <Text style={st.saveButtonText}>Sync Preferences</Text>
          </>}
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  backButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: COLORS.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  headerCenter: { flex: 1, alignItems: 'center', gap: 6 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  roleBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  roleBadgeText: { fontSize: 11, fontWeight: '700' },
  infoBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: COLORS.border, gap: 10 },
  infoBannerIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: 'rgba(0, 255, 255, 0.1)', justifyContent: 'center', alignItems: 'center' },
  infoBannerText: { flex: 1, fontSize: 13, color: COLORS.textSecondary, lineHeight: 19 },
  quickActions: { flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: COLORS.border },
  quickActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 6 },
  quickActionText: { fontSize: 13, fontWeight: '600' },
  quickActionDivider: { width: 1, backgroundColor: COLORS.border, marginVertical: 8 },
  groupCard: { backgroundColor: COLORS.surface, borderRadius: 18, marginBottom: 16, borderWidth: 1, borderColor: COLORS.border },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingBottom: 0 },
  groupHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  groupIcon: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  groupTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary },
  groupSubtitle: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  activeCounter: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  activeCounterText: { fontSize: 12, fontWeight: '800' },
  groupDivider: { height: 1, backgroundColor: COLORS.border, marginHorizontal: 16, marginTop: 14 },
  togglesList: { paddingHorizontal: 12, paddingVertical: 4 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 4 },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12, marginRight: 12 },
  toggleIconWrap: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  toggleTextWrap: { flex: 1 },
  toggleLabel: { fontSize: 15, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 3 },
  toggleDesc: { fontSize: 12, color: COLORS.textMuted, lineHeight: 16 },
  toggleDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.04)', marginLeft: 52 },
  saveButtonWrap: { position: 'absolute', bottom: 0, left: 20, right: 20, alignItems: 'center' },
  saveButton: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 18, borderRadius: 16, backgroundColor: COLORS.primary, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8, gap: 10 },
  saveButtonText: { fontSize: 17, fontWeight: '800', color: '#000000' },
});