// ============================================================
// LiveRadar – Pulsing green indicator for on-site inspectors
// Shows when is_on_site = true AND status = 'in_progress'
// ============================================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Animated,
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../lib/supabase';
import { CLIENT_THEME as T } from './theme';
import type { Project } from './types';

interface Props {
  clientId: string;
}

export default function LiveRadar({ clientId }: Props) {
  const [activeProjects, setActiveProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOnSite = useCallback(async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('*, inspector:profiles!inspector_id(id, full_name, avatar_url)')
      .eq('client_id', clientId)
      .eq('is_on_site', true)
      .eq('status', 'in_progress');

    if (!error && data) {
      setActiveProjects(data as Project[]);
    }
    setLoading(false);
  }, [clientId]);

  useEffect(() => {
    fetchOnSite();

    const channel = supabase
      .channel('client-live-radar')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'projects',
          filter: `client_id=eq.${clientId}`,
        },
        () => fetchOnSite(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clientId, fetchOnSite]);

  return (
    <View style={styles.container}>
      {/* Section Header */}
      <View style={styles.sectionHeader}>
        <Ionicons name="radio-outline" size={20} color={T.green} />
        <Text style={styles.sectionTitle}>Live On-Site Radar</Text>
        {activeProjects.length > 0 && (
          <View style={styles.liveBadge}>
            <View style={styles.liveDotSmall} />
            <Text style={styles.liveText}>{activeProjects.length} Active</Text>
          </View>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={T.green} size="small" style={{ padding: 20 }} />
      ) : activeProjects.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="radio-outline" size={32} color={T.textMuted} />
          <Text style={styles.emptyTitle}>No Active Inspections</Text>
          <Text style={styles.emptySubtitle}>
            When an inspector is on-site, they'll appear here in real time.
          </Text>
        </View>
      ) : (
        activeProjects.map((project) => (
          <OnSiteCard key={project.id} project={project} />
        ))
      )}
    </View>
  );
}

// ── On-Site Card ─────────────────────────────────────────

function OnSiteCard({ project }: { project: Project }) {
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseScale, {
            toValue: 2.2,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(pulseScale, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(pulseOpacity, {
            toValue: 0,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(pulseOpacity, {
            toValue: 0.6,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const duration = getActiveDuration(project.updated_at);

  return (
    <View style={styles.card}>
      {/* Pulsing Avatar Area */}
      <View style={styles.avatarContainer}>
        <Animated.View
          style={[
            styles.pulseRing,
            {
              transform: [{ scale: pulseScale }],
              opacity: pulseOpacity,
            },
          ]}
        />
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarLetter}>
            {(project.inspector?.full_name ?? '?')[0].toUpperCase()}
          </Text>
        </View>
        <View style={styles.statusDot} />
      </View>

      {/* Info */}
      <View style={styles.cardInfo}>
        <Text style={styles.inspectorName} numberOfLines={1}>
          {project.inspector?.full_name ?? 'Unknown Inspector'}
        </Text>
        <View style={styles.locationRow}>
          <Ionicons name="location" size={12} color={T.green} />
          <Text style={styles.locationText} numberOfLines={1}>
            Active at {project.location}
          </Text>
        </View>
        <Text style={styles.durationText}>On-site for {duration}</Text>
      </View>

      {/* Live Indicator */}
      <View style={styles.liveTag}>
        <Text style={styles.liveTagText}>LIVE</Text>
      </View>
    </View>
  );
}

// ── Helpers ──────────────────────────────────────────────

function getActiveDuration(isoUpdated: string): string {
  const diff = Date.now() - new Date(isoUpdated).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

// ── Styles ───────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { marginBottom: 24 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  sectionTitle: {
    color: T.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.greenDim,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 5,
  },
  liveDotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: T.green,
  },
  liveText: {
    color: T.green,
    fontSize: 11,
    fontWeight: '700',
  },

  // ── Card ──
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.card,
    borderRadius: T.radiusMd,
    borderWidth: 1,
    borderColor: T.green + '22',
    padding: 14,
    marginBottom: 10,
  },

  // ── Avatar & Pulse ──
  avatarContainer: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: T.green,
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: T.greenDim,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: T.green,
  },
  avatarLetter: {
    color: T.green,
    fontSize: 15,
    fontWeight: '800',
  },
  statusDot: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: T.green,
    borderWidth: 2,
    borderColor: T.card,
  },

  // ── Info ──
  cardInfo: {
    flex: 1,
    marginLeft: 12,
  },
  inspectorName: {
    color: T.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 3,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  locationText: {
    color: T.green,
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  durationText: {
    color: T.textMuted,
    fontSize: 11,
  },

  // ── Live Tag ──
  liveTag: {
    backgroundColor: T.green,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  liveTagText: {
    color: T.textInverse,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },

  // ── Empty ──
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.card,
    borderRadius: T.radiusMd,
    borderWidth: 1,
    borderColor: T.border,
    paddingVertical: 32,
    paddingHorizontal: 24,
    gap: 6,
  },
  emptyTitle: {
    color: T.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  emptySubtitle: {
    color: T.textMuted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});