// app/suppliers/onboard.tsx — Become a Supplier (capability graph onboarding)
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, StatusBar, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { NEXPEC_THEME as T } from '../../src/components/DynamicForm/theme';
import { DocumentField } from '../../src/components/DynamicForm/fields/DocumentField';
import { useCapabilityCatalog, onboardSupplier } from '../../src/hooks/useSupplierEcosystem';
import { useLanguage } from '@/src/i18n/LanguageProvider';

export default function SupplierOnboardScreen() {
  const { t, isRTL, language } = useLanguage();
  const router = useRouter();
  const { items: caps, loading } = useCapabilityCatalog();
  const [legalName, setLegalName] = useState('');
  const [headline, setHeadline] = useState('');
  const [country, setCountry] = useState('');
  const [standards, setStandards] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Custody-sealed documents (each uploads + seals immediately on pick).
  const [isoCert, setIsoCert] = useState<any>(null);
  const [accreditation, setAccreditation] = useState<any>(null);
  const [insurance, setInsurance] = useState<any>(null);

  const grouped = useMemo(() => {
    const g: Record<string, typeof caps> = {};
    caps.forEach((c) => { (g[c.category] ??= []).push(c); });
    return g;
  }, [caps]);

  const toggle = (k: string) => setSelected((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  const submit = async () => {
    if (legalName.trim() === '') { Alert.alert(t('Company name required')); return; }
    if (selected.length === 0) { Alert.alert(t('Pick at least one capability')); return; }
    setBusy(true);
    try {
      const attributes = standards.trim() ? { standards: standards.split(',').map((x) => x.trim()).filter(Boolean) } : {};
      const { error } = await onboardSupplier({ legal_name: legalName.trim(), headline: headline.trim() || null, capabilities: selected, attributes, country: country.trim() || null });
      if (error) { Alert.alert(t('Could not save'), error.message); return; }
      Alert.alert(t('You are listed'), t('Your supplier profile is live in the directory.'), [{ text: t('OK'), onPress: () => router.replace('/suppliers' as any) }]);
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={T.colors.background} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={s.back}><Ionicons name="arrow-back" size={24} color={T.colors.text} /></TouchableOpacity>
        <Text style={s.title}>{t('Become a Supplier')}</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? <View style={s.center}><ActivityIndicator size="large" color={T.colors.primary} /></View> : (
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Field label={t('Company / legal name *')}><TextInput value={legalName} onChangeText={setLegalName} placeholder={t('ACME Manufacturing GmbH')} placeholderTextColor={T.colors.textMuted} style={s.input} /></Field>
          <Field label={t('Headline')}><TextInput value={headline} onChangeText={setHeadline} placeholder={t('ISO 17025 calibration lab, GCC')} placeholderTextColor={T.colors.textMuted} style={s.input} /></Field>
          <Field label={t('Country code')}><TextInput value={country} onChangeText={(v) => setCountry(v.toUpperCase())} maxLength={2} autoCapitalize="characters" placeholder={t('AE')} placeholderTextColor={T.colors.textMuted} style={s.input} /></Field>

          <Text style={s.section}>{t('Capabilities *')}</Text>
          {Object.entries(grouped).map(([cat, list]) => (
            <View key={cat} style={{ marginBottom: T.spacing.sm }}>
              <Text style={s.catLabel}>{cat.toUpperCase()}</Text>
              <View style={s.chipWrap}>
                {list.map((c) => {
                  const on = selected.includes(c.key);
                  return (
                    <TouchableOpacity key={c.key} onPress={() => toggle(c.key)} activeOpacity={0.8} style={[s.chip, on && { backgroundColor: T.colors.primary, borderColor: T.colors.primary }]}>
                      {on && <Ionicons name="checkmark" size={13} color="#fff" />}
                      <Text style={[s.chipTxt, on && { color: '#fff' }]}>{c.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}

          <Field label={t('Standards served (comma-separated)')}><TextInput value={standards} onChangeText={setStandards} placeholder={t('ASME, EN, ISO')} placeholderTextColor={T.colors.textMuted} style={s.input} /></Field>

          <Text style={s.section}>{t('Certifications & Documents')}</Text>
          <Text style={s.docNote}>{t('Optional now. Every file is cryptographically sealed and timestamped on upload, then reviewed for verification. You can add more anytime from your dashboard.')}</Text>
          <DocumentField
            field={{ name: 'iso_cert', label: t('ISO / Quality certificate'), type: 'document', docType: 'iso_cert', helperText: t('e.g. ISO 9001 or ISO 17025') }}
            value={isoCert} onChange={setIsoCert} onBlur={() => {}}
          />
          <DocumentField
            field={{ name: 'accreditation', label: t('Accreditation certificate'), type: 'document', docType: 'accreditation', helperText: t('Lab / inspection body accreditation') }}
            value={accreditation} onChange={setAccreditation} onBlur={() => {}}
          />
          <DocumentField
            field={{ name: 'insurance', label: t('Insurance (optional)'), type: 'document', docType: 'insurance', helperText: t('Liability / professional indemnity') }}
            value={insurance} onChange={setInsurance} onBlur={() => {}}
          />

          <TouchableOpacity style={[s.submit, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="storefront-outline" size={18} color="#fff" />}
            <Text style={s.submitTxt}>{busy ? t('Saving…') : t('List my company')}</Text>
          </TouchableOpacity>
          <View style={{ height: 24 }} />
        </ScrollView>
      )}
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
  section: { color: T.colors.text, fontSize: T.fontSize.md, fontWeight: '700', marginTop: 4, marginBottom: T.spacing.sm },
  docNote: { color: T.colors.textMuted, fontSize: T.fontSize.xs, marginTop: -2, marginBottom: T.spacing.md, lineHeight: 16 },
  catLabel: { color: T.colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: T.borderRadius.full, borderWidth: 1, borderColor: T.colors.inputBorder, backgroundColor: T.colors.inputBackground },
  chipTxt: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, fontWeight: '600' },
  submit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: T.colors.primary, borderRadius: T.borderRadius.md, paddingVertical: T.spacing.lg, marginTop: T.spacing.md },
  submitTxt: { color: '#fff', fontSize: T.fontSize.md, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
