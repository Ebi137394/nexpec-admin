// ════════════════════════════════════════════════════════════════════════════
//  app/inspector-directory.tsx — Inspector Directory (buyer-facing)
//
//  Lets clients / agencies / enterprise users discover verified inspectors
//  and invite them to a specific job. Mounted at /inspector-directory and
//  reachable from the Client + Agency dashboards.
//
//  Two stages:
//    1. BROWSE — search/filter list of verified inspectors. Tap a card to
//       open the "Invite to job" sheet.
//    2. INVITE — sheet shows the buyer's open jobs (filtered by client_id
//       OR agency_id matching the caller). Pick a job, optionally add a
//       message, send. Calls invite_inspector_to_job RPC.
//
//  RPC contract:
//    public.invite_inspector_to_job(p_job_id, p_inspector_id, p_message)
//    — SECURITY DEFINER, guards job ownership + 24h idempotency window.
//    — Notifies the inspector via nx_notify; inspector still consents
//      to apply through the normal applications flow.
//
//  GR2: the open-jobs fetcher uses BUYER_JOB_FIELDS (no payout columns).
//  The inspector profile fetcher pulls public-safe fields only.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Alert,
  Image,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import { BUYER_JOB_FIELDS } from '@/lib/jobsProjection';

// ─────────────────────────────────────────────────────────────────────────────
//  Theme — locked to #020420 / #7C3AED rest-of-app vocabulary
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg: '#020420',
  bgElev: '#070A24',
  card: '#0B1138',
  cardElev: '#0F1647',
  border: 'rgba(255,255,255,0.06)',
  borderStrong: 'rgba(124, 58, 237, 0.32)',

  text: '#FFFFFF',
  textSec: '#A8B2C7',
  textMuted: '#6B7390',
  textDim: '#475569',

  primary: '#7C3AED',
  primaryBright: '#9333EA',
  primaryGlow: 'rgba(124, 58, 237, 0.22)',
  primaryDim: 'rgba(124, 58, 237, 0.10)',

  cyan: '#00FFFF',
  cyanDim: 'rgba(0, 255, 255, 0.12)',
  cyanBorder: 'rgba(0, 255, 255, 0.30)',

  gold: '#F4C430',
  goldDim: 'rgba(244, 196, 48, 0.14)',

  ok: '#10F995',
  okDim: 'rgba(16, 249, 149, 0.12)',
  warn: '#F59E0B',
};

// ─────────────────────────────────────────────────────────────────────────────
//  Types — strict projection, public-safe only
// ─────────────────────────────────────────────────────────────────────────────

interface InspectorRow {
  id: string;
  full_name: string | null;
  company_name: string | null;
  avatar_url: string | null;
  headline: string | null;
  location_city: string | null;
  location_province: string | null;
  country_of_residence: string | null;
  years_of_experience: number | null;
  rating_average: number | null;
  rating_count: number | null;
  is_verified: boolean | null;
  specialty_slugs: string[] | null;
}

interface OpenJob {
  id: string;
  title: string | null;
  status: string;
  location: string | null;
  client_price_cents: number | null;
  created_at: string;
}

const PAGE_SIZE = 30;

// ─────────────────────────────────────────────────────────────────────────────
//  Atomic — small badge
// ─────────────────────────────────────────────────────────────────────────────
const VerifyBadge: React.FC = () => (
  <View style={s.verifyBadge}>
    <Ionicons name="shield-checkmark" size={9} color={C.cyan} />
    <Text style={s.verifyBadgeText}>VERIFIED</Text>
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────
//  Screen
// ─────────────────────────────────────────────────────────────────────────────
export default function InspectorDirectoryScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [items, setItems] = useState<InspectorRow[]>([]);
  const [query, setQuery] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  // Invite sheet state
  const [inviteTarget, setInviteTarget] = useState<InspectorRow | null>(null);
  const [openJobs, setOpenJobs] = useState<OpenJob[]>([]);
  const [openJobsLoading, setOpenJobsLoading] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  // ── Fetch inspectors ──────────────────────────────────────────────────
  const fetchInspectors = useCallback(
    async ({ append = false, refresh = false } = {}) => {
      if (append) setLoadingMore(true);
      else if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const currentOffset = append ? offset : 0;

        // Public-safe projection — no payout/rates/private info. Just the
        // reputation + identity surface a buyer needs to decide whether
        // to invite.
        let q = supabase
          .from('profiles')
          .select(
            [
              'id',
              'full_name',
              'company_name',
              'avatar_url',
              'headline',
              'location_city',
              'location_province',
              'country_of_residence',
              'years_of_experience',
              'rating_average',
              'rating_count',
              'is_verified',
              'specialty_slugs',
            ].join(', '),
          )
          .eq('role', 'inspector');

        if (verifiedOnly) q = q.eq('is_verified', true);

        // Text search across full_name + company_name + headline.
        const trimmed = query.trim();
        if (trimmed.length >= 2) {
          const ilike = `%${trimmed}%`;
          q = q.or(
            `full_name.ilike.${ilike},company_name.ilike.${ilike},headline.ilike.${ilike}`,
          );
        }

        q = q
          .order('rating_average', { ascending: false, nullsFirst: false })
          .order('rating_count', { ascending: false })
          .range(currentOffset, currentOffset + PAGE_SIZE - 1);

        const { data, error: qErr } = await q;
        if (qErr) throw qErr;
        const rows = (data ?? []) as unknown as InspectorRow[];
        setHasMore(rows.length === PAGE_SIZE);
        setOffset(currentOffset + rows.length);
        setItems((prev) => (append ? [...prev, ...rows] : rows));
      } catch (e: any) {
        console.warn('[inspector-directory] fetch failed:', e?.message);
        setError(e?.message ?? 'Failed to load inspectors.');
        if (!append) setItems([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [query, verifiedOnly, offset],
  );

  // Initial + debounced refetch on filter changes
  useEffect(() => {
    const t = setTimeout(() => {
      setOffset(0);
      void fetchInspectors({ append: false });
    }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, verifiedOnly]);

  // ── Invite flow ──────────────────────────────────────────────────────
  const openInviteSheet = useCallback(
    async (target: InspectorRow) => {
      setInviteTarget(target);
      setSelectedJobId(null);
      setMessage('');
      if (!user?.id) return;
      setOpenJobsLoading(true);
      try {
        const projection = `${BUYER_JOB_FIELDS}`;
        // Buyer's invite-eligible jobs: anything they own (client_id or
        // agency_id) that's still accepting (open or pending_approval).
        // RLS already restricts to their own jobs; the .or() is
        // defense-in-depth on the column filter.
        const { data, error: jErr } = await supabase
          .from('jobs')
          .select(projection)
          .or(`client_id.eq.${user.id},agency_id.eq.${user.id}`)
          .in('status', ['open', 'pending_approval'])
          .order('created_at', { ascending: false })
          .limit(30);
        if (jErr) throw jErr;
        setOpenJobs((data ?? []) as unknown as OpenJob[]);
      } catch (e: any) {
        console.warn('[inspector-directory] jobs fetch failed:', e?.message);
        setOpenJobs([]);
      } finally {
        setOpenJobsLoading(false);
      }
    },
    [user?.id],
  );

  const handleSendInvite = useCallback(async () => {
    if (!inviteTarget?.id || !selectedJobId || sending) return;
    setSending(true);
    try {
      const { error: rpcErr } = await supabase.rpc('invite_inspector_to_job', {
        p_job_id: selectedJobId,
        p_inspector_id: inviteTarget.id,
        p_message: message.trim() || null,
      });
      if (rpcErr) throw rpcErr;
      Alert.alert(
        'Invitation sent',
        `${formatName(inviteTarget)} has been notified. They\'ll be able to apply through their dashboard.`,
      );
      setInviteTarget(null);
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('already invited')) {
        Alert.alert('Already invited', 'This inspector was invited to this job in the last 24 hours.');
      } else if (msg.includes('only the job owner')) {
        Alert.alert('Not allowed', 'Only the owner of this job can invite inspectors.');
      } else if (msg.includes('not accepting invitations')) {
        Alert.alert('Job not open', 'Invitations can only be sent on jobs that are open or pending approval.');
      } else {
        Alert.alert('Could not send invitation', msg || 'Please try again in a moment.');
      }
    } finally {
      setSending(false);
    }
  }, [inviteTarget, selectedJobId, message, sending]);

  // ── Derived ──────────────────────────────────────────────────────────
  const headerStats = useMemo(
    () => ({
      total: items.length,
      verified: items.filter((i) => i.is_verified).length,
    }),
    [items],
  );

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View pointerEvents="none" style={s.glowTopLeft} />
      <View pointerEvents="none" style={s.glowBottomRight} />

      <SafeAreaView style={s.safeArea} edges={['top']}>
        {/* Header */}
        <View style={s.header}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              s.headerBtn,
              pressed && { transform: [{ scale: 0.92 }] },
            ]}
            hitSlop={10}
          >
            <Ionicons name="arrow-back" size={18} color={C.text} />
          </Pressable>
          <View style={s.headerCenter}>
            <Text style={s.headerKicker}>DISCOVER</Text>
            <Text style={s.headerTitle}>Inspector Directory</Text>
          </View>
          <View style={{ width: 38 }} />
        </View>

        {/* Stats strip */}
        <View style={s.statsStrip}>
          <Stat
            label="Showing"
            value={String(headerStats.total)}
            tint={C.primary}
          />
          <View style={s.statsDivider} />
          <Stat
            label="Verified"
            value={String(headerStats.verified)}
            tint={C.cyan}
          />
          <View style={s.statsDivider} />
          <Pressable
            onPress={() => setVerifiedOnly((v) => !v)}
            style={[
              s.filterChip,
              verifiedOnly
                ? { backgroundColor: C.cyanDim, borderColor: C.cyanBorder }
                : { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: C.border },
            ]}
          >
            <Ionicons
              name={verifiedOnly ? 'shield-checkmark' : 'shield-outline'}
              size={12}
              color={verifiedOnly ? C.cyan : C.textMuted}
            />
            <Text
              style={[
                s.filterChipText,
                { color: verifiedOnly ? C.cyan : C.textMuted },
              ]}
            >
              Verified only
            </Text>
          </Pressable>
        </View>

        {/* Search */}
        <View style={s.searchWrap}>
          <Ionicons name="search" size={16} color={C.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name, company, or headline…"
            placeholderTextColor={C.textDim}
            style={s.searchInput}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={C.textMuted} />
            </Pressable>
          )}
        </View>

        {/* Error */}
        {error ? (
          <View style={s.errorBanner}>
            <Ionicons name="alert-circle" size={14} color="#FCA5A5" />
            <Text style={s.errorBannerText}>{error}</Text>
          </View>
        ) : null}

        {/* List */}
        {loading && items.length === 0 ? (
          <View style={s.loadingCenter}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={s.loadingText}>LOADING DIRECTORY…</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            contentContainerStyle={s.listContent}
            renderItem={({ item, index }) => (
              <InspectorCard
                row={item}
                index={index}
                onInvite={() => openInviteSheet(item)}
                onProfile={() => router.push(`/p/${item.id}` as any)}
              />
            )}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => fetchInspectors({ refresh: true })}
                tintColor={C.primary}
                colors={[C.primary]}
              />
            }
            onEndReachedThreshold={0.4}
            onEndReached={() => {
              if (hasMore && !loadingMore) fetchInspectors({ append: true });
            }}
            ListEmptyComponent={() => (
              <View style={s.empty}>
                <View style={s.emptyIconWrap}>
                  <Ionicons name="people-outline" size={22} color={C.primary} />
                </View>
                <Text style={s.emptyTitle}>No inspectors matched</Text>
                <Text style={s.emptySub}>
                  {query.trim()
                    ? 'Try a different search term, or toggle Verified-only off to widen the pool.'
                    : 'No inspector profiles available right now.'}
                </Text>
              </View>
            )}
            ListFooterComponent={
              loadingMore ? (
                <View style={s.footerLoader}>
                  <ActivityIndicator size="small" color={C.primary} />
                </View>
              ) : null
            }
          />
        )}
      </SafeAreaView>

      {/* INVITE SHEET ────────────────────────────────────────────────── */}
      <Modal
        visible={!!inviteTarget}
        animationType="slide"
        transparent
        onRequestClose={() => setInviteTarget(null)}
      >
        <View style={s.sheetBackdrop}>
          <View style={s.sheet}>
            <View style={s.sheetHandle} />
            <View style={s.sheetHeader}>
              <View style={s.sheetIconWrap}>
                <Ionicons name="paper-plane" size={18} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.sheetKicker}>INVITE TO JOB</Text>
                <Text style={s.sheetTitle} numberOfLines={1}>
                  {formatName(inviteTarget)}
                </Text>
              </View>
              <Pressable
                onPress={() => setInviteTarget(null)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={22} color={C.textSec} />
              </Pressable>
            </View>

            <Text style={s.sheetExplainer}>
              Pick one of your open jobs. The inspector will get a notification
              with a deep link to the brief and can apply on their end.
            </Text>

            <Text style={s.sheetLabel}>SELECT A JOB</Text>
            {openJobsLoading ? (
              <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={C.primary} />
              </View>
            ) : openJobs.length === 0 ? (
              <View style={s.sheetEmpty}>
                <Ionicons name="briefcase-outline" size={18} color={C.textMuted} />
                <Text style={s.sheetEmptyText}>
                  No open jobs to invite to. Post a job first, then come back.
                </Text>
              </View>
            ) : (
              <ScrollView
                style={{ maxHeight: 220 }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
              >
                {openJobs.map((job) => {
                  const selected = selectedJobId === job.id;
                  return (
                    <Pressable
                      key={job.id}
                      onPress={() => setSelectedJobId(job.id)}
                      style={[
                        s.jobOption,
                        selected
                          ? {
                              borderColor: C.borderStrong,
                              backgroundColor: C.primaryDim,
                            }
                          : { borderColor: C.border },
                      ]}
                    >
                      <View
                        style={[
                          s.jobOptionRadio,
                          {
                            borderColor: selected ? C.primary : C.border,
                            backgroundColor: selected ? C.primary : 'transparent',
                          },
                        ]}
                      >
                        {selected ? (
                          <Ionicons name="checkmark" size={11} color="#FFFFFF" />
                        ) : null}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.jobOptionTitle} numberOfLines={1}>
                          {job.title ?? 'Untitled job'}
                        </Text>
                        <Text style={s.jobOptionSub} numberOfLines={1}>
                          {job.location ?? '—'}
                          {job.client_price_cents != null
                            ? `, ${formatUSD(job.client_price_cents)}`
                            : ''}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            <Text style={[s.sheetLabel, { marginTop: 16 }]}>
              MESSAGE (OPTIONAL)
            </Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="A short note for the inspector, why this job is a fit."
              placeholderTextColor={C.textDim}
              multiline
              maxLength={500}
              editable={!sending}
              style={s.sheetInput}
            />

            <Pressable
              onPress={handleSendInvite}
              disabled={!selectedJobId || sending}
              style={({ pressed }) => [
                s.sendBtn,
                (!selectedJobId || sending) && { opacity: 0.5 },
                pressed && { transform: [{ scale: 0.98 }] },
              ]}
            >
              <LinearGradient
                colors={[C.primary, C.primaryBright]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
              {sending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="paper-plane" size={14} color="#FFFFFF" />
              )}
              <Text style={s.sendBtnText}>
                {sending ? 'Sending invitation…' : 'Send invitation'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function InspectorCard({
  row,
  index,
  onInvite,
  onProfile,
}: {
  row: InspectorRow;
  index: number;
  onInvite: () => void;
  onProfile: () => void;
}) {
  const initials = formatInitials(row);
  const name = formatName(row);
  const loc = [row.location_city, row.location_province, row.country_of_residence]
    .filter(Boolean)
    .slice(0, 2)
    .join(', ');
  const rating = row.rating_average != null ? Number(row.rating_average) : 0;
  const ratingCount = row.rating_count ?? 0;

  return (
    <Animated.View
      entering={FadeInDown.delay(60 * Math.min(index, 6)).duration(380)}
    >
      <Pressable
        onPress={onProfile}
        style={({ pressed }) => [
          s.inspectorCard,
          pressed && { transform: [{ scale: 0.99 }] },
        ]}
      >
        {/* Top row — avatar + name + verified */}
        <View style={s.inspectorTopRow}>
          {row.avatar_url ? (
            <Image source={{ uri: row.avatar_url }} style={s.avatar} />
          ) : (
            <View style={[s.avatar, s.avatarFallback]}>
              <Text style={s.avatarText}>{initials}</Text>
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={s.nameRow}>
              <Text style={s.name} numberOfLines={1}>
                {name}
              </Text>
              {row.is_verified ? <VerifyBadge /> : null}
            </View>
            {row.headline ? (
              <Text style={s.headline} numberOfLines={1}>
                {row.headline}
              </Text>
            ) : null}
            {loc ? (
              <View style={s.locRow}>
                <Ionicons name="location" size={10} color={C.textMuted} />
                <Text style={s.locText} numberOfLines={1}>
                  {loc}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Stats strip */}
        <View style={s.inspectorStats}>
          <InspectorStat
            icon={<Ionicons name="star" size={12} color={C.gold} />}
            value={rating > 0 ? rating.toFixed(1) : '—'}
            label={ratingCount > 0 ? `${ratingCount} review${ratingCount === 1 ? '' : 's'}` : 'No reviews'}
          />
          <View style={s.inspectorStatDivider} />
          <InspectorStat
            icon={<Ionicons name="briefcase" size={12} color={C.primary} />}
            value={
              row.years_of_experience != null && row.years_of_experience > 0
                ? `${row.years_of_experience}y`
                : '—'
            }
            label="Experience"
          />
          <View style={s.inspectorStatDivider} />
          <InspectorStat
            icon={<Ionicons name="ribbon" size={12} color={C.cyan} />}
            value={String(row.specialty_slugs?.length ?? 0)}
            label="Specialties"
          />
        </View>

        {/* Invite CTA */}
        <View style={s.inspectorActionRow}>
          <Pressable
            onPress={onProfile}
            style={({ pressed }) => [
              s.secondaryBtn,
              pressed && { transform: [{ scale: 0.97 }] },
            ]}
          >
            <Ionicons name="person-circle-outline" size={14} color={C.textSec} />
            <Text style={s.secondaryBtnText}>View profile</Text>
          </Pressable>
          <Pressable
            onPress={onInvite}
            style={({ pressed }) => [
              s.inviteBtn,
              pressed && { transform: [{ scale: 0.97 }] },
            ]}
          >
            <LinearGradient
              colors={[C.primary, C.primaryBright]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            <Ionicons name="paper-plane" size={13} color="#FFFFFF" />
            <Text style={s.inviteBtnText}>Invite to Job</Text>
          </Pressable>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function InspectorStat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <View style={s.inspectorStat}>
      <View style={s.inspectorStatIcon}>{icon}</View>
      <View>
        <Text style={s.inspectorStatValue}>{value}</Text>
        <Text style={s.inspectorStatLabel}>{label}</Text>
      </View>
    </View>
  );
}

function Stat({
  label,
  value,
  tint,
}: {
  label: string;
  value: string;
  tint: string;
}) {
  return (
    <View style={s.stat}>
      <Text style={[s.statValue, { color: tint }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Formatters
// ─────────────────────────────────────────────────────────────────────────────

function formatName(row: InspectorRow | null): string {
  if (!row) return 'Inspector';
  return (
    (row.company_name && row.company_name.trim()) ||
    (row.full_name && row.full_name.trim()) ||
    'Inspector'
  );
}

function formatInitials(row: InspectorRow): string {
  const name = formatName(row);
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

function formatUSD(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  safeArea: { flex: 1 },

  glowTopLeft: {
    position: 'absolute',
    top: -160,
    left: -120,
    width: 360,
    height: 360,
    borderRadius: 200,
    backgroundColor: C.primary,
    opacity: 0.20,
  },
  glowBottomRight: {
    position: 'absolute',
    bottom: -180,
    right: -100,
    width: 320,
    height: 320,
    borderRadius: 200,
    backgroundColor: C.cyan,
    opacity: 0.05,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: C.bgElev,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerKicker: {
    color: C.cyan,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.6,
    marginBottom: 1,
  },
  headerTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },

  // Stats
  statsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    marginTop: 6,
    marginBottom: 10,
    gap: 12,
  },
  stat: { gap: 1, minWidth: 60 },
  statValue: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  statLabel: {
    color: C.textMuted,
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  statsDivider: { width: 1, height: 26, backgroundColor: C.border },
  filterChip: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 9,
    borderWidth: 1,
  },
  filterChipText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.3 },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: C.card,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    color: C.text,
    fontSize: 13,
    fontWeight: '500',
    padding: 0,
  },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 11,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.30)',
  },
  errorBannerText: { flex: 1, color: '#FCA5A5', fontSize: 11.5, fontWeight: '600' },

  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  loadingText: { color: C.textMuted, fontSize: 11, letterSpacing: 1.4, fontWeight: '700' },

  // List
  listContent: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },
  footerLoader: { paddingVertical: 20 },

  // Inspector card
  inspectorCard: {
    backgroundColor: C.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
  },
  inspectorTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarFallback: {
    backgroundColor: C.primaryGlow,
    borderWidth: 1,
    borderColor: C.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: C.text, fontSize: 14.5, fontWeight: '800', flexShrink: 1 },
  verifyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: C.cyanDim,
    borderWidth: 1,
    borderColor: C.cyanBorder,
  },
  verifyBadgeText: { color: C.cyan, fontSize: 8.5, fontWeight: '800', letterSpacing: 0.6 },
  headline: { color: C.textSec, fontSize: 11.5, fontWeight: '500', marginTop: 3 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  locText: { color: C.textMuted, fontSize: 10.5, fontWeight: '500', flex: 1 },

  inspectorStats: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 4,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 12,
  },
  inspectorStat: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6 },
  inspectorStatIcon: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  inspectorStatValue: { color: C.text, fontSize: 12.5, fontWeight: '800' },
  inspectorStatLabel: {
    color: C.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginTop: 1,
  },
  inspectorStatDivider: { width: 1, height: 22, backgroundColor: C.border },

  inspectorActionRow: { flexDirection: 'row', gap: 8 },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 11,
    backgroundColor: C.bgElev,
    borderWidth: 1,
    borderColor: C.border,
  },
  secondaryBtnText: { color: C.textSec, fontSize: 11, fontWeight: '700' },
  inviteBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 11,
    overflow: 'hidden',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  inviteBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },

  // Empty
  empty: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 28,
    backgroundColor: C.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: 'dashed',
  },
  emptyIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 13,
    backgroundColor: C.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  emptyTitle: { color: C.text, fontSize: 14, fontWeight: '700', marginBottom: 4 },
  emptySub: { color: C.textMuted, fontSize: 11.5, lineHeight: 16, textAlign: 'center' },

  // Sheet
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 4, 32, 0.92)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: C.borderStrong,
    padding: 20,
    paddingBottom: 32,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.20)',
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  sheetIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: C.primaryDim,
    borderWidth: 1,
    borderColor: C.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetKicker: {
    color: C.primary,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  sheetTitle: {
    color: C.text,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginTop: 1,
  },
  sheetExplainer: {
    color: C.textMuted,
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 8,
    marginBottom: 16,
  },
  sheetLabel: {
    color: C.primary,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  sheetEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: C.border,
  },
  sheetEmptyText: { flex: 1, color: C.textMuted, fontSize: 11.5, lineHeight: 16 },
  sheetInput: {
    backgroundColor: C.bgElev,
    color: C.text,
    fontSize: 13,
    fontWeight: '500',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  jobOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  jobOptionRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jobOptionTitle: { color: C.text, fontSize: 12.5, fontWeight: '700' },
  jobOptionSub: { color: C.textMuted, fontSize: 10.5, fontWeight: '500', marginTop: 2 },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 18,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  sendBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
});
