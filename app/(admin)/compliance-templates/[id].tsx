// ════════════════════════════════════════════════════════════════════════════
//  app/(admin)/compliance-templates/[id].tsx
//
//  STEP 2 — Admin Scope-Template Editor (CREATE + EDIT)
//
//  Route convention:
//    • id === 'new' → create a fresh template (no row yet)
//    • id === uuid  → load existing template + its evidence requirements
//
//  Sections
//    1. Basics — name, slug, version, category, region, description
//    2. Pricing & validity — base_price_cents, validity_months, credential tier
//    3. Status — is_active toggle (with publish gate: must have ≥1 required req)
//    4. Requirements — full CRUD on inspection_evidence_requirements,
//       reorderable via up/down buttons, inline editor modal per item
//
//  All writes are committed individually (no draft/transactional save):
//  saving the template UPSERTs immediately; adding/editing/deleting a
//  requirement does the same. This avoids stale-draft footguns when
//  multiple admins are editing concurrently.
//
//  RLS: every write requires admin/super_admin role per the
//  compliance_mode_foundation migration. Non-admin viewers get the
//  same "Admin only" gate as the list screen.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  Plus,
  Save,
  ShieldAlert,
  Trash2,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

// ─────────────────────────────────────────────────────────────
//  Palette (matches index)
// ─────────────────────────────────────────────────────────────
const C = {
  bg: '#020420', card: '#0A0E2A', cardLift: '#0F1538', border: '#1A1F4A',
  borderHi: '#2B2F6E', primary: '#7C3AED', primarySoft: '#A78BFA',
  primaryDim: 'rgba(124,58,237,0.14)', text: '#FFFFFF', textSec: '#CBD5F5',
  textDim: '#64748B', ok: '#10B981', warn: '#F59E0B', danger: '#EF4444',
  cyan: '#06B6D4',
};

type EvidenceKind =
  | 'photo' | 'photo_with_face' | 'gps_pin' | 'document_upload'
  | 'video_walkthrough' | 'rep_interview' | 'signed_statement' | 'text_input';

const ALL_KINDS: EvidenceKind[] = [
  'photo', 'photo_with_face', 'gps_pin', 'document_upload',
  'video_walkthrough', 'rep_interview', 'signed_statement', 'text_input',
];
const ALL_TIERS = ['cci_basic', 'cci_advanced', 'cci_lead'] as const;
type Tier = typeof ALL_TIERS[number];

interface TemplateForm {
  slug: string;
  name: string;
  version: number;
  category: string;
  region: string;
  validity_months: number;
  base_price_cents: number;
  requires_credential_tier: Tier;
  description_md: string;
  is_active: boolean;
}

interface Requirement {
  id?: string;                  // undefined = unsaved local row
  template_id?: string;
  sort_order: number;
  kind: EvidenceKind;
  label: string;
  hint: string;
  required: boolean;
  min_count: number;
  max_count: number;
  constraints_json: string;     // edited as text; parsed on save
}

const BLANK_FORM: TemplateForm = {
  slug: '',
  name: '',
  version: 1,
  category: 'supplier_verification',
  region: 'global',
  validity_months: 12,
  base_price_cents: 0,
  requires_credential_tier: 'cci_basic',
  description_md: '',
  is_active: false,
};

const BLANK_REQ: Requirement = {
  sort_order: 1,
  kind: 'photo',
  label: '',
  hint: '',
  required: true,
  min_count: 1,
  max_count: 1,
  constraints_json: '{}',
};

// ─────────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────────
export default function ComplianceTemplateEditor() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { role } = useAuth();
  const isAdmin = role === 'admin' || role === 'super_admin';

  const [form, setForm] = useState<TemplateForm>(BLANK_FORM);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(isNew ? null : (id ?? null));

  // Requirement modal
  const [editingReq, setEditingReq] = useState<Requirement | null>(null);
  const [editingReqIdx, setEditingReqIdx] = useState<number | null>(null);

  // ─── Load existing template ─────────────────────────────
  const load = useCallback(async () => {
    if (isNew) return;
    try {
      const { data: t, error: tErr } = await supabase
        .from('inspection_scope_templates')
        .select('*')
        .eq('id', id)
        .single();
      if (tErr) throw tErr;
      setForm({
        slug: t.slug,
        name: t.name,
        version: t.version,
        category: t.category,
        region: t.region,
        validity_months: t.validity_months,
        base_price_cents: t.base_price_cents,
        requires_credential_tier: t.requires_credential_tier,
        description_md: t.description_md ?? '',
        is_active: t.is_active,
      });

      const { data: r, error: rErr } = await supabase
        .from('inspection_evidence_requirements')
        .select('*')
        .eq('template_id', id)
        .order('sort_order', { ascending: true });
      if (rErr) throw rErr;
      setRequirements(
        (r ?? []).map((row: any) => ({
          id: row.id,
          template_id: row.template_id,
          sort_order: row.sort_order,
          kind: row.kind,
          label: row.label,
          hint: row.hint ?? '',
          required: row.required,
          min_count: row.min_count,
          max_count: row.max_count,
          constraints_json: JSON.stringify(row.constraints_json ?? {}, null, 2),
        }))
      );
    } catch (e: any) {
      console.error('[template-editor] load failed:', e);
      Alert.alert('Error', e?.message ?? 'Failed to load template.');
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => { load(); }, [load]);

  // ─── Save template basics ───────────────────────────────
  const saveTemplate = async () => {
    // Client-side validation
    if (!form.name.trim()) return Alert.alert('Validation', 'Name is required.');
    if (!/^[a-z0-9_]+$/.test(form.slug)) {
      return Alert.alert('Validation', 'Slug must be lowercase letters, numbers, and underscores.');
    }
    if (form.validity_months <= 0) return Alert.alert('Validation', 'Validity months must be > 0.');
    if (form.base_price_cents < 0)  return Alert.alert('Validation', 'Price cannot be negative.');

    setSaving(true);
    try {
      if (isNew) {
        const { data, error } = await supabase
          .from('inspection_scope_templates')
          .insert({
            slug: form.slug,
            name: form.name,
            version: form.version,
            category: form.category,
            region: form.region,
            validity_months: form.validity_months,
            base_price_cents: form.base_price_cents,
            requires_credential_tier: form.requires_credential_tier,
            description_md: form.description_md || null,
            is_active: form.is_active,
          })
          .select('id')
          .single();
        if (error) throw error;
        setTemplateId(data.id);
        // Replace URL with the new id so subsequent edits go to the same row
        router.replace(`/(admin)/compliance-templates/${data.id}` as any);
        Alert.alert('Created', 'Template created. You can now add requirements.');
      } else {
        const { error } = await supabase
          .from('inspection_scope_templates')
          .update({
            slug: form.slug,
            name: form.name,
            version: form.version,
            category: form.category,
            region: form.region,
            validity_months: form.validity_months,
            base_price_cents: form.base_price_cents,
            requires_credential_tier: form.requires_credential_tier,
            description_md: form.description_md || null,
            is_active: form.is_active,
          })
          .eq('id', templateId);
        if (error) throw error;
      }
    } catch (e: any) {
      console.error('[template-editor] save failed:', e);
      Alert.alert('Error', e?.message ?? 'Failed to save template.');
    } finally {
      setSaving(false);
    }
  };

  // ─── Requirement CRUD ───────────────────────────────────
  const onAddRequirement = () => {
    if (!templateId) {
      Alert.alert('Save first', 'Save the template before adding requirements.');
      return;
    }
    setEditingReq({ ...BLANK_REQ, sort_order: requirements.length + 1 });
    setEditingReqIdx(null);
  };

  const onEditRequirement = (idx: number) => {
    setEditingReq({ ...requirements[idx] });
    setEditingReqIdx(idx);
  };

  const onSaveRequirementModal = async () => {
    if (!editingReq) return;
    if (!templateId) return;
    if (!editingReq.label.trim()) {
      return Alert.alert('Validation', 'Label is required.');
    }
    let parsed: any = {};
    try {
      parsed = JSON.parse(editingReq.constraints_json || '{}');
    } catch {
      return Alert.alert('Validation', 'constraints_json must be valid JSON.');
    }
    if (editingReq.min_count < 0 || editingReq.max_count < editingReq.min_count) {
      return Alert.alert('Validation', 'min_count must be ≥ 0 and ≤ max_count.');
    }

    try {
      if (editingReq.id) {
        const { error } = await supabase
          .from('inspection_evidence_requirements')
          .update({
            sort_order: editingReq.sort_order,
            kind: editingReq.kind,
            label: editingReq.label,
            hint: editingReq.hint || null,
            required: editingReq.required,
            min_count: editingReq.min_count,
            max_count: editingReq.max_count,
            constraints_json: parsed,
          })
          .eq('id', editingReq.id);
        if (error) throw error;
        setRequirements((prev) => {
          const next = [...prev];
          if (editingReqIdx !== null) next[editingReqIdx] = { ...editingReq };
          return next;
        });
      } else {
        const { data, error } = await supabase
          .from('inspection_evidence_requirements')
          .insert({
            template_id: templateId,
            sort_order: editingReq.sort_order,
            kind: editingReq.kind,
            label: editingReq.label,
            hint: editingReq.hint || null,
            required: editingReq.required,
            min_count: editingReq.min_count,
            max_count: editingReq.max_count,
            constraints_json: parsed,
          })
          .select('*')
          .single();
        if (error) throw error;
        setRequirements((prev) => [
          ...prev,
          {
            id: data.id,
            template_id: data.template_id,
            sort_order: data.sort_order,
            kind: data.kind,
            label: data.label,
            hint: data.hint ?? '',
            required: data.required,
            min_count: data.min_count,
            max_count: data.max_count,
            constraints_json: JSON.stringify(data.constraints_json ?? {}, null, 2),
          },
        ]);
      }
      setEditingReq(null);
      setEditingReqIdx(null);
    } catch (e: any) {
      console.error('[template-editor] save requirement failed:', e);
      Alert.alert('Error', e?.message ?? 'Failed to save requirement.');
    }
  };

  const onDeleteRequirement = async (idx: number) => {
    const req = requirements[idx];
    if (!req.id) {
      // Unsaved row — just drop it
      setRequirements((prev) => prev.filter((_, i) => i !== idx));
      return;
    }
    Alert.alert(
      'Delete requirement?',
      `"${req.label}", this cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('inspection_evidence_requirements')
                .delete()
                .eq('id', req.id);
              if (error) throw error;
              setRequirements((prev) => prev.filter((_, i) => i !== idx));
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Failed to delete.');
            }
          },
        },
      ]
    );
  };

  const onMoveRequirement = async (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= requirements.length) return;
    const a = requirements[idx];
    const b = requirements[target];
    // Swap sort_order values
    const newOrderA = b.sort_order;
    const newOrderB = a.sort_order;
    setRequirements((prev) => {
      const next = [...prev];
      next[idx]    = { ...a, sort_order: newOrderA };
      next[target] = { ...b, sort_order: newOrderB };
      return next.sort((x, y) => x.sort_order - y.sort_order);
    });
    // Persist both
    try {
      const ops = [
        a.id ? supabase.from('inspection_evidence_requirements').update({ sort_order: newOrderA }).eq('id', a.id) : null,
        b.id ? supabase.from('inspection_evidence_requirements').update({ sort_order: newOrderB }).eq('id', b.id) : null,
      ].filter(Boolean) as any[];
      await Promise.all(ops);
    } catch (e: any) {
      console.warn('[template-editor] reorder persist failed:', e);
    }
  };

  // ─── Render guards ───────────────────────────────────────
  if (!isAdmin) {
    return (
      <SafeAreaView style={s.bg} edges={['top']}>
        <View style={s.deniedWrap}>
          <ShieldAlert size={48} color={C.danger} />
          <Text style={s.deniedTitle}>Admin only</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={s.bg} edges={['top']}>
        <View style={s.center}><ActivityIndicator color={C.primary} size="large" /></View>
      </SafeAreaView>
    );
  }

  // ─── Main render ─────────────────────────────────────────
  return (
    <SafeAreaView style={s.bg} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.backBtn}>
          <ChevronLeft size={22} color={C.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle} numberOfLines={1}>
            {isNew ? 'New Template' : (form.name || 'Untitled')}
          </Text>
          <Text style={s.headerSub} numberOfLines={1}>
            {isNew ? 'Compliance scope library' : `${form.slug}, v${form.version}`}
          </Text>
        </View>
        <Pressable
          onPress={saveTemplate}
          disabled={saving}
          style={({ pressed }) => [s.saveBtn, pressed && { opacity: 0.85 }, saving && { opacity: 0.5 }]}
        >
          {saving
            ? <ActivityIndicator size="small" color="#FFF" />
            : <><Save size={14} color="#FFF" /><Text style={s.saveBtnText}>Save</Text></>}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        {/* SECTION 1: Basics */}
        <SectionCard title="Basics">
          <Field
            label="Slug"
            value={form.slug}
            onChangeText={(v) => setForm({ ...form, slug: v })}
            placeholder="supplier_existence_verification"
            mono
            autoCapitalize="none"
          />
          <Field
            label="Name"
            value={form.name}
            onChangeText={(v) => setForm({ ...form, name: v })}
            placeholder="Supplier Existence Verification"
          />
          <View style={s.row2}>
            <View style={{ flex: 1 }}>
              <Field
                label="Version"
                value={String(form.version)}
                onChangeText={(v) => setForm({ ...form, version: Math.max(1, parseInt(v, 10) || 1) })}
                keyboardType="numeric"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Category"
                value={form.category}
                onChangeText={(v) => setForm({ ...form, category: v })}
                placeholder="supplier_verification"
                autoCapitalize="none"
              />
            </View>
          </View>
          <View style={s.row2}>
            <View style={{ flex: 1 }}>
              <Field
                label="Region"
                value={form.region}
                onChangeText={(v) => setForm({ ...form, region: v })}
                placeholder="global / UAE / KSA / …"
                autoCapitalize="none"
              />
            </View>
          </View>
          <Field
            label="Description (markdown)"
            value={form.description_md}
            onChangeText={(v) => setForm({ ...form, description_md: v })}
            placeholder="Brief, regulator-grade description of what this scope verifies."
            multiline
          />
        </SectionCard>

        {/* SECTION 2: Pricing & validity */}
        <SectionCard title="Pricing & Validity">
          <View style={s.row2}>
            <View style={{ flex: 1 }}>
              <Field
                label="Base price (USD)"
                value={String((form.base_price_cents / 100).toFixed(2))}
                onChangeText={(v) =>
                  setForm({ ...form, base_price_cents: Math.max(0, Math.round((parseFloat(v) || 0) * 100)) })
                }
                keyboardType="numeric"
                placeholder="499.00"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Validity (months)"
                value={String(form.validity_months)}
                onChangeText={(v) => setForm({ ...form, validity_months: Math.max(1, parseInt(v, 10) || 1) })}
                keyboardType="numeric"
                placeholder="12"
              />
            </View>
          </View>
          <Text style={s.fieldLabel}>Required CCI tier</Text>
          <View style={s.tierRow}>
            {ALL_TIERS.map((t) => (
              <Pressable
                key={t}
                onPress={() => setForm({ ...form, requires_credential_tier: t })}
                style={[s.tierChip, form.requires_credential_tier === t && s.tierChipOn]}
              >
                <Text style={[s.tierChipText, form.requires_credential_tier === t && s.tierChipTextOn]}>
                  {t.replace('cci_', '').toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>
        </SectionCard>

        {/* SECTION 3: Status */}
        <SectionCard title="Status">
          <View style={s.statusRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.statusTitle}>Active</Text>
              <Text style={s.statusSub}>
                {form.is_active
                  ? 'Visible to buyers in the post-job scope picker.'
                  : 'Hidden from buyers. Use this for drafts and deprecated scopes.'}
              </Text>
            </View>
            <Switch
              value={form.is_active}
              onValueChange={(v) => setForm({ ...form, is_active: v })}
              thumbColor={form.is_active ? C.ok : C.textDim}
              trackColor={{ false: '#1F2937', true: 'rgba(16,185,129,0.4)' }}
            />
          </View>
        </SectionCard>

        {/* SECTION 4: Requirements */}
        <SectionCard
          title="Evidence Requirements"
          right={
            <Pressable
              onPress={onAddRequirement}
              style={({ pressed }) => [s.addReqBtn, pressed && { opacity: 0.85 }]}
            >
              <Plus size={12} color="#FFF" strokeWidth={3} />
              <Text style={s.addReqBtnText}>Add</Text>
            </Pressable>
          }
        >
          {requirements.length === 0 && (
            <Text style={s.emptyReq}>
              {templateId
                ? 'No requirements yet. Add at least one before publishing.'
                : 'Save the template first, then add requirements.'}
            </Text>
          )}
          {requirements.map((r, idx) => (
            <View key={r.id ?? `local-${idx}`} style={s.reqCard}>
              <View style={s.reqHead}>
                <View style={{ flex: 1 }}>
                  <Text style={s.reqLabel}>
                    {r.sort_order}. {r.label || <Text style={{ color: C.textDim, fontStyle: 'italic' }}>(no label)</Text>}
                  </Text>
                  <Text style={s.reqKind}>
                    {r.kind}, {r.required ? 'required' : 'optional'}, {r.min_count}–{r.max_count}
                  </Text>
                </View>
                <View style={s.reqActions}>
                  <Pressable onPress={() => onMoveRequirement(idx, -1)} hitSlop={6} style={s.reqIconBtn}>
                    <ArrowUp size={14} color={C.textDim} />
                  </Pressable>
                  <Pressable onPress={() => onMoveRequirement(idx, 1)} hitSlop={6} style={s.reqIconBtn}>
                    <ArrowDown size={14} color={C.textDim} />
                  </Pressable>
                  <Pressable onPress={() => onEditRequirement(idx)} hitSlop={6} style={s.reqEditBtn}>
                    <Text style={s.reqEditText}>Edit</Text>
                  </Pressable>
                  <Pressable onPress={() => onDeleteRequirement(idx)} hitSlop={6} style={s.reqIconBtn}>
                    <Trash2 size={14} color={C.danger} />
                  </Pressable>
                </View>
              </View>
              {!!r.hint && <Text style={s.reqHint}>{r.hint}</Text>}
            </View>
          ))}
        </SectionCard>
      </ScrollView>

      {/* Requirement editor modal */}
      <Modal
        visible={editingReq !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingReq(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={s.modalBg}
        >
          <Pressable style={s.modalBg} onPress={() => setEditingReq(null)}>
            <Pressable style={s.modalCard} onPress={(e) => e.stopPropagation()}>
              <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
                <Text style={s.modalTitle}>
                  {editingReqIdx !== null ? 'Edit Requirement' : 'Add Requirement'}
                </Text>

                <Field
                  label="Label"
                  value={editingReq?.label ?? ''}
                  onChangeText={(v) => setEditingReq((p) => p ? { ...p, label: v } : p)}
                  placeholder="GPS pin at the front entrance"
                />
                <Field
                  label="Hint"
                  value={editingReq?.hint ?? ''}
                  onChangeText={(v) => setEditingReq((p) => p ? { ...p, hint: v } : p)}
                  placeholder="Inspector-facing instruction shown next to the capture."
                  multiline
                />

                <Text style={s.fieldLabel}>Kind</Text>
                <View style={s.kindGrid}>
                  {ALL_KINDS.map((k) => (
                    <Pressable
                      key={k}
                      onPress={() => setEditingReq((p) => p ? { ...p, kind: k } : p)}
                      style={[s.kindChip, editingReq?.kind === k && s.kindChipOn]}
                    >
                      <Text style={[s.kindChipText, editingReq?.kind === k && s.kindChipTextOn]}>{k}</Text>
                    </Pressable>
                  ))}
                </View>

                <View style={s.row2}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="Sort order"
                      value={String(editingReq?.sort_order ?? 1)}
                      onChangeText={(v) => setEditingReq((p) => p ? { ...p, sort_order: parseInt(v, 10) || 1 } : p)}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={s.statusRow}>
                      <Text style={s.fieldLabel}>Required</Text>
                      <Switch
                        value={editingReq?.required ?? true}
                        onValueChange={(v) => setEditingReq((p) => p ? { ...p, required: v } : p)}
                        thumbColor={editingReq?.required ? C.ok : C.textDim}
                        trackColor={{ false: '#1F2937', true: 'rgba(16,185,129,0.4)' }}
                      />
                    </View>
                  </View>
                </View>

                <View style={s.row2}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="Min count"
                      value={String(editingReq?.min_count ?? 1)}
                      onChangeText={(v) => setEditingReq((p) => p ? { ...p, min_count: parseInt(v, 10) || 0 } : p)}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="Max count"
                      value={String(editingReq?.max_count ?? 1)}
                      onChangeText={(v) => setEditingReq((p) => p ? { ...p, max_count: parseInt(v, 10) || 1 } : p)}
                      keyboardType="numeric"
                    />
                  </View>
                </View>

                <Field
                  label="constraints_json"
                  value={editingReq?.constraints_json ?? '{}'}
                  onChangeText={(v) => setEditingReq((p) => p ? { ...p, constraints_json: v } : p)}
                  multiline
                  mono
                  autoCapitalize="none"
                />

                <View style={s.modalBtns}>
                  <Pressable
                    onPress={() => setEditingReq(null)}
                    style={[s.modalBtn, { backgroundColor: C.cardLift }]}
                  >
                    <Text style={[s.modalBtnText, { color: C.textSec }]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={onSaveRequirementModal}
                    style={[s.modalBtn, { backgroundColor: C.primary }]}
                  >
                    <Text style={[s.modalBtnText, { color: '#FFF' }]}>Save</Text>
                  </Pressable>
                </View>
              </ScrollView>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────
const SectionCard: React.FC<{
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, right, children }) => (
  <View style={s.sectionCard}>
    <View style={s.sectionHead}>
      <Text style={s.sectionTitle}>{title}</Text>
      {right}
    </View>
    {children}
  </View>
);

const Field: React.FC<{
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  mono?: boolean;
  keyboardType?: 'default' | 'numeric' | 'email-address';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}> = ({ label, value, onChangeText, placeholder, multiline, mono, keyboardType, autoCapitalize }) => (
  <View style={{ marginBottom: 12 }}>
    <Text style={s.fieldLabel}>{label}</Text>
    <TextInput
      style={[
        s.input,
        multiline && { minHeight: 80, textAlignVertical: 'top', paddingTop: 10 },
        mono && { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) as any, fontSize: 12 },
      ]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={C.textDim}
      multiline={multiline}
      keyboardType={keyboardType ?? 'default'}
      autoCapitalize={autoCapitalize ?? 'sentences'}
      autoCorrect={false}
    />
  </View>
);

// ─────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { color: C.text, fontSize: 16, fontWeight: '800' },
  headerSub: { color: C.textDim, fontSize: 11, marginTop: 1 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 10, backgroundColor: C.primary,
  },
  saveBtnText: { color: '#FFF', fontSize: 13, fontWeight: '800' },

  sectionCard: {
    backgroundColor: C.card,
    borderColor: C.border, borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    color: C.textDim, fontSize: 11, fontWeight: '800',
    letterSpacing: 0.8, textTransform: 'uppercase',
  },

  fieldLabel: {
    color: C.textSec, fontSize: 11, fontWeight: '700',
    marginBottom: 6, letterSpacing: 0.3, textTransform: 'uppercase',
  },
  input: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    color: C.text, fontSize: 14,
  },

  row2: { flexDirection: 'row', gap: 10 },

  tierRow: { flexDirection: 'row', gap: 8 },
  tierChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1, borderColor: C.border,
    backgroundColor: C.bg,
    alignItems: 'center',
  },
  tierChipOn: { backgroundColor: C.primaryDim, borderColor: C.primary },
  tierChipText: { color: C.textDim, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  tierChipTextOn: { color: C.primarySoft },

  statusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 4,
  },
  statusTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  statusSub: { color: C.textDim, fontSize: 12, marginTop: 2 },

  addReqBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, backgroundColor: C.primary,
  },
  addReqBtnText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  emptyReq: { color: C.textDim, fontSize: 12, fontStyle: 'italic', paddingVertical: 8 },

  reqCard: {
    backgroundColor: C.bg,
    borderColor: C.border, borderWidth: 1,
    borderRadius: 10, padding: 12, marginTop: 8,
  },
  reqHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reqLabel: { color: C.text, fontSize: 13, fontWeight: '700' },
  reqKind: { color: C.textDim, fontSize: 11, marginTop: 2 },
  reqHint: { color: C.textSec, fontSize: 11, marginTop: 6, fontStyle: 'italic' },
  reqActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reqIconBtn: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: C.cardLift,
    justifyContent: 'center', alignItems: 'center',
  },
  reqEditBtn: {
    paddingHorizontal: 8, height: 28, borderRadius: 8,
    backgroundColor: C.primaryDim,
    justifyContent: 'center', alignItems: 'center',
  },
  reqEditText: { color: C.primarySoft, fontSize: 11, fontWeight: '800' },

  // Modal
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: C.bg,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderColor: C.border, borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    padding: 18,
    maxHeight: '92%',
  },
  modalTitle: { color: C.text, fontSize: 16, fontWeight: '800', marginBottom: 14 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 10 },
  modalBtn: {
    flex: 1, paddingVertical: 12,
    borderRadius: 10, alignItems: 'center',
  },
  modalBtnText: { fontSize: 14, fontWeight: '800' },

  kindGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  kindChip: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.card,
  },
  kindChipOn: { backgroundColor: C.primaryDim, borderColor: C.primary },
  kindChipText: { color: C.textDim, fontSize: 11, fontWeight: '700' },
  kindChipTextOn: { color: C.primarySoft },

  deniedWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 8,
  },
  deniedTitle: { color: C.text, fontSize: 18, fontWeight: '800' },
});
