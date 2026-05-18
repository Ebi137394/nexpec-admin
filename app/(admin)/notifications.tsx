// app/(admin)/notifications.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Switch,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { SA, ago } from '@/lib/super-admin/theme';
import { useAuth } from '@/src/contexts/AuthContext';

interface NotificationSettings {
  push_enabled: boolean;
  email_enabled: boolean;
  sms_enabled: boolean;
  alert_new_jobs: boolean;
  alert_payouts: boolean;
  alert_messages: boolean;
  alert_verifications: boolean;
}

const DEFAULTS: NotificationSettings = {
  push_enabled: true,
  email_enabled: true,
  sms_enabled: false,
  alert_new_jobs: true,
  alert_payouts: true,
  alert_messages: true,
  alert_verifications: false,
};

const recentAlerts = [
  {
    id: '1',
    type: 'message',
    title: 'New Support Message',
    desc: 'Test Inspector sent you a message.',
    time: new Date().toISOString(),
    isRead: false,
    icon: 'chatbubbles' as const,
  },
  {
    id: '2',
    type: 'payout',
    title: 'Payout Requested',
    desc: '$4,500 pending for API-653 Tank Inspection.',
    time: new Date(Date.now() - 3600000).toISOString(),
    isRead: false,
    icon: 'cash' as const,
  },
  {
    id: '3',
    type: 'job',
    title: 'New Job Posted',
    desc: 'Enterprise Client posted a new NDT job.',
    time: new Date(Date.now() - 86400000).toISOString(),
    isRead: true,
    icon: 'briefcase' as const,
  },
];

export default function NotificationsSettings() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const [pushEnabled, setPushEnabled] = useState(DEFAULTS.push_enabled);
  const [emailEnabled, setEmailEnabled] = useState(DEFAULTS.email_enabled);
  const [smsEnabled, setSmsEnabled] = useState(DEFAULTS.sms_enabled);
  const [alertNewJobs, setAlertNewJobs] = useState(DEFAULTS.alert_new_jobs);
  const [alertPayouts, setAlertPayouts] = useState(DEFAULTS.alert_payouts);
  const [alertMessages, setAlertMessages] = useState(DEFAULTS.alert_messages);
  const [alertVerifications, setAlertVerifications] = useState(DEFAULTS.alert_verifications);

  const [savedSnapshot, setSavedSnapshot] = useState<NotificationSettings>(DEFAULTS);

  const currentSnapshot = (): NotificationSettings => ({
    push_enabled: pushEnabled,
    email_enabled: emailEnabled,
    sms_enabled: smsEnabled,
    alert_new_jobs: alertNewJobs,
    alert_payouts: alertPayouts,
    alert_messages: alertMessages,
    alert_verifications: alertVerifications,
  });

  useEffect(() => {
    const cur = currentSnapshot();
    const dirty = (Object.keys(cur) as (keyof NotificationSettings)[]).some(
      (k) => cur[k] !== savedSnapshot[k]
    );
    setHasChanges(dirty);
  }, [
    pushEnabled,
    emailEnabled,
    smsEnabled,
    alertNewJobs,
    alertPayouts,
    alertMessages,
    alertVerifications,
    savedSnapshot,
  ]);

  const fetchSettings = useCallback(async () => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase
        .from('admin_notification_settings')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) {
        console.error('Fetch settings error:', error.message);
        return;
      }

      if (data) {
        setPushEnabled(data.push_enabled ?? DEFAULTS.push_enabled);
        setEmailEnabled(data.email_enabled ?? DEFAULTS.email_enabled);
        setSmsEnabled(data.sms_enabled ?? DEFAULTS.sms_enabled);
        setAlertNewJobs(data.alert_new_jobs ?? DEFAULTS.alert_new_jobs);
        setAlertPayouts(data.alert_payouts ?? DEFAULTS.alert_payouts);
        setAlertMessages(data.alert_messages ?? DEFAULTS.alert_messages);
        setAlertVerifications(data.alert_verifications ?? DEFAULTS.alert_verifications);

        const snap: NotificationSettings = {
          push_enabled: data.push_enabled ?? DEFAULTS.push_enabled,
          email_enabled: data.email_enabled ?? DEFAULTS.email_enabled,
          sms_enabled: data.sms_enabled ?? DEFAULTS.sms_enabled,
          alert_new_jobs: data.alert_new_jobs ?? DEFAULTS.alert_new_jobs,
          alert_payouts: data.alert_payouts ?? DEFAULTS.alert_payouts,
          alert_messages: data.alert_messages ?? DEFAULTS.alert_messages,
          alert_verifications: data.alert_verifications ?? DEFAULTS.alert_verifications,
        };
        setSavedSnapshot(snap);
      }
    } catch (err: any) {
      console.error('Failed to load settings:', err?.message ?? err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchSettings();
  }, [fetchSettings]);

  // ── منطق جدید و ضد ارور برای ذخیره کردن (Option B) ──
  const handleSaveSettings = async () => {
    if (!user?.id) {
      Alert.alert('Error', 'User authentication missing. Please restart the app.');
      return;
    }

    setSaving(true);

    try {
      const settingsPayload = {
        push_enabled: pushEnabled,
        email_enabled: emailEnabled,
        sms_enabled: smsEnabled,
        alert_new_jobs: alertNewJobs,
        alert_payouts: alertPayouts,
        alert_messages: alertMessages,
        alert_verifications: alertVerifications,
        updated_at: new Date().toISOString(),
      };

      // مرحله ۱: چک کردن اینکه آیا از قبل ردیفی برای این کاربر وجود داره یا نه
      const { data: existing, error: fetchError } = await supabase
        .from('admin_notification_settings')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (fetchError) throw fetchError;

      // مرحله ۲: اگر بود آپدیت کن، اگر نبود اینسرت کن (خداحافظ باگ Upsert)
      if (existing) {
        const { error: updateError } = await supabase
          .from('admin_notification_settings')
          .update(settingsPayload)
          .eq('user_id', user.id);

        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from('admin_notification_settings')
          .insert({ user_id: user.id, ...settingsPayload });

        if (insertError) throw insertError;
      }

      // مرحله ۳: آپدیت کردن اسنپ‌شات برای خاموش شدن دکمه سیو
      const newSnapshot: NotificationSettings = {
        push_enabled: pushEnabled,
        email_enabled: emailEnabled,
        sms_enabled: smsEnabled,
        alert_new_jobs: alertNewJobs,
        alert_payouts: alertPayouts,
        alert_messages: alertMessages,
        alert_verifications: alertVerifications,
      };
      setSavedSnapshot(newSnapshot);

      Alert.alert('Saved ✓', 'Your notification preferences have been saved.');
    } catch (error: any) {
      console.error('Save error:', error);
      Alert.alert(
        'Save Failed',
        error?.message ?? 'Failed to save settings. Check your database connection.'
      );
    } finally {
      setSaving(false);
    }
  };

  const SettingRow = ({
    icon,
    title,
    subtitle,
    value,
    onToggle,
    color,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    subtitle: string;
    value: boolean;
    onToggle: (v: boolean) => void;
    color: string;
  }) => (
    <View style={s.settingRow}>
      <View style={[s.settingIcon, { backgroundColor: color + '15' }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <View style={s.settingTextWrap}>
        <Text style={s.settingTitle}>{title}</Text>
        <Text style={s.settingSub}>{subtitle}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: SA.border, true: SA.accent }}
        thumbColor="#fff"
      />
    </View>
  );

  if (!user || loading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Notifications & Alerts' }} />
        <View style={s.center}>
          <ActivityIndicator size="large" color={SA.accent} />
          <Text style={[s.loadingText, { marginTop: 12 }]}>Loading settings…</Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Notifications & Alerts' }} />

      <ScrollView
        style={s.root}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={SA.accent}
          />
        }
      >
        <Text style={s.sectionTitle}>Delivery Channels</Text>
        <View style={s.card}>
          <SettingRow icon="notifications" title="Push Notifications" subtitle="Receive alerts on your device" value={pushEnabled} onToggle={setPushEnabled} color={SA.info} />
          <View style={s.divider} />
          <SettingRow icon="mail" title="Email Alerts" subtitle="Send summaries to admin@nexpec.com" value={emailEnabled} onToggle={setEmailEnabled} color={SA.warning} />
          <View style={s.divider} />
          <SettingRow icon="phone-portrait" title="SMS Alerts" subtitle="Text messages for critical alerts only" value={smsEnabled} onToggle={setSmsEnabled} color={SA.success} />
        </View>

        <Text style={s.sectionTitle}>Alert Triggers</Text>
        <View style={s.card}>
          <SettingRow icon="briefcase" title="New Jobs" subtitle="When clients post new inspections" value={alertNewJobs} onToggle={setAlertNewJobs} color={SA.accent} />
          <View style={s.divider} />
          <SettingRow icon="cash" title="Payouts & Finances" subtitle="When inspectors request funds" value={alertPayouts} onToggle={setAlertPayouts} color={SA.success} />
          <View style={s.divider} />
          <SettingRow icon="chatbubble-ellipses" title="Support Messages" subtitle="Direct messages from users" value={alertMessages} onToggle={setAlertMessages} color={SA.warning} />
          <View style={s.divider} />
          <SettingRow icon="shield-checkmark" title="ID Verifications" subtitle="When users upload new documents" value={alertVerifications} onToggle={setAlertVerifications} color={SA.info} />
        </View>

        <TouchableOpacity
          style={[
            s.saveButton,
            !hasChanges && s.saveButtonDisabled,
            saving && { opacity: 0.7 },
          ]}
          onPress={handleSaveSettings}
          disabled={saving || !hasChanges}
          activeOpacity={0.75}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="save-outline" size={20} color="#fff" />
              <Text style={s.saveButtonText}>
                {hasChanges ? 'Save Settings' : 'All Settings Saved'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {hasChanges && (
          <View style={s.unsavedBanner}>
            <Ionicons name="alert-circle" size={16} color={SA.warning} />
            <Text style={s.unsavedText}>You have unsaved changes</Text>
          </View>
        )}

        <Text style={s.sectionTitle}>Recent Activity</Text>
        <View style={s.card}>
          {recentAlerts.map((alert, index) => (
            <React.Fragment key={alert.id}>
              <View style={[s.alertRow, alert.isRead ? { opacity: 0.55 } : null]}>
                <View style={[s.alertIcon, { backgroundColor: SA.surfaceLight }]}>
                  <Ionicons name={alert.icon} size={18} color={SA.textSec} />
                </View>
                <View style={s.alertTextWrap}>
                  <Text style={[s.alertTitle, !alert.isRead && { color: SA.text, fontWeight: '700' }]}>{alert.title}</Text>
                  <Text style={s.alertDesc} numberOfLines={2}>{alert.desc}</Text>
                </View>
                <Text style={s.alertTime}>{ago(alert.time)}</Text>
                {!alert.isRead && <View style={s.unreadDot} />}
              </View>
              {index < recentAlerts.length - 1 && <View style={s.divider} />}
            </React.Fragment>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: SA.bg, paddingHorizontal: 16, paddingTop: 16 },
  center: { flex: 1, backgroundColor: SA.bg, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: SA.textMuted, fontSize: 13 },
  sectionTitle: { color: SA.textSec, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, marginTop: 8 },
  card: { backgroundColor: SA.surface, borderRadius: SA.radius, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: SA.border },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  settingIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  settingTextWrap: { flex: 1, paddingRight: 10 },
  settingTitle: { color: SA.text, fontSize: 15, fontWeight: '600', marginBottom: 2 },
  settingSub: { color: SA.textMuted, fontSize: 12 },
  divider: { height: 1, backgroundColor: SA.border, marginVertical: 12 },
  saveButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: SA.accent, paddingVertical: 16, borderRadius: SA.radius, marginBottom: 12, gap: 8 },
  saveButtonDisabled: { backgroundColor: SA.surfaceLight, opacity: 0.6 },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  unsavedBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: SA.warningSoft, paddingVertical: 10, paddingHorizontal: 14, borderRadius: SA.radiusSm, marginBottom: 24 },
  unsavedText: { color: SA.warning, fontSize: 13, fontWeight: '600' },
  alertRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 4 },
  alertIcon: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginRight: 12, marginTop: 2 },
  alertTextWrap: { flex: 1, paddingRight: 10 },
  alertTitle: { color: SA.textSec, fontSize: 14, fontWeight: '600', marginBottom: 2 },
  alertDesc: { color: SA.textMuted, fontSize: 12, lineHeight: 18 },
  alertTime: { color: SA.textMuted, fontSize: 11, marginTop: 2 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: SA.danger, position: 'absolute', top: 6, right: -4 },
});