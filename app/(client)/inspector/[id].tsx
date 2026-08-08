// ════════════════════════════════════════════════════════════════════════════
//  app/(client)/inspector/[id].tsx — Mobile NEXPEC Trust Card (anonymized)
//
//  Mobile parity with the web public trust card (apps/web/src/app/p/[userId]).
//
//  TWO MODES, ONE SCREEN.
//
//  • BROWSE (no `jobId`) — anti-poaching by construction. Reads ONLY the
//    PII-free `inspectors_directory` projection (no name, photo, bio, headline,
//    city, email or phone ever enters that query), so there is nothing on
//    screen, in the network response, or in memory to disintermediate with.
//    The inspector is a stable pseudonymous handle (NX-XXXXXX) + Trust Sigil.
//
//  • JOB-SCOPED (`?jobId=`) — additionally reads job_applicant_identity_view,
//    where the DATABASE resolves that job's identity_mode and NULLs every
//    field the mode forbids (20260801322000 / 324000). Protected therefore
//    still renders exactly the browse card. Professional adds name, headline,
//    résumé and certifications. Full additionally releases email and phone,
//    rendered ONLY in the Full-mode Contact details block below — never in
//    Protected or Professional, where the server returns them as null.
//
//  ONE DOOR. Engagement is always the admin-brokered, held flow (Golden
//  Rules). Identity is released by policy, never by the client asking nicely.
// ════════════════════════════════════════════════════════════════════════════
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, StatusBar, Linking,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { nxHandle, nxHash } from '../../../src/core/utils/handle';
import { refreshAsSignedUrl, SIGNED_URL_TTL } from '@/src/core/storage/signedUrls';
import {
  fetchApplicantDisclosure,
  isProfessionallyDisclosed,
  type ApplicantDisclosure,
} from '@/lib/identityDisclosure';

// PII-free columns — mirrors the web fetchInspectorTrustCard projection over the
// `inspectors_directory` view. NEVER add name / avatar / bio / city / contact.
const CARD_COLS =
  'id, location_province, specialty_slugs, ndt_methods, certifications, ' +
  'verification_status, rating_average, rating_count, recommend_percent, ' +
  'completed_jobs_count, total_jobs, created_at';

const C = {
  bg: '#020420',
  card: 'rgba(255,255,255,0.03)',
  card2: 'rgba(255,255,255,0.02)',
  border: 'rgba(255,255,255,0.08)',
  text: '#F8FAFC',
  dim: '#94A3B8',
  mute: '#64748B',
  violet: '#7C3AED',
  violetGlow: '#A855F7',
  cyan: '#22D3EE',
  amber: '#F59E0B',
  green: '#22C55E',
};

interface TrustCard {
  id: string;
  location_province: string | null;
  specialty_slugs: string[] | null;
  ndt_methods: string[] | null;
  certifications: string[] | null;
  verification_status: string | null;
  rating_average: number | null;
  rating_count: number | null;
  recommend_percent: number | null;
  completed_jobs_count: number | null;
  total_jobs: number | null;
  created_at: string | null;
}

const prettySlug = (s: string) =>
  s.split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const dedupe = (items: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const k = it.toLowerCase();
    if (it && !seen.has(k)) { seen.add(k); out.push(it); }
  }
  return out;
};

const yearOf = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : String(d.getFullYear());
};

// Deterministic Trust Sigil gradient from the opaque id (no PII, stable).
const sigilColors = (id: string): [string, string] => {
  const h = nxHash('nexpec-sigil:' + id);
  return [`hsl(${h % 360},68%,46%)`, `hsl(${(h + 48) % 360},64%,30%)`];
};

export default function InspectorTrustCardScreen() {
  const router = useRouter();
  // ★ jobId makes this screen JOB-SCOPED. Without it the screen is a pure
  //   pre-engagement browse card and stays anonymous — which is correct.
  //   With it, the per-job identity_mode governs what may be shown, and the
  //   DB (job_applicant_identity_view) decides, not this component.
  const { id, jobId } = useLocalSearchParams<{ id: string; jobId?: string }>();
  const [card, setCard] = useState<TrustCard | null>(null);
  const [disclosure, setDisclosure] = useState<ApplicantDisclosure | null>(null);
  // Résumé/CV lives in a PRIVATE bucket. We never render the stored URL
  // directly and never make the bucket public: the link is minted on demand by
  // the existing `mint-doc-url` edge function, which authorizes server-side.
  const [resumeDocUrl, setResumeDocUrl] = useState<string | null>(null);
  const [resumeDocPending, setResumeDocPending] = useState(false);
  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  // ★ ONE loader, used by mount, focus and pull-to-refresh.
  //   DISCLOSURE DECREASES MUST NOT LEAVE RESIDUE. An admin can drop this job
  //   from Professional back to Protected at any time, so every load RESETS
  //   the disclosure and the minted résumé link to null BEFORE fetching, and
  //   writes back only what the server returns this time round. Merging into
  //   previous state would leave a revoked name/résumé rendered on screen.
  const load = useCallback(async (): Promise<void> => {
    if (!id) { setLoading(false); return; }
    try {
      // PII-free read only — never `.from('profiles')` on a buyer surface.
      const { data } = await supabase
        .from('inspectors_directory')
        .select(CARD_COLS)
        .eq('id', id)
        .maybeSingle();
      setCard((data as unknown as TrustCard) ?? null);

      // Clear first: a revoked policy must blank the screen, not persist.
      setDisclosure(null);
      setResumeDocUrl(null);

      if (jobId) {
        const d = await fetchApplicantDisclosure(String(jobId), String(id));
        setDisclosure(d);

        const stored = d?.resumeUrl?.trim() || d?.cvUrl?.trim() || null;
        if (stored) {
          setResumeDocPending(true);
          try {
            setResumeDocUrl(await refreshAsSignedUrl(stored, SIGNED_URL_TTL.RESUME));
          } finally {
            setResumeDocPending(false);
          }
        }
      }
    } catch {
      setCard(null);
      setDisclosure(null);
      setResumeDocUrl(null);
    } finally {
      setLoading(false);
    }
  }, [id, jobId]);

  useEffect(() => { void load(); }, [load]);

  // Reflect an admin policy change when the client returns to this screen.
  // No realtime subscription this release — focus + manual pull only.
  useFocusEffect(
    useCallback(() => { void load(); }, [load]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  const handle = nxHandle(id);
  // Disclosed ONLY when the server released a real name for THIS job.
  const disclosed = isProfessionallyDisclosed(disclosure) && !!disclosure?.displayName?.trim();
  const [g1, g2] = useMemo(() => sigilColors(id ?? ''), [id]);
  // "On file" = the SERVER released a résumé pointer for this job. Distinguishes
  // "inspector has no résumé" from "résumé exists but the link could not be minted".
  const hasResumeDoc = !!(disclosure?.resumeUrl?.trim() || disclosure?.cvUrl?.trim());
  // The name used in prose. Never hard-code the pseudonym: a Professional/Full
  // profile that says "inspector2" at the top must not say "NX-…" at the bottom.
  const engageName = disclosed ? (disclosure?.displayName?.trim() || handle) : handle;
  // ★ FULL-ONLY CONTACT. The DB already gates these to eff_mode='full'
  //   (job_applicant_identity_view), so a non-null value here IS the server's
  //   authorization decision — this component adds no policy of its own and
  //   cannot widen disclosure. In Professional they arrive null and the block
  //   below renders nothing.
  const fullDisclosed = disclosure?.identityMode === 'full';
  const contactEmail = fullDisclosed ? (disclosure?.email?.trim() || null) : null;
  const contactPhone = fullDisclosed ? (disclosure?.phone?.trim() || null) : null;

  const competencies = useMemo(() => {
    if (!card) return [];
    return dedupe([
      ...(card.specialty_slugs ?? []).map(prettySlug),
      ...(card.ndt_methods ?? []).map((m) => m.toUpperCase()),
      ...(card.certifications ?? []).map((c) => c.trim()).filter(Boolean),
    ]);
  }, [card]);

  const ratingCount = card?.rating_count ?? 0;
  const ratingAvg = card?.rating_average ?? 0;
  const completed = card?.completed_jobs_count ?? 0;
  const total = card?.total_jobs ?? 0;
  const completion = total > 0 ? Math.round((completed / total) * 100) : null;
  const isVerified = (card?.verification_status ?? '') === 'verified';
  const region = card?.location_province?.trim() || null;

  const goBack = () =>
    router.canGoBack() ? router.back() : router.push('/(client)/explore' as any);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.header}>
        <TouchableOpacity onPress={goBack} hitSlop={8} style={s.back} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Inspector</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={C.violet} /></View>
      ) : !card ? (
        <View style={s.center}>
          <Ionicons name="shield-outline" size={42} color={C.mute} />
          <Text style={s.unavailTitle}>Inspector unavailable</Text>
          <Text style={s.unavailBody}>
            This NEXPEC inspector profile isn’t publicly available. Verified, active
            inspectors appear here as anonymized trust cards.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.violet} />
          }
        >
          {/* Header card: sigil + pseudonymous handle + verification */}
          <View style={s.block}>
            <View style={s.headRow}>
              <LinearGradient colors={[g1, g2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.sigil}>
                <Text style={s.sigilGlyph}>{handle.slice(3, 5)}</Text>
              </LinearGradient>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.title}>
                  {disclosed ? disclosure?.displayName : 'NEXPEC-Verified Inspector'}
                </Text>
                <Text style={s.handle}>{disclosed ? (disclosure?.headline ?? handle) : handle}</Text>
                <Text style={s.sub}>Inspector{region ? `, Region: ${region}` : ''}</Text>
                {isVerified && (
                  <View style={s.badge}>
                    <Ionicons name="shield-checkmark" size={12} color={C.cyan} />
                    <Text style={s.badgeTxt}>Identity-verified</Text>
                  </View>
                )}
              </View>
            </View>
            {disclosed ? (
              <View style={s.lockNote}>
                <Ionicons name="id-card" size={14} color={C.cyan} style={{ marginTop: 1 }} />
                <Text style={s.lockTxt}>
                  {disclosure?.identityMode === 'full'
                    ? 'Full disclosure is authorized for this project. Contact details are released to you for this project only.'
                    : 'Professional disclosure is authorized for this project: name, résumé and certifications. Private contact details remain protected.'}
                </Text>
              </View>
            ) : (
              <View style={s.lockNote}>
                <Ionicons name="lock-closed" size={14} color={C.cyan} style={{ marginTop: 1 }} />
                <Text style={s.lockTxt}>
                  Identity is protected by NEXPEC. You’re seeing platform-verified capability
                  and performance — no résumé, no bias. Engagement happens securely through
                  NEXPEC with payment hold and dispute protection.
                </Text>
              </View>
            )}
          </View>

          {/* Performance metrics */}
          <View style={s.metrics}>
            <Metric label="Rating" value={ratingCount > 0 ? ratingAvg.toFixed(2) : '—'} sub={ratingCount > 0 ? `${ratingCount} review${ratingCount === 1 ? '' : 's'}` : 'No reviews'} tone={C.amber} />
            <Metric label="Recommend" value={ratingCount > 0 ? `${card.recommend_percent ?? 0}%` : '—'} sub="of clients" tone={C.green} />
            <Metric label="Completion" value={completion != null ? `${completion}%` : '—'} sub="jobs closed" tone={C.cyan} />
            <Metric label="Jobs done" value={String(completed)} sub="via NEXPEC" tone={C.violetGlow} />
            <Metric label="On NEXPEC" value={yearOf(card.created_at)} sub="since" tone={C.cyan} />
          </View>

          {/* ★ Professional dossier — Professional + Full ONLY.
              These fields were already fetched into ApplicantDisclosure but had
              no JSX, so the lock note promised "name, résumé and certifications"
              while the screen rendered only the name. Contact is NOT here:
              email/phone belong to Full mode and live in their own block. */}
          {disclosed && (
            <View style={s.block}>
              <View style={s.secHead}>
                <Ionicons name="document-text-outline" size={18} color={C.violetGlow} />
                <Text style={s.secTitle}>Professional dossier</Text>
              </View>
              <Text style={s.secSub}>
                Released for this project only, under the project&apos;s identity policy.
              </Text>

              {/* Résumé summary */}
              {disclosure?.resumeSummary?.trim() ? (
                <Text style={s.dossierBody}>{disclosure.resumeSummary.trim()}</Text>
              ) : (
                <Text style={s.muted}>No résumé summary provided.</Text>
              )}

              {/* Résumé / CV document — private bucket, signed on demand */}
              {resumeDocUrl ? (
                <TouchableOpacity
                  style={s.docBtn}
                  activeOpacity={0.85}
                  onPress={() => Linking.openURL(resumeDocUrl)}
                >
                  <Ionicons name="document-attach-outline" size={16} color={C.cyan} />
                  <Text style={s.docBtnTxt}>Open résumé / CV</Text>
                  <Ionicons name="open-outline" size={14} color={C.cyan} />
                </TouchableOpacity>
              ) : hasResumeDoc ? (
                <Text style={s.muted}>
                  {resumeDocPending
                    ? 'Preparing résumé link…'
                    : 'Résumé is on file but could not be opened for your account.'}
                </Text>
              ) : (
                <Text style={s.muted}>No résumé document on file.</Text>
              )}

              {/* Certifications released by the disclosure policy */}
              <View style={s.dossierSub}>
                <Text style={s.dossierLabel}>Certifications</Text>
                {disclosure?.certifications && disclosure.certifications.length > 0 ? (
                  <View style={s.chips}>
                    {disclosure.certifications.map((c) => (
                      <View key={`cert-${c}`} style={s.chip}>
                        <Ionicons name="ribbon-outline" size={12} color={C.violetGlow} />
                        <Text style={s.chipTxt}>{c}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={s.muted}>No certifications on file.</Text>
                )}
              </View>

              {/* Qualifications / disciplines released by the policy */}
              <View style={s.dossierSub}>
                <Text style={s.dossierLabel}>Qualifications</Text>
                {disclosure?.qualifications && disclosure.qualifications.length > 0 ? (
                  <View style={s.chips}>
                    {disclosure.qualifications.map((q) => (
                      <View key={`qual-${q}`} style={s.chip}>
                        <Ionicons name="school-outline" size={12} color={C.violetGlow} />
                        <Text style={s.chipTxt}>{prettySlug(q)}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={s.muted}>No qualifications on file.</Text>
                )}
              </View>
            </View>
          )}

          {/* ★ Contact details — FULL MODE ONLY.
              Professional must never reach this block: contactEmail/contactPhone
              are null unless the server released them. Rows render only for
              values that actually exist — no placeholder rows, no fake data. */}
          {fullDisclosed && (
            <View style={s.block}>
              <View style={s.secHead}>
                <Ionicons name="call-outline" size={18} color={C.cyan} />
                <Text style={s.secTitle}>Contact details</Text>
              </View>
              <Text style={s.secSub}>
                Released for this project only, under Full disclosure.
              </Text>

              {contactEmail || contactPhone ? (
                <>
                  {contactEmail ? (
                    <TouchableOpacity
                      style={s.contactRow}
                      activeOpacity={0.8}
                      onPress={() => Linking.openURL(`mailto:${contactEmail}`)}
                    >
                      <Ionicons name="mail-outline" size={16} color={C.dim} />
                      <Text style={s.contactLabel}>Email</Text>
                      <Text style={s.contactValue} numberOfLines={1}>{contactEmail}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {contactPhone ? (
                    <TouchableOpacity
                      style={s.contactRow}
                      activeOpacity={0.8}
                      onPress={() => Linking.openURL(`tel:${contactPhone}`)}
                    >
                      <Ionicons name="call-outline" size={16} color={C.dim} />
                      <Text style={s.contactLabel}>Phone</Text>
                      <Text style={s.contactValue} numberOfLines={1}>{contactPhone}</Text>
                    </TouchableOpacity>
                  ) : null}
                </>
              ) : (
                <Text style={s.muted}>No contact details on file.</Text>
              )}
            </View>
          )}

          {/* Verified competencies (platform-vouched, not a CV) */}
          <View style={s.block}>
            <View style={s.secHead}>
              <Ionicons name="ribbon-outline" size={18} color={C.cyan} />
              <Text style={s.secTitle}>NEXPEC-Verified Competencies</Text>
            </View>
            <Text style={s.secSub}>Each capability is verified by NEXPEC, not a self-reported CV.</Text>
            {competencies.length === 0 ? (
              <Text style={s.muted}>Competencies are being verified.</Text>
            ) : (
              <View style={s.chips}>
                {competencies.map((c) => (
                  <View key={c} style={s.chip}>
                    <Ionicons name="shield-checkmark" size={12} color={C.cyan} />
                    <Text style={s.chipTxt}>{c}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* ★ Engage block — context-aware.
              Two bugs lived here. (1) The body always interpolated {handle},
              so a Professional profile showed the real name at the top and the
              NX- pseudonym at the bottom. Use whatever identity the server
              actually released, falling back to the pseudonym. (2) When this
              screen is opened FROM an existing proposal (jobId present) the
              client has already made the request — telling them to "Start a
              request" sends them to post a SECOND job. In job context, return
              them to the proposal instead. Browse context is unchanged. */}
          <LinearGradient colors={['rgba(124,58,237,0.16)', 'rgba(34,211,238,0.06)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.block, s.engage]}>
            {jobId ? (
              <>
                <Text style={s.engageTitle}>This inspector applied to your project</Text>
                <Text style={s.engageBody}>
                  {engageName} is one of the inspectors proposing on this project. Review
                  the proposal to accept or decline — payment hold, signed deliverables and
                  dispute protection are built in.
                </Text>
                <TouchableOpacity style={s.cta} activeOpacity={0.85} onPress={goBack}>
                  <Text style={s.ctaTxt}>Back to the proposal</Text>
                  <Ionicons name="arrow-back" size={16} color="#FFFFFF" />
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={s.engageTitle}>Request this inspector through NEXPEC</Text>
                <Text style={s.engageBody}>
                  Post your scope and NEXPEC assigns {engageName} (or a peer of equal
                  verification) with payment hold, signed deliverables, and dispute
                  protection built in.
                </Text>
                <TouchableOpacity style={s.cta} activeOpacity={0.85} onPress={() => router.push('/post-new-job' as any)}>
                  <Text style={s.ctaTxt}>Start a request</Text>
                  <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
                </TouchableOpacity>
              </>
            )}
          </LinearGradient>

          {/* Client reviews — aggregate only; reviewer identity is never fetched here */}
          <View style={s.block}>
            <View style={s.secHead}>
              <Ionicons name="star-outline" size={18} color={C.amber} />
              <Text style={s.secTitle}>Client reviews</Text>
            </View>
            <Text style={s.secSub}>
              {ratingCount === 0
                ? 'No reviews yet. Verified clients can review after a job completes.'
                : `${ratingAvg.toFixed(2)} average across ${ratingCount} review${ratingCount === 1 ? '' : 's'}.`}
            </Text>
          </View>

          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <View style={s.metric}>
      <Text style={s.metricLabel}>{label}</Text>
      <Text style={[s.metricValue, { color: tone }]}>{value}</Text>
      <Text style={s.metricSub}>{sub}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  back: { padding: 4, marginLeft: -4 },
  headerTitle: { flex: 1, textAlign: 'center', color: C.text, fontSize: 17, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  unavailTitle: { color: C.text, fontSize: 18, fontWeight: '700', marginTop: 6 },
  unavailBody: { color: C.dim, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  scroll: { padding: 16, gap: 14 },
  block: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 18, padding: 16 },
  dossierBody: { color: C.text, fontSize: 13.5, lineHeight: 20, marginTop: 10 },
  dossierSub: { marginTop: 14 },
  dossierLabel: { color: C.dim, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8 },
  docBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(34,211,238,0.35)', backgroundColor: 'rgba(34,211,238,0.08)' },
  docBtnTxt: { flex: 1, color: C.cyan, fontSize: 13, fontWeight: '700' },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.card2 },
  contactLabel: { color: C.dim, fontSize: 12, fontWeight: '700', width: 52 },
  contactValue: { flex: 1, color: C.text, fontSize: 13.5, fontWeight: '600' },
  headRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  sigil: { width: 72, height: 72, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  sigilGlyph: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', letterSpacing: 1 },
  title: { color: C.text, fontSize: 17, fontWeight: '700' },
  handle: { color: C.violetGlow, fontSize: 14, fontWeight: '600', marginTop: 2, fontVariant: ['tabular-nums'] },
  sub: { color: C.mute, fontSize: 11, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 8, backgroundColor: 'rgba(34,211,238,0.10)', borderColor: 'rgba(34,211,238,0.30)', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt: { color: C.cyan, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  lockNote: { flexDirection: 'row', gap: 8, marginTop: 14, backgroundColor: C.card2, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12 },
  lockTxt: { flex: 1, color: C.dim, fontSize: 12, lineHeight: 18 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: { flexGrow: 1, flexBasis: '30%', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12 },
  metricLabel: { color: C.mute, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  metricValue: { fontSize: 20, fontWeight: '800', marginTop: 4, fontVariant: ['tabular-nums'] },
  metricSub: { color: C.mute, fontSize: 10, marginTop: 1 },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  secTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  secSub: { color: C.mute, fontSize: 12, marginTop: 4, lineHeight: 17 },
  muted: { color: C.mute, fontSize: 13, marginTop: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(124,58,237,0.08)', borderColor: 'rgba(124,58,237,0.25)', borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  chipTxt: { color: '#E2E8F0', fontSize: 12, fontWeight: '500' },
  engage: { borderColor: 'rgba(124,58,237,0.25)' },
  engageTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  engageBody: { color: C.dim, fontSize: 13, lineHeight: 19, marginTop: 6 },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.violet, borderRadius: 999, paddingVertical: 13, marginTop: 14 },
  ctaTxt: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
