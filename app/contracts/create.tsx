// ════════════════════════════════════════════════════════════════════════════
//  app/contracts/create.tsx — DEPRECATED
//
//  The legacy draft-creation flow that wrote to the V1 `public.contracts`
//  table is no longer the source of truth. Contracts in the V3 model are
//  generated server-side by the admin via `admin_generate_job_contract`
//  (web `/admin/jobs/[id]` → "Generate Contract") and surface to the
//  inspector via the new Job Agreement screen at
//  `app/(inspector)/jobs/[id]/contract.tsx`.
//
//  This stub replaces the old multi-screen draft builder so that any
//  remaining entry point (Hub "+ New" button, deep links, push
//  notifications) lands here with a clear explanation instead of
//  silently writing legacy rows.
//
//  The legacy `public.contracts` table remains readable (for audit
//  history) but is no longer written from the mobile app.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  StatusBar,
  ScrollView,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { ShieldCheck, ArrowLeft, Info } from 'lucide-react-native';

const COLORS = {
  background: '#020420',
  card: '#0F172A',
  cardBorder: '#1E293B',
  primary: '#7C3AED',
  primaryDark: '#5B21B6',
  textPrimary: '#F1F5F9',
  textMuted: '#94A3B8',
  textSubtle: '#64748B',
  accent: '#A78BFA',
} as const;

export default function ContractCreateDeprecated() {
  const router = useRouter();

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <Stack.Screen
        options={{
          title: 'Smart Contracts',
          headerStyle: { backgroundColor: COLORS.background },
          headerTintColor: COLORS.textPrimary,
          headerTitleStyle: { color: COLORS.textPrimary, fontWeight: '600' },
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              hitSlop={8}
              style={({ pressed }) => [
                styles.headerBack,
                pressed && { opacity: 0.6 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <ArrowLeft size={22} color={COLORS.textPrimary} />
            </Pressable>
          ),
        }}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.iconWrap}>
          <ShieldCheck size={32} color={COLORS.accent} />
        </View>

        <Text style={styles.title}>Contracts are now generated for you</Text>

        <Text style={styles.lead}>
          The legacy "Draft a Contract" flow has been retired. In the new
          model, contracts are generated automatically by the NEXPEC admin
          team once an inspector is awarded a job, and they surface
          directly inside the relevant job for both parties to sign.
        </Text>

        <View style={styles.stepsCard}>
          <View style={styles.stepHeader}>
            <Info size={14} color={COLORS.accent} />
            <Text style={styles.stepHeaderText}>How it works now</Text>
          </View>
          <Step
            n={1}
            title="Client posts a job"
            body="The job lands in the marketplace with budget + scope."
          />
          <Step
            n={2}
            title="Inspector is awarded"
            body="Either by direct assignment or by accepting an applicant."
          />
          <Step
            n={3}
            title="NEXPEC Admin generates the contract"
            body="A legally binding, role-based contract is generated and securely delivered to each party for review and signature."
          />
          <Step
            n={4}
            title="Both parties sign in-app"
            body="The contract opens inside the job's Contract tile. Typed-name digital signatures with IP capture and audit-trail emission."
          />
        </View>

        <Pressable
          onPress={() => router.replace('/(tabs)/jobs' as any)}
          style={({ pressed }) => [
            styles.primaryBtn,
            pressed && { opacity: 0.88 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Go to my jobs"
        >
          <Text style={styles.primaryBtnText}>Go to my jobs</Text>
        </Pressable>

        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.ghostBtn,
            pressed && { opacity: 0.7 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Back to contracts"
        >
          <Text style={styles.ghostBtnText}>Back to contracts</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberText}>{n}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepBody}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  headerBack: { paddingHorizontal: 6, paddingVertical: 6 },
  scrollContent: { padding: 20, paddingTop: 24, gap: 18 },
  iconWrap: {
    alignSelf: 'flex-start',
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: 'rgba(124, 58, 237, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
    letterSpacing: -0.3,
  },
  lead: {
    color: COLORS.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  stepsCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginTop: 4,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  stepHeaderText: {
    color: COLORS.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  stepRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 8,
  },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(124, 58, 237, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    color: COLORS.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  stepTitle: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  stepBody: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  primaryBtn: {
    marginTop: 6,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  ghostBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  ghostBtnText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
});
