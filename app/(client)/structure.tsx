// ════════════════════════════════════════════════════════════════════════════
//  app/(client)/structure.tsx — Mobile Org Structure / Department Tree (web parity)
//
//  Mirrors web /client/structure (+ /admin/orgs/[id]/structure). Renders the
//  department hierarchy from fetch_department_tree and edits it through the
//  verified RPCs create_/rename_/move_/delete_department and
//  assign_/unassign_member_from_department — every one gated server-side by
//  can_manage_org_structure (God-mode admin OR org owner/procurement_admin).
//  All schema verified against migrations 20260526120000 / 20260527120000.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal,
  ActivityIndicator, RefreshControl, StatusBar, SafeAreaView, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';

const C = {
  bg: '#020420', card: '#0B1138', cardDeep: '#080C2A',
  border: 'rgba(255,255,255,0.06)',
  text: '#FFFFFF', textSec: '#A8B2C7', textMute: '#6B7390',
  primary: '#7C3AED', primaryDim: 'rgba(124,58,237,0.14)',
  cyan: '#00FFFF', green: '#10B981', amber: '#F59E0B', red: '#EF4444', redDim: 'rgba(239,68,68,0.14)',
};

interface Dept { id: string; parentId: string | null; name: string; costCenter: string | null; depth: number; memberCount: number; }
interface OrgEntry { id: string; name: string; role: string; isActive: boolean; }
interface Person { userId: string; name: string; }

type EditState = { mode: 'create-root' | 'create-child' | 'rename'; parentId: string | null; deptId: string | null; name: string; costCenter: string } | null;

export default function StructureScreen() {
  const { org: orgParam, create: createParam } = useLocalSearchParams<{ org?: string; create?: string }>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [orgs, setOrgs] = useState<OrgEntry[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [assignable, setAssignable] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [edit, setEdit] = useState<EditState>(null);
  const [moveFor, setMoveFor] = useState<Dept | null>(null);
  const [membersFor, setMembersFor] = useState<Dept | null>(null);
  const [deptMembers, setDeptMembers] = useState<Person[]>([]);
  const [membersBusy, setMembersBusy] = useState(false);
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgKind, setNewOrgKind] = useState<'enterprise' | 'agency'>('enterprise');
  const [creatingOrg, setCreatingOrg] = useState(false);

  const myRole = useMemo(() => orgs.find((o) => o.id === orgId)?.role ?? null, [orgs, orgId]);
  const canManage = useMemo(() => isAdmin || myRole === 'owner' || myRole === 'procurement_admin', [isAdmin, myRole]);

  const fetchTree = useCallback(async (org: string) => {
    const [treeRes, memRes] = await Promise.all([
      supabase.rpc('fetch_department_tree' as never, { p_org_id: org } as never),
      supabase.from('org_members').select('user_id').eq('org_id', org),
    ]);
    if (treeRes.error) { setError(treeRes.error.message); return; }
    const rows = ((treeRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id), parentId: (r.parent_department_id as string | null) ?? null,
      name: String(r.name ?? '(unnamed)'), costCenter: (r.cost_center as string | null) ?? null,
      depth: typeof r.depth === 'number' ? r.depth : Number(r.depth ?? 0),
      memberCount: typeof r.member_count === 'number' ? r.member_count : Number(r.member_count ?? 0),
    }));
    setDepts(rows);
    const userIds = Array.from(new Set(((memRes.data ?? []) as Array<{ user_id: string }>).map((m) => m.user_id).filter(Boolean)));
    const people: Person[] = [];
    if (userIds.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name, email').in('id', userIds);
      (profs as Array<{ id: string; full_name: string | null; email: string | null }> | null)?.forEach((p) =>
        people.push({ userId: p.id, name: p.full_name || p.email || p.id.slice(0, 8) }));
    }
    setAssignable(people);
  }, []);

  const load = useCallback(async (target?: string) => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('You must be signed in.'); return; }
      const profRes = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      const role = (profRes.data as { role?: string } | null)?.role;
      setIsAdmin(role === 'admin' || role === 'super_admin');

      const { data, error: rpcErr } = await supabase.rpc('fetch_my_org_memberships' as never);
      if (rpcErr) { setError(rpcErr.message); return; }
      let list = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        id: String(r.org_id ?? ''), name: String(r.org_name ?? 'Organization'),
        role: String(r.role ?? 'viewer'), isActive: r.is_active_org === true,
      })).filter((o) => o.id);
      // Admin drill-in (e.g. from Org Management) — include the targeted org even
      // if the admin isn't a member. canManage still resolves via God-mode isAdmin.
      if (target && !list.some((o) => o.id === target)) {
        const { data: o } = await supabase.from('organizations').select('id, name').eq('id', target).maybeSingle();
        const row = o as { id: string; name: string | null } | null;
        list = [{ id: target, name: row?.name ?? 'Organization', role: '', isActive: false }, ...list];
      }
      setOrgs(list);
      const org = target ?? (list.find((o) => o.isActive)?.id ?? list[0]?.id ?? null);
      if (!org) { setOrgId(null); return; }
      setOrgId(org);
      await fetchTree(org);
    } catch (e: unknown) {
      console.warn('[structure] load threw:', e);
      setError((e as Error)?.message ?? 'Could not load the structure.');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [fetchTree]);

  useEffect(() => { void load(orgParam ? String(orgParam) : undefined); }, [load, orgParam]);
  useEffect(() => { if (createParam === '1') setShowCreateOrg(true); }, [createParam]);
  const onRefresh = useCallback(() => { setRefreshing(true); void load(orgId ?? undefined); }, [load, orgId]);

  const createOrg = useCallback(async () => {
    const nm = newOrgName.trim();
    if (nm.length < 2) { Alert.alert('Name required', 'Organization name must be at least 2 characters.'); return; }
    setCreatingOrg(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc('create_organization' as never, // outbox-exempt: online org-governance RPC (creator becomes owner)
        { p_name: nm, p_kind: newOrgKind } as never);
      if (rpcErr) { Alert.alert('Could not create', rpcErr.message); return; }
      const newId = (data as { org_id?: string } | null)?.org_id ?? null;
      setShowCreateOrg(false); setNewOrgName(''); setNewOrgKind('enterprise'); setExpanded(null); setLoading(true);
      await load(newId ?? undefined);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error)?.message ?? 'Unknown error.');
    } finally { setCreatingOrg(false); }
  }, [newOrgName, newOrgKind, load]);

  // DFS order from roots so the flat list reads as a tree.
  const ordered = useMemo(() => {
    const byParent = new Map<string, Dept[]>();
    depts.forEach((d) => { const k = d.parentId ?? '__root__'; const a = byParent.get(k) ?? []; a.push(d); byParent.set(k, a); });
    const out: Dept[] = [];
    const walk = (key: string) => {
      (byParent.get(key) ?? []).sort((a, b) => a.name.localeCompare(b.name)).forEach((d) => { out.push(d); walk(d.id); });
    };
    walk('__root__');
    return out;
  }, [depts]);

  const reload = useCallback(async () => { if (orgId) await fetchTree(orgId); }, [orgId, fetchTree]);

  const saveEdit = useCallback(async () => {
    if (!edit || !orgId) return;
    const name = edit.name.trim();
    if (name.length < 1) { Alert.alert('Name required', 'Enter a department name.'); return; }
    const cc = edit.costCenter.trim() || null;
    setBusy(true);
    try {
      let rpcErr;
      if (edit.mode === 'rename') {
        ({ error: rpcErr } = await supabase.rpc('rename_department' as never, // outbox-exempt: online org-governance RPC (gated)
          { p_department_id: edit.deptId, p_name: name, p_cost_center: cc } as never));
      } else {
        ({ error: rpcErr } = await supabase.rpc('create_department' as never, // outbox-exempt: online org-governance RPC (gated)
          { p_org_id: orgId, p_parent_department_id: edit.parentId, p_name: name, p_cost_center: cc } as never));
      }
      if (rpcErr) { Alert.alert('Could not save', rpcErr.message); return; }
      setEdit(null);
      await reload();
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error)?.message ?? 'Unknown error.');
    } finally { setBusy(false); }
  }, [edit, orgId, reload]);

  const doMove = useCallback(async (dept: Dept, newParentId: string | null) => {
    setBusy(true); setMoveFor(null);
    try {
      const { error: rpcErr } = await supabase.rpc('move_department' as never, // outbox-exempt: online org-governance RPC (gated, cycle-safe)
        { p_department_id: dept.id, p_new_parent_id: newParentId } as never);
      if (rpcErr) { Alert.alert('Could not move', /cycle|ancestor|descend/i.test(rpcErr.message) ? 'A department cannot be moved under its own descendant.' : rpcErr.message); }
      await reload();
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error)?.message ?? 'Unknown error.');
    } finally { setBusy(false); }
  }, [reload]);

  const doDelete = useCallback((dept: Dept, force = false) => {
    Alert.alert(force ? 'Force delete?' : 'Delete department', force
      ? `"${dept.name}" has sub-departments or members. Force-delete removes the department and orphans its members. Continue?`
      : `Delete "${dept.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: force ? 'Force delete' : 'Delete', style: 'destructive', onPress: async () => {
          setBusy(true);
          try {
            const { error: rpcErr } = await supabase.rpc('delete_department' as never, // outbox-exempt: online org-governance RPC (gated)
              { p_department_id: dept.id, p_force: force } as never);
            if (rpcErr) {
              if (!force && /descend|member|force/i.test(rpcErr.message)) { doDelete(dept, true); return; }
              Alert.alert('Could not delete', rpcErr.message); return;
            }
            await reload();
          } catch (e: unknown) {
            Alert.alert('Error', (e as Error)?.message ?? 'Unknown error.');
          } finally { setBusy(false); }
        },
      },
    ]);
  }, [reload]);

  const openMembers = useCallback(async (dept: Dept) => {
    setMembersFor(dept); setDeptMembers([]); setMembersBusy(true);
    try {
      const { data } = await supabase.from('department_members').select('user_id').eq('department_id', dept.id);
      const ids = ((data ?? []) as Array<{ user_id: string }>).map((m) => m.user_id);
      setDeptMembers(assignable.filter((p) => ids.includes(p.userId)));
    } finally { setMembersBusy(false); }
  }, [assignable]);

  const toggleMember = useCallback(async (dept: Dept, person: Person, isMember: boolean) => {
    setMembersBusy(true);
    try {
      const fn = isMember ? 'unassign_member_from_department' : 'assign_member_to_department';
      const { error: rpcErr } = await supabase.rpc(fn as never, // outbox-exempt: online org-governance RPC (gated, idempotent)
        { p_department_id: dept.id, p_user_id: person.userId } as never);
      if (rpcErr) { Alert.alert('Could not update', rpcErr.message); return; }
      setDeptMembers((prev) => isMember ? prev.filter((p) => p.userId !== person.userId) : [...prev, person]);
      void reload();
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error)?.message ?? 'Unknown error.');
    } finally { setMembersBusy(false); }
  }, [reload]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}><StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}><ActivityIndicator size="large" color={C.primary} /><Text style={s.centerText}>Loading structure…</Text></View>
      </SafeAreaView>
    );
  }

  const activeOrg = orgs.find((o) => o.id === orgId);

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><Ionicons name="arrow-back" size={22} color={C.text} /></TouchableOpacity>
        <Text style={s.headerTitle}>Org structure</Text>
        <TouchableOpacity onPress={() => setShowCreateOrg(true)} hitSlop={10}><Ionicons name="add" size={24} color={C.primary} /></TouchableOpacity>
      </View>

      {!orgId ? (
        <View style={s.center}><View style={s.reservedCard}>
          <Ionicons name="git-branch-outline" size={20} color={C.amber} />
          <Text style={s.reservedTitle}>No organization</Text>
          <Text style={s.reservedBody}>{error ?? 'Your account is not a member of any organization yet.'}</Text>
          <TouchableOpacity style={s.createOrgBtn} onPress={() => setShowCreateOrg(true)} activeOpacity={0.85}>
            <Ionicons name="add-circle-outline" size={16} color="#fff" /><Text style={s.createOrgBtnText}>Create organization</Text>
          </TouchableOpacity>
        </View></View>
      ) : (
        <ScrollView
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
        >
          <Animated.View entering={FadeIn.duration(220)} style={s.heroWrap}>
            <Text style={s.kicker}>CLIENT PORTAL · ORGANIZATION</Text>
            <Text style={s.title}>{activeOrg?.name ?? 'Structure'}</Text>
            <Text style={s.subtitle}>{depts.length} department{depts.length === 1 ? '' : 's'}. {canManage ? 'Build cost-center trees and assign members.' : 'Read-only — you can view the hierarchy.'}</Text>

            {orgs.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.orgRow}>
                {orgs.map((o) => {
                  const active = o.id === orgId;
                  return (
                    <TouchableOpacity key={o.id} onPress={() => { setLoading(true); setExpanded(null); void load(o.id); }} style={[s.orgChip, active && s.orgChipActive]} activeOpacity={0.7}>
                      <Text style={[s.orgChipText, active && s.orgChipTextActive]} numberOfLines={1}>{o.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </Animated.View>

          {error ? (<View style={s.errorBanner}><Ionicons name="alert-circle" size={16} color={C.red} /><Text style={s.errorText}>{error}</Text></View>) : null}

          {canManage && (
            <TouchableOpacity style={s.newBtn} activeOpacity={0.85} onPress={() => setEdit({ mode: 'create-root', parentId: null, deptId: null, name: '', costCenter: '' })}>
              <Ionicons name="add-circle-outline" size={18} color={C.primary} />
              <Text style={s.newBtnText}>New top-level department</Text>
            </TouchableOpacity>
          )}

          {ordered.length === 0 ? (
            <View style={s.emptyState}><Ionicons name="git-branch-outline" size={32} color={C.textMute} /><Text style={s.emptyText}>No departments yet.{canManage ? ' Create the first one above.' : ''}</Text></View>
          ) : (
            <View style={{ gap: 6 }}>
              {ordered.map((d) => (
                <View key={d.id}>
                  <TouchableOpacity
                    style={[s.deptRow, { marginLeft: Math.min(d.depth, 6) * 16 }]}
                    activeOpacity={canManage ? 0.7 : 1}
                    onPress={() => canManage && setExpanded(expanded === d.id ? null : d.id)}
                  >
                    {d.depth > 0 && <Ionicons name="return-down-forward-outline" size={13} color={C.textMute} style={{ marginRight: 2 }} />}
                    <View style={s.deptDot} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.deptName} numberOfLines={1}>{d.name}</Text>
                      <View style={s.deptMeta}>
                        {d.costCenter ? <View style={s.ccChip}><Text style={s.ccText}>{d.costCenter}</Text></View> : null}
                        <Ionicons name="people-outline" size={11} color={C.textMute} />
                        <Text style={s.deptMetaText}>{d.memberCount}</Text>
                      </View>
                    </View>
                    {canManage && <Ionicons name={expanded === d.id ? 'chevron-up' : 'ellipsis-horizontal'} size={16} color={C.textMute} />}
                  </TouchableOpacity>

                  {canManage && expanded === d.id && (
                    <View style={[s.actionPanel, { marginLeft: Math.min(d.depth, 6) * 16 }]}>
                      <ActionBtn icon="add-outline" label="Sub-dept" onPress={() => setEdit({ mode: 'create-child', parentId: d.id, deptId: null, name: '', costCenter: '' })} />
                      <ActionBtn icon="create-outline" label="Rename" onPress={() => setEdit({ mode: 'rename', parentId: d.parentId, deptId: d.id, name: d.name, costCenter: d.costCenter ?? '' })} />
                      <ActionBtn icon="swap-vertical-outline" label="Move" onPress={() => setMoveFor(d)} />
                      <ActionBtn icon="people-outline" label="Members" onPress={() => openMembers(d)} />
                      <ActionBtn icon="trash-outline" label="Delete" tone={C.red} onPress={() => doDelete(d)} />
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}

          <Text style={s.footnote}>Source · departments via fetch_department_tree · edits via can_manage_org_structure RPCs.</Text>
        </ScrollView>
      )}

      {/* Create / rename modal */}
      <Modal visible={!!edit} transparent animationType="fade" onRequestClose={() => setEdit(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.modalWrap}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>{edit?.mode === 'rename' ? 'Rename department' : edit?.mode === 'create-child' ? 'New sub-department' : 'New department'}</Text>
            <TextInput value={edit?.name ?? ''} onChangeText={(t) => setEdit((p) => p ? { ...p, name: t } : p)} placeholder="Department name" placeholderTextColor={C.textMute} style={s.input} autoFocus />
            <TextInput value={edit?.costCenter ?? ''} onChangeText={(t) => setEdit((p) => p ? { ...p, costCenter: t } : p)} placeholder="Cost center (optional)" placeholderTextColor={C.textMute} style={s.input} autoCapitalize="characters" />
            <View style={s.modalRow}>
              <TouchableOpacity style={s.modalCancel} onPress={() => setEdit(null)}><Text style={s.modalCancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[s.modalSave, busy && { opacity: 0.5 }]} onPress={saveEdit} disabled={busy}>
                {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.modalSaveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Move modal */}
      <Modal visible={!!moveFor} transparent animationType="fade" onRequestClose={() => setMoveFor(null)}>
        <View style={s.modalWrap}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Move “{moveFor?.name}”</Text>
            <Text style={s.modalSub}>Choose a new parent.</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              <TouchableOpacity style={s.pickRow} onPress={() => moveFor && doMove(moveFor, null)}>
                <Ionicons name="home-outline" size={15} color={C.primary} /><Text style={s.pickText}>Top level (no parent)</Text>
              </TouchableOpacity>
              {depts.filter((d) => moveFor && d.id !== moveFor.id).map((d) => (
                <TouchableOpacity key={d.id} style={s.pickRow} onPress={() => moveFor && doMove(moveFor, d.id)}>
                  <Ionicons name="folder-outline" size={15} color={C.textSec} /><Text style={s.pickText} numberOfLines={1}>{d.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={s.modalCancel} onPress={() => setMoveFor(null)}><Text style={s.modalCancelText}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Members modal */}
      <Modal visible={!!membersFor} transparent animationType="fade" onRequestClose={() => setMembersFor(null)}>
        <View style={s.modalWrap}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Members · {membersFor?.name}</Text>
            <Text style={s.modalSub}>Tap to assign or remove.</Text>
            {membersBusy && <ActivityIndicator size="small" color={C.primary} style={{ marginVertical: 6 }} />}
            <ScrollView style={{ maxHeight: 360 }}>
              {assignable.length === 0 ? <Text style={s.modalSub}>No org members to assign.</Text> : assignable.map((p) => {
                const isMember = deptMembers.some((m) => m.userId === p.userId);
                return (
                  <TouchableOpacity key={p.userId} style={s.pickRow} onPress={() => membersFor && toggleMember(membersFor, p, isMember)} disabled={membersBusy}>
                    <Ionicons name={isMember ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={isMember ? C.green : C.textMute} />
                    <Text style={s.pickText} numberOfLines={1}>{p.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={s.modalCancel} onPress={() => setMembersFor(null)}><Text style={s.modalCancelText}>Done</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Create organization modal */}
      <Modal visible={showCreateOrg} transparent animationType="fade" onRequestClose={() => setShowCreateOrg(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.modalWrap}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>New organization</Text>
            <Text style={s.modalSub}>You become the owner — invite teammates and build departments next.</Text>
            <TextInput value={newOrgName} onChangeText={setNewOrgName} placeholder="Organization name" placeholderTextColor={C.textMute} style={s.input} autoFocus />
            <View style={s.kindRow}>
              {(['enterprise', 'agency'] as const).map((k) => {
                const active = newOrgKind === k;
                return (
                  <TouchableOpacity key={k} onPress={() => setNewOrgKind(k)} style={[s.kindChip, active && { backgroundColor: C.primaryDim, borderColor: 'rgba(124,58,237,0.45)' }]} activeOpacity={0.7}>
                    <Text style={[s.kindChipText, active && { color: C.primary, fontWeight: '700' }]}>{k === 'enterprise' ? 'Enterprise · buyer' : 'Agency · inspection'}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={s.modalRow}>
              <TouchableOpacity style={s.modalCancel} onPress={() => setShowCreateOrg(false)}><Text style={s.modalCancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[s.modalSave, creatingOrg && { opacity: 0.5 }]} onPress={createOrg} disabled={creatingOrg}>
                {creatingOrg ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.modalSaveText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function ActionBtn({ icon, label, onPress, tone }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; tone?: string }) {
  return (
    <TouchableOpacity style={s.actionBtn} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={16} color={tone ?? C.primary} />
      <Text style={[s.actionBtnText, tone ? { color: tone } : null]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { padding: 16, paddingBottom: 64, gap: 14 },
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

  newBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(124,58,237,0.4)', backgroundColor: C.primaryDim },
  newBtnText: { color: C.primary, fontSize: 13, fontWeight: '700' },

  emptyState: { alignItems: 'center', padding: 32, gap: 10, borderRadius: 18, borderWidth: 1, borderColor: C.border, borderStyle: 'dashed', backgroundColor: 'rgba(255,255,255,0.01)' },
  emptyText: { color: C.textSec, fontSize: 13, textAlign: 'center', lineHeight: 18, maxWidth: 280 },

  deptRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  deptDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.primary },
  deptName: { color: C.text, fontSize: 14, fontWeight: '600' },
  deptMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  ccChip: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(0,255,255,0.25)', backgroundColor: 'rgba(0,255,255,0.08)' },
  ccText: { color: C.cyan, fontSize: 9, fontWeight: '700', letterSpacing: 0.4 },
  deptMetaText: { color: C.textMute, fontSize: 10 },

  actionPanel: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 10, marginTop: 4, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.cardDeep },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(255,255,255,0.02)' },
  actionBtnText: { color: C.primary, fontSize: 11, fontWeight: '700' },

  reservedCard: { alignItems: 'center', gap: 8, padding: 24, maxWidth: 320, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(245,158,11,0.32)', backgroundColor: 'rgba(245,158,11,0.14)' },
  reservedTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  reservedBody: { color: C.textSec, fontSize: 13, textAlign: 'center', lineHeight: 18 },

  footnote: { color: C.textMute, fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 8 },

  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  modalCard: { borderRadius: 18, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, padding: 18, gap: 10 },
  modalTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  modalSub: { color: C.textMute, fontSize: 12 },
  input: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, borderWidth: 1, borderColor: C.border, color: C.text, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  modalCancel: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  modalCancelText: { color: C.textSec, fontSize: 14, fontWeight: '600' },
  modalSave: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: C.primary },
  modalSaveText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  pickText: { color: C.text, fontSize: 13, flex: 1 },
  createOrgBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: C.primary },
  createOrgBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  kindRow: { flexDirection: 'row', gap: 8 },
  kindChip: { flex: 1, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(255,255,255,0.02)' },
  kindChipText: { color: C.textSec, fontSize: 12, fontWeight: '600' },
});
