// ════════════════════════════════════════════════════════════════════════════
//  app/(inspector)/talent.tsx — Talent candidate workflow on MOBILE
//
//  Field inspectors live on the phone. Consent and identity disclosure are the
//  two acts only the candidate can perform, so requiring a laptop to perform
//  them would make the brokered-identity contract theoretically sound and
//  practically unusable.
//
//  ── WHAT THIS SCREEN CAN AND CANNOT DO ─────────────────────────────────────
//  Disclosure is deliberately ONLINE-ONLY. It is not queued through the
//  offline outbox, and that is a decision rather than an omission: a queued
//  "share my details" that drains hours later would disclose identity at a
//  moment the candidate did not choose and could not see. Consent must be
//  contemporaneous with its effect. Offline, the controls are disabled and the
//  screen says why — the alternative is a button that silently commits a
//  privacy act later.
//
//  Read state IS cached-tolerant: a candidate can review what they have shared
//  without signal. Only the MUTATIONS require connectivity.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';

import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import { isOnline } from '@/src/core/offline/network';

const C = {
  bg: '#020420',
  card: '#0B1138',
  border: 'rgba(255,255,255,0.06)',
  text: '#FFFFFF',
  sec: '#A8B2C7',
  mute: '#6B7390',
  violet: '#7C3AED',
  green: '#10B981',
  amber: '#F59E0B',
  red: '#EF4444',
};

interface SubmissionRow {
  id: string;
  status: string;
  match_score: number | null;
  opportunity_id: string;
  title: string | null;
  disclosed: boolean;
}

type Phase = 'loading' | 'ready' | 'error';

export default function TalentCandidateScreen() {
  const { user } = useAuth();
  // isOnline() is a synchronous read of the shared network flag (network.ts).
  // Re-checked on every load/refresh rather than subscribed, which is enough
  // here: the controls are re-evaluated whenever the screen refreshes, and a
  // stale "online" simply surfaces the server's own error instead of silently
  // queueing a privacy act.
  const [online, setOnline] = useState(isOnline());

  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openToWork, setOpenToWork] = useState(false);
  const [consents, setConsents] = useState<Set<string>>(new Set());
  const [subs, setSubs] = useState<SubmissionRow[]>([]);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setOnline(isOnline());
    setError(null);
    try {
      const [prof, cons, sub] = await Promise.all([
        supabase
          .from('talent_candidate_profiles')
          .select('is_open_to_work')
          .eq('profile_id', user.id)
          .maybeSingle(),
        supabase
          .from('talent_consents')
          .select('scope, revoked_at')
          .eq('profile_id', user.id)
          .is('revoked_at', null),
        supabase
          .from('talent_submissions')
          .select('id, status, match_score, opportunity_id')
          .eq('profile_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      if (prof.error || cons.error || sub.error) {
        throw prof.error ?? cons.error ?? sub.error;
      }

      setOpenToWork(Boolean((prof.data as { is_open_to_work?: boolean } | null)?.is_open_to_work));
      setConsents(
        new Set(((cons.data ?? []) as Array<{ scope: string }>).map((c) => c.scope)),
      );

      const rows = (sub.data ?? []) as Array<{
        id: string;
        status: string;
        match_score: number | null;
        opportunity_id: string;
      }>;

      const [titles, disc] = await Promise.all([
        rows.length
          ? supabase
              .from('talent_opportunities')
              .select('id, title')
              .in('id', [...new Set(rows.map((r) => r.opportunity_id))])
          : Promise.resolve({ data: [], error: null }),
        rows.length
          ? supabase
              .from('talent_disclosures')
              .select('submission_id, revoked_at')
              .in('submission_id', rows.map((r) => r.id))
          : Promise.resolve({ data: [], error: null }),
      ]);

      const titleById = new Map(
        ((titles.data ?? []) as Array<{ id: string; title: string }>).map((o) => [
          o.id,
          o.title,
        ]),
      );
      const live = new Set(
        ((disc.data ?? []) as Array<{ submission_id: string; revoked_at: string | null }>)
          .filter((d) => d.revoked_at === null)
          .map((d) => d.submission_id),
      );

      setSubs(
        rows.map((r) => ({
          ...r,
          title: titleById.get(r.opportunity_id) ?? null,
          disclosed: live.has(r.id),
        })),
      );
      setPhase('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your Talent profile.');
      setPhase('error');
    }
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(fn: () => Promise<{ error: unknown }>, key: string) {
    if (!online) return;
    setBusy(key);
    setError(null);
    try {
      const { error: e } = await fn();
      if (e) throw e;
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  const toggleConsent = (scope: 'discoverable' | 'submission') => {
    const on = consents.has(scope);
    // Consent is the one write on this screen that must NOT be queued.
    //
    // A withdrawal sitting in the outbox is the dangerous case: the candidate
    // sees "consent withdrawn", the row still has revoked_at IS NULL, and their
    // identity remains disclosable to employers until the device next syncs.
    // The grant direction is no better — a queued grant can replay and disclose
    // an identity after the candidate has changed their mind, with no fresh
    // confirmation. Consent must reflect server truth at the moment it is given
    // or taken away, so both directions write directly and FAIL LOUDLY offline;
    // mutate()'s catch surfaces the error and the toggle stays where it was.
    //
    // Nothing here is financial, so the no-offline-financial-mutation rule is
    // not what is doing the work — this is consent integrity.
    return mutate(
      () =>
        on
          ? (supabase
              .from('talent_consents')
              // outbox-exempt: a queued withdrawal would leave identity disclosable while the UI claims it is revoked — must fail loudly
              .update({ revoked_at: new Date().toISOString() })
              .eq('profile_id', user!.id)
              .eq('scope', scope)
              .is('revoked_at', null) as unknown as Promise<{ error: unknown }>)
          : (supabase
              .from('talent_consents')
              // outbox-exempt: a queued grant could replay and disclose an identity after the candidate changed their mind — must fail loudly
              .insert({ profile_id: user!.id, scope }) as unknown as Promise<{
              error: unknown;
            }>),
      scope,
    );
  };

  if (phase === 'loading') {
    return (
      <View style={s.center} accessibilityRole="progressbar" accessibilityLabel="Loading">
        <ActivityIndicator color={C.violet} />
        <Text style={s.mute}>Loading your Talent profile…</Text>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={s.center}>
        <Text style={s.h2} accessibilityRole="alert">Could not load</Text>
        <Text style={s.mute}>{error}</Text>
        <TouchableOpacity style={s.ghost} onPress={() => void load()} accessibilityRole="button">
          <Text style={s.ghostText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} tintColor={C.violet} />}
    >
      <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
        <Text style={s.back}>‹ Back</Text>
      </TouchableOpacity>

      <Text style={s.h1} accessibilityRole="header">Permanent roles</Text>
      <Text style={s.body}>
        NEXPEC can put you forward for permanent positions. Employers see your
        experience — never your name or contact details — until you choose to
        share them, for one role at a time.
      </Text>

      {!online && (
        <View style={s.notice} accessibilityRole="alert">
          <Text style={s.noticeText}>
            You are offline. You can review what you have shared, but consent and
            sharing changes need a connection — a queued privacy decision could
            take effect at a moment you did not choose.
          </Text>
        </View>
      )}

      {error && (
        <View style={[s.notice, { borderColor: C.red + '55' }]} accessibilityRole="alert">
          <Text style={[s.noticeText, { color: C.red }]}>{error}</Text>
        </View>
      )}

      <Text style={s.h2}>Your consent</Text>
      <Text style={s.mute}>
        {openToWork
          ? 'You are marked open to permanent work.'
          : 'You are not currently marked open to permanent work — set that on the web to appear in matching.'}
      </Text>
      {(
        [
          ['discoverable', 'Be discoverable for matching'],
          ['submission', 'Allow NEXPEC to submit me'],
        ] as const
      ).map(([scope, label]) => (
        <View key={scope} style={s.row}>
          <Text style={s.rowLabel}>{label}</Text>
          <Switch
            value={consents.has(scope)}
            disabled={!online || busy === scope}
            onValueChange={() => void toggleConsent(scope)}
            trackColor={{ true: C.green, false: '#333' }}
            accessibilityLabel={label}
          />
        </View>
      ))}

      <Text style={s.h2}>Roles you have been put forward for</Text>
      {subs.length === 0 ? (
        <Text style={s.mute}>
          None yet. Granting both consents above lets NEXPEC match you.
        </Text>
      ) : (
        subs.map((sub) => (
          <View key={sub.id} style={s.card}>
            <Text style={s.cardTitle}>{sub.title ?? 'Opportunity'}</Text>
            <Text style={s.mute}>
              {sub.status.replace(/_/g, ' ')}
              {sub.match_score != null ? ` · match ${sub.match_score}` : ''}
            </Text>
            <Text style={[s.mute, { color: sub.disclosed ? C.amber : C.green, marginTop: 6 }]}>
              {sub.disclosed
                ? 'This employer can see your name and email'
                : 'You are anonymous to this employer'}
            </Text>
            <TouchableOpacity
              style={[s.btn, (!online || busy === sub.id) && { opacity: 0.4 }]}
              disabled={!online || busy === sub.id}
              onPress={() =>
                void mutate(
                  () =>
                    supabase.rpc(
                      sub.disclosed
                        ? 'nx_talent_revoke_disclosure'
                        : 'nx_talent_disclose_identity',
                      { p_submission_id: sub.id },
                    ) as unknown as Promise<{ error: unknown }>,
                  sub.id,
                )
              }
              accessibilityRole="button"
              accessibilityLabel={
                sub.disclosed ? 'Hide my details again' : 'Share my details'
              }
            >
              <Text style={s.btnText}>
                {busy === sub.id
                  ? 'Working…'
                  : sub.disclosed
                    ? 'Hide my details again'
                    : 'Share my details'}
              </Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 20, paddingBottom: 60, gap: 8 },
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  back: { color: C.sec, fontSize: 14 },
  h1: { color: C.text, fontSize: 24, fontWeight: '700', marginTop: 4 },
  h2: { color: C.text, fontSize: 16, fontWeight: '700', marginTop: 20 },
  body: { color: C.sec, fontSize: 14, lineHeight: 20 },
  mute: { color: C.mute, fontSize: 12 },
  notice: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 12 },
  noticeText: { color: C.sec, fontSize: 13, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 8 },
  rowLabel: { color: C.text, fontSize: 14, flex: 1, paddingRight: 12 },
  card: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 8 },
  cardTitle: { color: C.text, fontSize: 15, fontWeight: '600' },
  btn: { backgroundColor: C.violet, borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  ghost: { borderColor: C.border, borderWidth: 1, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 22, marginTop: 8 },
  ghostText: { color: C.text, fontSize: 14, fontWeight: '600' },
});
