// app/tools/[key].tsx
//
// The Tool Foundry — runner surface. Renders the tool's input_schema through
// your existing <DynamicForm/> (zero new form UI), calls tool_invoke via
// useToolRunner, and reveals the sealed result in a bottom sheet.
//
// Mirrors the FormScreen container pattern (SafeAreaView + header + DynamicForm)
// using NEXPEC_THEME.

import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, StatusBar, Modal, ScrollView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { NEXPEC_THEME as T } from '../../src/components/DynamicForm/theme';
import { DynamicForm } from '../../src/components/DynamicForm/DynamicForm';
import { useEngineeringTools } from '../../src/hooks/useEngineeringTools';
import { useToolRunner } from '../../src/hooks/useToolRunner';

const TONE: Record<string, string> = {
  success: T.colors.success, warn: '#F59E0B', danger: T.colors.error, default: T.colors.text,
};

export default function ToolRunnerScreen() {
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();
  const { tools, loading } = useEngineeringTools();
  const tool = useMemo(() => tools.find((t) => t.key === key), [tools, key]);
  const { run, running, result, reset } = useToolRunner();

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={T.colors.background} />

      <View style={s.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/tools'))} hitSlop={8} style={s.back} accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={24} color={T.colors.text} />
        </TouchableOpacity>
        <View style={s.headerTitleWrap}>
          <Ionicons name={(tool?.icon_token as any) ?? 'calculator-outline'} size={18} color={T.colors.primary} />
          <Text style={s.headerTitle} numberOfLines={1}>{tool?.title ?? 'Tool'}</Text>
        </View>
        <View style={{ width: 32 }} />
      </View>

      {loading || !tool ? (
        <View style={s.center}>
          {loading ? <ActivityIndicator size="large" color={T.colors.primary} /> : <Text style={s.err}>Tool not found.</Text>}
        </View>
      ) : (
        <>
          {!!tool.subtitle && <Text style={s.desc}>{tool.subtitle}</Text>}
          <DynamicForm
            schema={tool.input_schema}
            isLoading={running}
            submitButtonText="Calculate"
            onSubmit={async (values) => { await run(tool.key, values, tool.engine); }}
          />
        </>
      )}

      {/* Sealed result sheet */}
      <Modal visible={!!result} transparent animationType="slide" onRequestClose={reset}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <View style={s.handle} />
            {result?.ok === false && result?.locked ? (
              <Block icon="lock-closed" tint="#F59E0B" title={Platform.OS === 'ios' ? 'Not available' : 'Pro tool'} body={Platform.OS === 'ios'
                // ★ APPLE 2.1(b) (rejection, 2026-08-26) — on iOS this must carry
                //   no upgrade, pricing or purchase language: nothing here is
                //   purchasable in-app. The gate itself is unchanged (it is
                //   server-side, from result.locked) and Android keeps its
                //   existing copy so the submitted build is unaffected.
                ? "This tool isn't available for your current access level."
                : 'Upgrade to unlock this calculator.'} onClose={reset} closeText="Close" />
            ) : result?.ok === false ? (
              <Block icon="alert-circle" tint={T.colors.error} title="Check your inputs" body={result?.detail ?? 'Could not compute.'} onClose={reset} closeText="Back" />
            ) : result ? (
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={s.sheetTitle}>{result.title ?? tool?.title}</Text>
                <View style={{ gap: 10, marginTop: 14 }}>
                  {(result.result_cards ?? []).map((c, i) => (
                    <View key={i} style={s.row}>
                      <Text style={s.rowLabel}>{c.label}</Text>
                      <Text style={[s.rowValue, { color: TONE[c.tone] ?? T.colors.text }]}>
                        {c.value}{c.unit ? ` ${c.unit}` : ''}
                      </Text>
                    </View>
                  ))}
                </View>
                {!!result.citations?.length && <Text style={s.cite}>{result.citations.join(', ')}</Text>}
                {!!result.result_sha256 && (
                  <View style={s.sealRow}>
                    <Ionicons name="shield-checkmark" size={14} color={T.colors.success} />
                    <Text style={s.sealText}>Sealed, {result.result_sha256.slice(0, 12)}…</Text>
                  </View>
                )}
                <TouchableOpacity style={s.cta} onPress={reset} activeOpacity={0.85}>
                  <Text style={s.ctaText}>Done</Text>
                </TouchableOpacity>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Block({ icon, tint, title, body, onClose, closeText }: {
  icon: any; tint: string; title: string; body: string; onClose: () => void; closeText: string;
}) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 8 }}>
      <Ionicons name={icon} size={36} color={tint} />
      <Text style={s.sheetTitle}>{title}</Text>
      <Text style={s.blockBody}>{body}</Text>
      <TouchableOpacity style={s.cta} onPress={onClose} activeOpacity={0.85}>
        <Text style={s.ctaText}>{closeText}</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: T.spacing.lg, paddingTop: T.spacing.sm, paddingBottom: T.spacing.md, borderBottomWidth: 1, borderBottomColor: T.colors.inputBorder },
  back: { padding: 4, marginLeft: -4 },
  headerTitleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  headerTitle: { color: T.colors.text, fontSize: T.fontSize.lg, fontWeight: '600' },
  desc: { color: T.colors.textSecondary, fontSize: T.fontSize.sm, paddingHorizontal: T.spacing.lg, paddingVertical: T.spacing.md, backgroundColor: T.colors.cardBackground, borderBottomWidth: 1, borderBottomColor: T.colors.inputBorder },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  err: { color: T.colors.error, fontSize: T.fontSize.md },
  overlay: { flex: 1, backgroundColor: T.colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: T.colors.cardBackground, borderTopLeftRadius: T.borderRadius.xl, borderTopRightRadius: T.borderRadius.xl, padding: T.spacing.xl, paddingBottom: T.spacing.xxl, maxHeight: '82%', borderTopWidth: 1, borderColor: T.colors.inputBorder },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: T.colors.inputBorder, marginBottom: T.spacing.lg },
  sheetTitle: { color: T.colors.text, fontSize: T.fontSize.lg, fontWeight: '700', textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: T.colors.background, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder },
  rowLabel: { color: T.colors.textSecondary, fontSize: T.fontSize.sm, flexShrink: 1 },
  rowValue: { fontSize: T.fontSize.lg, fontWeight: '700' },
  cite: { color: T.colors.textMuted, fontSize: T.fontSize.xs, marginTop: 14, lineHeight: 16 },
  sealRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  sealText: { color: T.colors.success, fontSize: T.fontSize.xs, fontWeight: '600' },
  blockBody: { color: T.colors.textSecondary, fontSize: T.fontSize.sm, textAlign: 'center', marginTop: 8 },
  cta: { marginTop: T.spacing.xl, backgroundColor: T.colors.primary, borderRadius: T.borderRadius.md, paddingVertical: T.spacing.lg, alignItems: 'center' },
  ctaText: { color: T.colors.text, fontSize: T.fontSize.md, fontWeight: '600' },
});
