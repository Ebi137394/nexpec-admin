// ════════════════════════════════════════════════════════════════════════════
//  app/(inspector)/tax-center.tsx — RN payee Tax Center (mobile).
//  Jurisdiction-adaptive tax form. Submits via the tax-vault edge function
//  (TAX_VAULT_KEY stays server-side — never on device). Tax-info-before-money:
//  must be verified (or admin-exempt) before a payout. Theme: #020420 / #7C3AED.
// ════════════════════════════════════════════════════════════════════════════

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { supabase } from '@/lib/supabase';

const C = {
  bg: '#020420',
  card: 'rgba(255,255,255,0.03)',
  border: 'rgba(255,255,255,0.08)',
  primary: '#7C3AED',
  text: '#FFFFFF',
  muted: '#94A3B8',
  green: '#34D399',
  amber: '#FBBF24',
};

const COUNTRIES = [
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'OTHER', label: 'Other' },
];
const EU = new Set(['DE', 'FR']);
const FORM_LABELS: Record<string, string> = {
  w9: 'W-9 (US person)', w8ben: 'W-8BEN (individual)', w8bene: 'W-8BEN-E (entity)',
  t4a: 'T4A (Canada)', dac7: 'DAC7 (EU)',
};
function formsForCountry(code: string): string[] {
  if (code === 'US') return ['w9', 'w8ben', 'w8bene'];
  if (code === 'CA') return ['t4a', 'w8ben'];
  if (EU.has(code)) return ['dac7', 'w8ben'];
  return ['w8ben', 'w8bene'];
}
function idLabel(code: string, form: string): string {
  if (form === 'w9') return 'SSN or EIN';
  if (code === 'CA') return 'SIN or Business Number';
  if (form === 'dac7') return 'VAT ID or national tax number';
  return 'Foreign tax identifying number (TIN)';
}

export default function TaxCenterScreen() {
  const [loading, setLoading] = useState(true);
  const [cleared, setCleared] = useState(false);
  const [exempt, setExempt] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [country, setCountry] = useState('US');
  const forms = useMemo(() => formsForCountry(country), [country]);
  const [formType, setFormType] = useState('w9');
  const [taxId, setTaxId] = useState('');
  const [certified, setCertified] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const effForm = forms.includes(formType) ? formType : forms[0];

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data } = await supabase
            .from('tax_profiles')
            .select('tax_status, is_tax_exempt, expires_at')
            .eq('user_id', user.id)
            .maybeSingle();
          const verified = data?.tax_status === 'verified' && (!data?.expires_at || new Date(data.expires_at) > new Date());
          setExempt(data?.is_tax_exempt === true);
          setCleared(verified || data?.is_tax_exempt === true);
          setStatus(data?.tax_status ?? null);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const onSubmit = async () => {
    if (!certified || taxId.trim().length < 4) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('tax-vault', {
        body: { action: 'submit', form_type: effForm, country, tax_id: taxId.trim() },
      });
      const errMsg = error?.message || (data as { error?: string } | null)?.error;
      if (errMsg) {
        Alert.alert('Could not submit', errMsg);
      } else {
        Alert.alert('Submitted', 'Your tax information is encrypted and awaiting verification.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to submit tax information.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Tax Center</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={C.primary} /></View>
      ) : cleared ? (
        <View style={s.body}>
          <View style={[s.card, { borderColor: 'rgba(52,211,153,0.3)', backgroundColor: 'rgba(52,211,153,0.06)' }]}>
            <Ionicons name="shield-checkmark" size={26} color={C.green} />
            <Text style={s.clearedTitle}>{exempt ? 'Tax-exempt (admin override)' : 'Tax information verified'}</Text>
            <Text style={s.muted}>
              {exempt
                ? 'An administrator exempted your account. Payouts are unlocked.'
                : 'Your tax information is on file. Payouts are unlocked.'}
            </Text>
            <TouchableOpacity style={s.primaryBtn} onPress={() => router.replace('/(inspector)/wallet/withdraw')}>
              <Text style={s.primaryBtnText}>Continue to payout</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Text style={s.intro}>
            We collect tax details once, before your first payout, as legally required. Your full identifier is encrypted; only the last 4 digits are ever shown.
          </Text>
          {status === 'needs_update' && (
            <View style={[s.note, { borderColor: 'rgba(239,68,68,0.3)' }]}>
              <Text style={{ color: '#FCA5A5', fontSize: 12 }}>Your tax information needs an update, please re-submit.</Text>
            </View>
          )}

          <Text style={s.label}>Tax residency</Text>
          <View style={s.chipRow}>
            {COUNTRIES.map((c) => (
              <Chip key={c.code} active={country === c.code} label={c.label} onPress={() => setCountry(c.code)} />
            ))}
          </View>

          <Text style={s.label}>Tax form</Text>
          <View style={s.chipRow}>
            {forms.map((f) => (
              <Chip key={f} active={effForm === f} label={FORM_LABELS[f] ?? f} onPress={() => setFormType(f)} />
            ))}
          </View>

          <Text style={s.label}>{idLabel(country, effForm)}</Text>
          <TextInput
            value={taxId}
            onChangeText={setTaxId}
            placeholder="Enter your tax identifier"
            placeholderTextColor="#475569"
            keyboardType="number-pad"
            autoComplete="off"
            style={s.input}
          />

          <TouchableOpacity style={s.certifyRow} onPress={() => setCertified((v) => !v)} activeOpacity={0.7}>
            <Ionicons name={certified ? 'checkbox' : 'square-outline'} size={20} color={certified ? C.primary : C.muted} />
            <Text style={s.certifyText}>
              Under penalties of perjury, I certify that the information provided is true, correct, and complete.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.primaryBtn, (!certified || taxId.trim().length < 4 || submitting) && { opacity: 0.4 }]}
            onPress={onSubmit}
            disabled={!certified || taxId.trim().length < 4 || submitting}
          >
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>Submit tax information</Text>}
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Chip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[s.chip, active && { backgroundColor: 'rgba(124,58,237,0.18)', borderColor: C.primary }]}
    >
      <Text style={[s.chipText, active && { color: '#fff' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, gap: 14, paddingBottom: 48 },
  intro: { color: C.muted, fontSize: 13, lineHeight: 19 },
  note: { borderWidth: 1, borderRadius: 12, padding: 12, backgroundColor: 'rgba(239,68,68,0.06)' },
  label: { color: C.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: C.card },
  chipText: { color: C.muted, fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: C.card, color: C.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, fontVariant: ['tabular-nums'], letterSpacing: 1 },
  certifyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 6 },
  certifyText: { flex: 1, color: '#CBD5E1', fontSize: 12, lineHeight: 17 },
  primaryBtn: { backgroundColor: C.primary, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 10 },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  card: { borderWidth: 1, borderColor: C.border, borderRadius: 18, padding: 20, gap: 10, alignItems: 'flex-start' },
  clearedTitle: { color: C.text, fontSize: 17, fontWeight: '700', marginTop: 4 },
  muted: { color: C.muted, fontSize: 13, lineHeight: 19 },
});
