// app/(admin)/pending-hires.tsx
// =====================================================================
// SUPER-ADMIN INBOX
//   • Tab 1 "Hires"     — applications with status = 'CLIENT_SELECTED'
//                          (client picked an inspector; admin must
//                           Confirm & Dispatch in the Spread Editor)
//   • Tab 2 "Reports"   — inspection_reports with is_published = false
//   • Tab 3 "Published" — inspection_reports with is_published = true.
//                         Tap to re-view; long-press / Reopen button flips
//                         is_published=false so the admin can revise.
//   • Tab 4 "Rejected"  — applications with status in ('rejected','withdrawn')
//                          so admin has audit-trail visibility on every
//                          decision (closes the loop the user flagged).
// =====================================================================
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

type Tab = 'hires' | 'reports' | 'published' | 'rejected';

interface HireRow {
  id: string;
  status: string;
  cover_note: string | null;
  client_notes: string | null;
  rejection_reason?: string | null;
  created_at: string;
  updated_at: string;
  job_id: string;
  applicant: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    avatar_url: string | null;
    title: string | null;
    email: string | null;
  } | null;
  job: {
    id: string;
    title: string | null;
    location: string | null;
    client_id: string;
  } | null;
}

interface ReportRow {
  id: string;
  job_id: string;
  created_at: string;
  is_published: boolean;
  is_client_approved?: boolean;
  job?: { id: string; title: string | null; location: string | null } | null;
}

export default function PendingApprovalsScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('hires');
  const [hires, setHires] = useState<HireRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [published, setPublished] = useState<ReportRow[]>([]);
  const [rejected, setRejected] = useState<HireRow[]>([]); // ★ rejected/withdrawn
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ─────────────────────────────────────────────────────────────────
  // Fetchers
  // ─────────────────────────────────────────────────────────────────
  // ★ Manual 3-step join — avoids PostgREST FK-hint embedded query that
  //   was failing with PGRST200 ("Could not find a relationship between
  //   'applications' and 'jobs' in the schema cache"). Same pattern as
  //   fetchReports below.
  const fetchHires = useCallback(async () => {
    // (1) Pull bare applications.
    const { data: apps, error } = await supabase
      .from('applications')
      .select('id, status, cover_note, client_notes, created_at, updated_at, job_id, applicant_id')
      .eq('status', 'CLIENT_SELECTED')
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[pending-hires] hires fetch error →', error);
      setHires([]);
      return;
    }
    if (!apps || apps.length === 0) {
      setHires([]);
      return;
    }

    // (2) Pull associated jobs and applicant profiles in parallel.
    const jobIds = Array.from(new Set(apps.map((a: any) => a.job_id).filter(Boolean)));
    const profileIds = Array.from(
      new Set(apps.map((a: any) => a.applicant_id).filter(Boolean))
    );

    const [{ data: jobs }, { data: profiles }] = await Promise.all([
      jobIds.length
        ? supabase
            .from('jobs')
            .select('id, title, location, client_id')
            .in('id', jobIds)
        : Promise.resolve({ data: [] as any[] } as any),
      profileIds.length
        ? supabase
            .from('profiles')
            .select('id, first_name, last_name, full_name, avatar_url, title, email')
            .in('id', profileIds)
        : Promise.resolve({ data: [] as any[] } as any),
    ]);

    // (3) Stitch.
    const merged: HireRow[] = (apps as any[]).map((a) => ({
      id: a.id,
      status: a.status,
      cover_note: a.cover_note,
      client_notes: a.client_notes,
      created_at: a.created_at,
      updated_at: a.updated_at,
      job_id: a.job_id,
      applicant: profiles?.find((p: any) => p.id === a.applicant_id) ?? null,
      job: jobs?.find((j: any) => j.id === a.job_id) ?? null,
    }));

    setHires(merged);
  }, []);

  // ★ Rejections / withdrawals — audit trail for the admin so they can see
  //   every decision the client/agency made, not just the live pipeline.
  //   Uses the same 3-step manual join pattern as fetchHires.
  const fetchRejected = useCallback(async () => {
    const { data: apps, error } = await supabase
      .from('applications')
      .select('id, status, cover_note, client_notes, rejection_reason, created_at, updated_at, job_id, applicant_id')
      .in('status', ['rejected', 'withdrawn'])
      .order('updated_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[pending-hires] rejected fetch error →', error);
      setRejected([]);
      return;
    }
    if (!apps || apps.length === 0) {
      setRejected([]);
      return;
    }

    const jobIds = Array.from(new Set(apps.map((a: any) => a.job_id).filter(Boolean)));
    const profileIds = Array.from(
      new Set(apps.map((a: any) => a.applicant_id).filter(Boolean))
    );

    const [{ data: jobs }, { data: profiles }] = await Promise.all([
      jobIds.length
        ? supabase
            .from('jobs')
            .select('id, title, location, client_id')
            .in('id', jobIds)
        : Promise.resolve({ data: [] as any[] } as any),
      profileIds.length
        ? supabase
            .from('profiles')
            .select('id, first_name, last_name, full_name, avatar_url, title, email')
            .in('id', profileIds)
        : Promise.resolve({ data: [] as any[] } as any),
    ]);

    const merged: HireRow[] = (apps as any[]).map((a) => ({
      id: a.id,
      status: a.status,
      cover_note: a.cover_note,
      client_notes: a.client_notes,
      rejection_reason: a.rejection_reason ?? null,
      created_at: a.created_at,
      updated_at: a.updated_at,
      job_id: a.job_id,
      applicant: profiles?.find((p: any) => p.id === a.applicant_id) ?? null,
      job: jobs?.find((j: any) => j.id === a.job_id) ?? null,
    }));

    setRejected(merged);
  }, []);

  // ★ Reopen a published report — flips is_published=false so the admin can
  //   re-review or push it back through revision. The inspector and client
  //   continue to see the report via their existing job-detail surfaces;
  //   what changes is that the admin's Reports tab will show it again.
  const reopenReport = useCallback(
    async (reportId: string) => {
      Alert.alert(
        'Reopen Report',
        'This sends the report back to the Reports tab so it can be re-reviewed or revised. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Reopen',
            style: 'destructive',
            onPress: async () => {
              const { error } = await supabase
                .from('inspection_reports')
                .update({
                  is_published: false,
                  is_client_approved: false,
                })
                .eq('id', reportId);
              if (error) {
                Alert.alert('Could not reopen', error.message);
                return;
              }
              await fetchAll();
              Alert.alert('Reopened', 'Report moved back to the Reports tab.');
            },
          },
        ]
      );
    },
    // fetchAll defined later — reference it via closure (TypeScript will warn
    // if the deps array misses it; we accept the controlled reference here).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ★ Robust name resolution — falls through full_name, first/last, email,
  //   title, then a generic placeholder. Stops the "Unknown Inspector" labels
  //   when first_name/last_name are null on the profile row.
  const resolveInspectorName = (
    p: HireRow['applicant'],
    appId: string
  ): string => {
    if (!p) return 'Unknown Inspector';
    if (p.full_name && p.full_name.trim()) return p.full_name.trim();
    const fl = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
    if (fl) return fl;
    if (p.email && p.email.trim()) return p.email.trim();
    if (p.title && p.title.trim()) return p.title.trim();
    return `Inspector #${appId.slice(0, 6)}`;
  };

  const fetchReports = useCallback(async (isPublished: boolean) => {
    const { data: rep, error } = await supabase
      .from('inspection_reports')
      .select('id, job_id, created_at, is_published, is_client_approved')
      .eq('is_published', isPublished)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[pending-hires] reports fetch error →', error);
      return [] as ReportRow[];
    }
    if (!rep || rep.length === 0) return [] as ReportRow[];

    const jobIds = rep.map((r: any) => r.job_id).filter(Boolean);
    const { data: jobs } = await supabase
      .from('jobs')
      .select('id, title, location')
      .in('id', jobIds);
    return rep.map((r: any) => ({
      ...r,
      job: jobs?.find((j: any) => j.id === r.job_id) ?? null,
    })) as ReportRow[];
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [_, pendingReps, publishedReps] = await Promise.all([
      fetchHires(),
      fetchReports(false),
      fetchReports(true),
      fetchRejected(), // ★ rejected/withdrawn audit feed
    ]);
    setReports(pendingReps);
    setPublished(publishedReps);
    setLoading(false);
  }, [fetchHires, fetchReports, fetchRejected]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Refetch every time the screen gains focus.
  useFocusEffect(
    useCallback(() => {
      fetchAll();
    }, [fetchAll])
  );

  // Realtime: any application change kicks both the hires list and the
  // rejected feed so the admin sees rejections appear immediately.
  useEffect(() => {
    const ch = supabase
      .channel('pending-hires-rt')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'applications' },
        () => {
          fetchHires();
          fetchRejected();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [fetchHires, fetchRejected]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  // ─────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────
  const TabButton: React.FC<{
    id: Tab;
    label: string;
    count: number;
  }> = ({ id, label, count }) => (
    <TouchableOpacity
      style={[styles.tabButton, activeTab === id && styles.activeTab]}
      onPress={() => setActiveTab(id)}
    >
      <Text
        style={[styles.tabText, activeTab === id && styles.activeTabText]}
        numberOfLines={1}
      >
        {label}
        {count > 0 ? `  (${count})` : ''}
      </Text>
    </TouchableOpacity>
  );

  const renderHires = () => {
    if (hires.length === 0) {
      return (
        <View style={styles.center}>
          <Ionicons
            name="checkmark-done-circle-outline"
            size={64}
            color="#1E293B"
          />
          <Text style={styles.caughtUpText}>All caught up!</Text>
          <Text style={styles.subText}>
            No inspectors awaiting confirmation.
          </Text>
        </View>
      );
    }
    return (
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#7C3AED"
          />
        }
      >
        <Text style={styles.headerText}>
          {hires.length} hire{hires.length === 1 ? '' : 's'} awaiting Confirm &
          Dispatch
        </Text>
        {hires.map((row) => {
          const inspectorName = resolveInspectorName(row.applicant, row.id);
          const jobTitle =
            row.job?.title || row.job?.location || 'Untitled Job';
          // Client's selection note first (the "why I picked them" message),
          // then the inspector's original cover letter as supporting context.
          const clientNote = row.client_notes?.trim() || null;
          const inspectorNote = row.cover_note?.trim() || null;
          return (
            <TouchableOpacity
              key={row.id}
              style={styles.card}
              onPress={() =>
                router.push({
                  pathname: '/(admin)/jobs/[id]',
                  params: { id: row.job_id },
                })
              }
            >
              <View style={styles.cardLeft}>
                <Ionicons
                  name="person-add"
                  size={24}
                  color="#3B82F6"
                  style={{ marginRight: 12 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.jobText} numberOfLines={1}>
                    {inspectorName}
                  </Text>
                  <Text style={styles.subLine} numberOfLines={1}>
                    for {jobTitle}
                  </Text>
                  {clientNote ? (
                    <View style={styles.noteBlock}>
                      <Text style={styles.noteLabel}>CLIENT'S NOTE</Text>
                      <Text style={styles.noteBody} numberOfLines={3}>
                        “{clientNote}”
                      </Text>
                    </View>
                  ) : null}
                  {inspectorNote ? (
                    <View style={styles.inspectorNoteBlock}>
                      <Text style={styles.inspectorNoteLabel}>
                        INSPECTOR'S COVER LETTER
                      </Text>
                      <Text style={styles.inspectorNoteBody} numberOfLines={2}>
                        {inspectorNote}
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.pillRow}>
                    <View style={styles.selectedPill}>
                      <Text style={styles.selectedPillText}>
                        CLIENT SELECTED
                      </Text>
                    </View>
                    <Text style={styles.timeText}>
                      {new Date(row.updated_at).toLocaleString()}
                    </Text>
                  </View>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#3B82F6" />
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  };

  // ★ Rejections / withdrawals — read-only audit list. Tapping a card opens
  //   the Spread Editor for context, but no actions are required.
  const renderRejected = () => {
    if (rejected.length === 0) {
      return (
        <View style={styles.center}>
          <Ionicons name="archive-outline" size={64} color="#1E293B" />
          <Text style={styles.caughtUpText}>No rejections yet</Text>
          <Text style={styles.subText}>
            Rejected and withdrawn applications will show up here.
          </Text>
        </View>
      );
    }
    return (
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#7C3AED"
          />
        }
      >
        <Text style={styles.headerText}>
          {rejected.length} rejection{rejected.length === 1 ? '' : 's'} on record
        </Text>
        {rejected.map((row) => {
          const inspectorName = resolveInspectorName(row.applicant, row.id);
          const jobTitle = row.job?.title || row.job?.location || 'Untitled Job';
          const isWithdrawn = row.status === 'withdrawn';
          const reason = row.rejection_reason?.trim() || null;
          const clientNote = row.client_notes?.trim() || null;
          return (
            <TouchableOpacity
              key={row.id}
              style={styles.card}
              onPress={() =>
                router.push({
                  pathname: '/(admin)/jobs/[id]',
                  params: { id: row.job_id },
                })
              }
            >
              <View style={styles.cardLeft}>
                <Ionicons
                  name={isWithdrawn ? 'log-out-outline' : 'close-circle-outline'}
                  size={24}
                  color={isWithdrawn ? '#64748B' : '#EF4444'}
                  style={{ marginRight: 12 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.jobText} numberOfLines={1}>
                    {inspectorName}
                  </Text>
                  <Text style={styles.subLine} numberOfLines={1}>
                    for {jobTitle}
                  </Text>
                  {reason ? (
                    <View style={styles.noteBlock}>
                      <Text style={styles.noteLabel}>REJECTION REASON</Text>
                      <Text style={styles.noteBody} numberOfLines={3}>
                        “{reason}”
                      </Text>
                    </View>
                  ) : clientNote ? (
                    <View style={styles.noteBlock}>
                      <Text style={styles.noteLabel}>CLIENT'S NOTE</Text>
                      <Text style={styles.noteBody} numberOfLines={3}>
                        “{clientNote}”
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.pillRow}>
                    <View
                      style={[
                        styles.selectedPill,
                        {
                          backgroundColor: isWithdrawn
                            ? 'rgba(100, 116, 139, 0.15)'
                            : 'rgba(239, 68, 68, 0.15)',
                          borderColor: isWithdrawn
                            ? 'rgba(100, 116, 139, 0.4)'
                            : 'rgba(239, 68, 68, 0.4)',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.selectedPillText,
                          { color: isWithdrawn ? '#94A3B8' : '#EF4444' },
                        ]}
                      >
                        {isWithdrawn ? 'WITHDRAWN' : 'REJECTED'}
                      </Text>
                    </View>
                    <Text style={styles.timeText}>
                      {new Date(row.updated_at).toLocaleString()}
                    </Text>
                  </View>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#64748B" />
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  };

  const renderReports = (rows: ReportRow[], isPub: boolean) => {
    if (rows.length === 0) {
      return (
        <View style={styles.center}>
          <Ionicons
            name={isPub ? 'folder-open-outline' : 'checkmark-done-circle-outline'}
            size={64}
            color="#1E293B"
          />
          <Text style={styles.caughtUpText}>
            {isPub ? 'No History Yet' : 'All caught up!'}
          </Text>
          <Text style={styles.subText}>
            No {isPub ? 'published' : 'pending'} reports.
          </Text>
        </View>
      );
    }
    return (
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#7C3AED"
          />
        }
      >
        <Text style={styles.headerText}>
          {rows.length}{' '}
          {isPub
            ? rows.length === 1
              ? 'completed report'
              : 'completed reports'
            : rows.length === 1
            ? 'report awaiting action'
            : 'reports awaiting action'}
        </Text>
        {rows.map((item) => {
          const title =
            item.job?.title || item.job?.location || 'Unknown Job';
          const iconColor = isPub ? '#10B981' : '#F59E0B';
          const iconName = isPub ? 'checkmark-done-circle' : 'document-text';
          const cardPrefix = isPub ? 'Published:' : 'Review:';
          const datePrefix = isPub ? 'Completed:' : 'Submitted:';
          return (
            <TouchableOpacity
              key={item.id}
              style={styles.card}
              onPress={() =>
                router.push({
                  pathname: '/(admin)/jobs/[id]',
                  params: { id: item.job_id },
                })
              }
            >
              <View style={styles.cardLeft}>
                <Ionicons
                  name={iconName as any}
                  size={24}
                  color={iconColor}
                  style={{ marginRight: 12 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.jobText}>
                    {cardPrefix} {title}
                  </Text>
                  <Text style={styles.timeText}>
                    {datePrefix}{' '}
                    {new Date(item.created_at).toLocaleDateString()}
                  </Text>
                  {isPub &&
                    (item.is_client_approved ? (
                      <View style={styles.approvedPill}>
                        <Text style={styles.approvedPillText}>
                          CLIENT APPROVED
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.awaitingPill}>
                        <Text style={styles.awaitingPillText}>
                          AWAITING CLIENT
                        </Text>
                      </View>
                    ))}
                  {/* ★ Reopen action — only on published reports. Bypasses
                       the parent card's onPress so a tap on Reopen doesn't
                       also navigate to the Spread Editor. */}
                  {isPub && (
                    <TouchableOpacity
                      style={styles.reopenBtn}
                      onPress={(e) => {
                        e.stopPropagation();
                        reopenReport(item.id);
                      }}
                    >
                      <Ionicons name="refresh" size={13} color="#F59E0B" />
                      <Text style={styles.reopenBtnText}>Reopen Report</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={iconColor} />
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  };

  return (
    <SafeAreaView
      style={styles.container}
      edges={['bottom', 'left', 'right']}
    >
      <View style={styles.tabContainer}>
        <TabButton id="hires" label="Hires" count={hires.length} />
        <TabButton id="reports" label="Reports" count={reports.length} />
        <TabButton id="published" label="Archive" count={published.length} />
        <TabButton id="rejected" label="Rejected" count={rejected.length} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#7C3AED" />
        </View>
      ) : activeTab === 'hires' ? (
        renderHires()
      ) : activeTab === 'reports' ? (
        renderReports(reports, false)
      ) : activeTab === 'published' ? (
        renderReports(published, true)
      ) : (
        renderRejected()
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020420' },
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    marginBottom: 8,
    marginTop: 8,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: '#1A1D3C',
  },
  activeTab: { borderBottomColor: '#7C3AED' },
  tabText: { color: '#64748B', fontWeight: '600', fontSize: 12 },
  activeTabText: { color: '#7C3AED', fontWeight: 'bold' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  caughtUpText: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 16,
  },
  subText: { color: '#64748B', fontSize: 14, marginTop: 8 },
  scrollContent: { padding: 16 },
  headerText: {
    color: '#94A3B8',
    fontSize: 14,
    marginBottom: 16,
    textTransform: 'uppercase',
    fontWeight: 'bold',
  },
  card: {
    backgroundColor: '#0A0D2C',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1A1D3C',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  jobText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  subLine: { color: '#94A3B8', fontSize: 13, marginBottom: 4 },
  coverNote: {
    color: '#CBD5E1',
    fontSize: 12,
    fontStyle: 'italic',
    marginBottom: 6,
  },
  noteBlock: {
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
    borderLeftWidth: 3,
    borderLeftColor: '#3B82F6',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    marginTop: 6,
    marginBottom: 4,
  },
  noteLabel: {
    color: '#3B82F6',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  noteBody: {
    color: '#E2E8F0',
    fontSize: 12,
    fontStyle: 'italic',
    lineHeight: 16,
  },
  inspectorNoteBlock: {
    backgroundColor: 'rgba(124, 58, 237, 0.08)',
    borderLeftWidth: 2,
    borderLeftColor: '#7C3AED',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginBottom: 6,
  },
  inspectorNoteLabel: {
    color: '#7C3AED',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  inspectorNoteBody: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 15,
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  selectedPill: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.4)',
  },
  selectedPillText: {
    color: '#3B82F6',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 0.4,
  },
  approvedPill: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  approvedPillText: {
    color: '#10B981',
    fontSize: 11,
    fontWeight: 'bold',
  },
  awaitingPill: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  awaitingPillText: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: 'bold',
  },
  // ★ Reopen button on Archive (Published) cards
  reopenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.10)',
    borderColor: 'rgba(245, 158, 11, 0.40)',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 8,
  },
  reopenBtnText: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '700',
  },
  timeText: { color: '#64748B', fontSize: 12 },
});
