// ════════════════════════════════════════════════════════════════════════════
//  app/(inspector)/jobs/[id]/contract.tsx — V3 resolver (was the legacy sign page)
//
//  This route file's previous responsibility was the OLD "Job Agreement"
//  sign screen that wrote signatures into the V1 `public.contracts` table.
//  That entire path has been retired — the V3 model is the only canonical
//  contract surface.
//
//  This file is now a thin resolver:
//
//    1. Reads the job id from the URL.
//    2. Looks up the matching V3 contract in `inspector_job_contracts_view`.
//    3. Redirects to the canonical V3 signing surface at
//       /contracts/job/jc:<contract_id>.
//
//  Why a resolver instead of changing the call sites?
//
//    Multiple call sites already push to /jobs/<id>/contract — the Job
//    Details "Contract" tile, push-notification deep links, in-app links,
//    and any pasted/bookmarked URL. Converting this file into the resolver
//    fixes ALL of them in one place. Cleaner than chasing call sites.
//
//  Edge cases handled:
//    • V3 contract exists  → router.replace to V3 signing surface
//    • V3 contract missing → friendly "Contract pending" state with a
//      link back to the Job Details screen
//    • Auth missing        → bounce to sign-in via the V3 surface's gate
//    • Unknown job id      → friendly "Not found" with a back action
//
//  The legacy V1 `public.contracts` table is never touched by this file.
// ════════════════════════════════════════════════════════════════════════════

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  StatusBar,
  ScrollView,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  ShieldCheck,
  Clock,
  AlertCircle,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/src/i18n/LanguageProvider';

const COLORS = {
  background: '#020420',
  card: '#0F172A',
  cardBorder: '#1E293B',
  primary: '#7C3AED',
  primaryDark: '#5B21B6',
  textPrimary: '#F1F5F9',
  textMuted: '#94A3B8',
  textSubtle: '#64748B',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  accent: '#A78BFA',
} as const;

type ResolverState =
  | { kind: 'resolving' }
  | { kind: 'no-contract'; jobId: string }
  | { kind: 'job-not-found' }
  | { kind: 'error'; message: string };

export default function JobContractResolver() {
  const router = useRouter();
  const { t, isRTL, language } = useLanguage();
  const { id: jobId } = useLocalSearchParams<{ id: string }>();
  const [state, setState] = useState<ResolverState>({ kind: 'resolving' });

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      if (!jobId || typeof jobId !== 'string') {
        if (!cancelled) setState({ kind: 'job-not-found' });
        return;
      }

      const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RX.test(jobId)) {
        if (!cancelled) setState({ kind: 'job-not-found' });
        return;
      }

      try {
        // Inspector role → inspector_job_contracts_view (GR2 blind-pricing).
        // The view's RLS limits results to contracts where
        // inspector_id = auth.uid(), so this never returns another
        // inspector's row.
        const { data, error } = await supabase
          .from('inspector_job_contracts_view')
          .select('id, job_id')
          .eq('job_id', jobId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (cancelled) return;

        if (error) {
          setState({ kind: 'error', message: error.message });
          return;
        }

        if (data?.id) {
          // Redirect to the canonical V3 signing surface.
          // The `jc:` prefix is the Hub's convention to disambiguate V3
          // contract ids from legacy contract ids; the V3 page strips it.
          router.replace(`/contracts/job/jc:${data.id}` as any);
          return;
        }

        // No V3 contract yet for this job.
        setState({ kind: 'no-contract', jobId });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [jobId, router]);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <Stack.Screen
        options={{
          title: t('Contract'),
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
              accessibilityLabel={t('Go back')}
            >
              <ArrowLeft size={22} color={COLORS.textPrimary} />
            </Pressable>
          ),
        }}
      />

      <ScrollView contentContainerStyle={styles.content}>
        {state.kind === 'resolving' && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.resolvingText}>{t('Opening your contract…')}</Text>
          </View>
        )}

        {state.kind === 'no-contract' && (
          <View style={styles.card}>
            <View style={styles.iconCircle}>
              <Clock size={22} color={COLORS.warning} />
            </View>
            <Text style={styles.cardTitle}>{t('Contract pending')}</Text>
            <Text style={styles.cardBody}>
              {t("The NEXPEC admin team is still finalising the binding contract for this job. You'll be notified, and this screen will open automatically, once it's ready to sign.")}
            </Text>
            <View style={styles.helpRow}>
              <ShieldCheck size={14} color={COLORS.accent} />
              <Text style={styles.helpText}>
                {t('Contracts in NEXPEC are generated server-side and signed with cryptographic chain-of-custody. No drafts on your end.')}
              </Text>
            </View>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && { opacity: 0.88 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('Back to job')}
            >
              <Text style={styles.primaryBtnText}>{t('Back to job')}</Text>
            </Pressable>
          </View>
        )}

        {state.kind === 'job-not-found' && (
          <View style={styles.card}>
            <View style={styles.iconCircle}>
              <AlertCircle size={22} color={COLORS.danger} />
            </View>
            <Text style={styles.cardTitle}>{t('Job not found')}</Text>
            <Text style={styles.cardBody}>
              {t("The job referenced in this link doesn't exist or you don't have access to it.")}
            </Text>
            <Pressable
              onPress={() => router.replace('/(tabs)/jobs' as any)}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && { opacity: 0.88 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('Go to my jobs')}
            >
              <Text style={styles.primaryBtnText}>{t('Go to my jobs')}</Text>
            </Pressable>
          </View>
        )}

        {state.kind === 'error' && (
          <View style={styles.card}>
            <View style={styles.iconCircle}>
              <AlertCircle size={22} color={COLORS.danger} />
            </View>
            <Text style={styles.cardTitle}>{t("Couldn't open the contract")}</Text>
            <Text style={styles.cardBody}>{state.message}</Text>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && { opacity: 0.88 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('Go back')}
            >
              <Text style={styles.primaryBtnText}>{t('Back')}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  headerBack: { paddingHorizontal: 6, paddingVertical: 6 },
  content: { padding: 20, paddingTop: 32, gap: 14 },
  center: { alignItems: 'center', paddingVertical: 60, gap: 14 },
  resolvingText: { color: COLORS.textMuted, fontSize: 14 },
  card: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: 22,
    gap: 14,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(124, 58, 237, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  cardBody: {
    color: COLORS.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  helpRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(124, 58, 237, 0.08)',
    borderColor: 'rgba(124, 58, 237, 0.25)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
  },
  helpText: {
    color: COLORS.textPrimary,
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
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
});
