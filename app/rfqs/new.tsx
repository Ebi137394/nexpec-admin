// app/rfqs/new.tsx — Create RFQ with cross-discipline scope picker + source-inspection toggle
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, StatusBar, Modal, Switch, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { NEXPEC_THEME as T } from '../../src/components/DynamicForm/theme';
import { useScopeTemplates, createRfq, type ScopeTemplate } from '../../src/hooks/useSupplierEcosystem';

export default function NewRfqScreen() {
  const router = useRouter();
  const { items: scopes, loading: scopesLoading } = useScopeTemplates();
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [qty, setQty] = useState('');
  const [scope, setScope] = useState<ScopeTemplate | null>(null);
  const [requiresInspection, setRequiresInspection] = useState(true);
  const [picker, setPicker] = useState(false);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const byDomain = useMemo(() => {
    const f = scopes.filter((x) => search.trim() === '' || `${x.name} ${x.domain} ${x.category}`.toLowerCase().includes(search.toLowerCase()));
    const g: Record<string, ScopeTemplate[]> = {};
    f.forEach((x) => { (g[x.domain] ??= []).push(x); });
    return g;
  }, [scopes, search]);

  const submit = async () => {
    if (title.trim() === '') { Alert.alert('Title required'); return; }
    if (requiresInspection && !scope) { Alert.alert('Pick an inspection discipline', 'Source/FAT inspection is on. Choose the discipline NEXPEC should inspect, or turn it off for procurement-only.'); return; }
    setBusy(true);
    try {
      const spec: any = {};
      if (details.trim()) spec.details = details.trim();
      if (qty.trim()) spec.quantity = qty.trim();
      const { error } = await createRfq({ title: title.trim(), spec, scope_template_id: requiresInspection ? scope?.id ?? null : null, requires_source_inspection: requiresInspection, broker_mode: 'admin' });
      if (error) { Alert.alert('Could not post RFQ', error.message); return; }
      Alert.alert('RFQ posted', 'Suppliers can now bid. When you award, NEXPEC auto-dispatches the matched inspector.', [{ text: 'OK', onPress: () => router.replace('/rfqs' as any) }]);
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={T.colors.background} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={s.back}><Ionicons name="arrow-back" size={24} color={T.colors.text} /></TouchableOpacity>
        <Text style={s.title}>New RFQ</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Field label="What are you sourcing? *"><TextInput value={title} onChangeText={setTitle} placeholder="e.g. 20× ASME B16.5 WN flanges, 6in 150#" placeholderTextColor={T.colors.textMuted} style={s.input} /></Field>
        <Field label="Specification / details"><TextInput value={details} onChangeText={setDetails} placeholder="Material grade, standards, delivery terms…" placeholderTextColor={T.colors.textMuted} style={[s.input, s.area]} multiline /></Field>
        <Field label="Quantity"><TextInput value={qty} onChangeText={setQty} placeholder="e.g. 20 units" placeholderTextColor={T.colors.textMuted} style={s.input} /></Field>

        <View style={s.toggleCard}>
          <View style={{ flex: 1 }}>
            <Text style={s.toggleTitle}>Require source / FAT inspection</Text>
            <Text style={s.toggleSub}>NEXPEC dispatches a discipline-matched inspector to the supplier facility before shipment.</Text>
          </View>
          <Switch value={requiresInspection} onValueChange={setRequiresInspection} trackColor={{ false: T.colors.inputBorder, true: T.colors.primary }} thumbColor="#fff" />
        </View>

        {requiresInspection && (
          <Field label="Inspection discipline *">
            <TouchableOpacity style={s.picker} activeOpacity={0.85} onPress={() => setPicker(true)}>
              <Ionicons name={scope ? 'shield-checkmark' : 'shield-outline'} size={18} color={scope ? T.colors.success : T.colors.textMuted} />
              <View style={{ flex: 1 }}>
                {scope ? <>
                  <Text style={s.pickerVal} numberOfLines={1}>{scope.name}</Text>
                  <Text style={s.pickerDomain}>{scope.domain} ({scope.category})</Text>
                </> : <Text style={s.pickerPlaceholder}>Choose discipline / scope…</Text>}
              </View>
              <Ionicons name="chevron-forward" size={18} color={T.colors.textMuted} />
            </TouchableOpacity>
          </Field>
        )}

        <TouchableOpacity style={[s.submit, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={17} color="#fff" />}
          <Text style={s.submitTxt}>{busy ? 'Posting…' : 'Post RFQ'}</Text>
        </TouchableOpacity>
        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Cross-discipline scope picker */}
      <Modal visible={picker} animationType="slide" transparent onRequestClose={() => setPicker(false)}>
        <View style={s.modalRoot}>
          <View style={s.sheet}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>Inspection discipline</Text>
              <TouchableOpacity onPress={() => setPicker(false)} hitSlop={8}><Ionicons name="close" size={24} color={T.colors.text} /></TouchableOpacity>
            </View>
            <View style={s.searchWrap}>
              <Ionicons name="search" size={18} color={T.colors.textMuted} />
              <TextInput value={search} onChangeText={setSearch} placeholder="Search disciplines…" placeholderTextColor={T.colors.textMuted} style={s.search} />
            </View>
            {scopesLoading ? <View style={s.center}><ActivityIndicator color={T.colors.primary} /></View> : (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
                {Object.entries(byDomain).map(([domain, list]) => (
                  <View key={domain} style={{ marginBottom: T.spacing.md }}>
                    <Text style={s.domainLabel}>{domain.toUpperCase()}</Text>
                    {list.map((sc) => (
                      <TouchableOpacity key={sc.id} style={s.scopeRow} activeOpacity={0.8} onPress={() => { setScope(sc); setPicker(false); }}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.scopeName}>{sc.name}</Text>
                          <Text style={s.scopeCat}>{sc.category}</Text>
                        </View>
                        {scope?.id === sc.id && <Ionicons name="checkmark-circle" size={18} color={T.colors.success} />}
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
                {Object.keys(byDomain).length === 0 && <Text style={s.noMatch}>No matching discipline.</Text>}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={{ marginBottom: T.spacing.md }}><Text style={s.fieldLabel}>{label}</Text>{children}</View>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: T.spacing.lg, paddingTop: T.spacing.sm, paddingBottom: T.spacing.md, borderBottomWidth: 1, borderBottomColor: T.colors.inputBorder },
  back: { padding: 4, marginLeft: -4 },
  title: { color: T.colors.text, fontSize: T.fontSize.lg, fontWeight: '700' },
  content: { padding: T.spacing.lg },
  fieldLabel: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 },
  input: { backgroundColor: T.colors.inputBackground, borderColor: T.colors.inputBorder, borderWidth: 1, borderRadius: T.borderRadius.md, paddingHorizontal: 12, paddingVertical: 12, color: T.colors.text, fontSize: T.fontSize.sm },
  area: { minHeight: 90, textAlignVertical: 'top' },
  toggleCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: T.spacing.md, backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder, marginBottom: T.spacing.md },
  toggleTitle: { color: T.colors.text, fontSize: T.fontSize.sm, fontWeight: '700' },
  toggleSub: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, marginTop: 3, lineHeight: 16 },
  picker: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: T.colors.inputBackground, borderColor: T.colors.inputBorder, borderWidth: 1, borderRadius: T.borderRadius.md, paddingHorizontal: 12, paddingVertical: 12 },
  pickerVal: { color: T.colors.text, fontSize: T.fontSize.sm, fontWeight: '600' },
  pickerDomain: { color: T.colors.textMuted, fontSize: T.fontSize.xs, marginTop: 2 },
  pickerPlaceholder: { color: T.colors.textMuted, fontSize: T.fontSize.sm },
  submit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: T.colors.primary, borderRadius: T.borderRadius.md, paddingVertical: T.spacing.lg, marginTop: T.spacing.sm },
  submitTxt: { color: '#fff', fontSize: T.fontSize.md, fontWeight: '700' },
  modalRoot: { flex: 1, backgroundColor: T.colors.overlay ?? 'rgba(2,4,32,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: T.colors.background, borderTopLeftRadius: T.borderRadius.xl, borderTopRightRadius: T.borderRadius.xl, borderWidth: 1, borderColor: T.colors.inputBorder, maxHeight: '85%', paddingHorizontal: T.spacing.lg, paddingTop: T.spacing.lg },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: T.spacing.md },
  sheetTitle: { color: T.colors.text, fontSize: T.fontSize.lg, fontWeight: '700' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: T.spacing.md, height: 44, backgroundColor: T.colors.inputBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder, marginBottom: T.spacing.md },
  search: { flex: 1, color: T.colors.text, fontSize: T.fontSize.sm, paddingVertical: 0 },
  domainLabel: { color: T.colors.primaryLight, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 6 },
  scopeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: T.colors.inputBorder },
  scopeName: { color: T.colors.text, fontSize: T.fontSize.sm, fontWeight: '600' },
  scopeCat: { color: T.colors.textMuted, fontSize: T.fontSize.xs, marginTop: 2 },
  noMatch: { color: T.colors.textMuted, fontSize: T.fontSize.sm, textAlign: 'center', paddingVertical: 24 },
  center: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
});
