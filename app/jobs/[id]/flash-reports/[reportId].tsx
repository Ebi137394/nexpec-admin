// ════════════════════════════════════════════════════════════════════════════
//  app/jobs/[id]/flash-reports/[reportId].tsx
//  Flash Report detail — full body + attachments + state transitions.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Alert, Image, Linking, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft, Camera, FileText as FileIcon, MapPin, Clock, AlertTriangle,
  CheckCircle, ShieldAlert, ExternalLink,
} from 'lucide-react-native';

import { supabase } from '@/lib/supabase';
import {
  getFlashReport, listAttachments, signedAttachmentUrl, transitionFlashReport,
  legalTransitions,
  CATEGORY_META, SEVERITY_META, STATUS_META,
  formatTimestamp,
  type FlashReport, type FlashReportAttachment, type FlashReportStatus,
} from '@/src/lib/flashReports';

const C = {
  bg: '#020420', card: '#0A0D2C', cardAlt: '#0F172A', border: '#1E293B',
  text: '#FFFFFF', textSec: '#94A3B8', textMuted: '#64748B',
  primary: '#7C3AED', primarySoft: 'rgba(124,58,237,0.14)',
  primaryBorder: 'rgba(124,58,237,0.40)',
  error: '#EF4444', errorSoft: 'rgba(239,68,68,0.10)',
};

interface CallerContext {
  uid: string;
  callerRoleOnJob: 'inspector' | 'client' | 'agency' | 'super_admin' | 'other';
}

export default function FlashReportDetailScreen() {
  const router = useRouter();
  const { id: jobId, reportId } = useLocalSearchParams<{
    id: string; reportId: string;
  }>();

  const [report, setReport] = useState<FlashReport | null>(null);
  const [attachments, setAttachments] = useState<FlashReportAttachment[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [caller, setCaller] = useState<CallerContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState<FlashReportStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!reportId || !jobId) return;
    setError(null);
    try {
      // Resolve caller context (role on this job)
      const { data: authData } = await supabase.auth.getUser();
      const uid = authData?.user?.id;
      if (!uid) throw new Error('Not authenticated');

      const [reportData, jobRes, profRes] = await Promise.all([
        getFlashReport(reportId),
        supabase.from('jobs').select('client_id, agency_id, contractor_id').eq('id', jobId).maybeSingle(),
        supabase.from('profiles').select('role').eq('id', uid).maybeSingle(),
      ]);
      if (!reportData) throw new Error('Report not found');

      const job = jobRes.data;
      const profileRole = profRes.data?.role;
      let callerRoleOnJob: CallerContext['callerRoleOnJob'] = 'other';
      // God-mode: the single platform admin (admin/super_admin) is full authority on every job.
      if (profileRole === 'admin' || profileRole === 'super_admin') callerRoleOnJob = 'super_admin';
      else if (job?.contractor_id === uid) callerRoleOnJob = 'inspector';
      else if (job?.client_id === uid) callerRoleOnJob = 'client';
      else if (job?.agency_id === uid) callerRoleOnJob = 'agency';

      setCaller({ uid, callerRoleOnJob });
      setReport(reportData);

      const atts = await listAttachments(reportId);
      setAttachments(atts);

      // Signed URLs for photo thumbnails (kind === 'photo' only).
      const urlMap: Record<string, string> = {};
      await Promise.all(
        atts
          .filter((a) => a.kind === 'photo')
          .map(async (a) => {
            try {
              urlMap[a.id] = await signedAttachmentUrl(a.storage_path);
            } catch {/* swallow per-asset; rendered as broken */}
          }),
      );
      setThumbUrls(urlMap);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load report.');
    } finally {
      setLoading(false);
    }
  }, [reportId, jobId]);

  useEffect(() => { load(); }, [load]);

  const openAttachment = async (a: FlashReportAttachment) => {
    try {
      const url = await signedAttachmentUrl(a.storage_path);
      await Linking.openURL(url);
    } catch (e: any) {
      Alert.alert('Could not open file', e?.message ?? 'Unknown error.');
    }
  };

  const doTransition = async (to: FlashReportStatus, label: string) => {
    if (!report) return;
    Alert.alert(
      label,
      `Move this report to ${to.replace('_',' ')}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setTransitioning(to);
            try {
              await transitionFlashReport(report.id, to);
              await load();
            } catch (e: any) {
              Alert.alert('Transition failed', e?.message ?? 'Unknown error.');
            } finally {
              setTransitioning(null);
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}>
          <ActivityIndicator color={C.primary} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !report) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}>
          <ShieldAlert size={32} color="#EF4444" strokeWidth={1.8} />
          <Text style={styles.errTitle}>Couldn't load report</Text>
          <Text style={styles.errBody}>{error ?? 'Not found'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const sev = SEVERITY_META[report.severity];
  const st = STATUS_META[report.status];
  const cat = CATEGORY_META[report.category];

  const transitions = caller
    ? legalTransitions({
        current: report.status,
        callerRoleOnJob: caller.callerRoleOnJob,
        callerIsReporter: caller.uid === report.reporter_id,
      })
    : [];

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()} hitSlop={10}>
          <ArrowLeft size={22} color={C.text} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Flash Report</Text>
          <Text style={styles.headerSub}>NCR detail</Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Status + severity chips */}
        <View style={styles.chipRow}>
          <View style={[styles.chip, { backgroundColor: sev.bg }]}>
            <Text style={[styles.chipTxt, { color: sev.color }]}>{sev.label}</Text>
          </View>
          <View style={[styles.chip, { backgroundColor: st.bg }]}>
            <Text style={[styles.chipTxt, { color: st.color }]}>{st.label}</Text>
          </View>
          <View style={[styles.chip, { backgroundColor: 'rgba(124,58,237,0.14)' }]}>
            <Text style={[styles.chipTxt, { color: C.primary }]}>{cat.label}</Text>
          </View>
        </View>

        {/* Title + body */}
        <Text style={styles.title}>{report.title}</Text>
        <Text style={styles.description}>{report.description}</Text>

        {/* Metadata */}
        <View style={styles.metaCard}>
          <View style={styles.metaRow}>
            <Clock size={14} color={C.textMuted} strokeWidth={2} />
            <Text style={styles.metaLabel}>Raised</Text>
            <Text style={styles.metaValue}>{formatTimestamp(report.created_at)}</Text>
          </View>
          {report.occurred_at ? (
            <View style={styles.metaRow}>
              <Clock size={14} color={C.textMuted} strokeWidth={2} />
              <Text style={styles.metaLabel}>Occurred</Text>
              <Text style={styles.metaValue}>{formatTimestamp(report.occurred_at)}</Text>
            </View>
          ) : null}
          {report.location_text ? (
            <View style={styles.metaRow}>
              <MapPin size={14} color={C.textMuted} strokeWidth={2} />
              <Text style={styles.metaLabel}>Site</Text>
              <Text style={styles.metaValue}>{report.location_text}</Text>
            </View>
          ) : null}
          <View style={styles.metaRow}>
            <CheckCircle size={14} color={C.textMuted} strokeWidth={2} />
            <Text style={styles.metaLabel}>Reporter</Text>
            <Text style={styles.metaValue}>{report.reporter_role}</Text>
          </View>
          {report.acknowledged_at ? (
            <View style={styles.metaRow}>
              <CheckCircle size={14} color={C.textMuted} strokeWidth={2} />
              <Text style={styles.metaLabel}>Acknowledged</Text>
              <Text style={styles.metaValue}>{formatTimestamp(report.acknowledged_at)}</Text>
            </View>
          ) : null}
          {report.resolved_at ? (
            <View style={styles.metaRow}>
              <CheckCircle size={14} color={C.textMuted} strokeWidth={2} />
              <Text style={styles.metaLabel}>Resolved</Text>
              <Text style={styles.metaValue}>{formatTimestamp(report.resolved_at)}</Text>
            </View>
          ) : null}
          {report.resolution_notes ? (
            <View style={styles.metaRowMulti}>
              <Text style={styles.metaLabel}>Notes</Text>
              <Text style={styles.metaValueMulti}>{report.resolution_notes}</Text>
            </View>
          ) : null}
        </View>

        {/* Attachments */}
        <Text style={styles.sectionHeading}>
          Evidence ({attachments.length})
        </Text>
        {attachments.length === 0 ? (
          <Text style={styles.helper}>No evidence attached.</Text>
        ) : (
          <View style={styles.attachmentsGrid}>
            {attachments.map((a) => {
              if (a.kind === 'photo') {
                const url = thumbUrls[a.id];
                return (
                  <TouchableOpacity
                    key={a.id}
                    style={styles.photoTile}
                    onPress={() => openAttachment(a)}
                    activeOpacity={0.8}
                  >
                    {url ? (
                      <Image source={{ uri: url }} style={styles.photoImg} resizeMode="cover" />
                    ) : (
                      <View style={styles.photoFallback}>
                        <Camera size={20} color={C.textMuted} strokeWidth={1.8} />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              }
              return (
                <TouchableOpacity
                  key={a.id}
                  style={styles.docTile}
                  onPress={() => openAttachment(a)}
                  activeOpacity={0.7}
                >
                  <FileIcon size={18} color={C.primary} strokeWidth={2} />
                  <Text style={styles.docTileTxt} numberOfLines={2}>
                    {a.storage_path.split('/').pop()}
                  </Text>
                  <ExternalLink size={12} color={C.textMuted} strokeWidth={2} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Critical inline alert */}
        {report.severity === 'critical' && report.status === 'open' && (
          <View style={styles.criticalAlert}>
            <AlertTriangle size={16} color={C.error} strokeWidth={2.2} />
            <Text style={styles.criticalAlertTxt}>
              Critical report, admin has been notified via the audit
              trail. Acknowledge to begin remediation.
            </Text>
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Transition controls (only if there are any legal moves) */}
      {transitions.length > 0 && (
        <View style={styles.footer}>
          {transitions.map((t) => (
            <TouchableOpacity
              key={t.to}
              style={[
                styles.actionBtn,
                t.destructive && styles.actionBtnDestructive,
                transitioning === t.to && { opacity: 0.6 },
              ]}
              disabled={transitioning !== null}
              onPress={() => doTransition(t.to, t.label)}
              activeOpacity={0.85}
            >
              {transitioning === t.to
                ? <ActivityIndicator color={C.text} />
                : <Text style={styles.actionBtnTxt}>{t.label}</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  errTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  errBody: { color: C.textMuted, fontSize: 13, textAlign: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingTop: 8, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  iconBtn: {
    width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.cardAlt, borderWidth: 1, borderColor: C.border,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  headerSub: { color: C.textSec, fontSize: 11, marginTop: 2 },

  scroll: { padding: 16, paddingBottom: 32 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  chipTxt: { fontSize: 11, fontWeight: '700' },

  title: { color: C.text, fontSize: 19, fontWeight: '700', marginTop: 14, lineHeight: 24 },
  description: { color: C.textSec, fontSize: 14, lineHeight: 21, marginTop: 8 },

  metaCard: {
    marginTop: 20,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    borderRadius: 14, padding: 14, gap: 10,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  metaRowMulti: { flexDirection: 'column', gap: 4 },
  metaLabel: {
    color: C.textMuted, fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.4, minWidth: 92,
  },
  metaValue: { color: C.text, fontSize: 13, flex: 1 },
  metaValueMulti: { color: C.text, fontSize: 13, lineHeight: 19 },

  sectionHeading: {
    marginTop: 22, marginBottom: 10,
    color: C.textSec, fontSize: 13, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  helper: { color: C.textMuted, fontSize: 12 },

  attachmentsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoTile: {
    width: 96, height: 96,
    borderRadius: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: C.border,
    backgroundColor: C.cardAlt,
  },
  photoImg: { width: '100%', height: '100%' },
  photoFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  docTile: {
    width: '48%',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 14,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    borderRadius: 12,
  },
  docTileTxt: { flex: 1, color: C.text, fontSize: 12, fontWeight: '600' },

  criticalAlert: {
    marginTop: 18, padding: 12,
    flexDirection: 'row', gap: 10,
    backgroundColor: C.errorSoft,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.30)',
    borderRadius: 12,
  },
  criticalAlertTxt: { flex: 1, color: C.text, fontSize: 12, lineHeight: 17 },

  footer: {
    paddingHorizontal: 16, paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    borderTopWidth: 1, borderTopColor: C.border,
    backgroundColor: C.bg, gap: 10,
  },
  actionBtn: {
    paddingVertical: 14, borderRadius: 999,
    backgroundColor: C.primary, alignItems: 'center',
  },
  actionBtnDestructive: {
    backgroundColor: 'transparent',
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.55)',
  },
  actionBtnTxt: { color: C.text, fontSize: 14, fontWeight: '700' },
});
