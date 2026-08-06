// app/(admin)/jobs/[id].tsx
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SPREAD EDITOR
// Pricing management, payout status, and the SINGLE
// gatekeeper "Confirm & Dispatch" that promotes a
// CLIENT_SELECTED application into a `hired` contract
// and locks the job into status='assigned'.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput,
  TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  Modal, Image, Linking,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { signedUrl } from '@/src/core/storage/signedUrls';
import { useAuth } from '@/src/contexts/AuthContext';
import { SA, currency, statusColor } from '@/lib/super-admin/theme';
import type { Job } from '@/lib/super-admin/types';
import { toCents } from '@/lib/money';
// ★ Phase 5 — Industrial Black Box
import AuditTimeline from '@/src/components/audit/AuditTimeline';
import { MeetingsPanel } from '@/src/components/meetings/MeetingsPanel';
// ★ HIRE-002/003: transactional admin dispatch
import { adminDispatchJob } from '@/lib/assignJob';
// ★ Layer 1+3 — passive inspection-domain badge (no-op for industrial_ndt)
import { InspectionDomainBadge } from '@/src/components/shared/InspectionDomainBadge';

interface SelectedApplication {
  id: string;
  applicant_id: string;
  cover_note: string | null;
  client_notes?: string | null;        // ★ alias of cover_note (canonical client comment)
  admin_feedback?: string | null;       // ★ admin's prior reply
  admin_attachment?: string | null;     // ★ admin's prior uploaded doc URL
  applicant?: {
    id: string;
    full_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    company_name?: string | null;
    phone?: string | null;
  } | null;
}

export default function SpreadEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<{ id: string; is_published: boolean; photo_url?: string; notes?: string } | null>(null);
  // photo_url stores a PRIVATE inspection-photos storage path — render the
  // minted signed URL, never the raw path (which shows a broken image).
  const [reportPhotoUrl, setReportPhotoUrl] = useState<string | null>(null);
  const [viewerVisible, setViewerVisible] = useState(false);

  // Candidate the Client has selected — populated only when there's a
  // CLIENT_SELECTED application waiting for the admin to confirm.
  const [selectedApp, setSelectedApp] = useState<SelectedApplication | null>(null);

  // Editable pricing
  const [clientPrice, setClientPrice] = useState('');
  const [inspectorPayout, setInspectorPayout] = useState('');
  const [payoutStatus, setPayoutStatus] = useState('unpaid');

  // ★ Admin reply state — text + optional uploaded doc URL.
  //   Persists to applications.admin_feedback / admin_attachment so the
  //   client/agency can read the response on their job detail screen.
  const [adminReply, setAdminReply] = useState('');
  const [adminAttachmentUrl, setAdminAttachmentUrl] = useState<string | null>(null);
  const [adminAttachmentName, setAdminAttachmentName] = useState<string | null>(null);
  const [uploadingReply, setUploadingReply] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);

  // Bulletproof parsing
  const cp = parseFloat(clientPrice.replace(/[^0-9.]/g, '')) || 0;
  const ip = parseFloat(inspectorPayout.replace(/[^0-9.]/g, '')) || 0;
  const spread = cp - ip;
  const margin = cp > 0 ? ((spread / cp) * 100).toFixed(1) : '0.0';

  /* ── Fetch ──────────────────────────────────── */
  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    try {
      setError(null);

      // 1. Fetch the job
      const { data: jobData, error: jobError } = await supabase
        .from('jobs_secure_view')
        .select('*')
        .eq('id', id)
        .single();

      if (jobError) throw jobError;
      const fetchedJob = jobData as Job;

      // 2. Fetch the CLIENT_SELECTED application for this job, if any
      const { data: appRow } = await supabase
        .from('applications')
        .select('id, applicant_id, cover_note, client_notes, admin_feedback, admin_attachment')
        .eq('job_id', id)
        .eq('status', 'CLIENT_SELECTED')
        .maybeSingle();

      // 3. Profile lookup — collect every party id we know about plus the
      //    selected applicant if there is one. `contractor_id` is the
      //    canonical column on jobs after the gatekeeper runs;
      //    `inspector_id` kept as a legacy fallback in case your schema
      //    still carries it.
      const candidateIds = [
        fetchedJob.client_id,
        (fetchedJob as any).contractor_id,
        (fetchedJob as any).inspector_id,
        fetchedJob.agency_id,
        appRow?.applicant_id,
      ].filter(Boolean) as string[];
      const uniqueIds = Array.from(new Set(candidateIds));

      let profilesMap = new Map<string, any>();
      if (uniqueIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name, first_name, last_name, email, company_name, phone')
          .in('id', uniqueIds);

        if (profilesError) throw profilesError;
        profilesMap = new Map(profilesData?.map((p) => [p.id, p]) || []);
      }

      const inspectorIdResolved =
        (fetchedJob as any).contractor_id || (fetchedJob as any).inspector_id || null;

      const jobWithProfiles = {
        ...fetchedJob,
        client: fetchedJob.client_id ? profilesMap.get(fetchedJob.client_id) : null,
        inspector: inspectorIdResolved ? profilesMap.get(inspectorIdResolved) : null,
        agency: fetchedJob.agency_id ? profilesMap.get(fetchedJob.agency_id) : null,
      } as Job;

      setJob(jobWithProfiles);

      if (appRow) {
        setSelectedApp({
          id: appRow.id,
          applicant_id: appRow.applicant_id,
          // ★ Prefer the client's selection note (client_notes) over the
          //   inspector's original cover letter. The selection note is the
          //   "why I picked them" message the admin needs to act on.
          cover_note: (appRow as any).client_notes || appRow.cover_note,
          client_notes: (appRow as any).client_notes ?? null,
          admin_feedback: (appRow as any).admin_feedback ?? null,
          admin_attachment: (appRow as any).admin_attachment ?? null,
          applicant: profilesMap.get(appRow.applicant_id) ?? null,
        });
        // Seed the reply form with any prior reply so the admin can edit it
        // instead of overwriting blindly.
        setAdminReply(((appRow as any).admin_feedback ?? '') as string);
        setAdminAttachmentUrl(((appRow as any).admin_attachment ?? null) as string | null);
        setAdminAttachmentName(null);
      } else {
        setSelectedApp(null);
        setAdminReply('');
        setAdminAttachmentUrl(null);
        setAdminAttachmentName(null);
      }

      // ★ Task 4: read renamed cents columns; convert to dollar strings for the form inputs.
      const clientPriceCents = (jobWithProfiles as any).client_price_cents ?? (jobWithProfiles as any).budget_cents ?? 0;
      const inspectorPayoutCents = (jobWithProfiles as any).payout_amount_cents ?? 0;
      const clientPriceValue = clientPriceCents / 100;
      const inspectorPayoutValue = inspectorPayoutCents / 100;

      setClientPrice(clientPriceValue ? String(clientPriceValue) : '');
      setInspectorPayout(inspectorPayoutValue ? String(inspectorPayoutValue) : '');
      setPayoutStatus((jobWithProfiles as any).payout_status ?? 'unpaid');

      // Fetch report status
      try {
        const { data: report } = await supabase
          .from('inspection_reports')
          .select('*')
          .eq('job_id', id)
          .maybeSingle();
        if (report) setReportData(report);
        if (report?.photo_url) {
          const url = await signedUrl({ bucket: 'inspection-photos', path: report.photo_url, ttl: 3600 });
          setReportPhotoUrl(url ?? null);
        } else {
          setReportPhotoUrl(null);
        }
      } catch (e) {
        console.warn('No report found for job');
      }
    } catch (err: any) {
      setError(err.message ?? 'Failed to load job');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const publishReport = async () => {
    try {
      const { error: pubErr } = await supabase
        .from('inspection_reports')
        .update({ is_published: true })
        .eq('job_id', id);
      if (pubErr) throw pubErr;

      Alert.alert('Success', 'Report has been published to client');
      setReportData((prev) => (prev ? { ...prev, is_published: true } : null));
    } catch (error) {
      Alert.alert('Error', 'Failed to publish report');
    }
  };

  /* ── Save Pricing (no status change) ─────────── */
  const savePricing = async () => {
    if (!job || !user) return;
    setSaving(true);
    try {
      const { error: e } = await supabase
        .from('jobs')
        .update({
          client_price_cents: toCents(cp),   // ★ Task 4
          payout_amount_cents: toCents(ip),  // ★ Task 4
          inspector_payout_cents: toCents(ip), // keep GR2 inspector column in sync
          payout_status: payoutStatus,
        })
        .eq('id', job.id);

      if (e) throw e;
      Alert.alert('Saved', 'Pricing updated successfully.');

      setClientPrice(cp > 0 ? String(cp) : '');
      setInspectorPayout(ip > 0 ? String(ip) : '');
      setJob((prev) =>
        prev
          ? ({
              ...prev,
              client_price_cents: toCents(cp),   // ★ Task 4
              payout_amount_cents: toCents(ip),  // ★ Task 4
              inspector_payout_cents: toCents(ip), // keep GR2 inspector column in sync
              payout_status: payoutStatus,
            } as Job)
          : null,
      );
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  };

  /* ── Admin reply to client comment ──────────────────────
        Persists `admin_feedback` (text) and `admin_attachment` (uploaded
        file URL) on the CLIENT_SELECTED application row. The client/agency
        already reads these columns and renders them in the
        "Message from NEXPEC Admin" panel on their job detail screen. */
  const pickReplyAttachment = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];

      setUploadingReply(true);
      const fileName = asset.name || `admin-reply-${Date.now()}`;
      const ext = fileName.includes('.') ? fileName.split('.').pop() : 'bin';
      const storagePath = `admin-replies/${id}/${Date.now()}.${ext}`;

      // Read file as base64 → ArrayBuffer (native-safe; fetch(uri).blob()
      // uploads 0 bytes on RN for file:// URIs).
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const fileBytes = decode(base64);

      // Use the existing chat_attachments bucket since it's known to exist
      // and has the right RLS for cross-role reads.
      const { error: uploadErr } = await supabase.storage
        .from('chat_attachments')
        .upload(storagePath, fileBytes, {
          contentType: asset.mimeType ?? 'application/octet-stream',
          upsert: false,
        });
      if (uploadErr) throw uploadErr;

      // Store the storage PATH (not a URL). chat_attachments is private
      // post-lockdown; getPublicUrl would yield a dead link. Counterpart
      // screens mint a signed URL from this path at open time.
      setAdminAttachmentUrl(storagePath);
      setAdminAttachmentName(fileName);
    } catch (err: any) {
      Alert.alert('Upload failed', err?.message ?? 'Could not attach the file.');
    } finally {
      setUploadingReply(false);
    }
  };

  const clearReplyAttachment = () => {
    setAdminAttachmentUrl(null);
    setAdminAttachmentName(null);
  };

  const sendAdminReply = async () => {
    if (!selectedApp) return;
    const trimmed = adminReply.trim();
    if (!trimmed && !adminAttachmentUrl) {
      Alert.alert(
        'Nothing to send',
        'Write a message to the client or attach a document before sending.'
      );
      return;
    }
    setSendingReply(true);
    try {
      const { error } = await supabase
        .from('applications')
        .update({
          admin_feedback: trimmed || null,
          admin_attachment: adminAttachmentUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedApp.id);
      if (error) throw error;

      // Mirror the saved values into local state so the panel reflects what
      // the client will see.
      setSelectedApp((prev) =>
        prev
          ? {
              ...prev,
              admin_feedback: trimmed || null,
              admin_attachment: adminAttachmentUrl,
            }
          : prev
      );

      Alert.alert(
        'Reply sent',
        adminAttachmentUrl
          ? 'Your message and attachment have been delivered to the client.'
          : 'Your message has been delivered to the client.'
      );
    } catch (err: any) {
      Alert.alert('Send failed', err?.message ?? 'Could not save the reply.');
    } finally {
      setSendingReply(false);
    }
  };

  /* ── Approve & Publish — opens the job to inspector applications ──
        Used when the job is still in 'pending_approval'. The admin must
        set both the client price and the inspector payout (the spread)
        before publishing, otherwise inspectors would see a job with no
        compensation. */
  const publishJob = async () => {
    if (!job || !user) return;

    if (cp <= 0) { Alert.alert('Validation', 'Client price must be greater than zero.'); return; }
    if (ip <= 0) { Alert.alert('Validation', 'Inspector payout must be greater than zero.'); return; }
    if (spread < 0) { Alert.alert('Validation', 'Client price must be ≥ inspector payout.'); return; }

    Alert.alert(
      'Approve & Publish',
      `Client billed: ${currency(toCents(cp))}\nInspector offered: ${currency(toCents(ip))}\nPlatform spread: ${currency(toCents(spread))} (${margin}%)\n\nPublish this job to inspectors?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Publish',
          style: 'default',
          onPress: async () => {
            setSaving(true);
            try {
              const { error: jobErr } = await supabase
                .from('jobs')
                .update({
                  client_price_cents: toCents(cp),   // ★ Task 4
                  payout_amount_cents: toCents(ip),  // ★ Task 4
                  inspector_payout_cents: toCents(ip), // keep GR2 inspector column in sync
                  payout_status: payoutStatus,
                  status: 'open',
                  updated_at: new Date().toISOString(),
                })
                .eq('id', job.id);
              if (jobErr) throw jobErr;

              Alert.alert(
                'Published ✓',
                'Job is now visible to inspectors. They can begin applying.',
                [{ text: 'OK', onPress: () => router.back() }],
              );
            } catch (err: any) {
              Alert.alert('Publish failed', err?.message ?? 'Could not publish the job.');
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  /* ── Confirm & Dispatch — the Admin Gatekeeper ───────── */
  const confirmJob = async () => {
    if (!job || !user) return;

    if (cp <= 0) { Alert.alert('Validation', 'Client price must be greater than zero.'); return; }
    if (ip <= 0) { Alert.alert('Validation', 'Inspector payout must be greater than zero.'); return; }
    if (spread < 0) { Alert.alert('Validation', 'Client price must be ≥ inspector payout.'); return; }
    if (!selectedApp) {
      Alert.alert(
        'Nothing to dispatch',
        'There is no CLIENT_SELECTED application on this job. The Client must select an inspector before you can dispatch.',
      );
      return;
    }

    const inspectorName =
      selectedApp.applicant?.full_name ||
      `${selectedApp.applicant?.first_name ?? ''} ${selectedApp.applicant?.last_name ?? ''}`.trim() ||
      'Inspector';

    Alert.alert(
      'Confirm & Dispatch',
      `Inspector: ${inspectorName}\nClient billed: ${currency(toCents(cp))}\nInspector offered: ${currency(toCents(ip))}\nPlatform spread: ${currency(toCents(spread))} (${margin}%)\n\nProceed?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: 'default',
          onPress: async () => {
            setSaving(true);
            try {
              // ★ HIRE-002/003: replaced 3 loose UPDATEs with a single
              //   transactional RPC. Promotes app → hired, locks job →
              //   assigned, rejects siblings — all atomically. If any
              //   step fails the whole thing rolls back. Concurrency
              //   safe via SELECT ... FOR UPDATE.
              const result = await adminDispatchJob({
                jobId: job.id,
                applicationId: selectedApp.id,
                clientPriceCents: toCents(cp),
                payoutCents: toCents(ip),
                payoutStatus,
              });

              if (!result.ok) {
                Alert.alert('Dispatch failed', result.message);
                return;
              }

              // Best-effort notification — no-op if the Edge Function
              // is missing. Stays outside the RPC because email I/O
              // shouldn't gate the DB transaction.
              if (selectedApp.applicant?.email) {
                try {
                  await supabase.functions.invoke('notify-job-assigned', {
                    body: {
                      inspectorEmail: selectedApp.applicant.email,
                      inspectorName,
                      jobTitle: job.title || 'Inspection Job',
                      location: job.location || 'Location not specified',
                      payoutAmount: currency(toCents(ip)),
                    },
                  });
                } catch (notifyErr) {
                  console.warn('notify-job-assigned skipped:', notifyErr);
                }
              }

              Alert.alert(
                'Dispatched ✓',
                `Inspector hired, job locked, ${result.rejectedSiblings} other applicant${result.rejectedSiblings === 1 ? '' : 's'} notified.`,
                [{ text: 'OK', onPress: () => router.back() }],
              );
            } catch (err: any) {
              Alert.alert('Dispatch failed', err?.message ?? 'Could not finalize the hire.');
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const renderNotesWithLinks = (text: string | null | undefined) => {
    if (!text) return 'No notes provided.';
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part: string, i: number) => {
      if (part.match(urlRegex)) {
        return (
          <Text
            key={i}
            style={{ color: '#3B82F6', textDecorationLine: 'underline' }}
            onPress={() => Linking.openURL(part)}
          >
            {part}
          </Text>
        );
      }
      return <Text key={i} selectable>{part}</Text>;
    });
  };

  /* ── UI Helpers ─────────────────────────────── */
  const InfoRow = ({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; }) => (
    <View style={s.infoRow}>
      <Ionicons name={icon} size={16} color={SA.textMuted} />
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue} numberOfLines={1}>{value}</Text>
    </View>
  );

  const PayoutBtn = ({ v, label }: { v: string; label: string }) => (
    <TouchableOpacity
      style={[
        s.payoutBtn,
        payoutStatus === v && { backgroundColor: statusColor(v) + '25', borderColor: statusColor(v) },
      ]}
      onPress={() => setPayoutStatus(v)}
    >
      <Text style={[s.payoutBtnText, payoutStatus === v && { color: statusColor(v) }]}>{label}</Text>
    </TouchableOpacity>
  );

  /* ── Render ─────────────────────────────────── */
  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={SA.accent} /></View>;

  if (error || !job) {
    return (
      <View style={s.center}>
        <Ionicons name="alert-circle-outline" size={48} color={SA.danger} />
        <Text style={[s.emptyText, { marginTop: 12 }]}>{error ?? 'Job not found'}</Text>
        <TouchableOpacity onPress={load} style={{ marginTop: 16 }}><Text style={s.retryText}>Retry</Text></TouchableOpacity>
      </View>
    );
  }

  // Whoever is "the inspector" for display purposes:
  // - if the job already has a contractor (post-dispatch), use that
  // - else, if a Client has selected someone (pre-dispatch), use that candidate
  // - otherwise the slot is unassigned.
  const displayedInspectorName =
    (job as any).inspector?.full_name ??
    selectedApp?.applicant?.full_name ??
    (selectedApp?.applicant
      ? `${selectedApp.applicant.first_name ?? ''} ${selectedApp.applicant.last_name ?? ''}`.trim()
      : null);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={s.root}
        contentContainerStyle={{ paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        <Text style={s.jobTitle}>{job.title}</Text>
        <View style={[s.statusBadge, { backgroundColor: statusColor(job.status) + '20', alignSelf: 'flex-start' }]}>
          <Text style={[s.statusText, { color: statusColor(job.status) }]}>
            {String(job.status || '').replace(/_/g, ' ').toUpperCase()}
          </Text>
        </View>
        {/* ★ Layer 1+3 — passive domain badge. Renders nothing while every
              job is still in 'industrial_ndt' (the platform default), so
              this insertion is a true no-op visually today. Surfaces
              automatically once civil / electrical / mechanical jobs exist. */}
        <View style={{ marginTop: 8 }}>
          <InspectionDomainBadge domain={(job as any).domain} />
        </View>

        {job.description && <Text style={s.desc}>{job.description}</Text>}

        {/* ★ Inspector banner — strict per-state branching.
              • Awaiting state: ONLY when an unconfirmed CLIENT_SELECTED app
                exists AND the job hasn't moved past 'open'. Shows blue
                "CLIENT SELECTED — Awaiting Admin Confirmation" with the
                client's cover note for the admin to read before dispatching.
              • Active state: once the job is assigned/in_progress/completed
                (i.e. the admin already dispatched), the awaiting banner is
                replaced with a green "HIRED — ACTIVE INSPECTOR" badge that
                does NOT mention confirmation.
              No banner is rendered if neither condition applies (e.g. job is
              still 'open' with no client selection yet). */}
        {(() => {
          const jobStatus = (job.status ?? '').toLowerCase();
          const isPostDispatch = ['assigned', 'in_progress', 'on_site', 'active', 'completed'].includes(jobStatus);
          const isAwaiting = !!selectedApp && !isPostDispatch;
          const showActive = isPostDispatch && !!displayedInspectorName;

          if (isAwaiting) {
            return (
              <View style={s.gatekeeperBanner}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Ionicons name="person-add" size={16} color="#3B82F6" />
                  <Text style={s.gatekeeperTitle}>CLIENT SELECTED, Awaiting Admin Confirmation</Text>
                </View>
                <Text style={s.gatekeeperName}>
                  {displayedInspectorName || 'Inspector'}
                </Text>
                {selectedApp!.cover_note ? (
                  <Text style={s.gatekeeperNote} numberOfLines={4}>
                    💬 "{selectedApp!.cover_note}"
                  </Text>
                ) : null}
              </View>
            );
          }

          if (showActive) {
            const isCompleted = jobStatus === 'completed';
            return (
              <View style={s.activeInspectorBanner}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Ionicons
                    name={isCompleted ? 'checkmark-done-circle' : 'shield-checkmark'}
                    size={16}
                    color="#10B981"
                  />
                  <Text style={s.activeInspectorTitle}>
                    {isCompleted ? 'HIRED, JOB COMPLETED' : 'HIRED, ACTIVE INSPECTOR'}
                  </Text>
                </View>
                <Text style={s.gatekeeperName}>
                  {displayedInspectorName}
                </Text>
              </View>
            );
          }

          return null;
        })()}

        {/* ★ ADMIN ↔ CLIENT REPLY PANEL — yellow card.
              Shows the client/agency's note and lets the admin reply with
              text and/or attach a document. The client side reads
              `admin_feedback` + `admin_attachment` from the same row and
              renders a "Message from NEXPEC Admin" card. */}
        {selectedApp && (selectedApp.client_notes || selectedApp.cover_note) && (
          <View style={s.replyCard}>
            <View style={s.replyHeader}>
              <Ionicons name="chatbubbles" size={16} color="#F59E0B" />
              <Text style={s.replyHeaderText}>Client Comment</Text>
            </View>
            <Text style={s.replyClientNote}>
              "{selectedApp.client_notes || selectedApp.cover_note}"
            </Text>

            <Text style={s.replyLabel}>Your reply to the client</Text>
            <TextInput
              style={s.replyInput}
              value={adminReply}
              onChangeText={setAdminReply}
              placeholder="e.g. Welding cert is attached. Let me know if anything else is needed."
              placeholderTextColor={SA.textMuted}
              multiline
              textAlignVertical="top"
              maxLength={1000}
            />

            <View style={s.replyAttachmentRow}>
              {adminAttachmentUrl ? (
                <View style={s.replyAttachmentChip}>
                  <Ionicons name="document-attach" size={14} color="#F59E0B" />
                  <Text style={s.replyAttachmentText} numberOfLines={1}>
                    {adminAttachmentName || 'Attached document'}
                  </Text>
                  <TouchableOpacity onPress={clearReplyAttachment} hitSlop={8}>
                    <Ionicons name="close-circle" size={16} color={SA.textMuted} />
                  </TouchableOpacity>
                </View>
              ) : null}
              <TouchableOpacity
                style={s.replyAttachBtn}
                onPress={pickReplyAttachment}
                disabled={uploadingReply}
              >
                {uploadingReply ? (
                  <ActivityIndicator size="small" color="#F59E0B" />
                ) : (
                  <>
                    <Ionicons name="attach" size={16} color="#F59E0B" />
                    <Text style={s.replyAttachText}>
                      {adminAttachmentUrl ? 'Replace' : 'Attach Document'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[
                s.replySendBtn,
                (sendingReply ||
                  uploadingReply ||
                  (!adminReply.trim() && !adminAttachmentUrl)) &&
                  s.replySendBtnDisabled,
              ]}
              onPress={sendAdminReply}
              disabled={
                sendingReply ||
                uploadingReply ||
                (!adminReply.trim() && !adminAttachmentUrl)
              }
            >
              {sendingReply ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name="send" size={14} color="#FFF" />
                  <Text style={s.replySendText}>
                    {selectedApp.admin_feedback || selectedApp.admin_attachment
                      ? 'Update Reply'
                      : 'Send Reply to Client'}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            {(selectedApp.admin_feedback || selectedApp.admin_attachment) && (
              <Text style={s.replyDeliveredHint}>
                ✓ Delivered, the client can see this on their job detail screen.
              </Text>
            )}
          </View>
        )}

        {/* --- ADMIN REPORT APPROVAL CARD --- */}
        {reportData && !reportData.is_published && (
          <View style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', borderColor: '#F59E0B', borderWidth: 1, padding: 16, borderRadius: 12, marginBottom: 24, marginHorizontal: 0, marginTop: 16 }}>
            <Text style={{ color: '#F59E0B', fontSize: 16, fontWeight: 'bold', marginBottom: 12 }}>Report Pending Review</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 12, borderWidth: 1, borderColor: '#7C3AED', borderRadius: 8, alignItems: 'center' }}
                onPress={() => setViewerVisible(true)}
              >
                <Text style={{ color: '#7C3AED', fontWeight: '600' }}>View Draft</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 12, backgroundColor: '#7C3AED', borderRadius: 8, alignItems: 'center' }}
                onPress={publishReport}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: 'bold' }}>Publish to Client</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {reportData && reportData.is_published && (
          <View style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', borderColor: '#10B981', borderWidth: 1, padding: 16, borderRadius: 12, marginBottom: 24, marginHorizontal: 0, marginTop: 16 }}>
            <Text style={{ color: '#10B981', fontSize: 16, fontWeight: 'bold', marginBottom: 12 }}>Final Report Published</Text>
            <TouchableOpacity
              style={{ paddingVertical: 12, backgroundColor: '#10B981', borderRadius: 8, alignItems: 'center' }}
              onPress={() => setViewerVisible(true)}
            >
              <Text style={{ color: '#FFFFFF', fontWeight: 'bold' }}>View Report</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Details & Parties ───────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Job Details</Text>
          <InfoRow icon="location-outline" label="Location" value={job.location ?? '—'} />
          <InfoRow
            icon="calendar-outline"
            label="Scheduled"
            value={(job as any).scheduled_date ? new Date((job as any).scheduled_date).toLocaleDateString() : '—'}
          />
          <InfoRow icon="cash-outline" label="Orig. Budget" value={currency((job as any).budget_cents)} />
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Parties</Text>
          <InfoRow icon="person-outline" label="Client" value={(job as any).client?.full_name ?? (job as any).client?.company_name ?? '—'} />
          {(job as any).agency && (
            <InfoRow icon="business-outline" label="Agency" value={(job as any).agency.company_name ?? (job as any).agency.full_name ?? '—'} />
          )}
          <InfoRow
            icon="construct-outline"
            label="Inspector"
            value={
              displayedInspectorName ??
              (() => {
                const js = (job.status ?? '').toLowerCase();
                if (js === 'pending_approval' || js === 'pending_admin')
                  return 'Awaiting admin publication';
                if (js === 'assigned') return 'Unassigned';
                return 'Awaiting client selection';
              })()
            }
          />
        </View>

        {/* ── SPREAD EDITOR ─────────────── */}
        <View style={s.spreadSection}>
          <Text style={s.sectionTitle}>💰 Spread Editor</Text>

          <Text style={s.inputLabel}>Client Price (billed to client)</Text>
          <View style={s.inputWrap}>
            <Text style={s.inputPrefix}>$</Text>
            <TextInput
              style={s.input}
              value={clientPrice}
              onChangeText={setClientPrice}
              keyboardType="decimal-pad"
              placeholderTextColor={SA.textMuted}
              placeholder="0.00"
            />
          </View>

          <Text style={s.inputLabel}>Inspector Payout (offered to inspector)</Text>
          <View style={s.inputWrap}>
            <Text style={s.inputPrefix}>$</Text>
            <TextInput
              style={s.input}
              value={inspectorPayout}
              onChangeText={setInspectorPayout}
              keyboardType="decimal-pad"
              placeholderTextColor={SA.textMuted}
              placeholder="0.00"
            />
          </View>

          <View style={s.spreadDisplay}>
            <View style={s.spreadRow}>
              <Text style={s.spreadLabel}>Platform Spread</Text>
              <Text style={[s.spreadValue, { color: spread >= 0 ? SA.success : SA.danger }]}>
                {currency(toCents(spread))}
              </Text>
            </View>
            <View style={s.spreadRow}>
              <Text style={s.spreadLabel}>Margin</Text>
              <Text style={[s.spreadValue, { color: spread >= 0 ? SA.success : SA.danger }]}>
                {margin}%
              </Text>
            </View>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Payout Status</Text>
          <View style={s.payoutRow}>
            <PayoutBtn v="unpaid" label="Unpaid" />
            <PayoutBtn v="processing" label="Processing" />
            <PayoutBtn v="paid" label="Paid" />
            <PayoutBtn v="disputed" label="Disputed" />
          </View>
        </View>

        <View style={s.actions}>
          <TouchableOpacity style={s.btnSecondary} onPress={savePricing} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color={SA.accent} /> : <Text style={s.btnSecondaryText}>Save Pricing</Text>}
          </TouchableOpacity>

          {/* ★ Context-aware action button — one of three states:
                (a) job is pending_approval → admin must set pricing and
                    publish to inspectors before anyone can apply.
                (b) job is open with no CLIENT_SELECTED app → genuinely
                    waiting for the client to choose.
                (c) job is open with a CLIENT_SELECTED app → admin's
                    Confirm & Dispatch gate. */}
          {(() => {
            const jobStatus = (job.status ?? '').toLowerCase();
            const alreadyDispatched = !!(job as any).admin_confirmed_at;
            if (alreadyDispatched) return null;

            if (jobStatus === 'pending_approval' || jobStatus === 'pending_admin') {
              const canPublish = cp > 0 && ip > 0 && spread >= 0;
              return (
                <TouchableOpacity
                  style={[s.btnPrimary, !canPublish && s.btnPrimaryDisabled]}
                  onPress={publishJob}
                  disabled={saving || !canPublish}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="rocket-outline" size={18} color="#fff" />
                      <Text style={s.btnPrimaryText}>
                        {canPublish
                          ? 'Approve & Publish to Inspectors'
                          : 'Set Pricing to Publish'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              );
            }

            // Open / live job paths
            return (
              <TouchableOpacity
                style={[s.btnPrimary, !selectedApp && s.btnPrimaryDisabled]}
                onPress={confirmJob}
                disabled={saving || !selectedApp}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                    <Text style={s.btnPrimaryText}>
                      {selectedApp
                        ? 'Confirm & Dispatch'
                        : 'Awaiting Client Selection'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            );
          })()}
        </View>

        {/* ★ Phase 5 — Industrial Black Box: per-job audit timeline.
            Inline mode (no nested scroll). Tap "View Full Trail" to open
            the global Command Center scoped to this job for filtering. */}
        <View style={auditCardStyle.card}>
          <View style={auditCardStyle.headerRow}>
            <View style={auditCardStyle.iconWrap}>
              <Ionicons name="shield-checkmark" size={18} color="#7C3AED" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={auditCardStyle.title}>Audit Trail</Text>
              <Text style={auditCardStyle.sub}>
                Every status, pricing, hiring, and payout change, immutable
              </Text>
            </View>
            <TouchableOpacity
              style={auditCardStyle.viewFullBtn}
              activeOpacity={0.8}
              onPress={() =>
                router.push({
                  pathname: '/(admin)/audit-trail' as any,
                  params: { jobId: id },
                })
              }
            >
              <Text style={auditCardStyle.viewFullText}>Open</Text>
              <Ionicons name="arrow-forward" size={12} color="#7C3AED" />
            </TouchableOpacity>
          </View>

          {/* Brokered War Room — admin convenes the cross-party call.
             As organizer, the admin auto-satisfies the schedule_meeting guard,
             so a client+inspector(+vendor) room is permitted here. */}
          <MeetingsPanel
            jobId={id}
            parties={([
              job?.client_id ? { id: job.client_id, label: 'Client', role: 'client' } : null,
              (job as any)?.contractor_id ? { id: (job as any).contractor_id, label: 'Inspector', role: 'inspector' } : null,
            ].filter(Boolean)) as any}
          />

          <View style={auditCardStyle.timelineWrap}>
            <AuditTimeline
              jobId={id}
              asAdmin
              inline
              showHeader={false}
              emptyTitle="No events for this job yet"
              emptySubtitle="Changes will appear here in real time."
            />
          </View>
        </View>

        {/* ★ FLASH-REPORT-001: Admin entry to NCR/Flash Reports for this
            job. Admin acknowledges, resolves disputes, and closes reports.
            Re-uses the audit card's style sheet so visual rhythm stays
            consistent with the surrounding admin tools. */}
        <View style={auditCardStyle.card}>
          <View style={auditCardStyle.headerRow}>
            <View style={auditCardStyle.iconWrap}>
              <Ionicons name="warning-outline" size={18} color="#EF4444" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={auditCardStyle.title}>Flash Reports</Text>
              <Text style={auditCardStyle.sub}>
                NCRs raised by parties to this job, calibration, safety, defects, disputes
              </Text>
            </View>
            <TouchableOpacity
              style={auditCardStyle.viewFullBtn}
              activeOpacity={0.8}
              onPress={() => router.push(`/jobs/${id}/flash-reports` as any)}
            >
              <Text style={auditCardStyle.viewFullText}>Open</Text>
              <Ionicons name="arrow-forward" size={12} color="#7C3AED" />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* --- DRAFT VIEWER MODAL --- */}
      <Modal visible={viewerVisible} animationType="slide" transparent onRequestClose={() => setViewerVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(2, 4, 32, 0.95)', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: '#0A0D2C', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#1A1D3C', maxHeight: '80%' }}>
            <Text style={{ color: '#FFF', fontSize: 20, fontWeight: 'bold', marginBottom: 16 }}>Draft Inspection Report</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {reportPhotoUrl && (
                <Image
                  source={{ uri: reportPhotoUrl }}
                  style={{ width: '100%', height: 220, borderRadius: 8, marginBottom: 16, backgroundColor: '#1A1D3C' }}
                  resizeMode="cover"
                />
              )}
              <Text style={{ color: '#7C3AED', fontSize: 12, fontWeight: 'bold', marginBottom: 4, textTransform: 'uppercase' }}>Inspector Notes</Text>
              <Text style={{ color: '#94A3B8', fontSize: 15, lineHeight: 24 }} selectable>
                {renderNotesWithLinks(reportData?.notes)}
              </Text>
            </ScrollView>
            <TouchableOpacity
              style={{ backgroundColor: '#7C3AED', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 20 }}
              onPress={() => setViewerVisible(false)}
            >
              <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 16 }}>Close Viewer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </KeyboardAvoidingView>
  );
}

/* ── Styles ──────────────────────────────────── */
// ★ Phase 5 — Audit Trail inline card styles (locked NEXPEC theme)
const auditCardStyle = StyleSheet.create({
  card: {
    marginTop: 14,
    marginHorizontal: 12,
    backgroundColor: '#0A0E2E',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1A1F4E',
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1F4E',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(124,58,237,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.30)',
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: 0.2,
  },
  sub: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  viewFullBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(124,58,237,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.40)',
  },
  viewFullText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#7C3AED',
    letterSpacing: 0.4,
  },
  timelineWrap: {
    paddingTop: 4,
    paddingBottom: 8,
  },
});

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: SA.bg, paddingHorizontal: 16, paddingTop: 12 },
  center: { flex: 1, backgroundColor: SA.bg, justifyContent: 'center', alignItems: 'center' },

  jobTitle: { color: SA.text, fontSize: 22, fontWeight: '800', marginBottom: 8 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, marginBottom: 12 },
  statusText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  desc: { color: SA.textSec, fontSize: 14, lineHeight: 20, marginBottom: 16 },

  section: {
    backgroundColor: SA.surface, borderRadius: SA.radius,
    padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: SA.border,
  },
  sectionTitle: {
    color: SA.textSec, fontSize: 12, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12,
  },

  // Highlight banner for the CLIENT_SELECTED candidate (pre-dispatch, blue)
  gatekeeperBanner: {
    backgroundColor: 'rgba(59, 130, 246, 0.10)',
    borderColor: 'rgba(59, 130, 246, 0.45)',
    borderWidth: 1,
    padding: 14,
    borderRadius: 12,
    marginBottom: 14,
  },
  // ★ Post-dispatch banner — job is assigned / in progress / completed (green)
  activeInspectorBanner: {
    backgroundColor: 'rgba(16, 185, 129, 0.10)',
    borderColor: 'rgba(16, 185, 129, 0.45)',
    borderWidth: 1,
    padding: 14,
    borderRadius: 12,
    marginBottom: 14,
  },
  activeInspectorTitle: {
    color: '#10B981',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    flex: 1,
  },
  // ★ Yellow admin reply panel
  replyCard: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderColor: 'rgba(245, 158, 11, 0.45)',
    borderWidth: 1,
    padding: 14,
    borderRadius: 12,
    marginBottom: 14,
  },
  replyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  replyHeaderText: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  replyClientNote: {
    color: SA.text,
    fontSize: 14,
    fontStyle: 'italic',
    lineHeight: 20,
    marginBottom: 12,
  },
  replyLabel: {
    color: SA.textSec,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  replyInput: {
    backgroundColor: '#020420',
    borderColor: 'rgba(245, 158, 11, 0.35)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    color: SA.text,
    fontSize: 14,
    minHeight: 80,
    maxHeight: 160,
    lineHeight: 20,
    marginBottom: 10,
  },
  replyAttachmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  replyAttachmentChip: {
    flex: 1,
    minWidth: 140,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(245, 158, 11, 0.35)',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  replyAttachmentText: {
    flex: 1,
    color: SA.text,
    fontSize: 12,
  },
  replyAttachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.45)',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
  },
  replyAttachText: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '700',
  },
  replySendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#F59E0B',
  },
  replySendBtnDisabled: {
    opacity: 0.5,
  },
  replySendText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  replyDeliveredHint: {
    color: '#10B981',
    fontSize: 11,
    marginTop: 8,
    textAlign: 'center',
  },
  gatekeeperTitle: {
    color: '#3B82F6',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    flex: 1,
  },
  gatekeeperName: {
    color: SA.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  gatekeeperNote: {
    color: SA.textSec,
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 18,
  },

  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  infoLabel: { color: SA.textMuted, fontSize: 13, width: 90 },
  infoValue: { color: SA.text, fontSize: 13, fontWeight: '600', flex: 1 },

  spreadSection: {
    backgroundColor: SA.surface, borderRadius: SA.radius,
    padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: SA.accent + '40',
  },

  inputLabel: { color: SA.textSec, fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 4 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: SA.bg, borderRadius: SA.radiusSm,
    borderWidth: 1, borderColor: SA.border,
    paddingHorizontal: 12, marginBottom: 14,
  },
  inputPrefix: { color: SA.textMuted, fontSize: 16, fontWeight: '700', marginRight: 4 },
  input: { flex: 1, color: SA.text, fontSize: 16, fontWeight: '600', paddingVertical: 12 },

  spreadDisplay: {
    backgroundColor: SA.bg, borderRadius: SA.radiusSm,
    padding: 14, gap: 8,
  },
  spreadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  spreadLabel: { color: SA.textSec, fontSize: 13 },
  spreadValue: { fontSize: 18, fontWeight: '800' },

  payoutRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  payoutBtn: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1, borderColor: SA.border,
    backgroundColor: SA.bg,
  },
  payoutBtnText: { color: SA.textSec, fontSize: 12, fontWeight: '700' },

  actions: { gap: 12, marginTop: 8 },
  btnPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: SA.accent, borderRadius: SA.radiusSm,
    paddingVertical: 16,
  },
  btnPrimaryDisabled: {
    backgroundColor: SA.accent + '55',
  },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnSecondary: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: SA.surface, borderRadius: SA.radiusSm,
    paddingVertical: 14, borderWidth: 1, borderColor: SA.border,
  },
  btnSecondaryText: { color: SA.accent, fontSize: 15, fontWeight: '700' },

  emptyText: { color: SA.textMuted, fontSize: 14 },
  retryText: { color: SA.accent, fontWeight: '700', fontSize: 15 },
});