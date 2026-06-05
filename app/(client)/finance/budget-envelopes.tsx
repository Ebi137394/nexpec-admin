// ════════════════════════════════════════════════════════════════════════════
//  app/(client)/finance/budget-envelopes.tsx
//  Mobile parity for web `/client/budget/envelopes` — the department-budget
//  ("envelope") editor.
//
//  Source of truth mirrored exactly:
//    • Table  public.department_budgets (per-dept, per-fiscal-period cap, cents).
//    • Write  RPC `set_department_budget(p_department_id, p_fiscal_period_start,
//             p_fiscal_period_end, p_currency, p_allocated_cents, p_notes)` —
//             an UPSERT keyed on (department_id, period) → naturally idempotent
//             (re-saving the same window updates in place, never duplicates).
//    • Read   department_budgets is RLS-readable by org members; the write RPC
//             is SECURITY DEFINER, gated server-side by can_manage_org_structure
//             (owner / procurement_admin / super_admin). isElevated only hides UI.
//
//  USD-only platform → currency is fixed to 'USD' (no picker). Money is integer
//  cents; the form collects dollars and converts via toCents(). Display via the
//  canonical formatUsd (byte-identical to the web dashboard).
//
//  Palette + component vocabulary locked to the rest of the app (#020420 /
//  #7C3AED). Purely additive — no existing screen altered.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, StatusBar, SafeAreaView, Modal, TextInput, Alert, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';
import { formatUsd, toCents } from '@/src/core/utils/money';

const C = {
  bg: '#020420', card: '#0B1138', cardDeep: '#080C2A',
  border: 'rgba(255,255,255,0.06)', borderHi: 'rgba(255,255,255,0.12)',
  text: '#FFFFFF', textSec: '#A8B2C7', textMute: '#6B7390',
  primary: '#7C3AED', primaryDim: 'rgba(124,58,237,0.14)',
  cyan: '#00FFFF', green: '#10B981', greenDim: 'rgba(16,185,129,0.14)',
  amber: '#F59E0B', red: '#EF4444',
};

interface DeptOption { id: string; name: string; costCenter: string | null }
interface BudgetRow {
  id: string;
  departmentId: string;
  deptName: string;
  periodStart: string;
  periodEnd: string;
  allocatedCents: number;
  notes: string | null;
}

const thisYear = new Date().getUTCFullYear();

function fmtPeriod(startIso: string): string {
  // Envelopes are annual fiscal windows; show the start year.
  const y = startIso?.slice(0, 4);
  return y ? `FY ${y}` : '—';
}

export default function BudgetEnvelopesScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string>('your organization');
  const [isElevated, setIsElevated] = useState(false);
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [deptPickerOpen, setDeptPickerOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null); // present = editing existing
  const [editDeptId, setEditDeptId] = useState<string | null>(null);
  const [editYear, setEditYear] = useState<number>(thisYear);
  const [editAllocated, setEditAllocated] = useState<string>(''); // dollars
  const [editNotes, setEditNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('You must be signed in.'); return; }

      // Resolve the active org + the caller's role on it. Mirrors the
      // can_manage_org_structure() gate: the platform admin (God-mode) OR an
      // org owner / procurement_admin. The single `admin` role has full access
      // — UI gate stays in lockstep with RLS so the owner is never locked out
      // of a write the database would permit.
      const [memRes, profRes] = await Promise.all([
        supabase.from('org_members').select('org_id, role').eq('user_id', user.id),
        supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
      ]);
      const role = (profRes.data as { role?: string } | null)?.role;
      const isPlatformAdmin = role === 'admin' || role === 'super_admin';
      const memberships = (memRes.data ?? []) as Array<{ org_id: string; role: string }>;
      const elevatedMembership = memberships.find(
        (m) => m.role === 'owner' || m.role === 'procurement_admin',
      );
      const activeOrgId = elevatedMembership?.org_id ?? memberships[0]?.org_id ?? null;
      const elevated = isPlatformAdmin || !!elevatedMembership;
      setOrgId(activeOrgId);
      setIsElevated(elevated);

      if (!activeOrgId) {
        setError('No organization found for your account.');
        return;
      }

      // Org name + departments + existing envelopes (all RLS-gated reads).
      const [orgRes, deptRes, budRes] = await Promise.all([
        supabase.from('organizations').select('name').eq('id', activeOrgId).maybeSingle(),
        supabase.from('departments').select('id, name, cost_center').eq('org_id', activeOrgId).order('name'),
        supabase
          .from('department_budgets')
          .select('id, department_id, fiscal_period_start, fiscal_period_end, allocated_cents, notes')
          .eq('org_id', activeOrgId)
          .order('fiscal_period_start', { ascending: false }),
      ]);
      setOrgName(((orgRes.data as { name?: string } | null)?.name) ?? 'your organization');
      const depts = ((deptRes.data ?? []) as Array<{ id: string; name: string; cost_center: string | null }>)
        .map((d) => ({ id: d.id, name: d.name, costCenter: d.cost_center }));
      setDepartments(depts);
      const nameById = new Map(depts.map((d) => [d.id, d.name]));
      setBudgets(
        ((budRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
          id: String(r.id),
          departmentId: String(r.department_id ?? ''),
          deptName: nameById.get(String(r.department_id ?? '')) ?? 'Department',
          periodStart: String(r.fiscal_period_start ?? ''),
          periodEnd: String(r.fiscal_period_end ?? ''),
          allocatedCents: typeof r.allocated_cents === 'number' ? r.allocated_cents : Number(r.allocated_cents ?? 0),
          notes: (r.notes as string | null) ?? null,
        })),
      );
    } catch (e: unknown) {
      setError((e as Error)?.message ?? 'Could not load budgets.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); void load(); }, [load]);

  const openNew = useCallback(() => {
    setEditId(null);
    setEditDeptId(departments[0]?.id ?? null);
    setEditYear(thisYear);
    setEditAllocated('');
    setEditNotes('');
    setEditorOpen(true);
  }, [departments]);

  const openEdit = useCallback((b: BudgetRow) => {
    setEditId(b.id);
    setEditDeptId(b.departmentId);
    setEditYear(Number(b.periodStart.slice(0, 4)) || thisYear);
    setEditAllocated((b.allocatedCents / 100).toString());
    setEditNotes(b.notes ?? '');
    setEditorOpen(true);
  }, []);

  const selectedDeptName = useMemo(
    () => departments.find((d) => d.id === editDeptId)?.name ?? 'Choose a department',
    [departments, editDeptId],
  );

  const save = useCallback(async () => {
    if (!editDeptId) { Alert.alert('Pick a department', 'Choose which department this budget is for.'); return; }
    const dollars = parseFloat(editAllocated);
    if (!Number.isFinite(dollars) || dollars < 0) {
      Alert.alert('Invalid amount', 'Enter a non-negative allocation.');
      return;
    }
    setSaving(true);
    try {
      // RPC is an UPSERT keyed on (department_id, period) → idempotent. The server
      // re-enforces the write gate (can_manage_org_structure) regardless of UI.
      const { error: rpcErr } = await supabase.rpc('set_department_budget', {
        p_department_id: editDeptId,
        p_fiscal_period_start: `${editYear}-01-01`,
        p_fiscal_period_end: `${editYear + 1}-01-01`,
        p_currency: 'USD',
        p_allocated_cents: toCents(dollars),
        p_notes: editNotes.trim() || null,
      });
      if (rpcErr) {
        Alert.alert(
          'Could not save budget',
          /permission|not authorized|42501/i.test(rpcErr.message)
            ? 'This action is reserved for an organization owner or procurement admin.'
            : rpcErr.message,
        );
        return;
      }
      setEditorOpen(false);
      await load();
      Alert.alert('Saved', `Budget for ${selectedDeptName} (FY ${editYear}) saved.`);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error)?.message ?? 'Unknown error.');
    } finally {
      setSaving(false);
    }
  }, [editDeptId, editAllocated, editYear, editNotes, load, selectedDeptName]);

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
        <Text style={s.headerTitle}>Budget envelopes</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
      >
        <Animated.View entering={FadeIn.duration(200)}>
          <LinearGradient colors={[C.primaryDim, 'rgba(0,0,0,0)']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={s.hero}>
            <Text style={s.heroKicker}>DEPARTMENT BUDGETS, {orgName.toUpperCase()}</Text>
            <Text style={s.heroSub}>Per-department spending caps for the fiscal year.</Text>
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
              <Text style={s.reservedBody}>
                Managing budget envelopes is available to an organization owner or
                procurement admin. You can view spend in Budget Overview.
              </Text>
            </View>
          </View>
        ) : (
          <>
            <View style={s.section}>
              {budgets.length === 0 ? (
                <Text style={s.empty}>No budget envelopes yet. Create the first one below.</Text>
              ) : (
                budgets.map((b) => (
                  <TouchableOpacity key={b.id} style={s.budgetCard} activeOpacity={0.8} onPress={() => openEdit(b)}>
                    <View style={s.budgetIcon}>
                      <Ionicons name="wallet-outline" size={18} color={C.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.budgetDept} numberOfLines={1}>{b.deptName}</Text>
                      <Text style={s.budgetMeta}>{fmtPeriod(b.periodStart)}{b.notes ? `, ${b.notes}` : ''}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={s.budgetAmount}>{formatUsd(b.allocatedCents)}</Text>
                      <Ionicons name="chevron-forward" size={14} color={C.textMute} />
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </View>

            <TouchableOpacity style={s.newBtn} activeOpacity={0.85} onPress={openNew} disabled={departments.length === 0}>
              <Ionicons name="add-circle" size={18} color="#04150C" />
              <Text style={s.newBtnText}>
                {departments.length === 0 ? 'No departments to budget' : 'New budget envelope'}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {/* ─── Editor modal ─────────────────────────────────────────────── */}
      <Modal visible={editorOpen} animationType="slide" transparent onRequestClose={() => setEditorOpen(false)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>{editId ? 'Edit budget envelope' : 'New budget envelope'}</Text>

            {/* Department */}
            <Text style={s.fieldLabel}>Department</Text>
            <TouchableOpacity
              style={[s.fieldInput, !!editId && s.fieldLocked]}
              activeOpacity={editId ? 1 : 0.7}
              onPress={() => { if (!editId) setDeptPickerOpen(true); }}
            >
              <Text style={s.fieldValue}>{selectedDeptName}</Text>
              {!editId && <Ionicons name="chevron-down" size={16} color={C.textMute} />}
            </TouchableOpacity>

            {/* Fiscal year */}
            <Text style={s.fieldLabel}>Fiscal year</Text>
            <View style={s.yearRow}>
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <TouchableOpacity
                  key={y}
                  style={[s.yearChip, editYear === y && s.yearChipActive]}
                  onPress={() => setEditYear(y)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.yearChipText, editYear === y && s.yearChipTextActive]}>{y}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.fieldHint}>Jan 1, {editYear} → Jan 1, {editYear + 1}</Text>

            {/* Allocated */}
            <Text style={s.fieldLabel}>Allocated (USD)</Text>
            <View style={s.amountInputWrap}>
              <Text style={s.amountPrefix}>$</Text>
              <TextInput
                style={s.amountInput}
                value={editAllocated}
                onChangeText={(t) => setEditAllocated(t.replace(/[^0-9.]/g, ''))}
                placeholder="0.00"
                placeholderTextColor={C.textMute}
                keyboardType="decimal-pad"
              />
            </View>

            {/* Notes */}
            <Text style={s.fieldLabel}>Notes (optional)</Text>
            <TextInput
              style={[s.fieldInput, s.notesInput]}
              value={editNotes}
              onChangeText={setEditNotes}
              placeholder="e.g. Q1 ramp, capex hold…"
              placeholderTextColor={C.textMute}
              multiline
              maxLength={2000}
            />

            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setEditorOpen(false)} disabled={saving}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.saveBtn, saving && s.btnDisabled]} onPress={save} disabled={saving} activeOpacity={0.85}>
                {saving ? <ActivityIndicator color="#04150C" size="small" /> : <Ionicons name="checkmark" size={16} color="#04150C" />}
                <Text style={s.saveBtnText}>{saving ? 'Saving…' : 'Save budget'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ─── Department picker ────────────────────────────────────────── */}
      <Modal visible={deptPickerOpen} animationType="fade" transparent onRequestClose={() => setDeptPickerOpen(false)}>
        <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={() => setDeptPickerOpen(false)}>
          <View style={s.pickerSheet}>
            <Text style={s.modalTitle}>Department</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {departments.map((d) => (
                <TouchableOpacity
                  key={d.id}
                  style={s.pickerRow}
                  onPress={() => { setEditDeptId(d.id); setDeptPickerOpen(false); }}
                  activeOpacity={0.7}
                >
                  <Text style={s.pickerRowText}>{d.name}</Text>
                  {d.costCenter ? <Text style={s.pickerRowMeta}>{d.costCenter}</Text> : null}
                  {editDeptId === d.id && <Ionicons name="checkmark" size={16} color={C.primary} />}
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
  budgetCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border },
  budgetIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: C.primaryDim, alignItems: 'center', justifyContent: 'center' },
  budgetDept: { color: C.text, fontSize: 15, fontWeight: '600' },
  budgetMeta: { color: C.textMute, fontSize: 12, marginTop: 2 },
  budgetAmount: { color: C.text, fontSize: 16, fontWeight: '700' },
  newBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 16, marginTop: 18, backgroundColor: C.cyan, paddingVertical: 15, borderRadius: 14 },
  newBtnText: { color: '#04150C', fontWeight: '800', fontSize: 15 },
  // modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: C.cardDeep, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: Platform.OS === 'ios' ? 36 : 24, borderTopWidth: 1, borderColor: C.borderHi },
  modalHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.borderHi, marginBottom: 14 },
  modalTitle: { color: C.text, fontSize: 17, fontWeight: '700', marginBottom: 14 },
  fieldLabel: { color: C.textSec, fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 6, letterSpacing: 0.4 },
  fieldInput: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, borderWidth: 1, borderColor: C.border },
  fieldLocked: { opacity: 0.6 },
  fieldValue: { color: C.text, fontSize: 15 },
  fieldHint: { color: C.textMute, fontSize: 12, marginTop: 6 },
  notesInput: { color: C.text, minHeight: 56, textAlignVertical: 'top', justifyContent: 'flex-start' },
  yearRow: { flexDirection: 'row', gap: 8 },
  yearChip: { flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  yearChipActive: { backgroundColor: C.primaryDim, borderColor: C.primary },
  yearChipText: { color: C.textSec, fontWeight: '700', fontSize: 14 },
  yearChipTextActive: { color: C.text },
  amountInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: C.border },
  amountPrefix: { color: C.textSec, fontSize: 18, fontWeight: '700', marginRight: 6 },
  amountInput: { flex: 1, color: C.text, fontSize: 18, fontWeight: '700', paddingVertical: 13 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 22 },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  cancelBtnText: { color: C.textSec, fontWeight: '700', fontSize: 15 },
  saveBtn: { flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: C.cyan },
  saveBtnText: { color: '#04150C', fontWeight: '800', fontSize: 15 },
  btnDisabled: { opacity: 0.55 },
  pickerSheet: { marginHorizontal: 24, marginTop: 'auto', marginBottom: 'auto', backgroundColor: C.cardDeep, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: C.borderHi },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.border },
  pickerRowText: { color: C.text, fontSize: 15, flex: 1 },
  pickerRowMeta: { color: C.textMute, fontSize: 12 },
});
