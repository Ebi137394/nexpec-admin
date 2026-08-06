// app/(admin)/dashboard.tsx
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The Command Center. Financial KPIs, quick-nav cards,
// recent activity feed. All live from Supabase.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl,
  TouchableOpacity, ActivityIndicator, Dimensions, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import { PipelineSection } from '@/src/components/jobs/PipelineSection';
import { SA, currency, ago, statusColor } from '@/lib/super-admin/theme';
import type { DashboardKPI, Job } from '@/lib/super-admin/types';

const { width } = Dimensions.get('window');
const CARD_W = (width - 48) / 2;

/* ────────────────────────────────────────────── */

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, role, signOut } = useAuth();

  const [kpi, setKpi] = useState<DashboardKPI>({
    totalVolume: 0, platformProfit: 0, pendingPayouts: 0,
    activeJobs: 0, pendingModeration: 0, pendingVerifications: 0,
    openSupport: 0, openHelpdesk: 0, totalJobs: 0,
  });
  const [recent, setRecent] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingReportCount, setPendingReportCount] = useState(0);
  const [pendingHireCount, setPendingHireCount] = useState(0); // ★ CLIENT_SELECTED apps
  const [atRisk, setAtRisk] = useState<any[]>([]); // SLA Sentinel — overdue, unsealed reports

/* ── Sign Out Handler ───────────────────────── */
  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut();
            // AuthGate handles routing to /(auth)/sign-in automatically.
          } catch (e) {
            console.error('Sign out error:', e);
          }
        },
      },
    ]);
  };

  /* ── Data Fetching ──────────────────────────── */
  const load = useCallback(async () => {
    try {
      setError(null);

      // 1. All jobs — financial aggregation (Updated for Stealth Markup)
      // We now fetch payout_amount instead of inspector_payout
      // ★ Task 4: integer cents end-to-end. Math is unit-agnostic.
      const { data: jobs, error: jErr } = await supabase
        .from('jobs_secure_view')
        .select('client_price_cents, payout_amount_cents, payout_status, status, admin_confirmed_at');
      if (jErr) throw jErr;
      const all = jobs ?? [];

      const totalVolume     = all.reduce((s, j) => s + (j.client_price_cents ?? 0), 0);

      // Platform Profit (cents): client_price_cents − payout_amount_cents on completed jobs.
      const platformProfit  = all
        .filter(j => j.status === 'completed')
        .reduce((s, j) => s + ((j.client_price_cents ?? 0) - (j.payout_amount_cents ?? 0)), 0);

      // Pending Payouts (cents): money owed to inspectors.
      const pendingPayouts  = all
        .filter(j => j.payout_status === 'unpaid' && j.status === 'completed')
        .reduce((s, j) => s + (j.payout_amount_cents ?? 0), 0);

      const activeJobs      = all.filter(j =>
        ['in_progress', 'assigned', 'on_site', 'active'].includes(j.status)).length;
        
      // Pending Moderation: New jobs waiting for admin approval
      const pendingMod      = all.filter(j => j.status === 'pending_approval').length;

      // 2. Verification count (graceful if table missing)
      let pendingV = 0;
      try {
        const { count } = await supabase
          .from('inspector_documents')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending');
        pendingV = count ?? 0;
      } catch { /* table may not exist yet */ }

      // 3a. Legacy Support count (Job/Report Oversight tickets)
      let openS = 0;
      try {
        const { count } = await supabase
          .from('support_messages')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'open');
        openS = count ?? 0;
      } catch {}

      // 3b. NEW: Helpdesk inbox count
      let openHelp = 0;
      try {
        const adminId = user?.id ?? null;
        let q = supabase
          .from('helpdesk_messages')
          .select('id', { count: 'exact', head: true })
          .eq('is_read', false);
        if (adminId) q = q.neq('sender_id', adminId);
        const { count } = await q;
        openHelp = count ?? 0;
      } catch {}

      // 3c. At-risk reports (SLA Sentinel) — overdue jobs with no sealed report
      try {
        const { data: ar } = await supabase.rpc('get_overdue_reports');
        setAtRisk(ar ?? []);
      } catch { /* sentinel migration not applied yet */ }

      setKpi({
        totalVolume, platformProfit, pendingPayouts,
        activeJobs, pendingModeration: pendingMod,
        pendingVerifications: pendingV,
        openSupport: openS,
        openHelpdesk: openHelp,
        totalJobs: all.length,
      });

      // 4. Recent jobs (Updated columns for Stealth Markup)
      const { data: rec } = await supabase
        .from('jobs_secure_view')
        .select('id, title, status, client_price_cents, payout_amount_cents, created_at')
        .order('created_at', { ascending: false })
        .limit(6);
      setRecent(rec as Job[] ?? []);

      // Fetch pending report count
      try {
        const { count } = await supabase
          .from('inspection_reports')
          .select('id', { count: 'exact', head: true })
          .eq('is_published', false);
        if (count !== null) {
          setPendingReportCount(count);
        }
      } catch { /* graceful fail */ }

      // ★ Fetch pending hire count (CLIENT_SELECTED applications)
      try {
        const { count } = await supabase
          .from('applications')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'CLIENT_SELECTED');
        if (count !== null) {
          setPendingHireCount(count);
        }
      } catch { /* graceful fail */ }

    } catch (err: any) {
      setError(err.message ?? 'Failed to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  /* ── Sub-components ─────────────────────────── */

  const KPICard = ({ label, value, color, icon }: {
    label: string; value: string; color: string; icon: keyof typeof Ionicons.glyphMap;
  }) => (
    <View style={[s.kpiCard, { borderColor: color + '30' }]}>
      <View style={[s.kpiIcon, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={s.kpiValue}>{value}</Text>
      <Text style={s.kpiLabel}>{label}</Text>
    </View>
  );

  const NavCard = ({ label, icon, route, badge, color }: {
    label: string; icon: keyof typeof Ionicons.glyphMap;
    route: string; badge?: number; color: string;
  }) => (
    <TouchableOpacity
      style={s.navCard}
      activeOpacity={0.7}
      onPress={() => router.push(route as any)}
    >
      <View style={[s.navIcon, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={s.navLabel} numberOfLines={1}>{label}</Text>
      {badge != null && badge > 0 && (
        <View style={[s.badge, { backgroundColor: label === 'Pending Approvals' ? '#EF4444' : color }]}>
          <Text style={[s.badgeText, { color: '#FFFFFF' }]}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  /* ── Render ─────────────────────────────────── */

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={SA.accent} />
        <Text style={[s.kpiLabel, { marginTop: 12 }]}>Loading Command Center…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={SA.accent} />}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Header ─────────────────────── */}
      <View style={s.header}>
        <View>
          <Text style={s.greeting}>Welcome back</Text>
          <Text style={s.title}>Command Center</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {/* Notifications Button */}
          <TouchableOpacity 
            style={s.avatarCircle} 
            onPress={() => router.push('/(admin)/notifications' as any)} 
            activeOpacity={0.7}
          >
            <Ionicons name="notifications-outline" size={22} color={SA.accent} />
            <View style={{ position: 'absolute', top: 10, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: SA.danger }} />
          </TouchableOpacity>

          {/* Log Out Button */}
          <TouchableOpacity 
            style={[s.avatarCircle, { backgroundColor: SA.danger + '15', borderColor: SA.danger + '30' }]} 
            onPress={handleSignOut} 
            activeOpacity={0.7}
          >
            <Ionicons name="log-out-outline" size={22} color={SA.danger} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Error Banner ───────────────── */}
      {error && (
        <TouchableOpacity style={s.errorBanner} onPress={load} activeOpacity={0.8}>
          <Ionicons name="alert-circle" size={18} color={SA.danger} />
          <Text style={s.errorText}>{error}</Text>
          <Text style={s.retryText}>Retry</Text>
        </TouchableOpacity>
      )}

      {/*
        Admin Pipeline — surfaces the 5 admin signoff gates on the home
        screen so admins don't have to dig into menus to see what's
        blocked waiting for THEIR action: open disputes (hottest),
        completed jobs awaiting sign-off, milestone release requests,
        accepted applications needing contract issuance, and pending
        approval queue. Self-suppresses when nothing is pending.
        Strictly additive (2026-05-20 UX directive — no nav changes).
      */}
      <PipelineSection userId={user?.id ?? null} userRole={role} />

      {/* ── Financial KPIs ─────────────── */}
      <Text style={s.sectionTitle}>Financial Overview</Text>
      <View style={s.kpiRow}>
        <KPICard label="Total Volume"     value={currency(kpi.totalVolume)}     color={SA.info}    icon="trending-up" />
        <KPICard label="Platform Profit"  value={currency(kpi.platformProfit)}  color={SA.success} icon="cash-outline" />
      </View>
      <View style={s.kpiRow}>
        <KPICard label="Pending Payouts"  value={currency(kpi.pendingPayouts)}  color={SA.warning} icon="time-outline" />
        <KPICard label="Total Jobs"       value={String(kpi.totalJobs)}         color={SA.accent}  icon="briefcase-outline" />
      </View>

      {/* ── Financial Control Center — hero card routing to /financial ─ */}
      <Text style={s.sectionTitle}>Financial Tools</Text>
      <TouchableOpacity
        style={s.financialHeroCard}
        activeOpacity={0.85}
        onPress={() => router.push('/(admin)/financial' as any)}
      >
        <View style={s.financialHeroIcon}>
          <Ionicons name="trending-up" size={26} color="#7C3AED" />
        </View>
        <View style={{ flex: 1 }}>
          <View style={s.financialHeroTitleRow}>
            <Text style={s.financialHeroTitle}>Financial Control Center</Text>
            <View style={s.financialHeroBadge}>
              <Text style={s.financialHeroBadgeText}>NEW</Text>
            </View>
          </View>
          <Text style={s.financialHeroSubtitle} numberOfLines={2}>
            Cash flow, Inspector payouts, Platform margin, Pipeline analytics
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color="#7C3AED" />
      </TouchableOpacity>

      {/* ── ★ Phase 5: Compliance & Governance — Audit Trail hero ─────
            Immutable record of every consequential mutation. Same hero
            shape as the Financial card so visual rhythm stays consistent. */}
      <Text style={s.sectionTitle}>Compliance & Governance</Text>
      <TouchableOpacity
        style={s.financialHeroCard}
        activeOpacity={0.85}
        onPress={() => router.push('/(admin)/audit-trail' as any)}
      >
        <View style={s.financialHeroIcon}>
          <Ionicons name="shield-checkmark" size={26} color="#7C3AED" />
        </View>
        <View style={{ flex: 1 }}>
          <View style={s.financialHeroTitleRow}>
            <Text style={s.financialHeroTitle}>Audit Trail</Text>
            <View style={s.financialHeroBadge}>
              <Text style={s.financialHeroBadgeText}>NEW</Text>
            </View>
          </View>
          <Text style={s.financialHeroSubtitle} numberOfLines={2}>
            Industrial black box, Every status, pricing, hiring, and payout event, immutable
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color="#7C3AED" />
      </TouchableOpacity>

      {/* ── ★ Phase 6: Reviews & Reputation — Moderation hero ─────────
            Lists every review across the platform with filters and
            inline hide / dispute / flag / note actions. */}
      <TouchableOpacity
        style={s.financialHeroCard}
        activeOpacity={0.85}
        onPress={() => router.push('/(admin)/reviews-moderation' as any)}
      >
        <View style={s.financialHeroIcon}>
          <Ionicons name="star-half" size={26} color="#7C3AED" />
        </View>
        <View style={{ flex: 1 }}>
          <View style={s.financialHeroTitleRow}>
            <Text style={s.financialHeroTitle}>Reviews Moderation</Text>
            <View style={s.financialHeroBadge}>
              <Text style={s.financialHeroBadgeText}>NEW</Text>
            </View>
          </View>
          <Text style={s.financialHeroSubtitle} numberOfLines={2}>
            Hide, dispute, or flag abusive reviews, Private feedback channel, Auto-audited
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color="#7C3AED" />
      </TouchableOpacity>

      {/* ── Disputes Board — escrow-frozen jobs awaiting mediation ─────
            Sister surface to /admin/disputes on web. Calls
            admin_resolve_dispute(uuid, text, text) RPC for resolution. */}
      <TouchableOpacity
        style={s.financialHeroCard}
        activeOpacity={0.85}
        onPress={() => router.push('/(admin)/disputes' as any)}
      >
        <View style={s.financialHeroIcon}>
          <Ionicons name="flame" size={26} color="#EF4444" />
        </View>
        <View style={{ flex: 1 }}>
          <View style={s.financialHeroTitleRow}>
            <Text style={s.financialHeroTitle}>Disputes Board</Text>
            <View style={[s.financialHeroBadge, { backgroundColor: 'rgba(239,68,68,0.18)' }]}>
              <Text style={[s.financialHeroBadgeText, { color: '#EF4444' }]}>LIVE</Text>
            </View>
          </View>
          <Text style={s.financialHeroSubtitle} numberOfLines={2}>
            Resolve disputed jobs, Release or refund Secured Funds, Audit-annotated
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color="#EF4444" />
      </TouchableOpacity>

      {/* ── At-risk reports (SLA Sentinel) ── */}
      {atRisk.length > 0 && (
        <TouchableOpacity
          style={s.financialHeroCard}
          activeOpacity={0.85}
          onPress={() => router.push('/(admin)/jobs' as any)}
        >
          <View style={s.financialHeroIcon}>
            <Ionicons name="alert-circle" size={26} color="#F59E0B" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={s.financialHeroTitleRow}>
              <Text style={s.financialHeroTitle}>At-risk reports</Text>
              <View style={[s.financialHeroBadge, { backgroundColor: 'rgba(245,158,11,0.18)' }]}>
                <Text style={[s.financialHeroBadgeText, { color: '#F59E0B' }]}>{atRisk.length}</Text>
              </View>
            </View>
            <Text style={s.financialHeroSubtitle} numberOfLines={2}>
              {atRisk.length} inspection{atRisk.length > 1 ? 's' : ''} overdue without a sealed report, SLA Sentinel is chasing the inspector
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color="#F59E0B" />
        </TouchableOpacity>
      )}

      {/* ── Quick Actions ──────────────── */}
      <Text style={s.sectionTitle}>Quick Actions</Text>
      <View style={s.navGrid}>
        <NavCard label="Pending Approvals" icon="checkmark-done-circle" route="/(admin)/pending-hires" badge={pendingReportCount + pendingHireCount} color="#10B981" />
        <NavCard label="Pending Jobs"    icon="hourglass-outline"  route="/(admin)/jobs"                    badge={kpi.pendingModeration}    color={SA.warning} />
        <NavCard label="Legal & Contracts" icon="document-text-outline" route="/(admin)/admin-contracts" badge={undefined} color="#3B82F6" />
        <NavCard label="Live Radar"      icon="radio-outline"      route="/(admin)/live-radar"              badge={kpi.activeJobs}           color={SA.info} />
        <NavCard label="Project Chats"   icon="chatbubbles-outline" route="/(admin)/communications"         badge={undefined}                color={SA.accent} />
        <NavCard label="System Alerts"   icon="mail-outline"       route="/(admin)/admin-inbox"             badge={undefined}                color="#8B5CF6" />
        <NavCard label="Job Issues"      icon="chatbubble-ellipses-outline" route="/(admin)/communications/support"  badge={kpi.openSupport}          color={SA.danger} />
        <NavCard label="Unified Inbox"   icon="chatbubbles-outline" route="/inbox"                          badge={kpi.openHelpdesk}         color="#7C3AED" />
        <NavCard label="Verification"    icon="shield-checkmark-outline" route="/(admin)/verification"      badge={kpi.pendingVerifications} color={SA.success} />
        {/* ★ TURNKEY MARKETPLACE — procurement suite + supplier directory.
            Root routes (allow-listed in AuthGate); admin is god-mode so it
            sees every RFQ/quote and can award (auto-spawns the source job). */}
        <NavCard label="RFQs & Procurement" icon="document-text-outline" route="/rfqs"      badge={undefined} color="#8B5CF6" />
        <NavCard label="Find Suppliers"     icon="search-outline"        route="/suppliers" badge={undefined} color="#06B6D4" />
        {/* ★ COMPLIANCE-MODE — CCI applications queue + compliance scope
            template library. Twin entry cards for the two admin surfaces
            shipped in Phase α (STEP 2 + STEP 3). */}
        <NavCard label="CCI Applications" icon="ribbon-outline"   route="/(admin)/cci-applications"     badge={undefined}                color="#7C3AED" />
        <NavCard label="Scope Templates"  icon="library-outline"  route="/(admin)/compliance-templates" badge={undefined}                color="#06B6D4" />
        <NavCard label="Inspection Domains" icon="globe-outline"  route="/(admin)/inspection-domains"   badge={undefined}                color="#7C3AED" />
        <NavCard label="Integrity Console" icon="pulse-outline"   route="/(admin)/integrity"            badge={undefined}                color="#FB923C" />
        <NavCard label="Evidence Vault"    icon="folder-open-outline" route="/(admin)/vault"             badge={undefined}                color="#10B981" />
        <NavCard label="Organizations"     icon="business-outline"   route="/(admin)/org-management"      badge={undefined}                color="#00FFFF" />
        <NavCard label="Diagnostics"       icon="medkit-outline"     route="/(admin)/diagnostics"         badge={undefined}                color="#F59E0B" />
        <NavCard label="Platform Settings" icon="options-outline"    route="/(admin)/settings"            badge={undefined}                color="#7C3AED" />
        <NavCard label="Users & CRM"     icon="people-outline"     route="/(admin)/users"                   badge={undefined}                color="#E17055" />
        <NavCard label="Payouts"         icon="cash-outline"       route="/(admin)/payouts"                 badge={undefined}                color={SA.warning} />
      </View>

      {/* ── Recent Activity ────────────── */}
      <Text style={s.sectionTitle}>Recent Jobs</Text>
      {recent.map((job: any) => {
        // ★ Task 4: integer cents.
        const spread = (job.client_price_cents ?? 0) - (job.payout_amount_cents ?? 0);
        return (
          <TouchableOpacity
            key={job.id}
            style={s.recentCard}
            activeOpacity={0.7}
            onPress={() => router.push(`/(admin)/jobs/${job.id}` as any)}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.recentTitle} numberOfLines={1}>{job.title}</Text>
              <Text style={s.recentSub}>
                {currency(job.client_price_cents)} → {currency(job.payout_amount_cents)}
                {'  '}
                <Text style={{ color: SA.success }}>+{currency(spread)}</Text>
              </Text>
            </View>
            <View style={s.recentRight}>
              <View style={[s.statusDot, { backgroundColor: statusColor(job.status) }]} />
              <Text style={s.recentTime}>{ago(job.created_at)}</Text>
            </View>
          </TouchableOpacity>
        );
      })}
      {recent.length === 0 && (
        <View style={s.empty}>
          <Ionicons name="file-tray-outline" size={40} color={SA.textMuted} />
          <Text style={s.emptyText}>No jobs yet</Text>
        </View>
      )}
    </ScrollView>
  );
}

/* ── Styles ──────────────────────────────────── */
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: SA.bg, paddingHorizontal: 16 },
  center: { flex: 1, backgroundColor: SA.bg, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 24,
  },
  greeting: { color: SA.textSec, fontSize: 14, marginBottom: 2 },
  title: { color: SA.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  avatarCircle: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: SA.danger + '15', justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: SA.danger + '30',
  },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: SA.dangerSoft, padding: 12, borderRadius: SA.radiusSm, marginBottom: 16,
  },
  errorText: { color: SA.danger, flex: 1, fontSize: 13 },
  retryText: { color: SA.danger, fontWeight: '700', fontSize: 13 },

  sectionTitle: {
    color: SA.textSec, fontSize: 13, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, marginTop: 8,
  },

  kpiRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  kpiCard: {
    width: CARD_W, backgroundColor: SA.surface,
    borderRadius: SA.radius, padding: 16, borderWidth: 1,
  },
  kpiIcon: {
    width: 36, height: 36, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  kpiValue: { color: SA.text, fontSize: 22, fontWeight: '800', marginBottom: 4 },
  kpiLabel: { color: SA.textSec, fontSize: 12 },

  // ★ Financial Control Center hero card — locked NEXPEC primary (#7C3AED).
  //   Full-width, tinted purple, prominent placement above Quick Actions.
  financialHeroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(124,58,237,0.10)',
    borderRadius: SA.radius,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.30)',
    marginBottom: 12,
  },
  financialHeroIcon: {
    width: 50,
    height: 50,
    borderRadius: 12,
    backgroundColor: 'rgba(124,58,237,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  financialHeroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  financialHeroTitle: {
    color: SA.text,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  financialHeroBadge: {
    backgroundColor: '#7C3AED',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  financialHeroBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  financialHeroSubtitle: {
    color: SA.textSec,
    fontSize: 12,
    marginTop: 3,
  },

  navGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24,
  },
  navCard: {
    width: CARD_W, backgroundColor: SA.surface,
    borderRadius: SA.radius, padding: 16,
    borderWidth: 1, borderColor: SA.border,
  },
  navIcon: {
    width: 40, height: 40, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center', marginBottom: 10,
  },
  navLabel: { color: SA.text, fontSize: 14, fontWeight: '600', paddingRight: 20 },
  badge: {
    position: 'absolute', top: 8, right: 8,
    minWidth: 22, height: 22, borderRadius: 11,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },

  recentCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: SA.surface, borderRadius: SA.radiusSm,
    padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: SA.border,
  },
  recentTitle: { color: SA.text, fontSize: 14, fontWeight: '600', marginBottom: 3 },
  recentSub: { color: SA.textSec, fontSize: 12 },
  recentRight: { alignItems: 'flex-end', marginLeft: 12 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 4 },
  recentTime: { color: SA.textMuted, fontSize: 11 },

  empty: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyText: { color: SA.textMuted, fontSize: 14 },
});