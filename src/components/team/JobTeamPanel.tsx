// src/components/team/JobTeamPanel.tsx — the inspector's view of their team.
//
// Drop into the existing Job Details screen. READ-ONLY by design: normal
// inspectors see who is on the job and in what discipline, and never get team
// management. nx_job_add_inspector / nx_job_remove_inspector / nx_job_set_lead
// are admin-gated in the database and are deliberately not referenced here at
// all, so this file cannot become an accidental management surface.
//
// ── WHAT IT SHOWS ───────────────────────────────────────────────────────────
// Reads the canonical nx_job_inspectors(jobId), which authorises the caller in
// its own body (admin, job party, contracted inspector, or an active team
// member). An unrelated inspector gets an error, not an empty list, and this
// panel renders nothing rather than implying "no team".
//
// ── PRIVACY ─────────────────────────────────────────────────────────────────
// The RPC returns no pricing column of any kind, so no payout, buyer price or
// platform margin can reach this component. Identity handling is the database's
// job, not this panel's: teammate names arrive already resolved under the
// server's rules. This file adds no name lookup of its own.
//
// ── LEGACY JOBS ─────────────────────────────────────────────────────────────
// A job with no explicit team returns one row with from_fallback = true, built
// from jobs.contractor_id. Rather than render a misleading one-person "Team"
// card, the panel stays hidden unless the viewer is that inspector — in which
// case it simply confirms they are the assigned inspector.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NEXPEC_THEME as T } from '../DynamicForm/theme';
import { supabase } from '@/lib/supabase';

export interface JobTeamMember {
  inspector_id: string;
  full_name: string | null;
  role: string;
  specialty_slug: string | null;
  status: string;
  is_lead: boolean;
  assigned_at: string | null;
  is_contracted: boolean;
  from_fallback: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  lead: 'Lead inspector',
  inspector: 'Inspector',
  mechanical: 'Mechanical',
  electrical: 'Electrical',
  welding_ndt: 'Welding / NDT',
  coating: 'Coating',
  civil: 'Civil',
  specialist: 'Specialist',
  trainee: 'Trainee',
  observer: 'Observer',
};

export function JobTeamPanel({ jobId, viewerId }: { jobId: string; viewerId?: string | null }) {
  const [items, setItems] = useState<JobTeamMember[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('nx_job_inspectors', { p_job_id: jobId });
    if (rpcError) {
      // Not authorised is the normal case for someone merely browsing an open
      // job — that is not an error worth showing, so the panel hides itself.
      const notAuthorised = /not authorized|42501/i.test(rpcError.message);
      setError(notAuthorised ? null : rpcError.message);
      setItems(notAuthorised ? [] : null);
      setLoading(false);
      return;
    }
    setItems((data ?? []) as JobTeamMember[]);
    setLoading(false);
  }, [jobId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <View style={s.card}>
        <View style={s.headerRow}>
          <Ionicons name="people-outline" size={16} color={T.colors.textMuted} />
          <Text style={s.header}>Inspection team</Text>
        </View>
        <ActivityIndicator style={{ marginTop: 12 }} color={T.colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={s.card}>
        <View style={s.headerRow}>
          <Ionicons name="people-outline" size={16} color={T.colors.textMuted} />
          <Text style={s.header}>Inspection team</Text>
        </View>
        <Text style={s.error}>Could not load the team. {error}</Text>
        <TouchableOpacity onPress={() => void load()} style={s.retry} accessibilityRole="button">
          <Text style={s.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const team = items ?? [];
  if (team.length === 0) return null;

  // Legacy single-inspector job: only meaningful to the assigned inspector.
  const fallbackOnly = team.length === 1 && team[0].from_fallback;
  if (fallbackOnly && (!viewerId || team[0].inspector_id !== viewerId)) return null;

  const me = viewerId ? team.find((m) => m.inspector_id === viewerId) : undefined;

  return (
    <View style={s.card}>
      <View style={s.headerRow}>
        <Ionicons name="people-outline" size={16} color={T.colors.textMuted} />
        <Text style={s.header}>
          Inspection team{team.length > 1 ? ` · ${team.length}` : ''}
        </Text>
      </View>

      {me && (
        <View style={s.youRow}>
          <Ionicons
            name={me.is_lead ? 'ribbon' : 'checkmark-circle'}
            size={14}
            color={me.is_lead ? '#F5A524' : T.colors.success}
          />
          <Text style={s.youText}>
            {me.is_lead ? 'You are the lead inspector' : 'You are on this team'}
            {me.role && me.role !== 'lead' ? ` · ${ROLE_LABELS[me.role] ?? me.role}` : ''}
            {me.specialty_slug ? ` · ${me.specialty_slug}` : ''}
          </Text>
        </View>
      )}

      {fallbackOnly ? (
        <Text style={s.muted}>
          You are the assigned inspector for this job. No additional team members
          have been added.
        </Text>
      ) : (
        team.map((m) => {
          const isYou = viewerId != null && m.inspector_id === viewerId;
          return (
            <View key={m.inspector_id} style={s.row}>
              <View style={s.rowMain}>
                <Text style={s.name} numberOfLines={1}>
                  {m.full_name ?? 'Inspector'}
                  {isYou ? ' (you)' : ''}
                </Text>
                <Text style={s.meta} numberOfLines={1}>
                  {ROLE_LABELS[m.role] ?? m.role}
                  {m.specialty_slug ? ` · ${m.specialty_slug}` : ''}
                  {m.is_contracted ? ' · contracted' : ''}
                </Text>
              </View>
              {m.is_lead && (
                <View style={s.leadChip}>
                  <Ionicons name="ribbon-outline" size={11} color="#F5A524" />
                  <Text style={s.leadText}>Lead</Text>
                </View>
              )}
            </View>
          );
        })
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: T.colors.cardBackground,
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: T.colors.inputBorder,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  header: { color: T.colors.text, fontSize: 14, fontWeight: '700' },
  youRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 10, paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.colors.inputBorder,
  },
  youText: { color: T.colors.text, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 10, paddingVertical: 8,
  },
  rowMain: { flexShrink: 1 },
  name: { color: T.colors.text, fontSize: 13, fontWeight: '600' },
  meta: { color: T.colors.textMuted, fontSize: 11, marginTop: 2 },
  muted: { color: T.colors.textMuted, fontSize: 12, marginTop: 10, lineHeight: 17 },
  leadChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(245,165,36,0.12)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  leadText: { color: '#F5A524', fontSize: 10, fontWeight: '700' },
  error: { color: T.colors.error, fontSize: 12, marginTop: 10 },
  retry: { marginTop: 8, alignSelf: 'flex-start' },
  retryText: { color: T.colors.primary, fontSize: 12, fontWeight: '700' },
});

export default JobTeamPanel;
