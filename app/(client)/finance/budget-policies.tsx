// ════════════════════════════════════════════════════════════════════════════
//  app/(client)/finance/budget-policies.tsx
//  Mobile parity for web `/client/budget/policies` — the approval-policy
//  ("spend band") editor.
//
//  Source of truth mirrored exactly:
//    • Table  public.approval_policies (tiered pre-authorization bands gating
//             job posts by amount; integer cents).
//    • Write  RPC `set_approval_policy(p_org_id, p_name, p_min_amount_cents,
//             p_max_amount_cents, p_currency, p_required_approver_roles,
//             p_min_approvers_count, p_requires_sod, p_scope_department_id,
//             p_is_active, p_id)`. p_id NULL = insert, uuid = update →
//             idempotent (an update targets the same row; deactivate is just an
//             update with is_active=false — there is no DELETE).
//    • Guard  RLS lets org members READ; the SECURITY DEFINER RPC is gated by
//             can_manage_org_structure (owner / procurement_admin / super_admin).
//    • A constraint trigger refuses OVERLAPPING active bands within
//             (org_id, scope_department_id, currency) → SQLSTATE 23P01; we
//             translate it to a friendly message.
//
//  Zod (shared-core setApprovalPolicyInput): name 1–120; min_cents ≥ 0;
//  max_cents > min OR null (=unbounded); roles ⊆ {owner, procurement_admin,
//  project_lead, viewer}, ≥1; min_approvers 1–10; requires_sod default true.
//
//  USD-only platform → currency fixed 'USD'. Money is integer cents (toCents /
//  formatUsd). Palette + components locked to the app (#020420 / #7C3AED).
//  Purely additive — no existing screen altered.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, StatusBar, SafeAreaView, Modal, TextInput, Alert, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';
import { formatUsd, toCents } from '@/src/core/utils/money';

const C = {
  bg: '#020420', card: '#0B1138', cardDeep: '#080C2A',
  border: 'rgba(255,255,255,0.06)', borderHi: 'rgba(255,255,255,0.12)',
  text: '#FFFFFF', textSec: '#A8B2C7', textMute: '#6B7390',
  primary: '#7C3AED', primaryDim: 'rgba(124,58,237,0.14)',
  cyan: '#00FFFF', green: '#10B981', amber: '#F59E0B', red: '#EF4444',
};

// Single cross-platform source (shared-core ORG_MEMBER_ROLES).
const ROLES: Array<{ key: string; label: string }> = [
  { key: 'owner', label: 'Owner' },
  { key: 'procurement_admin', label: 'Procurement admin' },
  { key: 'project_lead', label: 'Project lead' },
  { key: 'viewer', label: 'Viewer' },
];
const roleLabel = (k: string) => ROLES.find((r) => r.key === k)?.label ?? k;

interface DeptOption { id: string; name: string }
interface PolicyRow {
  id: string;
  name: string;
  minCents: number;
  maxCents: number | null;
  roles: string[];
  minApprovers: number;
  requiresSod: boolean;
  scopeDeptId: string | null;
  isActive: boolean;
}

export default function BudgetPoliciesScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string>('your organization');
  const [isElevated, setIsElevated] = useState(false);
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [policies, setPolicies] = useState<PolicyRow[]>([]);

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editMin, setEditMin] = useState('0'); // dollars
  const [editMax, setEditMax] = useState(''); // dollars, blank = unbounded
  const [editRoles, setEditRoles] = useState<string[]>(['owner']);
  const [editMinApprovers, setEditMinApprovers] = useState(1);
  const [editSod, setEditSod] = useState(true);
  const [editActive, setEditActive] = useState(true);
  const [editScopeDeptId, setEditScopeDeptId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('You must be signed in.'); return; }

      const [memRes, profRes] = await Promise.all([
        supabase.from('org_members').select('org_id, role').eq('user_id', user.id),
        supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
      ]);
      // God-mode: the single platform admin (admin/super_admin) can manage any
      // org — mirrors the can_manage_org_structure() RLS gate (UI ⇄ RLS in lockstep).
      const role = (profRes.data as { role?: string } | null)?.role;
      const isPlatformAdmin = role === 'admin' || role === 'super_admin';
      const memberships = (memRes.data ?? []) as Array<{ org_id: string; role: string }>;
      const elevatedMembership = memberships.find((m) => m.role === 'owner' || m.role === 'procurement_admin');
      const activeOrgId = elevatedMembership?.org_id ?? memberships[0]?.org_id ?? null;
      setOrgId(activeOrgId);
      setIsElevated(isPlatformAdmin || !!elevatedMembership);

      if (!activeOrgId) { setError('No organization found for your account.'); return; }

      const [orgRes, deptRes, polRes] = await Promise.all([
        supabase.from('organizations').select('name').eq('id', activeOrgId).maybeSingle(),
        supabase.from('departments').select('id, name').eq('org_id', activeOrgId).order('name'),
        supabase
          .from('approval_policies')
          .select('id, name, min_amount_cents, max_amount_cents, required_approver_roles, min_approvers_count, requires_sod, scope_department_id, is_active')
          .eq('org_id', activeOrgId)
          .order('is_active', { ascending: false })
          .order('min_amount_cents', { ascending: true }),
      ]);
      setOrgName(((orgRes.data as { name?: string } | null)?.name) ?? 'your organization');
      setDepartments(((deptRes.data ?? []) as Array<{ id: string; name: string }>).map((d) => ({ id: d.id, name: d.name })));
      setPolicies(
        ((polRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
          id: String(r.id),
          name: String(r.name ?? ''),
          minCents: typeof r.min_amount_cents === 'number' ? r.min_amount_cents : Number(r.min_amount_cents ?? 0),
          maxCents: r.max_amount_cents == null ? null : Number(r.max_amount_cents),
          roles: Array.isArray(r.required_approver_roles) ? (r.required_approver_roles as string[]) : [],
          minApprovers: typeof r.min_approvers_count === 'number' ? r.min_approvers_count : Number(r.min_approvers_count ?? 1),
          requiresSod: r.requires_sod !== false,
          scopeDeptId: (r.scope_department_id as string | null) ?? null,
          isActive: r.is_active !== false,
        })),
      );
    } catch (e: unknown) {
      setError((e as Error)?.message ?? 'Could not load policies.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); void load(); }, [load]);

  const deptName = useCallback(
    (id: string | null) => (id ? (departments.find((d) => d.id === id)?.name ?? 'Department') : 'Org-wide'),
    [departments],
  );

  const openNew = useCallback(() => {
    setEditId(null); setEditName(''); setEditMin('0'); setEditMax('');
    setEditRoles(['owner']); setEditMinApprovers(1); setEditSod(true);
    setEditActive(true); setEditScopeDeptId(null); setEditorOpen(true);
  }, []);

  const openEdit = useCallback((p: PolicyRow) => {
    setEditId(p.id); setEditName(p.name);
    setEditMin((p.minCents / 100).toString());
    setEditMax(p.maxCents == null ? '' : (p.maxCents / 100).toString());
    setEditRoles(p.roles.length ? p.roles : ['owner']);
    setEditMinApprovers(p.minApprovers); setEditSod(p.requiresSod);
    setEditActive(p.isActive); setEditScopeDeptId(p.scopeDeptId); setEditorOpen(true);
  }, []);

  const toggleRole = useCallback((key: string) => {
    setEditRoles((prev) => (prev.includes(key) ? prev.filter((r) => r !== key) : [...prev, key]));
  }, []);

  const friendlyRpcError = (msg: string): string =>
    /overlap/i.test(msg)
      ? 'This band overlaps an existing active band for the same scope. Adjust the range or deactivate the other band.'
      : /permission|not authorized|42501/i.test(msg)
        ? 'This action is reserved for an organization owner or procurement admin.'
        : msg;

  const save = useCallback(async () => {
    const name = editName.trim();
    if (name.length < 1) { Alert.alert('Name required', 'Give the band a name.'); return; }
    if (name.length > 120) { Alert.alert('Name too long', 'Max 120 characters.'); return; }
    const min = parseFloat(editMin || '0');
    if (!Number.isFinite(min) || min < 0) { Alert.alert('Invalid minimum', 'Minimum must be ≥ 0.'); return; }
    let maxCents: number | null = null;
    if (editMax.trim() !== '') {
      const max = parseFloat(editMax);
      if (!Number.isFinite(max) || max <= min) { Alert.alert('Invalid maximum', 'Maximum must be greater than the minimum (leave blank for unbounded).'); return; }
      maxCents = toCents(max);
    }
    if (editRoles.length === 0) { Alert.alert('Pick approver roles', 'Select at least one required approver role.'); return; }

    setSaving(true);
    try {
      const { error: rpcErr } = await supabase.rpc('set_approval_policy', {
        p_org_id: orgId,
        p_name: name,
        p_min_amount_cents: toCents(min),
        p_max_amount_cents: maxCents,
        p_currency: 'USD',
        p_required_approver_roles: editRoles,
        p_min_approvers_count: editMinApprovers,
        p_requires_sod: editSod,
        p_scope_department_id: editScopeDeptId,
        p_is_active: editActive,
        p_id: editId, // null = create, uuid = update (idempotent)
      });
      if (rpcErr) { Alert.alert('Could not save band', friendlyRpcError(rpcErr.message)); return; }
      setEditorOpen(false);
      await load();
      Alert.alert('Saved', `Approval band "${name}" saved.`);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error)?.message ?? 'Unknown error.');
    } finally {
      setSaving(false);
    }
  }, [editName, editMin, editMax, editRoles, editMinApprovers, editSod, editActive, editScopeDeptId, editId, orgId, load]);

  const toggleActive = useCallback(async (p: PolicyRow) => {
    try {
      // Deactivate / reactivate is just an update of the same row (p_id set).
      const { error: rpcErr } = await supabase.rpc('set_approval_policy', {
        p_org_id: orgId, p_name: p.name, p_min_amount_cents: p.minCents,
        p_max_amount_cents: p.maxCents, p_currency: 'USD',
        p_required_approver_roles: p.roles, p_min_approvers_count: p.minApprovers,
        p_requires_sod: p.requiresSod, p_scope_department_id: p.scopeDeptId,
        p_is_active: !p.isActive, p_id: p.id,
      });
      if (rpcErr) { Alert.alert('Could not update', friendlyRpcError(rpcErr.message)); return; }
      await load();
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error)?.message ?? 'Unknown error.');
    }
  }, [orgId, load]);

  const bandRange = (p: PolicyRow) =>
    p.maxCents == null ? `${formatUsd(p.minCents)}+` : `${formatUsd(p.minCents)} – ${formatUsd(p.maxCents)}`;

  // ─── Render ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}><ActivityIndicator size="large" color={C.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Approval policies</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
      >
        <Animated.View entering={FadeIn.duration(200)}>
          <LinearGradient colors={[C.primaryDim, 'rgba(0,0,0,0)']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={s.hero}>
            <Text style={s.heroKicker}>APPROVAL BANDS · {orgName.toUpperCase()}</Text>
            <Text style={s.heroSub}>Tiered pre-authorization — gate spend by amount with required approvers.</Text>
          </LinearGradient>
        </Animated.View>

        {error && (
          <View style={s.bannerErr}>
            <Ionicons name="alert-circle-outline" size={16} color={C.red} />
            <Text style={s.bannerErrText}>{error}</Text>
          </View>
        )}

        {!isElevated ? (
          <View style={s.section}>
            <View style={s.reservedCard}>
              <Ionicons name="lock-closed-outline" size={20} color={C.amber} />
              <Text style={s.reservedTitle}>Reserved access</Text>
              <Text style={s.reservedBody}>Managing approval policies is available to an organization owner or procurement admin.</Text>
            </View>
          </View>
        ) : (
          <>
            <View style={s.section}>
              {policies.length === 0 ? (
                <Text style={s.empty}>No approval bands yet. Create the first one below.</Text>
              ) : (
                policies.map((p) => (
                  <View key={p.id} style={[s.policyCard, !p.isActive && { opacity: 0.6 }]}>
                    <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.8} onPress={() => openEdit(p)}>
                      <View style={s.policyTopRow}>
                        <Text style={s.policyName} numberOfLines={1}>{p.name}</Text>
                        <View style={[s.statusDot, { backgroundColor: p.isActive ? C.green : C.textMute }]} />
                      </View>
                      <Text style={s.policyRange}>{bandRange(p)}</Text>
                      <Text style={s.policyMeta} numberOfLines={1}>
                        {deptName(p.scopeDeptId)} · {p.minApprovers} approver{p.minApprovers === 1 ? '' : 's'} · {p.roles.map(roleLabel).join(', ')}
                        {p.requiresSod ? ' · SoD' : ''}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => toggleActive(p)} hitSlop={8} style={s.toggleActiveBtn}>
                      <Ionicons name={p.isActive ? 'pause-circle-outline' : 'play-circle-outline'} size={22} color={p.isActive ? C.amber : C.green} />
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>

            <TouchableOpacity style={s.newBtn} activeOpacity={0.85} onPress={openNew}>
              <Ionicons name="add-circle" size={18} color="#04150C" />
              <Text style={s.newBtnText}>New approval band</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {/* ─── Editor modal ─────────────────────────────────────────────── */}
      <Modal visible={editorOpen} animationType="slide" transparent onRequestClose={() => setEditorOpen(false)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={s.modalTitle}>{editId ? 'Edit approval band' : 'New approval band'}</Text>

              <Text style={s.fieldLabel}>Band name</Text>
              <TextInput style={s.fieldInput} value={editName} onChangeText={setEditName} placeholder="e.g. Standard approvals" placeholderTextColor={C.textMute} maxLength={120} />

              <View style={s.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>Min (≥)</Text>
                  <View style={s.amountInputWrap}>
                    <Text style={s.amountPrefix}>$</Text>
                    <TextInput style={s.amountInput} value={editMin} onChangeText={(t) => setEditMin(t.replace(/[^0-9.]/g, ''))} placeholder="0.00" placeholderTextColor={C.textMute} keyboardType="decimal-pad" />
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>Max (&lt;)</Text>
                  <View style={s.amountInputWrap}>
                    <Text style={s.amountPrefix}>$</Text>
                    <TextInput style={s.amountInput} value={editMax} onChangeText={(t) => setEditMax(t.replace(/[^0-9.]/g, ''))} placeholder="∞" placeholderTextColor={C.textMute} keyboardType="decimal-pad" />
                  </View>
                </View>
              </View>
              <Text style={s.fieldHint}>Leave Max blank for an unbounded top band.</Text>

              <Text style={s.fieldLabel}>Required approver roles</Text>
              <View style={s.chipsRow}>
                {ROLES.map((r) => {
                  const on = editRoles.includes(r.key);
                  return (
                    <TouchableOpacity key={r.key} onPress={() => toggleRole(r.key)} activeOpacity={0.8} style={[s.chip, on && s.chipOn]}>
                      <Text style={[s.chipText, on && s.chipTextOn]}>{r.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={s.fieldLabel}>Minimum approvers required</Text>
              <View style={s.stepperRow}>
                <TouchableOpacity style={s.stepBtn} onPress={() => setEditMinApprovers((n) => Math.max(1, n - 1))}>
                  <Ionicons name="remove" size={18} color={C.text} />
                </TouchableOpacity>
                <Text style={s.stepValue}>{editMinApprovers}</Text>
                <TouchableOpacity style={s.stepBtn} onPress={() => setEditMinApprovers((n) => Math.min(10, n + 1))}>
                  <Ionicons name="add" size={18} color={C.text} />
                </TouchableOpacity>
                <Text style={s.fieldHint}>  2+ for dual-approval (SOX).</Text>
              </View>

              <Text style={s.fieldLabel}>Scope</Text>
              <TouchableOpacity style={s.fieldInput} activeOpacity={0.7} onPress={() => setScopePickerOpen(true)}>
                <Text style={s.fieldValue}>{deptName(editScopeDeptId)}</Text>
                <Ionicons name="chevron-down" size={16} color={C.textMute} />
              </TouchableOpacity>

              <TouchableOpacity style={s.toggleRow} activeOpacity={0.8} onPress={() => setEditSod((v) => !v)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.toggleLabel}>Enforce Segregation of Duties</Text>
                  <Text style={s.toggleHint}>A requester cannot approve their own spend.</Text>
                </View>
                <Ionicons name={editSod ? 'checkbox' : 'square-outline'} size={22} color={editSod ? C.primary : C.textMute} />
              </TouchableOpacity>

              <TouchableOpacity style={s.toggleRow} activeOpacity={0.8} onPress={() => setEditActive((v) => !v)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.toggleLabel}>Active</Text>
                  <Text style={s.toggleHint}>Inactive bands don't gate spend but stay in history.</Text>
                </View>
                <Ionicons name={editActive ? 'checkbox' : 'square-outline'} size={22} color={editActive ? C.primary : C.textMute} />
              </TouchableOpacity>

              <View style={s.modalActions}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setEditorOpen(false)} disabled={saving}>
                  <Text style={s.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.saveBtn, saving && s.btnDisabled]} onPress={save} disabled={saving} activeOpacity={0.85}>
                  {saving ? <ActivityIndicator color="#04150C" size="small" /> : <Ionicons name="checkmark" size={16} color="#04150C" />}
                  <Text style={s.saveBtnText}>{saving ? 'Saving…' : 'Save band'}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ─── Scope picker ─────────────────────────────────────────────── */}
      <Modal visible={scopePickerOpen} animationType="fade" transparent onRequestClose={() => setScopePickerOpen(false)}>
        <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={() => setScopePickerOpen(false)}>
          <View style={s.pickerSheet}>
            <Text style={s.modalTitle}>Scope</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              <TouchableOpacity style={s.pickerRow} onPress={() => { setEditScopeDeptId(null); setScopePickerOpen(false); }} activeOpacity={0.7}>
                <Text style={s.pickerRowText}>Org-wide</Text>
                {editScopeDeptId === null && <Ionicons name="checkmark" size={16} color={C.primary} />}
              </TouchableOpacity>
              {departments.map((d) => (
                <TouchableOpacity key={d.id} style={s.pickerRow} onPress={() => { setEditScopeDeptId(d.id); setScopePickerOpen(false); }} activeOpacity={0.7}>
                  <Text style={s.pickerRowText}>{d.name}</Text>
                  {editScopeDeptId === d.id && <Ionicons name="checkmark" size={16} color={C.primary} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  scroll: { paddingBottom: 48 },
  hero: { marginHorizontal: 16, marginTop: 4, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: C.border },
  heroKicker: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: C.primary },
  heroSub: { fontSize: 13, color: C.textSec, marginTop: 6 },
  bannerErr: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: 'rgba(239,68,68,0.10)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
  bannerErrText: { color: C.red, fontSize: 13, flex: 1 },
  section: { marginHorizontal: 16, marginTop: 16, gap: 10 },
  empty: { color: C.textMute, fontSize: 14, textAlign: 'center', paddingVertical: 24 },
  reservedCard: { backgroundColor: C.card, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: C.border, alignItems: 'center', gap: 8 },
  reservedTitle: { color: C.text, fontWeight: '700', fontSize: 15 },
  reservedBody: { color: C.textSec, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  policyCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border },
  policyTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  policyName: { color: C.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  policyRange: { color: C.cyan, fontSize: 14, fontWeight: '700', marginTop: 4 },
  policyMeta: { color: C.textMute, fontSize: 12, marginTop: 3 },
  toggleActiveBtn: { padding: 4 },
  newBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 16, marginTop: 18, backgroundColor: C.cyan, paddingVertical: 15, borderRadius: 14 },
  newBtnText: { color: '#04150C', fontWeight: '800', fontSize: 15 },
  // modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: C.cardDeep, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: Platform.OS === 'ios' ? 36 : 24, borderTopWidth: 1, borderColor: C.borderHi, maxHeight: '90%' },
  modalHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.borderHi, marginBottom: 14 },
  modalTitle: { color: C.text, fontSize: 17, fontWeight: '700', marginBottom: 6 },
  fieldLabel: { color: C.textSec, fontSize: 12, fontWeight: '700', marginTop: 14, marginBottom: 6, letterSpacing: 0.4 },
  fieldInput: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, borderWidth: 1, borderColor: C.border, color: C.text, fontSize: 15 },
  fieldValue: { color: C.text, fontSize: 15 },
  fieldHint: { color: C.textMute, fontSize: 12, marginTop: 6 },
  row2: { flexDirection: 'row', gap: 12 },
  amountInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: C.border },
  amountPrefix: { color: C.textSec, fontSize: 17, fontWeight: '700', marginRight: 6 },
  amountInput: { flex: 1, color: C.text, fontSize: 17, fontWeight: '700', paddingVertical: 13 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipOn: { backgroundColor: C.primaryDim, borderColor: C.primary },
  chipText: { color: C.textSec, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: C.text },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  stepValue: { color: C.text, fontSize: 18, fontWeight: '800', minWidth: 28, textAlign: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, backgroundColor: C.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border },
  toggleLabel: { color: C.text, fontSize: 14, fontWeight: '600' },
  toggleHint: { color: C.textMute, fontSize: 12, marginTop: 2 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 22 },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  cancelBtnText: { color: C.textSec, fontWeight: '700', fontSize: 15 },
  saveBtn: { flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: C.cyan },
  saveBtnText: { color: '#04150C', fontWeight: '800', fontSize: 15 },
  btnDisabled: { opacity: 0.55 },
  pickerSheet: { marginHorizontal: 24, marginTop: 'auto', marginBottom: 'auto', backgroundColor: C.cardDeep, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: C.borderHi },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.border },
  pickerRowText: { color: C.text, fontSize: 15, flex: 1 },
});
