// src/screens/Settings/NotificationSettings.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, Switch, StyleSheet, ActivityIndicator } from 'react-native';
import { supabase } from '../../lib/supabase';

export const NotificationSettings = () => {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchSettings = async () => {
    const { data } = await supabase
      .from('notification_settings')
      .select('*')
      .single();
    setSettings(data);
    setLoading(false);
  };

  const toggleSetting = async (key: string, value: boolean) => {
    setSettings((prev: any) => ({ ...prev, [key]: value }));
    await supabase
      .from('notification_settings')
      .update({ [key]: value })
      .eq('user_id', settings.user_id);
  };

  useEffect(() => { fetchSettings(); }, []);

  if (loading) return <ActivityIndicator style={{ flex: 1 }} />;

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Email Notifications</Text>
      <View style={styles.row}>
        <Text>Dispute Updates</Text>
        <Switch 
          value={settings.email_disputes} 
          onValueChange={(v) => toggleSetting('email_disputes', v)} 
        />
      </View>

      <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Push Notifications</Text>
      <View style={styles.row}>
        <Text>Project Disputes</Text>
        <Switch 
          value={settings.push_disputes} 
          onValueChange={(v) => toggleSetting('push_disputes', v)} 
        />
      </View>
      <View style={styles.row}>
        <Text>Project Updates</Text>
        <Switch 
          value={settings.push_project_updates} 
          onValueChange={(v) => toggleSetting('push_project_updates', v)} 
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#FFF' },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#374151', marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }
});