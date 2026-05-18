// ════════════════════════════════════════════════════════════════════════════
//  app/post-compliance-job.tsx
//
//  STEP 4 — Buyer compliance-job post flow
//
//  The Quality and Compliance tracks share the same `jobs` table but
//  have distinct post UX, distinct evidence pipelines, and distinct
//  inspector pools. The schema's `jobs_compliance_requires_template`
//  CHECK constraint enforces that a compliance job ALWAYS has a
//  scope_template_id (and a quality job NEVER does), so this screen
//  is the sole entry point that produces compliance rows.
//
//  Sections, top to bottom:
//    1. Scope template picker — cards rendered from
//       inspection_scope_templates WHERE is_active. Each card shows
//       the per-scope requirement count, validity window, base price,
//       and required CCI tier.
//    2. Subject (supplier) details — name + a claimed-address field
//       with a "Use current GPS" capture button that fills lat/lng.
//       The claimed_address_geocoded geography(Point,4326) column is
//       set via EWKT text so PostGIS parses it on insert.
//    3. Optional supplier documents — at job-post time the buyer can
//       pre-attach the supplier's trade license, tax cert, etc. We
//       insert the job row first, then upload to
//       compliance/documents/<job_id>/... and insert
//       compliance_documents rows referencing each.
//    4. Submit.
//
//  RLS path:
//    • Insert into jobs: buyer is the row's client_id (if role=client)
//      or agency_id (if role=agency); both have INSERT via existing
//      jobs RLS.
//    • Insert into compliance_documents: WITH CHECK enforces
//      uploaded_by = auth.uid() AND auth.uid() is a job party.
//    • Storage uploads under compliance/documents/<job_id>/... are
//      gated by the policies in 20260514100200_compliance_documents_storage.sql.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  Building2,
  CheckCircle2,
  ChevronLeft,
  ClipboardList,
  FileBadge,
  FileText,
  Link2,
  MapPin,
  Navigation,
  Plus,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import { captureCurrentLocation } from '@/src/utils/locationCapture';

// ─────────────────────────────────────────────────────────────
//  Palette (matches the rest of the dark-theme buyer flow)
// ─────────────────────────────────────────────────────────────
const C = {
  bg: '#020420', card: '#0A0E2A', cardLift: '#0F1538', border: '#1A1F4A',
  primary: '#7C3AED', primarySoft: '#A78BFA',
  primaryDim: 'rgba(124,58,237,0.14)',
  text: '#FFFFFF', textSec: '#CBD5F5', textDim: '#64748B',
  ok: '#10B981', warn: '#F59E0B', danger: '#EF4444', amber: '#FBBF24',
  cyan: '#06B6D4',
};

type Tier = 'cci_basic' | 'cci_advanced' | 'cci_lead';

interface ScopeTemplate {
  id: string;
  slug: string;
  name: string;
  version: number;
  category: string;
  region: string;
  validity_months: number;
  base_price_cents: number;
  requires_credential_tier: Tier;
  description_md: string | null;
  requirements_count: number;
}

interface PendingDoc {
  localUri: string;
  /** Tag the buyer picks so admin OCR can validate against expectation. */
  doc_type: 'trade_license' | 'tax_certificate' | 'chamber_extract' | 'other';
}

/**
 * External link evidence — Google Drive / Dropbox / OneDrive / video host.
 * Used when an artifact is too heavy to push through our compliance bucket.
 * Inserted into compliance_documents with `document_url` populated and
 * `storage_path` left NULL (the new migration allows that).
 */
interface PendingLink {
  url: string;
  doc_type: PendingDoc['doc_type'];
}

const DOC_TYPES: { key: PendingDoc['doc_type']; label: string }[] = [
  { key: 'trade_license',   label: 'Trade License' },
  { key: 'tax_certificate', label: 'Tax Certificate' },
  { key: 'chamber_extract', label: 'Chamber of Commerce' },
  { key: 'other',           label: 'Other' },
];

// ─────────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────────
export default function PostComplianceJobScreen() {
  const router = useRouter();
  const { user, role } = useAuth();
  const isClient = role === 'client';
  const isAgency = role === 'agency' || role === 'enterprise';

  // ─── Scope templates ────────────────────────────────────
  const [templates, setTemplates] = useState<ScopeTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId]
  );

  // ─── Subject (supplier) ─────────────────────────────────
  const [supplierName, setSupplierName] = useState('');
  const [claimedAddress, setClaimedAddress] = useState('');
  const [contextNote, setContextNote] = useState('');
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number | null } | null>(null);
  const [gpsCapturing, setGpsCapturing] = useState(false);

  // ─── Documents (file upload track) ──────────────────────
  const [pendingDocs, setPendingDocs] = useState<PendingDoc[]>([]);
  const [pendingDocType, setPendingDocType] = useState<PendingDoc['doc_type']>('trade_license');

  // ─── External Links track (URLs for heavy artifacts) ───
  const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([]);
  const [linkDraft, setLinkDraft] = useState('');

  // ─── Submit ─────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);

  // ─── Bootstrap: fetch active scope templates + per-template counts ───
  const fetchTemplates = useCallback(async () => {
    try {
      const { data: t, error: tErr } = await supabase
        .from('inspection_scope_templates')
        .select('*')
        .eq('is_active', true)
        .order('category')
        .order('name');
      if (tErr) throw tErr;
      const rows = (t ?? []) as Omit<ScopeTemplate, 'requirements_count'>[];

      const ids = rows.map((r) => r.id);
      let counts: Record<string, number> = {};
      if (ids.length) {
        const { data: r } = await supabase
          .from('inspection_evidence_requirements')
          .select('template_id')
          .in('template_id', ids);
        counts = (r ?? []).reduce<Record<string, number>>((acc, row: any) => {
          acc[row.template_id] = (acc[row.template_id] ?? 0) + 1;
          return acc;
        }, {});
      }
      setTemplates(rows.map((r) => ({ ...r, requirements_count: counts[r.id] ?? 0 })));
    } catch (e: any) {
      console.error('[post-compliance-job] fetch templates failed:', e);
      Alert.alert('Error', e?.message ?? 'Could not load scope templates.');
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  // ─── GPS capture ────────────────────────────────────────
  const onCaptureGps = async () => {
    setGpsCapturing(true);
    try {
      const loc = await captureCurrentLocation();
      if (loc) {
        setGps({ lat: loc.latitude, lng: loc.longitude, accuracy: loc.accuracy });
        if (!claimedAddress && loc.formattedAddress) {
          setClaimedAddress(loc.formattedAddress);
        }
      }
    } catch (e) {
      console.warn('[post-compliance-job] gps capture failed:', e);
    } finally {
      setGpsCapturing(false);
    }
  };

  // ─── Document pick / remove ─────────────────────────────
  const onPickDoc = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to attach a document.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      base64: false,
    });
    if (!res.canceled && res.assets[0]) {
      setPendingDocs((prev) => [...prev, { localUri: res.assets[0].uri, doc_type: pendingDocType }]);
    }
  };
  const removeDoc = (idx: number) => setPendingDocs((prev) => prev.filter((_, i) => i !== idx));

  // ─── External Link add / remove ────────────────────────
  // Lightweight client-side URL sanity: must look like http(s). The
  // CHECK constraint on compliance_documents.document_url enforces the
  // same shape server-side, so any bad input also fails the insert.
  const onAddLink = () => {
    const raw = linkDraft.trim();
    if (!raw) return;
    const ok = /^https?:\/\//i.test(raw);
    if (!ok) {
      Alert.alert(
        'Invalid link',
        'External links must start with http:// or https:// (e.g. a Google Drive or Dropbox share URL).',
      );
      return;
    }
    setPendingLinks((prev) => [...prev, { url: raw, doc_type: pendingDocType }]);
    setLinkDraft('');
  };
  const removeLink = (idx: number) =>
    setPendingLinks((prev) => prev.filter((_, i) => i !== idx));

  // ─── Validation gate ────────────────────────────────────
  const canSubmit =
    !!user?.id &&
    (isClient || isAgency) &&
    !!selected &&
    supplierName.trim().length >= 2 &&
    claimedAddress.trim().length >= 6;

  // ─── Submit ─────────────────────────────────────────────
  const onSubmit = async () => {
    if (!canSubmit || !selected || !user?.id) return;
    setSubmitting(true);
    try {
      // 1) Compose the job row. inspection_type='compliance' +
      //    scope_template_id satisfies the jobs_compliance_requires_template
      //    CHECK constraint. We populate claimed_address_geocoded only
      //    when GPS was captured — null is acceptable until the inspector
      //    pins it at site visit time.
      const title = `${selected.name} — ${supplierName.trim()}`;
      const ownerField: Record<string, string | null> = isClient
        ? { client_id: user.id, agency_id: null }
        : { client_id: null, agency_id: user.id };

      const geocoded = gps ? `SRID=4326;POINT(${gps.lng} ${gps.lat})` : null;

      const insertPayload: Record<string, unknown> = {
        ...ownerField,
        title,
        description: contextNote.trim() || null,
        location: claimedAddress.trim(),
        status: 'pending_approval',
        inspection_type: 'compliance',
        scope_template_id: selected.id,
        claimed_address_text: claimedAddress.trim(),
        claimed_address_geocoded: geocoded,
        client_price_cents: selected.base_price_cents,
      };

      const { data: jobRow, error: jobErr } = await supabase
        .from('jobs')
        .insert(insertPayload)
        .select('id')
        .single();
      if (jobErr) throw jobErr;

      const jobId = jobRow.id as string;

      // 2) Upload pending documents (best-effort; partial failures don't
      //    block the job's existence — admin can ask supplier to resend).
      const uploadFailures: number[] = [];
      for (let i = 0; i < pendingDocs.length; i++) {
        const doc = pendingDocs[i];
        try {
          const stamp = Date.now() + i;
          const remotePath = `documents/${jobId}/${stamp}-${doc.doc_type}.jpg`;
          const resp = await fetch(doc.localUri);
          const blob = await resp.blob();
          const { error: upErr } = await supabase.storage
            .from('compliance')
            .upload(remotePath, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
          if (upErr) throw upErr;

          const { error: docErr } = await supabase
            .from('compliance_documents')
            .insert({
              job_id: jobId,
              doc_type: doc.doc_type,
              storage_path: remotePath,
              uploaded_by: user.id,
              uploader_role: isClient ? 'client' : 'agency',
              verification_status: 'pending',
            });
          if (docErr) throw docErr;
        } catch (e) {
          console.warn(`[post-compliance-job] doc ${i} upload failed:`, e);
          uploadFailures.push(i);
        }
      }

      // 3) Insert external-link evidence rows. These do NOT touch storage —
      //    they live in compliance_documents with `document_url` populated
      //    and `storage_path` NULL (allowed by the new
      //    compliance_documents_has_pointer constraint).
      const linkFailures: number[] = [];
      for (let i = 0; i < pendingLinks.length; i++) {
        const lk = pendingLinks[i];
        try {
          const { error: linkErr } = await supabase
            .from('compliance_documents')
            .insert({
              job_id: jobId,
              doc_type: lk.doc_type,
              storage_path: null,
              document_url: lk.url,
              uploaded_by: user.id,
              uploader_role: isClient ? 'client' : 'agency',
              verification_status: 'pending',
            });
          if (linkErr) throw linkErr;
        } catch (e) {
          console.warn(`[post-compliance-job] link ${i} insert failed:`, e);
          linkFailures.push(i);
        }
      }

      const totalFailures = uploadFailures.length + linkFailures.length;
      if (totalFailures) {
        Alert.alert(
          'Job posted with partial attachments',
          `${totalFailures} evidence item(s) failed to attach. You can re-attach them later from the job details screen.`
        );
      } else {
        Alert.alert(
          'Compliance job posted',
          `${selected.name} dispatched to NEXPEC admin for CCI assignment. You will be notified when an inspector accepts.`
        );
      }
      router.replace(`/jobs/${jobId}` as any);
    } catch (e: any) {
      console.error('[post-compliance-job] submit failed:', e);
      Alert.alert('Error', e?.message ?? 'Failed to post the compliance job.');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────
  return (
    <SafeAreaView style={s.bg} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.backBtn}>
          <ChevronLeft size={22} color={C.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Compliance Verification</Text>
          <Text style={s.headerSub}>Post a regulator-grade inspection</Text>
        </View>
        <View style={s.shieldWrap}>
          <ShieldCheck size={18} color={C.primarySoft} />
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }}>
          {/* Intro card */}
          <View style={s.introCard}>
            <ClipboardList size={20} color={C.primarySoft} />
            <Text style={s.introTitle}>What's different about a compliance job</Text>
            <Text style={s.introBody}>
              Only Compliance-Certified Inspectors (CCIs) at the required tier can accept this work.
              The inspector follows a structured evidence checklist on site, with tamper-evident
              capture and GPS verification. You receive a Verified Compliance Affidavit (VCA) with
              a public verify URL.
            </Text>
          </View>

          {/* SECTION 1: Scope template */}
          <Section title="1 · Choose Scope" icon={FileBadge}>
            {templatesLoading ? (
              <ActivityIndicator color={C.primary} />
            ) : templates.length === 0 ? (
              <Text style={s.emptyHint}>No active scope templates. Ask an admin to publish one.</Text>
            ) : (
              templates.map((t) => {
                const on = selectedTemplateId === t.id;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => setSelectedTemplateId(t.id)}
                    style={[s.scopeCard, on && s.scopeCardOn]}
                  >
                    <View style={s.scopeTopRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.scopeName}>{t.name}</Text>
                        <Text style={s.scopeSlug}>{t.slug} · v{t.version}</Text>
                      </View>
                      {on && <CheckCircle2 size={18} color={C.primarySoft} />}
                    </View>
                    {!!t.description_md && (
                      <Text style={s.scopeDesc} numberOfLines={3}>{t.description_md}</Text>
                    )}
                    <View style={s.scopeBadges}>
                      <Badge label={`${t.requirements_count} reqs`} tint={C.cyan} />
                      <Badge label={`$${(t.base_price_cents / 100).toFixed(0)}`} tint={C.ok} />
                      <Badge label={`${t.validity_months}-mo validity`} tint={C.primarySoft} />
                      <Badge label={tierLabel(t.requires_credential_tier)} tint={C.warn} />
                    </View>
                  </Pressable>
                );
              })
            )}
          </Section>

          {/* SECTION 2: Supplier details */}
          <Section title="2 · Subject / Supplier" icon={Building2}>
            <Text style={s.fieldLabel}>Supplier name</Text>
            <TextInput
              value={supplierName}
              onChangeText={setSupplierName}
              style={s.input}
              placeholder="e.g., Acme Trading FZE"
              placeholderTextColor={C.textDim}
            />

            <Text style={[s.fieldLabel, { marginTop: 12 }]}>Claimed address</Text>
            <TextInput
              value={claimedAddress}
              onChangeText={setClaimedAddress}
              style={[s.input, { minHeight: 64, textAlignVertical: 'top' }]}
              multiline
              placeholder="Full street address as the supplier represents it"
              placeholderTextColor={C.textDim}
            />

            <Pressable onPress={onCaptureGps} disabled={gpsCapturing} style={s.gpsBtn}>
              {gpsCapturing
                ? <ActivityIndicator color={C.primarySoft} />
                : <><Navigation size={14} color={C.primarySoft} /><Text style={s.gpsBtnText}>
                    {gps ? 'Re-capture device GPS' : 'Use device GPS as initial pin'}
                  </Text></>}
            </Pressable>
            {gps && (
              <View style={s.gpsResult}>
                <MapPin size={12} color={C.ok} />
                <Text style={s.gpsResultText}>
                  {gps.lat.toFixed(6)}, {gps.lng.toFixed(6)}
                  {gps.accuracy != null ? ` · ±${Math.round(gps.accuracy)}m` : ''}
                </Text>
              </View>
            )}
            <Text style={s.gpsFootnote}>
              The inspector will re-pin GPS on site at each evidence-requirement step; this
              initial pin is what the platform cross-checks against.
            </Text>

            <Text style={[s.fieldLabel, { marginTop: 14 }]}>Context note (optional)</Text>
            <TextInput
              value={contextNote}
              onChangeText={setContextNote}
              style={[s.input, { minHeight: 64, textAlignVertical: 'top' }]}
              multiline
              placeholder="Anything the inspector should know before the visit."
              placeholderTextColor={C.textDim}
            />
          </Section>

          {/* SECTION 3: Documents */}
          <Section title="3 · Supplier Documents (Optional)" icon={FileText}>
            <Text style={s.fieldHelp}>
              Pre-attach trade license, tax certificate, or chamber-of-commerce extract. Admin
              will OCR + verify the documents against your scope.
            </Text>

            <Text style={[s.fieldLabel, { marginTop: 10 }]}>Document type for next upload</Text>
            <View style={s.docTypeRow}>
              {DOC_TYPES.map((d) => (
                <Pressable
                  key={d.key}
                  onPress={() => setPendingDocType(d.key)}
                  style={[s.docTypeChip, pendingDocType === d.key && s.docTypeChipOn]}
                >
                  <Text style={[s.docTypeText, pendingDocType === d.key && s.docTypeTextOn]}>
                    {d.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable onPress={onPickDoc} style={s.uploadBtn}>
              <Upload size={16} color={C.primarySoft} />
              <Text style={s.uploadBtnText}>Attach {DOC_TYPES.find((d) => d.key === pendingDocType)?.label}</Text>
            </Pressable>

            {pendingDocs.length > 0 && (
              <View style={s.docList}>
                {pendingDocs.map((d, i) => (
                  <View key={i} style={s.docRow}>
                    <Image source={{ uri: d.localUri }} style={s.docThumb} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.docRowTitle}>{DOC_TYPES.find((t) => t.key === d.doc_type)?.label}</Text>
                      <Text style={s.docRowSub}>Ready to upload on submit</Text>
                    </View>
                    <Pressable onPress={() => removeDoc(i)} hitSlop={8} style={s.docRemove}>
                      <X size={14} color={C.danger} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            {/* ─── External Link evidence ─────────────────────────────
                For artifacts too heavy for our compliance bucket:
                Google Drive, Dropbox, OneDrive, video host URLs. Stored
                in compliance_documents.document_url and surfaced on the
                public affidavit as "External Evidence". */}
            <View style={s.linkDivider}>
              <View style={s.linkDividerLine} />
              <Text style={s.linkDividerText}>OR ATTACH EXTERNAL LINK</Text>
              <View style={s.linkDividerLine} />
            </View>

            <Text style={s.fieldHelp}>
              For heavy files (large PDFs, video, etc.), paste a Google Drive,
              Dropbox, or OneDrive share link. The link is recorded on the
              affidavit as "External Evidence" and shown on the public verify
              page.
            </Text>

            <View style={s.linkInputRow}>
              <View style={s.linkInputIcon}>
                <Link2 size={14} color={C.primarySoft} />
              </View>
              <TextInput
                value={linkDraft}
                onChangeText={setLinkDraft}
                style={s.linkInput}
                placeholder="https://drive.google.com/..."
                placeholderTextColor={C.textDim}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="done"
                onSubmitEditing={onAddLink}
              />
              <Pressable onPress={onAddLink} style={s.linkAddBtn} hitSlop={6}>
                <Plus size={14} color="#FFF" />
              </Pressable>
            </View>

            {pendingLinks.length > 0 && (
              <View style={s.docList}>
                {pendingLinks.map((lk, i) => (
                  <View key={i} style={s.docRow}>
                    <View style={s.linkBadge}>
                      <Link2 size={16} color={C.cyan} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.docRowTitle} numberOfLines={1}>
                        {DOC_TYPES.find((t) => t.key === lk.doc_type)?.label} · External
                      </Text>
                      <Text style={s.docRowLink} numberOfLines={1}>{lk.url}</Text>
                    </View>
                    <Pressable onPress={() => removeLink(i)} hitSlop={8} style={s.docRemove}>
                      <X size={14} color={C.danger} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </Section>

          {/* Submit */}
          <Pressable
            onPress={onSubmit}
            disabled={!canSubmit || submitting}
            style={[s.submit, (!canSubmit || submitting) && { opacity: 0.5 }]}
          >
            {submitting
              ? <ActivityIndicator color="#FFF" />
              : <Text style={s.submitText}>
                  Post Compliance Job{selected ? ` · $${(selected.base_price_cents / 100).toFixed(0)}` : ''}
                </Text>}
          </Pressable>
          {!canSubmit && (
            <Text style={s.submitHint}>
              Pick a scope, enter the supplier name, and provide the claimed address to continue.
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────
const Section: React.FC<{ title: string; icon: any; children: React.ReactNode }> =
  ({ title, icon: Icon, children }) => (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <View style={s.sectionIcon}><Icon size={14} color={C.primarySoft} /></View>
        <Text style={s.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );

const Badge: React.FC<{ label: string; tint: string }> = ({ label, tint }) => (
  <View style={[s.badge, { borderColor: tint + '66', backgroundColor: tint + '14' }]}>
    <Text style={[s.badgeText, { color: tint }]}>{label}</Text>
  </View>
);

const tierLabel = (t: Tier) => ({ cci_basic: 'CCI BASIC', cci_advanced: 'CCI ADVANCED', cci_lead: 'CCI LEAD' }[t]);

// ─────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    justifyContent: 'center', alignItems: 'center',
  },
  shieldWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.primaryDim, borderWidth: 1, borderColor: 'rgba(124,58,237,0.45)',
    justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { color: C.text, fontSize: 16, fontWeight: '800' },
  headerSub: { color: C.textDim, fontSize: 11, marginTop: 1 },

  introCard: {
    backgroundColor: C.primaryDim, borderColor: 'rgba(124,58,237,0.45)',
    borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 16, gap: 6,
  },
  introTitle: { color: C.text, fontSize: 14, fontWeight: '800' },
  introBody: { color: C.textSec, fontSize: 12, lineHeight: 17 },

  section: {
    backgroundColor: C.card, borderColor: C.border, borderWidth: 1,
    borderRadius: 14, padding: 14, marginBottom: 14,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionIcon: {
    width: 26, height: 26, borderRadius: 8,
    backgroundColor: C.primaryDim, justifyContent: 'center', alignItems: 'center',
  },
  sectionTitle: {
    color: C.textDim, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase',
  },

  fieldLabel: {
    color: C.textSec, fontSize: 11, fontWeight: '700',
    letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 6,
  },
  fieldHelp: { color: C.textDim, fontSize: 12, lineHeight: 17 },
  input: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 14,
  },
  emptyHint: { color: C.textDim, fontSize: 12, paddingVertical: 12, fontStyle: 'italic' },

  // Scope cards
  scopeCard: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    borderRadius: 12, padding: 12, marginBottom: 10,
  },
  scopeCardOn: { borderColor: C.primary, backgroundColor: C.primaryDim },
  scopeTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  scopeName: { color: C.text, fontSize: 14, fontWeight: '800' },
  scopeSlug: { color: C.textDim, fontSize: 11, marginTop: 1, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) as any },
  scopeDesc: { color: C.textSec, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  scopeBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },

  badge: { borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },

  // GPS
  gpsBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 10, marginTop: 10,
    backgroundColor: C.primaryDim, borderWidth: 1, borderColor: 'rgba(124,58,237,0.45)',
  },
  gpsBtnText: { color: C.primarySoft, fontSize: 12, fontWeight: '800' },
  gpsResult: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  gpsResultText: { color: C.ok, fontSize: 11, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) as any },
  gpsFootnote: { color: C.textDim, fontSize: 11, marginTop: 6, fontStyle: 'italic', lineHeight: 16 },

  // Documents
  docTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  docTypeChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.bg,
  },
  docTypeChipOn: { backgroundColor: C.primaryDim, borderColor: C.primary },
  docTypeText: { color: C.textDim, fontSize: 11, fontWeight: '700' },
  docTypeTextOn: { color: C.primarySoft },

  uploadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.bg, borderWidth: 1, borderStyle: 'dashed', borderColor: C.primary + '88',
    borderRadius: 12, paddingVertical: 12,
  },
  uploadBtnText: { color: C.primarySoft, fontSize: 13, fontWeight: '700' },
  docList: { marginTop: 10, gap: 8 },
  docRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    padding: 10,
  },
  docThumb: { width: 40, height: 40, borderRadius: 6, backgroundColor: C.cardLift },
  docRowTitle: { color: C.text, fontSize: 12, fontWeight: '700' },
  docRowSub: { color: C.textDim, fontSize: 10, marginTop: 2 },
  docRowLink: {
    color: C.cyan, fontSize: 10, marginTop: 2,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) as any,
  },

  // External-link divider + input row.
  linkDivider: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 16, marginBottom: 10,
  },
  linkDividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  linkDividerText: {
    color: C.textDim, fontSize: 10, fontWeight: '800',
    letterSpacing: 0.8,
  },
  linkInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 6,
  },
  linkInputIcon: {
    width: 32, height: 38, borderRadius: 8,
    backgroundColor: C.primaryDim, borderWidth: 1, borderColor: 'rgba(124,58,237,0.45)',
    justifyContent: 'center', alignItems: 'center',
  },
  linkInput: {
    flex: 1,
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 9, color: C.text, fontSize: 12,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) as any,
  },
  linkAddBtn: {
    width: 38, height: 38, borderRadius: 8,
    backgroundColor: C.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  linkBadge: {
    width: 40, height: 40, borderRadius: 6,
    backgroundColor: 'rgba(6,182,212,0.14)',
    borderWidth: 1, borderColor: 'rgba(6,182,212,0.32)',
    justifyContent: 'center', alignItems: 'center',
  },
  docRemove: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: 'rgba(239,68,68,0.12)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.32)',
    justifyContent: 'center', alignItems: 'center',
  },

  submit: {
    marginTop: 6, backgroundColor: C.primary,
    paddingVertical: 14, borderRadius: 12, alignItems: 'center',
  },
  submitText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  submitHint: { color: C.textDim, fontSize: 11, marginTop: 8, textAlign: 'center' },
});
