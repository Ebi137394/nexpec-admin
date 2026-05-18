// app/contracts/_components/ContractEditorModal.tsx
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Glassmorphic in-app contract drafting editor.
//
//  Lets either party type the contract body clause-by-clause and
//  saves the result to `contracts.contract_text`. A small palette
//  of clause templates ("Confidentiality", "Payment terms", etc.)
//  appends boilerplate at the cursor with one tap.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  X,
  Check,
  Edit3,
  Type,
  FileSignature,
  Sparkles,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';

// ── Brand ──
const C = {
  bg: '#020420',
  primary: '#7C3AED',
  primaryDeep: '#5B21B6',
  primaryBright: '#9333EA',
  primaryGlow: 'rgba(124, 58, 237, 0.22)',
  cyan: '#00FFFF',
  cyanGlow: 'rgba(0, 255, 255, 0.16)',
  cyanBorder: 'rgba(0, 255, 255, 0.30)',
  surface: 'rgba(255, 255, 255, 0.03)',
  surfaceElev: '#0A0E2E',
  surfaceCard: '#0E1438',
  border: 'rgba(255, 255, 255, 0.06)',
  borderStrong: 'rgba(124, 58, 237, 0.32)',
  text: '#FFFFFF',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textDim: '#475569',
  success: '#10F995',
  warning: '#F59E0B',
  pink: '#F472B6',
};

interface ContractLite {
  id: string;
  contract_text?: string | null;
  total_amount_cents?: number | null;     // ★ Task 4
  status?: string | null;
}

const TEMPLATES: Array<{
  key: string;
  label: string;
  icon: any;
  color: string;
  body: string;
}> = [
  {
    key: 'header',
    label: 'Standard header',
    icon: FileSignature,
    color: C.cyan,
    body:
      'INSPECTION SERVICES AGREEMENT\n\nThis Agreement is entered into on [DATE] between the parties hereto and governs the inspection services described below.\n\n',
  },
  {
    key: 'scope',
    label: 'Scope of work',
    icon: Type,
    color: C.primary,
    body:
      '\n1. SCOPE OF WORK\nThe Contractor shall provide qualified NDT / Welding inspection services as specified, including report generation, photo documentation, and any required follow-up consultation.\n\n',
  },
  {
    key: 'payment',
    label: 'Payment terms',
    icon: Sparkles,
    color: C.warning,
    body:
      '\n2. PAYMENT TERMS\nThe Client shall pay the agreed total amount within 14 calendar days of contract completion and acceptance of the final inspection report. Late payments accrue interest at 1.5% per month.\n\n',
  },
  {
    key: 'confidentiality',
    label: 'Confidentiality',
    icon: Edit3,
    color: C.pink,
    body:
      '\n3. CONFIDENTIALITY\nAll information shared during the engagement is treated as confidential and may not be disclosed to any third party without prior written consent.\n\n',
  },
];

export default function ContractEditorModal({
  visible,
  contract,
  onClose,
  onSaved,
}: {
  visible: boolean;
  contract: ContractLite | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const insets = useSafeAreaInsets();

  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Hydrate / reset on open
  useEffect(() => {
    if (visible && contract) {
      setBody(contract.contract_text ?? '');
      setDirty(false);
      setSubmitting(false);
    }
  }, [visible, contract?.id]);

  if (!contract) return null;

  const onChange = useCallback((text: string) => {
    setBody(text);
    setDirty(true);
  }, []);

  const insertTemplate = useCallback((blob: string) => {
    Haptics.selectionAsync().catch(() => {});
    setBody((prev) => (prev.length === 0 ? blob.trimStart() : `${prev}${blob}`));
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const text = body.trim().length === 0 ? null : body;
      const { error } = await supabase
        .from('contracts')
        .update({ contract_text: text })
        .eq('id', contract.id);
      if (error) throw error;

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {},
      );
      onSaved();
      onClose();
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
        () => {},
      );
      Alert.alert('Save failed', e?.message ?? 'Could not save the draft.');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, body, contract.id, onSaved, onClose]);

  const handleAttemptClose = useCallback(() => {
    if (dirty) {
      Alert.alert(
        'Discard changes?',
        'You have unsaved edits to the contract body.',
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: onClose },
        ],
      );
    } else {
      onClose();
    }
  }, [dirty, onClose]);

  const charCount = body.length;
  const wordCount =
    body.trim().length === 0 ? 0 : body.trim().split(/\s+/).length;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="overFullScreen"
      onRequestClose={handleAttemptClose}
      transparent={false}
    >
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View pointerEvents="none" style={s.glowTopLeft} />
        <View pointerEvents="none" style={s.glowMidRight} />

        <SafeAreaView style={s.flex1} edges={['top']}>
          <KeyboardAvoidingView
            style={s.flex1}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
          >
            {/* HEADER */}
            <View style={s.header}>
              <Pressable
                onPress={handleAttemptClose}
                disabled={submitting}
                style={({ pressed }) => [
                  s.iconBtn,
                  pressed && { transform: [{ scale: 0.92 }] },
                ]}
                hitSlop={8}
              >
                <X size={20} color={C.text} />
              </Pressable>

              <View style={s.headerCenter}>
                <Text style={s.kicker}>CONTRACT BODY</Text>
                <Text style={s.title}>Draft your agreement</Text>
              </View>

              <Pressable
                onPress={handleSave}
                disabled={submitting}
                style={({ pressed }) => [
                  s.saveBtn,
                  submitting && s.saveBtnDisabled,
                  pressed && { transform: [{ scale: 0.97 }] },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Check size={14} color="#FFFFFF" />
                    <Text style={s.saveText}>Save</Text>
                  </>
                )}
              </Pressable>
            </View>

            {/* TEMPLATE PALETTE */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.templatesRow}
            >
              {TEMPLATES.map((t) => {
                const Icon = t.icon;
                return (
                  <Pressable
                    key={t.key}
                    onPress={() => insertTemplate(t.body)}
                    style={({ pressed }) => [
                      s.templateChip,
                      {
                        backgroundColor: t.color + '14',
                        borderColor: t.color + '4D',
                      },
                      pressed && { transform: [{ scale: 0.96 }] },
                    ]}
                  >
                    <Icon size={12} color={t.color} />
                    <Text style={[s.templateLabel, { color: t.color }]}>
                      {t.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* EDITOR */}
            <View style={s.editorWrap}>
              <LinearGradient
                colors={[
                  'rgba(124, 58, 237, 0.06)',
                  'rgba(0, 255, 255, 0.03)',
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <TextInput
                value={body}
                onChangeText={onChange}
                placeholder={
                  'Write your contract clauses here…\n\nTip: tap a template chip above to insert standard boilerplate at the end.\n\n1. Scope\n2. Compensation\n3. Term\n4. Confidentiality\n5. Termination'
                }
                placeholderTextColor={C.textDim}
                multiline
                textAlignVertical="top"
                style={s.editor}
                autoCapitalize="sentences"
                autoCorrect
                editable={!submitting}
              />
            </View>

            {/* FOOTER METRICS */}
            <View
              style={[
                s.footer,
                { paddingBottom: Math.max(insets.bottom, 12) },
              ]}
            >
              <View style={s.metricsRow}>
                <Metric label="Words" value={wordCount} />
                <View style={s.metricDivider} />
                <Metric label="Chars" value={charCount} />
                <View style={s.metricDivider} />
                <Metric
                  label="Status"
                  value={dirty ? 'Unsaved' : 'Saved'}
                  accent={dirty ? C.warning : C.success}
                />
              </View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const Metric = ({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) => (
  <View style={s.metric}>
    <Text style={[s.metricValue, accent ? { color: accent } : null]}>
      {value}
    </Text>
    <Text style={s.metricLabel}>{label}</Text>
  </View>
);

// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  flex1: { flex: 1 },

  glowTopLeft: {
    position: 'absolute',
    top: -160,
    left: -120,
    width: 360,
    height: 360,
    borderRadius: 200,
    backgroundColor: C.primary,
    opacity: 0.18,
  },
  glowMidRight: {
    position: 'absolute',
    top: 280,
    right: -140,
    width: 320,
    height: 320,
    borderRadius: 200,
    backgroundColor: C.cyan,
    opacity: 0.06,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 10,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.surfaceElev,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  kicker: {
    color: C.cyan,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.6,
    marginBottom: 2,
  },
  title: {
    color: C.text,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 11,
    backgroundColor: C.success,
    shadowColor: C.success,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 5,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveText: { color: '#04130B', fontSize: 13, fontWeight: '800' },

  templatesRow: {
    paddingHorizontal: 20,
    paddingVertical: 6,
    gap: 8,
    flexDirection: 'row',
  },
  templateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  templateLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },

  editorWrap: {
    flex: 1,
    marginHorizontal: 20,
    marginTop: 8,
    borderRadius: 18,
    backgroundColor: C.surfaceElev,
    borderWidth: 1,
    borderColor: C.borderStrong,
    overflow: 'hidden',
  },
  editor: {
    flex: 1,
    color: C.text,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    padding: 18,
    textAlignVertical: 'top',
  },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 10,
    backgroundColor: C.bg,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: C.surfaceElev,
    borderWidth: 1,
    borderColor: C.border,
  },
  metric: { flex: 1, alignItems: 'center' },
  metricValue: {
    color: C.text,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  metricLabel: {
    color: C.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginTop: 1,
  },
  metricDivider: {
    width: 1,
    height: 22,
    backgroundColor: C.border,
    marginHorizontal: 4,
  },
});
