// ============================================================
// CriticalAlerts – Real-time banner for severity === 'critical'
// Subscribes via Supabase Realtime; auto-stacks newest on top.
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { CLIENT_THEME as T } from './theme';
import type { Finding } from './types';

interface Props {
  clientId: string;
}

interface AlertItem extends Finding {
  _key: string;  // dedup key
}

export default function CriticalAlerts({ clientId }: Props) {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);

  // ── Realtime subscription ──────────────────────────────
  useEffect(() => {
    // Initial fetch of recent criticals (last 24 h)
    const fetchRecent = async () => {
      const since = new Date(Date.now() - 86_400_000).toISOString();

      const { data } = await supabase
        .from('findings')
        .select('*, project:projects!inner(title, location, client_id)')
        .eq('severity', 'critical')
        .eq('project.client_id', clientId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(5);

      if (data) {
        setAlerts(
          data.map((f: any) => ({
            ...f,
            project: { title: f.project.title, location: f.project.location },
            _key: f.id,
          })),
        );
      }
    };
    fetchRecent();

    // Live channel
    const channel = supabase
      .channel('client-critical-alerts')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'findings',
          filter: `severity=eq.critical`,
        },
        async (payload: { new: Finding }) => {
          const newFinding = payload.new;

          // Verify it belongs to this client
          const { data: proj } = await supabase
            .from('projects')
            .select('title, location, client_id')
            .eq('id', newFinding.project_id)
            .single();

          if (proj?.client_id !== clientId) return;

          const alertItem: AlertItem = {
            ...newFinding,
            project: { title: proj.title, location: proj.location },
            _key: newFinding.id,
          };

          setAlerts((prev) => [alertItem, ...prev].slice(0, 8));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clientId]);

  // ── Dismiss ────────────────────────────────────────────
  const dismiss = (key: string) => {
    setAlerts((prev) => prev.filter((a) => a._key !== key));
  };

  if (alerts.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="warning" size={18} color={T.red} />
        <Text style={styles.headerText}>Critical Alerts</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{alerts.length}</Text>
        </View>
      </View>

      {alerts.map((alert) => (
        <AlertBanner key={alert._key} alert={alert} onDismiss={dismiss} />
      ))}
    </View>
  );
}

// ── Single alert banner with slide-in ────────────────────

function AlertBanner({
  alert,
  onDismiss,
}: {
  alert: AlertItem;
  onDismiss: (key: string) => void;
}) {
  const slideAnim = useRef(new Animated.Value(-100)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 60,
        friction: 10,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const timeAgo = getRelativeTime(alert.created_at);

  return (
    <Animated.View
      style={[
        styles.alertCard,
        {
          transform: [{ translateY: slideAnim }],
          opacity: opacityAnim,
        },
      ]}
    >
      <View style={styles.alertIconCol}>
        <View style={styles.alertDot} />
      </View>

      <View style={styles.alertBody}>
        <Text style={styles.alertDesc} numberOfLines={2}>
          {alert.description}
        </Text>
        <Text style={styles.alertMeta}>
          {alert.project?.title ?? 'Unknown Project'} · {timeAgo}
        </Text>
      </View>

      <Pressable
        onPress={() => onDismiss(alert._key)}
        hitSlop={12}
        style={styles.dismissBtn}
        accessibilityLabel="Dismiss alert"
      >
        <Ionicons name="close" size={16} color={T.textMuted} />
      </Pressable>
    </Animated.View>
  );
}

// ── Helpers ──────────────────────────────────────────────

function getRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Styles ───────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  headerText: {
    color: T.red,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  badge: {
    backgroundColor: T.redDim,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    color: T.red,
    fontSize: 12,
    fontWeight: '700',
  },

  alertCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: T.redDim + '44', // translucent
    borderWidth: 1,
    borderColor: T.red + '33',
    borderRadius: T.radiusMd,
    padding: 12,
    marginBottom: 8,
  },
  alertIconCol: {
    width: 24,
    alignItems: 'center',
    paddingTop: 4,
  },
  alertDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: T.red,
  },
  alertBody: {
    flex: 1,
    marginLeft: 4,
  },
  alertDesc: {
    color: T.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  alertMeta: {
    color: T.textMuted,
    fontSize: 11,
    marginTop: 4,
  },
  dismissBtn: {
    padding: 4,
    marginLeft: 8,
  },
});