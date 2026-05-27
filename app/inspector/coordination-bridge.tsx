// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/coordination-bridge.tsx
//
//  COORDINATION BRIDGE — Sprint B · inspector mobile workspace.
//
//  Deep-link reachable at:
//    /inspector/coordination-bridge?job_id=<uuid>      (create new bridge)
//    /inspector/coordination-bridge?bridge_id=<uuid>   (open existing)
//
//  Flat-folder pattern matching submit-report.tsx / my-jobs.tsx /
//  seal-report.tsx already in app/inspector/.
//
//  Functions:
//    • If no bridge for the job: collect vendor info → bridge_create →
//      surface the raw token (one-time display) → trigger
//      bridge_send_invitation (emails the vendor) → show timeline.
//    • If bridge exists: render slots + documents from
//      bridge_fetch_for_inspector. Add document requests, propose
//      schedule, accept/reject vendor docs, copy invitation link,
//      rotate token, cancel/complete.
//
//  Locked theme: #020420 / #7C3AED.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  StatusBar,
  Alert,
  Modal,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import {
  ArrowLeft,
  Link as LinkIcon,
  Copy,
  Mail,
  Plus,
  Check,
  X,
  Calendar,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Lock,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';

const COLORS = {
  background: '#020420',
  primary: '#7C3AED',
  primaryDark: '#5B21B6',
  card: '#0F172A',
  cardBorder: '#1E293B',
  cardElevated: '#1E293B',
  textPrimary: '#F1F5F9',
  textMuted: '#94A3B8',
  textSubtle: '#64748B',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  accent: '#A78BFA',
};

const PORTAL_BASE_URL =
  process.env.EXPO_PUBLIC_BRIDGE_PORTAL_BASE_URL ?? 'https://app.nexpec.com/bridge';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────
interface InspectorBridgeView {
  bridge: {
    id: string;
    job_id: string;
    vendor_contact_id: string;
    inspector_id: string;
    client_id: string | null;
    status: string;
    token_expires_at: string;
    token_revoked_at: string | null;
    vendor_first_seen_at: string | null;
    vendor_last_seen_at: string | null;
    vendor_session_count: number;
    completed_at: string | null;
    cancelled_at: string | null;
    inspector_private_notes: string | null;
  };
  vendor: {
    id: string;
    company_name: string;
    contact_name: string | null;
    contact_email: string;
    timezone: string | null;
    language_code: string;
  };
  slots: BridgeSlot[];
  documents: BridgeDocument[];
}

interface BridgeSlot {
  id: string;
  kind: 'schedule' | 'document_request' | 'site_access' | 'pre_inspection_ack' | 'arrival_ack';
  status: 'pending' | 'awaiting_vendor' | 'awaiting_inspector' | 'completed' | 'rejected';
  title: string;
  description: string | null;
  required: boolean;
  sort_order: number;
  payload_json: Record<string, unknown>;
  created_at: string;
  last_action_at: string | null;
  last_action_by_actor_kind: string | null;
  completed_at: string | null;
  rejected_at: string | null;
  rejected_reason: string | null;
}

interface BridgeDocument {
  id: string;
  bridge_id: string;
  slot_id: string | null;
  uploaded_by_actor_kind: string;
  original_filename: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  sha256_client_computed: string;
  created_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
  rejected_reason: string | null;
}

export default function InspectorCoordinationBridgeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ job_id?: string; bridge_id?: string }>();
  const jobId = typeof params.job_id === 'string' ? params.job_id : '';
  const bridgeIdParam = typeof params.bridge_id === 'string' ? params.bridge_id : '';

  // If we have only job_id, look up the bridge (or surface the create form).
  const existingBridgeQuery = useQuery({
    queryKey: ['cb:existing', jobId, bridgeIdParam],
    enabled: !!(jobId || bridgeIdParam),
    queryFn: async (): Promise<string | null> => {
      if (bridgeIdParam) return bridgeIdParam;
      const { data, error } = await supabase
        .from('coordination_bridges')
        .select('id')
        .eq('job_id', jobId)
        .maybeSingle();
      if (error) throw error;
      return (data?.id as string | undefined) ?? null;
    },
  });

  const bridgeId = existingBridgeQuery.data ?? '';

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <Stack.Screen
        options={{
          title: 'Coordination Bridge',
          headerStyle: { backgroundColor: COLORS.background },
          headerTintColor: COLORS.textPrimary,
          headerTitleStyle: { color: COLORS.textPrimary, fontWeight: '600' },
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              hitSlop={8}
              style={({ pressed }) => [styles.headerBackBtn, pressed && { opacity: 0.6 }]}
            >
              <ArrowLeft size={22} color={COLORS.textPrimary} />
            </Pressable>
          ),
        }}
      />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {existingBridgeQuery.isLoading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        ) : bridgeId ? (
          <ExistingBridgeView bridgeId={bridgeId} />
        ) : jobId ? (
          <CreateBridgeForm jobId={jobId} />
        ) : (
          <View style={styles.emptyCard}>
            <AlertTriangle size={28} color={COLORS.warning} />
            <Text style={styles.emptyTitle}>Open from a job</Text>
            <Text style={styles.emptyBody}>
              Deep-link this screen with <Text style={styles.code}>?job_id=…</Text> to start
              coordinating with the vendor, or <Text style={styles.code}>?bridge_id=…</Text> to
              open an existing bridge.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Create-bridge form
// ─────────────────────────────────────────────────────────────────────
function CreateBridgeForm({ jobId }: { jobId: string }) {
  const queryClient = useQueryClient();
  const [company, setCompany] = useState('');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [tz, setTz] = useState('');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [createdBridgeId, setCreatedBridgeId] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: async (): Promise<{ bridge_id: string; raw_token: string }> => {
      const { data, error } = await supabase.rpc('bridge_create', {
        p_job_id: jobId,
        p_company_name: company.trim(),
        p_contact_name: contact.trim() || null,
        p_contact_email: email.trim(),
        p_contact_phone: phone.trim() || null,
        p_country_code: null,
        p_timezone: tz.trim() || null,
        p_language_code: 'en',
        p_token_ttl_days: 60,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return { bridge_id: row.bridge_id, raw_token: row.raw_token };
    },
    onSuccess: async ({ bridge_id, raw_token }) => {
      setCreatedToken(raw_token);
      setCreatedBridgeId(bridge_id);
      // Fire-and-forget the invitation email through the existing dispatcher.
      try {
        await supabase.rpc('bridge_send_invitation', {
          p_bridge_id: bridge_id,
          p_raw_token: raw_token,
          p_portal_base: PORTAL_BASE_URL,
        });
      } catch (e) {
        Alert.alert(
          'Bridge created, invitation queue failed',
          e instanceof Error ? e.message : 'Send the link manually from the next screen.',
        );
      }
      queryClient.invalidateQueries({ queryKey: ['cb:existing'] });
    },
    onError: (err) => {
      Alert.alert('Could not create bridge', err instanceof Error ? err.message : String(err));
    },
  });

  if (createdToken && createdBridgeId) {
    return <TokenJustCreatedView token={createdToken} bridgeId={createdBridgeId} />;
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.headerIconWrap}>
          <LinkIcon size={18} color={COLORS.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Open a Coordination Bridge</Text>
          <Text style={styles.cardSubtitle}>
            We'll email the vendor a private link to confirm dates, upload preliminary documents,
            and declare site access. No NEXPEC account required on their end.
          </Text>
        </View>
      </View>

      <View style={styles.divider} />

      <FormField label="Company name" value={company} onChange={setCompany} placeholder="ACME Manufacturing GmbH" />
      <FormField label="Contact name (optional)" value={contact} onChange={setContact} placeholder="Anna Schmidt" />
      <FormField label="Contact email" value={email} onChange={setEmail} keyboardType="email-address" placeholder="anna@acme-mfg.de" autoCapitalize="none" />
      <FormField label="Phone (optional)" value={phone} onChange={setPhone} keyboardType="phone-pad" placeholder="+49 211 …" />
      <FormField label="Timezone (IANA, optional)" value={tz} onChange={setTz} placeholder="Europe/Berlin" autoCapitalize="none" />

      <Pressable
        onPress={() => createMut.mutate()}
        disabled={createMut.isPending || !company.trim() || !email.trim()}
        style={({ pressed }) => [
          styles.primaryBtn,
          (createMut.isPending || !company.trim() || !email.trim()) && styles.primaryBtnDisabled,
          pressed && { opacity: 0.85 },
        ]}
      >
        {createMut.isPending ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            <Mail size={18} color="#FFFFFF" />
            <Text style={styles.primaryBtnText}>Send invitation</Text>
          </>
        )}
      </Pressable>

      <Text style={styles.footerHint}>
        The invitation link expires in 60 days. You can rotate or revoke it any time.
      </Text>
    </View>
  );
}

function TokenJustCreatedView({ token, bridgeId }: { token: string; bridgeId: string }) {
  const router = useRouter();
  const portalUrl = `${PORTAL_BASE_URL}/${token}`;
  const copy = useCallback(async () => {
    await Clipboard.setStringAsync(portalUrl);
    Alert.alert('Copied', 'Invitation link copied. You can paste it into a message if needed.');
  }, [portalUrl]);

  return (
    <View style={styles.card}>
      <View style={[styles.sealedBanner, { backgroundColor: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.25)' }]}>
        <ShieldCheck size={20} color={COLORS.success} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.sealedTitle, { color: COLORS.success }]}>Bridge created</Text>
          <Text style={styles.sealedSubtitle}>Vendor invitation queued for delivery.</Text>
        </View>
      </View>

      <Text style={styles.sectionHeader}>Magic link (one-time display)</Text>
      <View style={styles.hashBlock}>
        <Text selectable style={styles.hashValue}>{portalUrl}</Text>
        <Pressable onPress={copy} hitSlop={6} style={styles.ghostBtn}>
          <Copy size={14} color={COLORS.accent} />
          <Text style={styles.ghostBtnText}>Copy link</Text>
        </Pressable>
      </View>

      <Text style={styles.footerHint}>
        We'll never show this exact token again — we only store its hash. The vendor can re-open
        their portal from the invitation email at any time until the token expires.
      </Text>

      <Pressable
        onPress={() => router.setParams({ bridge_id: bridgeId, job_id: '' })}
        style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
      >
        <Text style={styles.primaryBtnText}>Open bridge workspace</Text>
      </Pressable>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Existing-bridge view
// ─────────────────────────────────────────────────────────────────────
function ExistingBridgeView({ bridgeId }: { bridgeId: string }) {
  const queryClient = useQueryClient();
  const stateQuery = useQuery({
    queryKey: ['cb:state', bridgeId],
    queryFn: async (): Promise<InspectorBridgeView> => {
      const { data, error } = await supabase.rpc('bridge_fetch_for_inspector', {
        p_bridge_id: bridgeId,
      });
      if (error) throw error;
      return data as InspectorBridgeView;
    },
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['cb:state', bridgeId] });
  }, [queryClient, bridgeId]);

  if (stateQuery.isLoading) {
    return (
      <View style={styles.loadingCard}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading bridge…</Text>
      </View>
    );
  }
  if (stateQuery.error) {
    return (
      <View style={styles.errorCard}>
        <AlertTriangle size={24} color={COLORS.danger} />
        <Text style={styles.errorTitle}>Failed to load</Text>
        <Text style={styles.errorBody}>{(stateQuery.error as Error).message}</Text>
      </View>
    );
  }
  const view = stateQuery.data;
  if (!view) return null;

  const isTerminal = view.bridge.status === 'completed' || view.bridge.status === 'cancelled';

  return (
    <View style={{ gap: 14 }}>
      <BridgeHeaderCard view={view} onRefresh={refresh} />
      {view.slots
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((slot) => (
          <InspectorSlotCard
            key={slot.id}
            slot={slot}
            documents={view.documents.filter((d) => d.slot_id === slot.id)}
            disabled={isTerminal}
            onMutate={refresh}
          />
        ))}
      {!isTerminal && (
        <AddDocumentRequestCard bridgeId={bridgeId} onAdded={refresh} />
      )}
      {!isTerminal && (
        <ProposeScheduleCard
          bridgeId={bridgeId}
          existingSlotId={view.slots.find((s) => s.kind === 'schedule')?.id}
          onProposed={refresh}
        />
      )}
      <BridgeAdminCard view={view} onMutate={refresh} />
    </View>
  );
}

function BridgeHeaderCard({ view, onRefresh }: { view: InspectorBridgeView; onRefresh: () => void }) {
  const expires = formatDate(view.bridge.token_expires_at);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.headerIconWrap}>
          <Lock size={18} color={COLORS.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{view.vendor.company_name}</Text>
          <Text style={styles.cardSubtitle}>
            {view.vendor.contact_name ? `${view.vendor.contact_name} · ` : ''}
            {view.vendor.contact_email}
          </Text>
        </View>
        <Pressable onPress={onRefresh} hitSlop={6} style={styles.iconBtn}>
          <RefreshCw size={16} color={COLORS.accent} />
        </Pressable>
      </View>

      <View style={styles.divider} />
      <KV label="Status" value={view.bridge.status} valueColor={statusColor(view.bridge.status)} />
      <KV label="Token expires" value={expires} />
      <KV
        label="Vendor sessions"
        value={String(view.bridge.vendor_session_count)}
      />
      {view.bridge.vendor_last_seen_at && (
        <KV label="Last seen" value={formatDate(view.bridge.vendor_last_seen_at)} />
      )}
    </View>
  );
}

function InspectorSlotCard({
  slot,
  documents,
  disabled,
  onMutate,
}: {
  slot: BridgeSlot;
  documents: BridgeDocument[];
  disabled: boolean;
  onMutate: () => void;
}) {
  // State-driven prompt for rejecting a vendor document. Replaces
  // Alert.prompt (iOS-only) with a cross-platform Modal so the reject
  // flow works on Android too. The rejection reason is required by the
  // RPC (>= 3 chars) and surfaces in the audit trail + vendor portal.
  const [rejectingDocId, setRejectingDocId] = useState<string | null>(null);

  const acceptMut = useMutation({
    mutationFn: async (documentId: string) => {
      const { error } = await supabase.rpc('bridge_accept_document', {
        p_document_id: documentId,
      });
      if (error) throw error;
    },
    onSuccess: onMutate,
    onError: (e) => Alert.alert('Failed', e instanceof Error ? e.message : String(e)),
  });
  const rejectMut = useMutation({
    mutationFn: async ({ documentId, reason }: { documentId: string; reason: string }) => {
      const { error } = await supabase.rpc('bridge_reject_document', {
        p_document_id: documentId,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setRejectingDocId(null);
      onMutate();
    },
    onError: (e) => Alert.alert('Failed', e instanceof Error ? e.message : String(e)),
  });

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kindLabel}>{labelForKind(slot.kind)}</Text>
          <Text style={styles.cardTitle}>{slot.title}</Text>
          {slot.description ? <Text style={styles.cardSubtitle}>{slot.description}</Text> : null}
        </View>
        <SlotPill status={slot.status} required={slot.required} />
      </View>

      {/* Schedule slot payload */}
      {slot.kind === 'schedule' && (
        <SchedulePayloadRow payload={slot.payload_json} status={slot.status} />
      )}

      {/* Document list (for document_request slots) */}
      {slot.kind === 'document_request' && (
        <View style={{ marginTop: 12, gap: 8 }}>
          {documents.length === 0 ? (
            <Text style={styles.subtleText}>No file uploaded yet.</Text>
          ) : (
            documents.map((d) => (
              <View key={d.id} style={styles.docRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.docName} numberOfLines={1}>{d.original_filename}</Text>
                  <Text style={styles.docMeta}>
                    {humanSize(d.file_size_bytes)} · SHA-256 {d.sha256_client_computed.slice(0, 14)}…
                  </Text>
                  {d.rejected_reason ? (
                    <Text style={[styles.docMeta, { color: COLORS.danger }]}>Rejected: {d.rejected_reason}</Text>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {d.accepted_at ? (
                    <Pill color={COLORS.success} label="ACCEPTED" />
                  ) : d.rejected_at ? (
                    <Pill color={COLORS.danger} label="REJECTED" />
                  ) : disabled ? null : (
                    <>
                      <Pressable
                        onPress={() => acceptMut.mutate(d.id)}
                        hitSlop={6}
                        style={[styles.smallBtn, { borderColor: COLORS.success }]}
                      >
                        <Check size={12} color={COLORS.success} />
                      </Pressable>
                      <Pressable
                        onPress={() => setRejectingDocId(d.id)}
                        hitSlop={6}
                        style={[styles.smallBtn, { borderColor: COLORS.danger }]}
                      >
                        <X size={12} color={COLORS.danger} />
                      </Pressable>
                    </>
                  )}
                </View>
              </View>
            ))
          )}
        </View>
      )}

      {/* Site access payload echo */}
      {slot.kind === 'site_access' && slot.payload_json?.declared_at ? (
        <View style={{ marginTop: 12 }}>
          <KV label="PPE" value={joinList(slot.payload_json?.ppe)} />
          <KV label="Escort" value={slot.payload_json?.escort_required ? 'Required' : 'Not required'} />
          <KV label="Badge" value={slot.payload_json?.badge_required ? 'Required' : 'Not required'} />
          <KV label="Entry hours" value={String(slot.payload_json?.entry_hours ?? '—')} />
          <KV label="Contact" value={String(slot.payload_json?.contact_on_arrival ?? '—')} />
        </View>
      ) : null}

      {/* Arrival signature echo */}
      {slot.kind === 'arrival_ack' && slot.status === 'completed' ? (
        <View style={{ marginTop: 12 }}>
          <KV label="Signed by" value={String(slot.payload_json?.typed_name ?? '—')} />
          <KV label="Signed at" value={formatDate(String(slot.payload_json?.signed_at ?? ''))} />
        </View>
      ) : null}

      {/* Reject-document prompt — cross-platform Modal (Alert.prompt is iOS-only). */}
      <ReasonPromptModal
        visible={rejectingDocId !== null}
        title="Reject document"
        description="Tell the vendor why this document is being rejected. They'll see your reason in their portal and can resubmit."
        minLength={3}
        busy={rejectMut.isPending}
        confirmLabel="Reject"
        onCancel={() => setRejectingDocId(null)}
        onSubmit={(text) => {
          if (rejectingDocId) {
            rejectMut.mutate({ documentId: rejectingDocId, reason: text });
          }
        }}
      />
    </View>
  );
}

function SchedulePayloadRow({ payload, status }: { payload: Record<string, unknown>; status: string }) {
  const proposed = payload?.proposed_at ? formatDate(String(payload.proposed_at)) : '—';
  const tz = payload?.timezone ? String(payload.timezone) : 'UTC';
  const proposedBy = String(payload?.proposed_by_kind ?? '—');
  return (
    <View style={{ marginTop: 12 }}>
      <KV label="Proposed" value={`${proposed} (${tz})`} />
      <KV label="By" value={proposedBy} />
      {status === 'completed' && payload?.agreed_at ? (
        <KV label="Agreed" value={formatDate(String(payload.agreed_at))} valueColor={COLORS.success} />
      ) : null}
    </View>
  );
}

function AddDocumentRequestCard({ bridgeId, onAdded }: { bridgeId: string; onAdded: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [required, setRequired] = useState(true);

  const mut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('bridge_add_document_request', {
        p_bridge_id: bridgeId,
        p_title: title.trim(),
        p_description: description.trim() || null,
        p_required: required,
        p_max_size_mb: 50,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setTitle('');
      setDescription('');
      onAdded();
    },
    onError: (e) => Alert.alert('Failed', e instanceof Error ? e.message : String(e)),
  });

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.headerIconWrap}>
          <Plus size={18} color={COLORS.accent} />
        </View>
        <Text style={styles.cardTitle}>Request a document</Text>
      </View>
      <FormField label="Title" value={title} onChange={setTitle} placeholder="Bill of Materials, latest revision" />
      <FormField label="Description (optional)" value={description} onChange={setDescription} multiline />
      <View style={styles.toggleRow}>
        <Pressable onPress={() => setRequired(!required)} hitSlop={6} style={styles.toggleWrap}>
          <View style={[styles.toggleBox, required && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }]}>
            {required && <Check size={12} color="#FFFFFF" />}
          </View>
          <Text style={styles.toggleLabel}>Required document</Text>
        </Pressable>
      </View>
      <Pressable
        disabled={mut.isPending || !title.trim()}
        onPress={() => mut.mutate()}
        style={({ pressed }) => [
          styles.primaryBtn,
          (mut.isPending || !title.trim()) && styles.primaryBtnDisabled,
          pressed && { opacity: 0.85 },
        ]}
      >
        {mut.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryBtnText}>Add request</Text>}
      </Pressable>
    </View>
  );
}

function ProposeScheduleCard({
  bridgeId,
  existingSlotId,
  onProposed,
}: {
  bridgeId: string;
  existingSlotId?: string;
  onProposed: () => void;
}) {
  const [iso, setIso] = useState('');
  const [tz, setTz] = useState('UTC');
  const [notes, setNotes] = useState('');

  const mut = useMutation({
    mutationFn: async () => {
      const dt = new Date(iso);
      if (Number.isNaN(dt.getTime())) {
        throw new Error('Enter a valid ISO datetime, e.g. 2026-06-15T09:00');
      }
      const { error } = await supabase.rpc('bridge_propose_schedule', {
        p_bridge_id: bridgeId,
        p_proposed_at: dt.toISOString(),
        p_timezone: tz.trim() || 'UTC',
        p_notes: notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setIso('');
      setNotes('');
      onProposed();
    },
    onError: (e) => Alert.alert('Failed', e instanceof Error ? e.message : String(e)),
  });

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.headerIconWrap}>
          <Calendar size={18} color={COLORS.accent} />
        </View>
        <Text style={styles.cardTitle}>{existingSlotId ? 'Update inspection date' : 'Propose inspection date'}</Text>
      </View>
      <FormField label="ISO date-time (local, e.g. 2026-06-15T09:00)" value={iso} onChange={setIso} autoCapitalize="none" />
      <FormField label="Timezone (IANA)" value={tz} onChange={setTz} autoCapitalize="none" />
      <FormField label="Notes (optional)" value={notes} onChange={setNotes} multiline />
      <Pressable
        disabled={mut.isPending || !iso.trim()}
        onPress={() => mut.mutate()}
        style={({ pressed }) => [
          styles.primaryBtn,
          (mut.isPending || !iso.trim()) && styles.primaryBtnDisabled,
          pressed && { opacity: 0.85 },
        ]}
      >
        {mut.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryBtnText}>Propose date</Text>}
      </Pressable>
    </View>
  );
}

function BridgeAdminCard({ view, onMutate }: { view: InspectorBridgeView; onMutate: () => void }) {
  const isTerminal = view.bridge.status === 'completed' || view.bridge.status === 'cancelled';
  // Cross-platform prompt state for cancel-with-reason (Alert.prompt is iOS-only).
  const [cancelPromptVisible, setCancelPromptVisible] = useState(false);

  const rotateMut = useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc('bridge_rotate_token', {
        p_bridge_id: view.bridge.id,
        p_token_ttl_days: 60,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return String(row.raw_token);
    },
    onSuccess: async (raw) => {
      // Re-send the invitation with the new token.
      try {
        await supabase.rpc('bridge_send_invitation', {
          p_bridge_id: view.bridge.id,
          p_raw_token: raw,
          p_portal_base: PORTAL_BASE_URL,
        });
      } catch (e) {
        Alert.alert('Token rotated', `Send the new link manually if the email fails: ${PORTAL_BASE_URL}/${raw}`);
      }
      onMutate();
    },
    onError: (e) => Alert.alert('Failed', e instanceof Error ? e.message : String(e)),
  });

  const completeMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('bridge_complete', { p_bridge_id: view.bridge.id });
      if (error) throw error;
    },
    onSuccess: onMutate,
    onError: (e) => Alert.alert('Failed', e instanceof Error ? e.message : String(e)),
  });

  const cancelMut = useMutation({
    mutationFn: async (reason: string) => {
      const { error } = await supabase.rpc('bridge_cancel', {
        p_bridge_id: view.bridge.id,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setCancelPromptVisible(false);
      onMutate();
    },
    onError: (e) => Alert.alert('Failed', e instanceof Error ? e.message : String(e)),
  });

  if (isTerminal) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Bridge is {view.bridge.status}</Text>
        <Text style={styles.cardSubtitle}>No further actions available.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Bridge controls</Text>
      <Pressable
        onPress={() => rotateMut.mutate()}
        disabled={rotateMut.isPending}
        style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.85 }]}
      >
        <RefreshCw size={14} color={COLORS.accent} />
        <Text style={styles.secondaryBtnText}>Rotate magic link &amp; resend</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          Alert.alert('Mark complete?', 'This closes the Bridge and revokes the vendor link.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Complete', style: 'default', onPress: () => completeMut.mutate() },
          ]);
        }}
        disabled={completeMut.isPending}
        style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.85 }]}
      >
        <ShieldCheck size={14} color={COLORS.success} />
        <Text style={[styles.secondaryBtnText, { color: COLORS.success }]}>Mark bridge complete</Text>
      </Pressable>
      <Pressable
        onPress={() => setCancelPromptVisible(true)}
        disabled={cancelMut.isPending}
        style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.85 }]}
      >
        <X size={14} color={COLORS.danger} />
        <Text style={[styles.secondaryBtnText, { color: COLORS.danger }]}>Cancel bridge</Text>
      </Pressable>

      {/* Cancel-with-reason prompt — cross-platform Modal. */}
      <ReasonPromptModal
        visible={cancelPromptVisible}
        title="Cancel bridge"
        description="Provide a reason for cancelling. This revokes the vendor's magic link immediately and is recorded in the audit trail."
        minLength={0}
        busy={cancelMut.isPending}
        confirmLabel="Cancel bridge"
        onCancel={() => setCancelPromptVisible(false)}
        onSubmit={(text) => cancelMut.mutate(text)}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Atoms
// ─────────────────────────────────────────────────────────────────────
function FormField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        placeholderTextColor={COLORS.textSubtle}
        multiline={props.multiline}
        keyboardType={props.keyboardType ?? 'default'}
        autoCapitalize={props.autoCapitalize ?? 'sentences'}
        style={[styles.fieldInput, props.multiline && { minHeight: 72, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

function KV({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={[styles.kvValue, valueColor ? { color: valueColor } : undefined]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function SlotPill({ status, required }: { status: string; required: boolean }) {
  const color =
    status === 'completed'
      ? COLORS.success
      : status === 'rejected'
      ? COLORS.danger
      : status === 'awaiting_inspector'
      ? COLORS.primary
      : status === 'awaiting_vendor'
      ? COLORS.warning
      : COLORS.textMuted;
  const label =
    status === 'awaiting_inspector'
      ? 'YOUR TURN'
      : status === 'awaiting_vendor'
      ? 'AWAITING VENDOR'
      : status.toUpperCase().replace(/_/g, ' ');
  return <Pill color={color} label={`${label}${required ? '' : ' · OPT'}`} />;
}

function Pill({ color, label }: { color: string; label: string }) {
  return (
    <View style={[styles.pill, { borderColor: color + '55', backgroundColor: color + '18' }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

function labelForKind(kind: BridgeSlot['kind']): string {
  switch (kind) {
    case 'schedule': return 'INSPECTION DATE';
    case 'document_request': return 'DOCUMENT REQUEST';
    case 'site_access': return 'SITE ACCESS';
    case 'pre_inspection_ack': return 'PRE-INSPECTION';
    case 'arrival_ack': return 'ARRIVAL SIGN-OFF';
    default: return 'SLOT';
  }
}

function statusColor(s: string): string {
  switch (s) {
    case 'completed': return COLORS.success;
    case 'cancelled': return COLORS.danger;
    case 'in_progress': return COLORS.primary;
    case 'pending_invite': return COLORS.warning;
    case 'ready_for_inspection': return COLORS.success;
    default: return COLORS.textPrimary;
  }
}

function joinList(v: unknown): string {
  if (Array.isArray(v)) return v.map(String).join(', ') || '—';
  if (typeof v === 'string') return v || '—';
  return '—';
}

function humanSize(b: number | null | undefined): string {
  if (b == null) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ─────────────────────────────────────────────────────────────────────
// ReasonPromptModal — cross-platform replacement for Alert.prompt
//
// React Native's Alert.prompt is iOS-only. On Android the optional-chain
// call would silently no-op, breaking the reject-document and cancel-
// bridge flows. This modal works identically on both platforms.
// ─────────────────────────────────────────────────────────────────────
function ReasonPromptModal({
  visible,
  title,
  description,
  minLength,
  busy,
  confirmLabel,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  title: string;
  description: string;
  minLength?: number;
  busy?: boolean;
  confirmLabel?: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (visible) setText('');
  }, [visible]);

  const min = minLength ?? 0;
  const trimmed = text.trim();
  const isValid = min === 0 || trimmed.length >= min;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={modalStyles.backdrop}>
        <View style={modalStyles.card}>
          <Text style={modalStyles.title}>{title}</Text>
          <Text style={modalStyles.description}>{description}</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            placeholder={min > 0 ? `At least ${min} characters…` : 'Type your reason (optional)…'}
            placeholderTextColor={COLORS.textSubtle}
            style={modalStyles.input}
          />
          <View style={modalStyles.actions}>
            <Pressable
              onPress={onCancel}
              disabled={busy}
              style={({ pressed }) => [
                modalStyles.cancelBtn,
                pressed && { opacity: 0.7 },
                busy && { opacity: 0.5 },
              ]}
            >
              <Text style={modalStyles.cancelText}>Back</Text>
            </Pressable>
            <Pressable
              onPress={() => onSubmit(trimmed)}
              disabled={busy || !isValid}
              style={({ pressed }) => [
                modalStyles.confirmBtn,
                (busy || !isValid) && { opacity: 0.5 },
                pressed && !busy && isValid && { opacity: 0.85 },
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={modalStyles.confirmText}>{confirmLabel ?? 'Confirm'}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 4, 32, 0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: COLORS.card,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
  },
  title: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '600' },
  description: { color: COLORS.textMuted, fontSize: 13, marginTop: 6, lineHeight: 19 },
  input: {
    marginTop: 14,
    minHeight: 96,
    backgroundColor: COLORS.cardElevated,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: COLORS.textPrimary,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16, justifyContent: 'flex-end' },
  cancelBtn: {
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
  },
  cancelText: { color: COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  confirmBtn: {
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    minWidth: 100,
    alignItems: 'center',
  },
  confirmText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
});

// ─────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  headerBackBtn: { paddingHorizontal: 6, paddingVertical: 6 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40, gap: 14 },

  loadingCard: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  loadingText: { color: COLORS.textMuted, fontSize: 14 },

  errorCard: {
    backgroundColor: COLORS.card,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    gap: 8,
  },
  errorTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '600' },
  errorBody: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 19 },

  emptyCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '600' },
  emptyBody: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 19 },

  card: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: 'rgba(124, 58, 237, 0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtn: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: 'rgba(124, 58, 237, 0.12)',
    borderWidth: 1, borderColor: 'rgba(124, 58, 237, 0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '600' },
  cardSubtitle: { color: COLORS.textMuted, fontSize: 13, marginTop: 2, lineHeight: 19 },
  kindLabel: {
    color: COLORS.accent, fontSize: 10, fontWeight: '700',
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.cardBorder, marginVertical: 14 },
  sectionHeader: {
    color: COLORS.textSubtle, fontSize: 11, fontWeight: '700',
    letterSpacing: 1, textTransform: 'uppercase', marginTop: 14, marginBottom: 8,
  },

  fieldLabel: {
    color: COLORS.textSubtle, fontSize: 11, fontWeight: '700',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6,
  },
  fieldInput: {
    backgroundColor: COLORS.cardElevated,
    borderColor: COLORS.cardBorder, borderWidth: 1,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    color: COLORS.textPrimary, fontSize: 14,
  },

  kvRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, gap: 12 },
  kvLabel: { color: COLORS.textSubtle, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8 },
  kvValue: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },

  primaryBtn: {
    marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: COLORS.primary, paddingVertical: 14, borderRadius: 12, minHeight: 48,
  },
  primaryBtnDisabled: { backgroundColor: COLORS.primaryDark, opacity: 0.5 },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600', letterSpacing: 0.3 },

  secondaryBtn: {
    marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10,
    backgroundColor: 'rgba(124, 58, 237, 0.08)', borderWidth: 1, borderColor: 'rgba(124, 58, 237, 0.3)',
  },
  secondaryBtnText: { color: COLORS.accent, fontSize: 13, fontWeight: '600' },

  footerHint: { marginTop: 12, color: COLORS.textMuted, fontSize: 12, lineHeight: 18 },

  sealedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 6,
  },
  sealedTitle: { fontSize: 15, fontWeight: '700', letterSpacing: 0.4 },
  sealedSubtitle: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },

  hashBlock: {
    marginTop: 14, backgroundColor: COLORS.cardElevated,
    borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: 10, padding: 14, gap: 8,
  },
  hashValue: { color: COLORS.accent, fontSize: 12, fontFamily: 'Menlo', lineHeight: 18 },
  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8,
    backgroundColor: 'rgba(124, 58, 237, 0.12)',
    borderColor: 'rgba(124, 58, 237, 0.3)', borderWidth: 1, alignSelf: 'flex-start',
  },
  ghostBtnText: { color: COLORS.accent, fontSize: 12, fontWeight: '600' },

  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },

  docRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.cardElevated, borderColor: COLORS.cardBorder, borderWidth: 1,
    borderRadius: 10, padding: 10,
  },
  docName: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '600' },
  docMeta: { color: COLORS.textMuted, fontSize: 11, marginTop: 2, fontFamily: 'Menlo' },
  smallBtn: {
    width: 28, height: 28, borderRadius: 8, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  subtleText: { color: COLORS.textSubtle, fontSize: 12, fontStyle: 'italic' },

  toggleRow: { marginTop: 12 },
  toggleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggleBox: {
    width: 20, height: 20, borderRadius: 6,
    borderWidth: 1, borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.cardElevated,
    alignItems: 'center', justifyContent: 'center',
  },
  toggleLabel: { color: COLORS.textPrimary, fontSize: 13 },

  code: { fontFamily: 'Menlo', color: COLORS.accent },
});
