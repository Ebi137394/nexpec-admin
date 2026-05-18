// ════════════════════════════════════════════════════════════════════════════
//  app/(admin)/audit-trail.tsx
//  NEXPEC — Industrial Black Box (Patch 5 / v1)
//
//  Admin-only top-level "Command Center" screen. Renders the full audit
//  timeline across every job on the platform.
//
//  Optional ?jobId query param deep-links to a single job's timeline —
//  used by the Spread Editor's "View Full Audit Trail" action and by
//  notification taps. When jobId is set, the screen title narrows to
//  "Job Audit Trail" and an "All Events" back-chip is shown.
//
//  Layout strategy: zero chrome. The AuditTimeline owns its own filter
//  strip, header, list, empty state. The Stack header (from _layout.tsx)
//  provides the title. RLS is bypassed via asAdmin=true since this route
//  is already gated by the super-admin layout's auth guard.
// ════════════════════════════════════════════════════════════════════════════

import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AuditTimeline from '@/src/components/audit/AuditTimeline';

// NEXPEC theme (locked) — matched to the rest of the super-admin surfaces.
const C = {
  bg:            '#020420',
  surface:       '#0A0E2E',
  border:        '#1A1F4E',
  primary:       '#7C3AED',
  primaryBg:     'rgba(124,58,237,0.12)',
  primaryBorder: 'rgba(124,58,237,0.40)',
  primaryLight:  '#8B5CF6',
  textPrimary:   '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted:     '#64748B',
};

export default function AuditTrailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ jobId?: string }>();
  const jobId  = params.jobId || undefined;

  const title = useMemo(
    () => (jobId ? 'Job Audit Trail' : 'Audit Trail'),
    [jobId],
  );

  return (
    <SafeAreaView style={s.root} edges={['bottom']}>
      <Stack.Screen options={{ title }} />

      {/* When deep-linked to a single job, give the admin a one-tap
          "All Events" pill to widen back to the global feed. */}
      {jobId && (
        <View style={s.scopeBar}>
          <View style={s.scopePill}>
            <Ionicons name="git-network-outline" size={12} color={C.primaryLight} />
            <Text style={s.scopePillText}>Scoped to one job</Text>
          </View>
          <TouchableOpacity
            style={s.scopeReset}
            onPress={() => router.replace('/(admin)/audit-trail' as any)}
            activeOpacity={0.8}
          >
            <Ionicons name="apps-outline" size={12} color={C.primary} />
            <Text style={s.scopeResetText}>All Events</Text>
          </TouchableOpacity>
        </View>
      )}

      <AuditTimeline
        jobId={jobId}
        asAdmin
        showHeader
        emptyTitle={
          jobId
            ? 'No events for this job yet'
            : 'No audit events captured yet'
        }
        emptySubtitle={
          jobId
            ? 'Events for this job will appear here in real time.'
            : 'Every consequential change on the platform is recorded here automatically.'
        }
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  scopeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  scopePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: C.primaryBg,
    borderWidth: 1,
    borderColor: C.primaryBorder,
  },
  scopePillText: {
    fontSize: 11,
    color: C.primaryLight,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  scopeReset: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  scopeResetText: {
    fontSize: 11,
    color: C.primary,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
