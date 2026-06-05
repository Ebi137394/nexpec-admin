// ════════════════════════════════════════════════════════════════════════════
//  app/(client)/team.tsx — Mobile Team Management + Invites (web parity)
//
//  Mirrors web /client/team. Resolves the caller's orgs via fetch_my_org_memberships,
//  shows the member roster (org_members + profiles) and pending invitations
//  (org_invitations), and — for owners / procurement_admins / God-mode admin —
//  invite + revoke via the verified RPCs invite_org_member / revoke_org_invitation.
//  All schema verified against migrations (20260521120000 / 20260518220000 /
//  20260531120000). canManage mirrors the RPC gate; the RPC is the real gate.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, RefreshControl, StatusBar, SafeAreaView, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';

const C = {
  bg: '#020420', card: '#0B1138',
  border: 'rgba(255,255,255,0.06)',
  text: '#FFFFFF', textSec: '#A8B2C7', textMute: '#6B7390',
  primary: '#7C3AED', primaryDim: 'rgba(124,58,237,0.14)',
  cyan: '#00FFFF', cyanDim: 'rgba(0,255,255,0.12)',
  green: '#10B981', greenDim: 'rgba(16,185,129,0.14)',
  amber: '#F59E0B', amberDim: 'rgba(245,158,11,0.14)',
  red: '#EF4444', redDim: 'rgba(239,68,68,0.14)',
};

type OrgRole = 'owner' | 'procurement_admin' | 'project_lead' | 'viewer';
const ROLE_LABEL: Record<OrgRole, string> = {
  owner: 'Owner', procurement_admin: 'Procurement admin', project_lead: 'Project lead', viewer: 'Viewer',
};
const ROLE_TONE: Record<OrgRole, string> = {
  owner: C.primary, procurement_admin: C.cyan, project_lead: C.green, viewer: C.textMute,
};
const INVITE_ROLES: OrgRole[] = ['viewer', 'project_lead', 'procurement_admin', 'owner'];

interface OrgEntry { id: string; name: string; role: OrgRole; isActive: boolean; }
interface Member { id: string; userId: string; role: OrgRole; name: string | null; email: string | null; joined: string; }
interface Invite { id: string; email: string; role: OrgRole; expiresAt: string; }

export default function TeamScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [orgs, setOrgs] = useState<OrgEntry[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('viewer');
  const [sending, setSending] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const myRole = useMemo(() => orgs.find((o) => o.id === orgId)?.role ?? null, [orgs, orgId]);
  const canManage = useMemo(
    () => isAdmin || myRole === 'owner' || myRole === 'procurement_admin',
    [isAdmin, myRole],
  );

  const loadOrgScope = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('You must be signed in.'); return null; }
    setUid(user.id);
    const profRes = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    const role = (profRes.data as { role?: string } | null)?.role;
    setIsAdmin(role === 'admin' || role === 'super_admin');

    const { data, error: rpcErr } = await supabase.rpc('fetch_my_org_memberships' as never);
    if (rpcErr) { setError(rpcErr.message); return null; }
    const list = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.org_id ?? ''),
      name: String(r.org_name ?? 'Organization'),
      role: (r.role as OrgRole) ?? 'viewer',
      isActive: r.is_active_org === true,
    })).filter((o) => o.id);
    setOrgs(list);
    const active = list.find((o) => o.isActive)?.id ?? list[0]?.id ?? null;
    return active;
  }, []);

  const loadTeam = useCallback(async (targetOrg: string) => {
    const [memRes, invRes, orgMemRes] = await Promise.all([
      supabase.from('org_members').select('id, user_id, role, created_at').eq('org_id', targetOrg).order('created_at', { ascending: true }),
      supabase.from('org_invitations').select('id, invited_email, invited_role, expires_at, accepted_at, revoked_at').eq('org_id', targetOrg).order('created_at', { ascending: false }),
      Promise.resolve(null),
    ]);
    if (memRes.error) { setError(memRes.error.message); return; }
    const memRows = (memRes.data ?? []) as Array<Record<string, unknown>>;
    const userIds = Array.from(new Set(memRows.map((r) => String(r.user_id ?? '')).filter(Boolean)));
    const byId = new Map<string, { full_name: string | null; email: string | null }>();
    if (userIds.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name, email').in('id', userIds);
      (profs as Array<{ id: string; full_name: string | null; email: string | null }> | null)?.forEach((p) =>
        byId.set(p.id, { full_name: p.full_name, email: p.email }));
    }
    setMembers(memRows.map((r) => {
      const p = byId.get(String(r.user_id ?? ''));
      return {
        id: String(r.id), userId: String(r.user_id ?? ''),
        role: (r.role as OrgRole) ?? 'viewer',
        name: p?.full_name ?? null, email: p?.email ?? null,
        joined: String(r.created_at ?? ''),
      };
    }));
    const invRows = (invRes.data ?? []) as Array<Record<string, unknown>>;
    setInvites(invRows
      .filter((r) => !r.accepted_at && !r.revoked_at)
      .map((r) => ({ id: String(r.id), email: String(r.invited_email ?? ''), role: (r.invited_role as OrgRole) ?? 'viewer', expiresAt: String(r.expires_at ?? '') })));
  }, []);

  const load = useCallback(async (target?: string) => {
    setError(null);
    try {
      const org = target ?? (await loadOrgScope());
      if (!org) return;
      setOrgId(org);
      await loadTeam(org);
    } catch (e: unknown) {
      console.warn('[team] load threw:', e);
      setError((e as Error)?.message ?? 'Could not load the team.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadOrgScope, loadTeam]);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); void load(orgId ?? undefined); }, [load, orgId]);

  const sendInvite = useCallback(async () => {
    const clean = email.trim().toLowerCase();
    if (!orgId) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) { Alert.alert('Invalid email', 'Enter a valid email address.'); return; }
    setSending(true);
    try {
      const { error: rpcErr } = await supabase.rpc('invite_org_member' as never, // outbox-exempt: online org-governance RPC (server-gated, dup-guarded)
        { p_org_id: orgId, p_email: clean, p_role: inviteRole } as never);
      if (rpcErr) {
        Alert.alert('Could not invite', /already|duplicate|pending/i.test(rpcErr.message) ? 'There is already a pending invite for that email.' : rpcErr.message);
        return;
      }
      setEmail(''); setInviteRole('viewer');
      await loadTeam(orgId);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error)?.message ?? 'Unknown error.');
    } finally {
      setSending(false);
    }
  }, [email, inviteRole, orgId, loadTeam]);

  const revokeInvite = useCallback((inv: Invite) => {
    if (!orgId) return;
    Alert.alert('Revoke invitation', `Revoke the invite for ${inv.email}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke', style: 'destructive', onPress: async () => {
          setRevoking(inv.id);
          setInvites((prev) => prev.filter((i) => i.id !== inv.id)); // optimistic
          try {
            const { error: rpcErr } = await supabase.rpc('revoke_org_invitation' as never, // outbox-exempt: online org-governance RPC (idempotent)
              { p_invitation_id: inv.id } as never);
            if (rpcErr) { Alert.alert('Could not revoke', rpcErr.message); await loadTeam(orgId); }
          } catch (e: unknown) {
            Alert.alert('Error', (e as Error)?.message ?? 'Unknown error.'); await loadTeam(orgId);
          } finally {
            setRevoking(null);
          }
        },
      },
    ]);
  }, [orgId, loadTeam]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}><StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}><ActivityIndicator size="large" color={C.primary} /><Text style={s.centerText}>Loading team…</Text></View>
      </SafeAreaView>
    );
  }

  const activeOrg = orgs.find((o) => o.id === orgId);

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><Ionicons name="arrow-back" size={22} color={C.text} /></TouchableOpacity>
        <Text style={s.headerTitle}>Team</Text>
        <View style={{ width: 22 }} />
      </View>

      {!orgId ? (
        <View style={s.center}><View style={s.reservedCard}><Ionicons name="people-outline" size={20} color={C.amber} /><Text style={s.reservedTitle}>No organization</Text><Text style={s.reservedBody}>{error ?? 'Your account is not a member of any organization yet.'}</Text></View></View>
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={s.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
          >
            <Animated.View entering={FadeIn.duration(220)} style={s.heroWrap}>
              <Text style={s.kicker}>CLIENT PORTAL, ORGANIZATION</Text>
              <Text style={s.title}>{activeOrg?.name ?? 'Team'}</Text>
              <Text style={s.subtitle}>{members.length} member{members.length === 1 ? '' : 's'}{invites.length > 0 ? `, ${invites.length} pending invite${invites.length === 1 ? '' : 's'}` : ''}.</Text>

              {orgs.length > 1 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.orgRow}>
                  {orgs.map((o) => {
                    const active = o.id === orgId;
                    return (
                      <TouchableOpacity key={o.id} onPress={() => { setLoading(true); void load(o.id); }} style={[s.orgChip, active && s.orgChipActive]} activeOpacity={0.7}>
                        <Text style={[s.orgChipText, active && s.orgChipTextActive]} numberOfLines={1}>{o.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </Animated.View>

            {error ? (<View style={s.errorBanner}><Ionicons name="alert-circle" size={16} color={C.red} /><Text style={s.errorText}>{error}</Text></View>) : null}

            {/* Invite form */}
            {canManage && (
              <Animated.View entering={FadeInDown.delay(60).duration(240)} style={s.inviteCard}>
                <Text style={s.sectionLabel}>INVITE A TEAMMATE</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="name@company.com"
                  placeholderTextColor={C.textMute}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={s.input}
                />
                <View style={s.roleRow}>
                  {INVITE_ROLES.map((r) => {
                    const active = inviteRole === r;
                    return (
                      <TouchableOpacity key={r} onPress={() => setInviteRole(r)} style={[s.roleChip, active && { backgroundColor: C.primaryDim, borderColor: 'rgba(124,58,237,0.45)' }]} activeOpacity={0.7}>
                        <Text style={[s.roleChipText, active && { color: C.primary, fontWeight: '700' }]}>{ROLE_LABEL[r]}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TouchableOpacity style={[s.sendBtn, (sending || !email.trim()) && { opacity: 0.5 }]} onPress={sendInvite} disabled={sending || !email.trim()} activeOpacity={0.85}>
                  {sending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="paper-plane-outline" size={16} color="#fff" />}
                  <Text style={s.sendBtnText}>Send invitation</Text>
                </TouchableOpacity>
                <Text style={s.inviteHint}>Invitations expire after 14 days.</Text>
              </Animated.View>
            )}

            {/* Pending invitations */}
            {canManage && invites.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text style={s.sectionLabel}>PENDING ({invites.length})</Text>
                {invites.map((inv) => (
                  <View key={inv.id} style={s.inviteRow}>
                    <View style={s.inviteIcon}><Ionicons name="mail-outline" size={16} color={C.amber} /></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.inviteEmail} numberOfLines={1}>{inv.email}</Text>
                      <Text style={s.inviteMeta}>{ROLE_LABEL[inv.role]}, expires {formatDate(inv.expiresAt)}</Text>
                    </View>
                    <TouchableOpacity onPress={() => revokeInvite(inv)} disabled={revoking === inv.id} style={s.revokeBtn} activeOpacity={0.7}>
                      {revoking === inv.id ? <ActivityIndicator size="small" color={C.red} /> : <Text style={s.revokeText}>Revoke</Text>}
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Member roster */}
            <View style={{ gap: 8 }}>
              <Text style={s.sectionLabel}>MEMBERS ({members.length})</Text>
              {members.map((m) => (
                <View key={m.id} style={s.memberRow}>
                  <View style={s.avatar}><Text style={s.avatarText}>{initials(m.name ?? m.email ?? '?')}</Text></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={s.memberTop}>
                      <Text style={s.memberName} numberOfLines={1}>{m.name ?? m.email ?? m.userId.slice(0, 8)}</Text>
                      {m.userId === uid && <View style={s.youPill}><Text style={s.youPillText}>YOU</Text></View>}
                    </View>
                    {m.email && <Text style={s.memberEmail} numberOfLines={1}>{m.email}</Text>}
                    <Text style={s.memberJoined}>Joined {formatDate(m.joined)}</Text>
                  </View>
                  <View style={[s.rolePill, { borderColor: ROLE_TONE[m.role] + '55', backgroundColor: ROLE_TONE[m.role] + '1A' }]}>
                    <Text style={[s.rolePillText, { color: ROLE_TONE[m.role] }]}>{ROLE_LABEL[m.role]}</Text>
                  </View>
                </View>
              ))}
            </View>

            <Text style={s.footnote}>Source, org_members + org_invitations, RLS org-scoped, invites via verified RPC.</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────
function initials(s: string): string {
  const parts = s.trim().split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { padding: 16, paddingBottom: 64, gap: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14, padding: 32 },
  centerText: { color: C.textSec, fontSize: 13 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { color: C.text, fontSize: 16, fontWeight: '700' },

  heroWrap: { gap: 6 },
  kicker: { color: 'rgba(124,58,237,0.85)', fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: C.text, fontSize: 26, fontWeight: '700', marginTop: 4 },
  subtitle: { color: C.textSec, fontSize: 13, lineHeight: 20, marginTop: 4 },
  orgRow: { gap: 8, paddingVertical: 10, paddingHorizontal: 2 },
  orgChip: { maxWidth: 200, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(255,255,255,0.02)' },
  orgChipActive: { backgroundColor: C.primaryDim, borderColor: 'rgba(124,58,237,0.45)' },
  orgChipText: { color: C.textSec, fontSize: 12, fontWeight: '600' },
  orgChipTextActive: { color: C.primary, fontWeight: '700' },

  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.redDim, borderColor: 'rgba(239,68,68,0.32)', borderWidth: 1, padding: 12, borderRadius: 12 },
  errorText: { color: '#FCA5A5', fontSize: 13, flex: 1 },

  sectionLabel: { color: C.textMute, fontSize: 10, fontWeight: '700', letterSpacing: 0.9 },

  inviteCard: { borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, padding: 14, gap: 10 },
  input: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, borderWidth: 1, borderColor: C.border, color: C.text, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 },
  roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  roleChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(255,255,255,0.02)' },
  roleChipText: { color: C.textSec, fontSize: 12, fontWeight: '600' },
  sendBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12, marginTop: 2 },
  sendBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  inviteHint: { color: C.textMute, fontSize: 10, textAlign: 'center' },

  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  inviteIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.amberDim, justifyContent: 'center', alignItems: 'center' },
  inviteEmail: { color: C.text, fontSize: 13, fontWeight: '600' },
  inviteMeta: { color: C.textMute, fontSize: 10, marginTop: 2 },
  revokeBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(239,68,68,0.32)', backgroundColor: C.redDim },
  revokeText: { color: C.red, fontSize: 11, fontWeight: '700' },

  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.primaryDim, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: C.primary, fontSize: 13, fontWeight: '800' },
  memberTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  memberName: { color: C.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  memberEmail: { color: C.textMute, fontSize: 11, marginTop: 1 },
  memberJoined: { color: C.textMute, fontSize: 10, marginTop: 2 },
  youPill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(124,58,237,0.4)', backgroundColor: C.primaryDim },
  youPillText: { color: C.primary, fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  rolePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  rolePillText: { fontSize: 9, fontWeight: '700' },

  reservedCard: { alignItems: 'center', gap: 8, padding: 24, maxWidth: 320, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(245,158,11,0.32)', backgroundColor: C.amberDim },
  reservedTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  reservedBody: { color: C.textSec, fontSize: 13, textAlign: 'center', lineHeight: 18 },

  footnote: { color: C.textMute, fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 8 },
});
