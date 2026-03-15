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
  ActivityIndicator,
  Animated as RNAnimated,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRouter, useFocusEffect } from 'expo-router';

// Safe relative paths from app/ root
import { supabase } from '../lib/supabase';
import { useAuth } from '../src/contexts/AuthContext';

// ── Theme ──────────────────────────────────────────────
const COLORS = {
  background: '#020420',
  backgroundAlt: '#0a0f2e',
  surface: '#0F172A',
  surfaceLight: '#1E293B',
  border: '#1F2937',
  borderLight: '#334155',
  primary: '#7C3AED',
  primaryDark: '#6D28D9',
  primaryBg: 'rgba(124, 58, 237, 0.12)',
  accent: '#00D4AA',
  accentBg: 'rgba(0, 212, 170, 0.12)',
  accentBorder: 'rgba(0, 212, 170, 0.25)',
  blue: '#3B82F6',
  blueBg: 'rgba(59, 130, 246, 0.12)',
  green: '#10B981',
  greenBg: 'rgba(16, 185, 129, 0.12)',
  red: '#EF4444',
  amber: '#F59E0B',
  amberBg: 'rgba(245, 158, 11, 0.12)',
  cyan: '#06B6D4',
  cyanBg: 'rgba(6, 182, 212, 0.12)',
  white: '#FFFFFF',
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textDark: '#475569',
  switchTrackOff: '#1E293B',
  switchTrackOn: '#7C3AED',
  switchThumbOff: '#64748B',
  switchThumbOn: '#FFFFFF',
};

type UserRole = 'inspector' | 'client' | 'agency';

interface NotificationToggle {
  id: string;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  roles: UserRole[] | 'all';
  defaultValue: boolean;
}

interface ToggleGroup {
  id: string;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  toggles: NotificationToggle[];
}

const NOTIFICATION_GROUPS: ToggleGroup[] = [
  {
    id: 'job_alerts',
    title: 'Job & Operation Alerts',
    subtitle: 'Stay updated on your active work',
    icon: 'briefcase',
    iconColor: COLORS.blue,
    iconBg: COLORS.blueBg,
    toggles: [
      { id: 'new_jobs_area', label: 'New Jobs in My Area', description: 'Get notified when new inspection jobs are posted near you', icon: 'location', iconColor: COLORS.accent, iconBg: COLORS.accentBg, roles: ['inspector'], defaultValue: true },
      { id: 'contract_assigned', label: 'Contract Assigned to Me', description: 'Receive alerts when a client assigns you a contract', icon: 'clipboard', iconColor: COLORS.blue, iconBg: COLORS.blueBg, roles: ['inspector'], defaultValue: true },
      { id: 'report_approved_rejected', label: 'Report Approved / Rejected', description: 'Know immediately when your report is reviewed', icon: 'document-text', iconColor: COLORS.green, iconBg: COLORS.greenBg, roles: ['inspector'], defaultValue: true },
      { id: 'new_applicant', label: 'New Applicant for My Job', description: 'Get notified when an inspector applies to your job post', icon: 'person-add', iconColor: COLORS.primary, iconBg: COLORS.primaryBg, roles: ['client'], defaultValue: true },
      { id: 'inspection_started', label: 'Inspection Started', description: 'Know when your assigned inspector begins an inspection', icon: 'analytics', iconColor: COLORS.cyan, iconBg: COLORS.cyanBg, roles: ['client'], defaultValue: true },
      { id: 'report_submitted', label: 'Report Submitted', description: 'Receive alerts when an inspection report is ready for review', icon: 'send', iconColor: COLORS.green, iconBg: COLORS.greenBg, roles: ['client'], defaultValue: true },
      { id: 'new_enterprise_contract', label: 'New Enterprise Contract', description: 'Get notified about new enterprise-level contracts', icon: 'business', iconColor: COLORS.amber, iconBg: COLORS.amberBg, roles: ['agency'], defaultValue: true },
      { id: 'inspector_performance', label: 'Inspector Performance Alert', description: 'Receive alerts about inspector KPIs and performance metrics', icon: 'trending-up', iconColor: COLORS.cyan, iconBg: COLORS.cyanBg, roles: ['agency'], defaultValue: true },
    ],
  },
  {
    id: 'docs_financial',
    title: 'Documents & Financial',
    subtitle: 'Payments, invoices, and document updates',
    icon: 'cash',
    iconColor: COLORS.green,
    iconBg: COLORS.greenBg,
    toggles: [
      { id: 'new_message', label: 'New Message Received', description: 'Get notified when someone sends you a message', icon: 'chatbubbles', iconColor: COLORS.primary, iconBg: COLORS.primaryBg, roles: 'all', defaultValue: true },
      { id: 'system_updates', label: 'Important System Updates', description: 'Critical platform announcements and maintenance alerts', icon: 'warning', iconColor: COLORS.amber, iconBg: COLORS.amberBg, roles: 'all', defaultValue: true },
      { id: 'payout_processed', label: 'Payout Processed', description: 'Know when your earnings have been transferred', icon: 'cash', iconColor: COLORS.green, iconBg: COLORS.greenBg, roles: ['inspector'], defaultValue: true },
      { id: 'invoice_generated', label: 'Invoice Generated', description: 'Receive alerts when a new invoice is created for your account', icon: 'receipt', iconColor: COLORS.blue, iconBg: COLORS.blueBg, roles: ['client', 'agency'], defaultValue: true },
      { id: 'document_uploaded', label: 'Document Uploaded', description: 'Get notified when new documents are uploaded to your projects', icon: 'cloud-upload', iconColor: COLORS.cyan, iconBg: COLORS.cyanBg, roles: ['client', 'agency'], defaultValue: true },
    ],
  },
  {
    id: 'methods',
    title: 'Notification Methods',
    subtitle: 'Choose how you receive notifications',
    icon: 'notifications',
    iconColor: COLORS.primary,
    iconBg: COLORS.primaryBg,
    toggles: [
      { id: 'push_notifications', label: 'Push Notifications', description: 'Receive instant alerts on your device', icon: 'phone-portrait', iconColor: COLORS.primary, iconBg: COLORS.primaryBg, roles: 'all', defaultValue: true },
      { id: 'email_notifications', label: 'Email Notifications', description: 'Get notification summaries via email', icon: 'mail', iconColor: COLORS.blue, iconBg: COLORS.blueBg, roles: 'all', defaultValue: true },
      { id: 'sms_alerts', label: 'SMS Alerts', description: 'Receive text messages for critical alerts', icon: 'chatbox', iconColor: COLORS.green, iconBg: COLORS.greenBg, roles: 'all', defaultValue: false },
    ],
  },
];

const ToggleRow: React.FC<{
  toggle: NotificationToggle;
  value: boolean;
  onToggle: (id: string, val: boolean) => void;
  index: number;
}> = React.memo(({ toggle, value, onToggle, index }) => {
  return (
    <Animated.View entering={FadeInDown.duration(300).delay(index * 60)} style={st.toggleRow}>
      <View style={st.toggleLeft}>
        <View style={[st.toggleIconWrap, { backgroundColor: toggle.iconBg }]}>
          <Ionicons name={toggle.icon} size={18} color={toggle.iconColor} />
        </View>
        <View style={st.toggleTextWrap}>
          <Text style={st.toggleLabel}>{toggle.label}</Text>
          <Text style={st.toggleDesc} numberOfLines={2}>{toggle.description}</Text>
        </View>
      </View>
      <Switch
        value={value}
        onValueChange={(val) => onToggle(toggle.id, val)}
        trackColor={{ false: COLORS.switchTrackOff, true: COLORS.switchTrackOn }}
        thumbColor={value ? COLORS.switchThumbOn : COLORS.switchThumbOff}
        ios_backgroundColor={COLORS.switchTrackOff}
        style={Platform.OS === 'android' ? { transform: [{ scaleX: 1.1 }, { scaleY: 1.1 }] } : undefined}
      />
    </Animated.View>
  );
});

const GroupCard: React.FC<{
  group: ToggleGroup;
  role: UserRole;
  values: Record<string, boolean>;
  onToggle: (id: string, val: boolean) => void;
  groupIndex: number;
}> = React.memo(({ group, role, values, onToggle, groupIndex }) => {
  const visibleToggles = useMemo(
    () => group.toggles.filter((t) => t.roles === 'all' || t.roles.includes(role)),
    [group.toggles, role]
  );

  if (visibleToggles.length === 0) return null;

  const activeCount = visibleToggles.filter((t) => values[t.id]).length;

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(groupIndex * 120)} style={st.groupCard}>
      <View style={st.groupHeader}>
        <View style={st.groupHeaderLeft}>
          <View style={[st.groupIcon, { backgroundColor: group.iconBg }]}>
            <Ionicons name={group.icon} size={20} color={group.iconColor} />
          </View>
          <View>
            <Text style={st.groupTitle}>{group.title}</Text>
            <Text style={st.groupSubtitle}>{group.subtitle}</Text>
          </View>
        </View>
        <View style={[st.activeCounter, { backgroundColor: `${group.iconColor}15` }]}>
          <Text style={[st.activeCounterText, { color: group.iconColor }]}>
            {activeCount}/{visibleToggles.length}
          </Text>
        </View>
      </View>
      <View style={st.groupDivider} />
      <View style={st.togglesList}>
        {visibleToggles.map((toggle, idx) => (
          <React.Fragment key={toggle.id}>
            <ToggleRow
              toggle={toggle}
              value={values[toggle.id] ?? toggle.defaultValue}
              onToggle={onToggle}
              index={idx}
            />
            {idx < visibleToggles.length - 1 && <View style={st.toggleDivider} />}
          </React.Fragment>
        ))}
      </View>
    </Animated.View>
  );
});

const RoleBadge: React.FC<{ role: UserRole }> = ({ role }) => {
  const config = {
    inspector: { label: 'Inspector', icon: 'shield-checkmark', color: COLORS.accent, bg: COLORS.accentBg, border: COLORS.accentBorder },
    client: { label: 'Client', icon: 'briefcase', color: COLORS.blue, bg: COLORS.blueBg, border: 'rgba(59,130,246,0.25)' },
    agency: { label: 'Agency', icon: 'business', color: COLORS.amber, bg: COLORS.amberBg, border: 'rgba(245,158,11,0.25)' },
  }[role];
  
  return (
    <View style={[st.roleBadge, { backgroundColor: config.bg, borderColor: config.border }]}>
      <Ionicons name={config.icon as any} size={12} color={config.color} />
      <Text style={[st.roleBadgeText, { color: config.color }]}>{config.label}</Text>
    </View>
  );
};

const InfoBanner: React.FC<{ role: UserRole }> = ({ role }) => {
  const message = {
    inspector: 'Your notification preferences are tailored for field inspectors. Stay on top of new jobs, contract updates, and payouts.',
    client: 'Manage how you receive updates about your inspection projects, applicants, and submitted reports.',
    agency: 'Control enterprise notifications including contract alerts, inspector performance, and financial summaries.',
  }[role];

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(80)} style={st.infoBanner}>
      <LinearGradient colors={['rgba(124,58,237,0.10)', 'rgba(124,58,237,0.03)', 'transparent']} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
      <View style={st.infoBannerIcon}>
        <Ionicons name="information-circle" size={16} color={COLORS.primary} />
      </View>
      <Text style={st.infoBannerText}>{message}</Text>
    </Animated.View>
  );
};

const QuickActions: React.FC<{ onEnableAll: () => void; onDisableAll: () => void; }> = React.memo(({ onEnableAll, onDisableAll }) => (
  <Animated.View entering={FadeInDown.duration(400).delay(60)} style={st.quickActions}>
    <TouchableOpacity style={st.quickActionBtn} onPress={onEnableAll} activeOpacity={0.7}>
      <Ionicons name="notifications" size={14} color={COLORS.green} />
      <Text style={[st.quickActionText, { color: COLORS.green }]}>Enable All</Text>
    </TouchableOpacity>
    <View style={st.quickActionDivider} />
    <TouchableOpacity style={st.quickActionBtn} onPress={onDisableAll} activeOpacity={0.7}>
      <Ionicons name="notifications-off" size={14} color={COLORS.textMuted} />
      <Text style={[st.quickActionText, { color: COLORS.textMuted }]}>Disable All</Text>
    </TouchableOpacity>
  </Animated.View>
));

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  
  const [userRole, setUserRole] = useState<UserRole>('inspector');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [toggleValues, setToggleValues] = useState<Record<string, boolean>>({});

  const initialValuesRef = useRef<Record<string, boolean>>({});
  const saveButtonAnim = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    RNAnimated.spring(saveButtonAnim, {
      toValue: hasChanges ? 1 : 0,
      tension: 50,
      friction: 8,
      useNativeDriver: true,
    }).start();
  }, [hasChanges]);

  const fetchUserRole = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        setUserRole('inspector');
      } else {
        const fetchedRole = (data as any)?.role || 'inspector';
        setUserRole(fetchedRole === 'enterprise' ? 'agency' : fetchedRole);
      }
    } catch (err) {
      console.error('Error fetching role:', err);
      setUserRole('inspector');
    }
  }, [user?.id]);

  const initializeToggles = useCallback((role: UserRole) => {
    const defaults: Record<string, boolean> = {};
    NOTIFICATION_GROUPS.forEach((group) => {
      group.toggles.forEach((toggle) => {
        const isVisible = toggle.roles === 'all' || toggle.roles.includes(role);
        if (isVisible) {
          defaults[toggle.id] = toggle.defaultValue;
        }
      });
    });
    setToggleValues(defaults);
    initialValuesRef.current = { ...defaults };
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    await fetchUserRole();
    setLoading(false);
  }, [fetchUserRole]);

  useEffect(() => {
    if (userRole) {
      initializeToggles(userRole);
    }
  }, [userRole, initializeToggles]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleToggle = useCallback((id: string, value: boolean) => {
    setToggleValues((prev) => {
      const next = { ...prev, [id]: value };
      const changed = Object.keys(next).some((key) => next[key] !== initialValuesRef.current[key]);
      setHasChanges(changed);
      return next;
    });
  }, []);

  const handleEnableAll = useCallback(() => {
    setToggleValues((prev) => {
      const next: Record<string, boolean> = {};
      Object.keys(prev).forEach((key) => {
        next[key] = true;
      });
      setHasChanges(true);
      return next;
    });
  }, []);

  const handleDisableAll = useCallback(() => {
    Alert.alert(
      'Disable All Notifications',
      'Are you sure you want to turn off all notifications? You may miss important updates.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disable All',
          style: 'destructive',
          onPress: () => {
            setToggleValues((prev) => {
              const next: Record<string, boolean> = {};
              Object.keys(prev).forEach((key) => {
                next[key] = false;
              });
              setHasChanges(true);
              return next;
            });
          },
        },
      ]
    );
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      initialValuesRef.current = { ...toggleValues };
      setHasChanges(false);
      Alert.alert(
        'Preferences Saved',
        'Your notification preferences have been updated successfully.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save preferences.');
    } finally {
      setSaving(false);
    }
  }, [toggleValues, router]);

  const totalToggles = Object.keys(toggleValues).length;
  const activeToggles = Object.values(toggleValues).filter(Boolean).length;

  if (loading) {
    return (
      <SafeAreaView style={st.container} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        <View style={st.loadingWrap}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={st.loadingText}>Loading preferences…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <LinearGradient colors={[COLORS.background, COLORS.backgroundAlt, COLORS.background]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFillObject} />
      
      <View style={st.header}>
        <TouchableOpacity style={st.backButton} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={COLORS.white} />
        </TouchableOpacity>
        <View style={st.headerCenter}>
          <Text style={st.headerTitle}>Notification Settings</Text>
          <View style={st.headerMetaRow}>
            <RoleBadge role={userRole} />
            <View style={st.activeCountChip}>
              <Ionicons name="flash" size={10} color={COLORS.accent} />
              <Text style={st.activeCountChipText}>{activeToggles}/{totalToggles} active</Text>
            </View>
          </View>
        </View>
        <View style={{ width: 42 }} />
      </View>

      <ScrollView style={st.scrollView} contentContainerStyle={st.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <InfoBanner role={userRole} />
        <QuickActions onEnableAll={handleEnableAll} onDisableAll={handleDisableAll} />
        
        {NOTIFICATION_GROUPS.map((group, gIdx) => (
          <GroupCard key={group.id} group={group} role={userRole} values={toggleValues} onToggle={handleToggle} groupIndex={gIdx} />
        ))}

        <Animated.View entering={FadeInDown.duration(400).delay(500)} style={st.footerNote}>
          <Ionicons name="globe" size={14} color={COLORS.textDark} />
          <Text style={st.footerNoteText}>Notification preferences are synced across all your devices. Some system-critical alerts cannot be disabled for compliance reasons.</Text>
        </Animated.View>
        
        <View style={{ height: 100 }} />
      </ScrollView>

      <RNAnimated.View
        style={[
          st.saveButtonWrap,
          {
            opacity: saveButtonAnim,
            transform: [{ translateY: saveButtonAnim.interpolate({ inputRange: [0, 1], outputRange: [80, 0] }) }],
          },
        ]}
        pointerEvents={hasChanges ? 'auto' : 'none'}
      >
        <TouchableOpacity style={st.saveButton} onPress={handleSave} disabled={saving || !hasChanges} activeOpacity={0.85}>
          <LinearGradient colors={saving ? [COLORS.surfaceLight, COLORS.surfaceLight] : [COLORS.primary, COLORS.primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          {saving ? (
            <ActivityIndicator size="small" color={COLORS.white} />
          ) : (
            <>
              <Ionicons name="save" size={18} color={COLORS.white} />
              <Text style={st.saveButtonText}>Save Changes</Text>
            </>
          )}
        </TouchableOpacity>
        {hasChanges && !saving && <View style={st.unsavedDot} />}
      </RNAnimated.View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 },
  loadingText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '500' },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.06)' },
  backButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: COLORS.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  headerCenter: { flex: 1, alignItems: 'center', gap: 6 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.white, letterSpacing: -0.3 },
  headerMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roleBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  roleBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  activeCountChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: COLORS.accentBg },
  activeCountChipText: { fontSize: 10, fontWeight: '700', color: COLORS.accent },
  infoBanner: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: COLORS.primary, gap: 10, overflow: 'hidden' },
  infoBannerIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: COLORS.primaryBg, justifyContent: 'center', alignItems: 'center', marginTop: 1 },
  infoBannerText: { flex: 1, fontSize: 13, color: COLORS.textSecondary, lineHeight: 19 },
  quickActions: { flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  quickActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 6 },
  quickActionText: { fontSize: 13, fontWeight: '600' },
  quickActionDivider: { width: 1, backgroundColor: COLORS.border, marginVertical: 8 },
  groupCard: { backgroundColor: COLORS.surface, borderRadius: 18, marginBottom: 14, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
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
  toggleLabel: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 3 },
  toggleDesc: { fontSize: 12, color: COLORS.textMuted, lineHeight: 16 },
  toggleDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.04)', marginLeft: 52 },
  footerNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 4, paddingHorizontal: 4 },
  footerNoteText: { flex: 1, fontSize: 11, color: COLORS.textDark, lineHeight: 16, fontStyle: 'italic' },
  saveButtonWrap: { position: 'absolute', bottom: Platform.OS === 'ios' ? 36 : 20, left: 20, right: 20, alignItems: 'center' },
  saveButton: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderRadius: 16, gap: 10, overflow: 'hidden', ...Platform.select({ ios: { shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16 }, android: { elevation: 12 } }) },
  saveButtonText: { fontSize: 16, fontWeight: '800', color: COLORS.white, letterSpacing: 0.3 },
  unsavedDot: { position: 'absolute', top: -3, right: -3, width: 12, height: 12, borderRadius: 6, backgroundColor: COLORS.red, borderWidth: 2, borderColor: COLORS.background },
});