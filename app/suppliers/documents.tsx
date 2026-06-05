// app/suppliers/documents.tsx — Supplier: Vendor Document Vault (mobile parity).
// Sealed certificates (Trust Spine + OpenTimestamps). Reuses the custody DocumentField.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, StatusBar, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { NEXPEC_THEME as T } from '../../src/components/DynamicForm/theme';
import { DocumentField } from '../../src/components/DynamicForm/fields/DocumentField';
import { useMyVendorDocuments, signVendorDocument } from '../../src/hooks/useSupplierEcosystem';

const DOC_LABEL: Record<string, string> = {
  iso_cert: 'ISO / Quality', accreditation: 'Accreditation', insurance: 'Insurance', financial: 'Financial',
  nda: 'NDA', msa: 'MSA', technical_proposal: 'Technical proposal', mill_cert: 'Mill certificate', other: 'Other',
};
const DOC_TYPES = Object.keys(DOC_LABEL);
const bytes = (n: number | null) => (!n ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export default function SupplierDocuments() {
  const router = useRouter();
  const { items, loading, refetch } = useMyVendorDocuments();
  const [docType, setDocType] = useState('iso_cert');
  const [val, setVal] = useState<any>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const verified = useMemo(() => items.filter((d) => d.ots_status === 'bitcoin_confirmed').length, [items]);
  const goBack = () => (router.canGoBack() ? router.back() : router.push('/supplier-dashboard' as any));

  const onSealed = (v: any) => { setVal(v); if (v) { refetch(); setTimeout(() => setVal(null), 300); } };
  const open = async (path: string, id: string) => {
    setOpening(id);
    try { const url = await signVendorDocument(path); if (url) await Linking.openURL(url); } finally { setOpening(null); }
  };

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={T.colors.background} />
      <View style={s.header}>
        <TouchableOpacity onPress={goBack} hitSlop={8} style={s.back}><Ionicons name="arrow-back" size={24} color={T.colors.text} /></TouchableOpacity>
        <Text style={s.title}>Document Vault</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* Summary */}
        <View style={s.statRow}>
          <Stat icon="folder-open-outline" color="#8B5CF6" value={String(items.length)} label="Sealed" />
          <Stat icon="logo-bitcoin" color="#F59E0B" value={String(verified)} label="Anchored" />
          <Stat icon="time-outline" color="#38BDF8" value={String(items.length - verified)} label="Pending" />
        </View>

        {/* Upload */}
        <Text style={s.sectionTitle}>Seal a new document</Text>
        <View style={s.uploadCard}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
            {DOC_TYPES.map((t) => {
              const active = t === docType;
              return (
                <TouchableOpacity key={t} onPress={() => setDocType(t)} activeOpacity={0.8} style={[s.chip, active && { backgroundColor: T.colors.primary, borderColor: T.colors.primary }]}>
                  <Text style={[s.chipTxt, active && { color: '#FFF' }]}>{DOC_LABEL[t]}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <DocumentField key={docType} field={{ name: 'doc', label: 'File', type: 'document', docType } as any} value={val} onChange={onSealed} onBlur={() => {}} />
        </View>

        {/* Registry */}
        <Text style={s.sectionTitle}>Sealed registry</Text>
        {loading ? (
          <View style={s.center}><ActivityIndicator size="large" color={T.colors.primary} /></View>
        ) : items.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="lock-closed-outline" size={26} color={T.colors.textMuted} />
            <Text style={s.emptyTxt}>No documents sealed yet. Upload ISO, accreditation or insurance certificates, each is hashed, sealed into the Trust Spine and anchored to Bitcoin.</Text>
          </View>
        ) : items.map((d) => (
          <View key={d.id} style={s.docCard}>
            <View style={[s.iconTile, { backgroundColor: 'rgba(124,58,237,0.14)' }]}><Ionicons name="document-text-outline" size={20} color={T.colors.primaryLight} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.docTitle} numberOfLines={1}>{d.title || 'Document'}</Text>
              <View style={s.docMeta}>
                <Ionicons name="shield-checkmark" size={12} color={T.colors.success} />
                <Text style={[s.metaTxt, { color: T.colors.success }]}>Sealed</Text>
                {d.ots_status === 'bitcoin_confirmed'
                  ? <><Ionicons name="logo-bitcoin" size={12} color="#F59E0B" /><Text style={[s.metaTxt, { color: '#F59E0B' }]}>Anchored</Text></>
                  : <><Ionicons name="time-outline" size={12} color="#38BDF8" /><Text style={[s.metaTxt, { color: '#38BDF8' }]}>Pending</Text></>}
                <Text style={s.metaMuted}>{DOC_LABEL[d.doc_type] ?? d.doc_type}</Text>{d.byte_size ? <Text style={s.metaMuted}>{bytes(d.byte_size)}</Text> : null}
              </View>
            </View>
            <TouchableOpacity style={s.viewBtn} onPress={() => open(d.storage_path, d.id)} disabled={opening === d.id}>
              {opening === d.id ? <ActivityIndicator size="small" color={T.colors.primary} /> : <Ionicons name="open-outline" size={18} color={T.colors.primary} />}
            </TouchableOpacity>
          </View>
        ))}
        <View style={{ height: 28 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ icon, color, value, label }: { icon: any; color: string; value: string; label: string }) {
  return (
    <View style={s.statCard}>
      <View style={[s.statIcon, { backgroundColor: color + '22' }]}><Ionicons name={icon} size={16} color={color} /></View>
      <Text style={s.statVal}>{value}</Text><Text style={s.statLbl}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: T.spacing.lg, paddingTop: T.spacing.sm, paddingBottom: T.spacing.md },
  back: { padding: 4, marginLeft: -4 },
  title: { color: T.colors.text, fontSize: T.fontSize.xl, fontWeight: '700' },
  content: { paddingHorizontal: T.spacing.lg },
  statRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder, padding: T.spacing.md },
  statIcon: { width: 32, height: 32, borderRadius: T.borderRadius.md, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  statVal: { color: T.colors.text, fontSize: T.fontSize.xl, fontWeight: '800' },
  statLbl: { color: T.colors.textSecondary, fontSize: T.fontSize.xs },
  sectionTitle: { color: T.colors.text, fontSize: T.fontSize.md, fontWeight: '700', marginTop: T.spacing.lg, marginBottom: T.spacing.sm },
  uploadCard: { backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder, padding: T.spacing.md },
  chips: { gap: 8, paddingBottom: T.spacing.md },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: T.borderRadius.full, borderWidth: 1, borderColor: T.colors.inputBorder, backgroundColor: T.colors.background },
  chipTxt: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, fontWeight: '600' },
  center: { paddingVertical: 32, alignItems: 'center' },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 28, paddingHorizontal: 24, backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder },
  emptyTxt: { color: T.colors.textMuted, fontSize: T.fontSize.sm, textAlign: 'center', lineHeight: 20 },
  docCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: T.spacing.md, backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder, marginBottom: 8 },
  iconTile: { width: 44, height: 44, borderRadius: T.borderRadius.md, alignItems: 'center', justifyContent: 'center' },
  docTitle: { color: T.colors.text, fontSize: T.fontSize.sm, fontWeight: '600' },
  docMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 5 },
  metaTxt: { fontSize: 11, fontWeight: '700' },
  metaMuted: { color: T.colors.textMuted, fontSize: 11 },
  dot: { color: T.colors.textMuted, fontSize: 11 },
  viewBtn: { width: 40, height: 40, borderRadius: T.borderRadius.md, borderWidth: 1, borderColor: T.colors.inputBorder, alignItems: 'center', justifyContent: 'center' },
});
