// ════════════════════════════════════════════════════════════════════════════
//  app/jobs/[id]/flash-reports/new.tsx
//  Raise a Flash Report / NCR against an active job.
// ════════════════════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft, AlertTriangle, Camera, FileText as FileIcon, X, ChevronRight,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

import {
  raiseFlashReport,
  CATEGORY_META, SEVERITY_META,
  type FlashReportCategory, type FlashReportSeverity,
} from '@/src/lib/flashReports';

const C = {
  bg: '#020420', card: '#0A0D2C', cardAlt: '#0F172A', border: '#1E293B',
  inputBg: '#0A0E2E', text: '#FFFFFF', textSec: '#94A3B8', textMuted: '#64748B',
  primary: '#7C3AED', primarySoft: 'rgba(124,58,237,0.14)',
  primaryBorder: 'rgba(124,58,237,0.40)',
  error: '#EF4444', errorSoft: 'rgba(239,68,68,0.10)', errorBorder: 'rgba(239,68,68,0.30)',
};

const CATEGORIES: FlashReportCategory[] = [
  'safety', 'calibration', 'documentation', 'procedure', 'defect',
  'client_interference', 'other',
];
const SEVERITIES: FlashReportSeverity[] = ['observation','minor','major','critical'];

interface PendingFile {
  kind: 'photo' | 'pdf' | 'document';
  uri: string;
  filename: string;
  mimeType: string;
}

export default function NewFlashReportScreen() {
  const router = useRouter();
  const { id: jobId } = useLocalSearchParams<{ id: string }>();

  const [category, setCategory] = useState<FlashReportCategory>('safety');
  const [severity, setSeverity] = useState<FlashReportSeverity>('major');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [locationText, setLocationText] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const titleErr = title.trim().length > 0 && title.trim().length < 8
    ? 'Title must be at least 8 characters'
    : null;
  const descErr = description.trim().length > 0 && description.trim().length < 20
    ? 'Description must be at least 20 characters'
    : null;
  const formValid =
    !titleErr && !descErr &&
    title.trim().length >= 8 &&
    description.trim().length >= 20;

  const pickPhoto = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Allow photo library access to attach evidence.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        allowsMultipleSelection: false,
      });
      if (result.canceled) return;
      const a = result.assets[0];
      setPendingFiles((prev) => [...prev, {
        kind: 'photo',
        uri: a.uri,
        filename: a.fileName ?? `photo-${Date.now()}.jpg`,
        mimeType: a.mimeType ?? 'image/jpeg',
      }]);
    } catch (e: any) {
      Alert.alert('Photo error', e?.message ?? 'Could not attach photo.');
    }
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*', 'application/*'],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const a = result.assets?.[0];
      if (!a) return;
      const kind: 'pdf' | 'document' = a.mimeType === 'application/pdf' ? 'pdf' : 'document';
      setPendingFiles((prev) => [...prev, {
        kind,
        uri: a.uri,
        filename: a.name,
        mimeType: a.mimeType ?? 'application/octet-stream',
      }]);
    } catch (e: any) {
      Alert.alert('Document error', e?.message ?? 'Could not attach document.');
    }
  };

  const removePending = (idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if (!jobId) return;
    if (!formValid) {
      Alert.alert('Incomplete', 'Please complete the title and description.');
      return;
    }

    setSubmitting(true);
    try {
      // Raise the report + all evidence as ONE offline-safe outbox op. Never a
      // direct write — with no signal it queues + retries instead of failing and
      // losing the NCR (the data-loss bug this fixes). #QA
      const { id, synced } = await raiseFlashReport(
        {
          jobId,
          category,
          severity,
          title: title.trim(),
          description: description.trim(),
          locationText: locationText.trim() || null,
        },
        pendingFiles.map((f) => ({
          kind: f.kind,
          localUri: f.uri,
          filename: f.filename,
          mimeType: f.mimeType,
        })),
      );

      if (synced) {
        // Landed on the server — open the report, exactly as before.
        router.replace(`/jobs/${jobId}/flash-reports/${id}` as any);
      } else {
        // Queued offline — confirm and return to the list; it syncs on reconnect.
        Alert.alert(
          'Saved — will sync when online',
          'This report and its evidence are queued and will upload automatically once you have a connection.',
          [{ text: 'OK', onPress: () => router.replace(`/jobs/${jobId}/flash-reports` as any) }],
        );
      }
    } catch (e: any) {
      Alert.alert('Could not raise report', e?.message ?? 'Unknown error.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => router.back()}
            hitSlop={10}
          >
            <ArrowLeft size={22} color={C.text} strokeWidth={2.2} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Raise Flash Report</Text>
            <Text style={styles.headerSub}>NCR / mid-job concern</Text>
          </View>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Severity */}
          <Text style={styles.label}>Severity</Text>
          <View style={styles.severityRow}>
            {SEVERITIES.map((s) => {
              const meta = SEVERITY_META[s];
              const on = severity === s;
              return (
                <TouchableOpacity
                  key={s}
                  onPress={() => setSeverity(s)}
                  activeOpacity={0.7}
                  style={[
                    styles.severityTile,
                    on && { backgroundColor: meta.bg, borderColor: meta.color },
                  ]}
                >
                  <Text
                    style={[
                      styles.severityTileTxt,
                      on && { color: meta.color },
                    ]}
                  >
                    {meta.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Category */}
          <Text style={styles.label}>Category</Text>
          <View style={styles.chipsWrap}>
            {CATEGORIES.map((cat) => {
              const on = category === cat;
              return (
                <TouchableOpacity
                  key={cat}
                  onPress={() => setCategory(cat)}
                  activeOpacity={0.7}
                  style={[styles.catChip, on && styles.catChipOn]}
                >
                  <Text style={[styles.catChipTxt, on && styles.catChipTxtOn]}>
                    {CATEGORY_META[cat].label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Title */}
          <Text style={styles.label}>Title</Text>
          <View style={[styles.inputWrap, titleErr && styles.inputErr]}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. UT machine calibration expired 2 days ago"
              placeholderTextColor={C.textMuted}
              maxLength={160}
              style={styles.input}
            />
          </View>
          {titleErr ? <Text style={styles.errTxt}>{titleErr}</Text> : (
            <Text style={styles.helper}>{title.length}/160</Text>
          )}

          {/* Description */}
          <Text style={styles.label}>Description</Text>
          <View style={[styles.inputWrap, descErr && styles.inputErr]}>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Describe what you observed, when it happened, and what the risk is."
              placeholderTextColor={C.textMuted}
              maxLength={5000}
              multiline
              numberOfLines={6}
              style={[styles.input, styles.textArea]}
              textAlignVertical="top"
            />
          </View>
          {descErr ? <Text style={styles.errTxt}>{descErr}</Text> : (
            <Text style={styles.helper}>{description.length}/5000</Text>
          )}

          {/* Location */}
          <Text style={styles.label}>Site reference (optional)</Text>
          <View style={styles.inputWrap}>
            <TextInput
              value={locationText}
              onChangeText={setLocationText}
              placeholder='e.g. "Tank T-201, north manway"'
              placeholderTextColor={C.textMuted}
              maxLength={200}
              style={styles.input}
            />
          </View>

          {/* Attachments */}
          <Text style={styles.label}>Evidence (optional)</Text>
          <View style={styles.attachRow}>
            <TouchableOpacity style={styles.attachBtn} onPress={pickPhoto} activeOpacity={0.7}>
              <Camera size={16} color={C.primary} strokeWidth={2.2} />
              <Text style={styles.attachBtnTxt}>Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachBtn} onPress={pickDocument} activeOpacity={0.7}>
              <FileIcon size={16} color={C.primary} strokeWidth={2.2} />
              <Text style={styles.attachBtnTxt}>PDF / Doc</Text>
            </TouchableOpacity>
          </View>

          {pendingFiles.length > 0 && (
            <View style={styles.pendingList}>
              {pendingFiles.map((f, i) => (
                <View key={`${f.uri}-${i}`} style={styles.pendingRow}>
                  {f.kind === 'photo'
                    ? <Camera size={14} color={C.textSec} strokeWidth={2} />
                    : <FileIcon size={14} color={C.textSec} strokeWidth={2} />}
                  <Text style={styles.pendingTxt} numberOfLines={1}>{f.filename}</Text>
                  <TouchableOpacity onPress={() => removePending(i)} hitSlop={8}>
                    <X size={14} color={C.textMuted} strokeWidth={2.4} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* Critical severity warning */}
          {severity === 'critical' && (
            <View style={styles.criticalNotice}>
              <AlertTriangle size={16} color={C.error} strokeWidth={2.2} />
              <Text style={styles.criticalNoticeTxt}>
                Critical reports raise an immediate alert in admin's audit
                trail. Use only for safety, integrity, or compliance issues
                that warrant stopping the job.
              </Text>
            </View>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>

        {/* Submit */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.submitBtn, (!formValid || submitting) && { opacity: 0.55 }]}
            disabled={!formValid || submitting}
            onPress={handleSubmit}
            activeOpacity={0.85}
          >
            {submitting
              ? <ActivityIndicator color={C.text} />
              : (<>
                  <Text style={styles.submitTxt}>Raise report</Text>
                  <ChevronRight size={16} color={C.text} strokeWidth={2.4} />
                </>)
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
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

  scroll: { padding: 16, paddingBottom: 24 },

  label: {
    color: C.textSec, fontSize: 13, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.4,
    marginTop: 18, marginBottom: 10,
  },

  severityRow: { flexDirection: 'row', gap: 8 },
  severityTile: {
    flex: 1,
    paddingVertical: 12, paddingHorizontal: 8,
    backgroundColor: C.cardAlt, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, alignItems: 'center',
  },
  severityTileTxt: { color: C.textSec, fontSize: 12, fontWeight: '700' },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catChip: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  catChipOn: { backgroundColor: C.primary, borderColor: C.primary },
  catChipTxt: { color: C.textSec, fontSize: 12, fontWeight: '600' },
  catChipTxtOn: { color: C.text },

  inputWrap: {
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
  },
  inputErr: { borderColor: C.errorBorder, backgroundColor: C.errorSoft },
  input: { color: C.text, fontSize: 14, padding: 0 },
  textArea: { minHeight: 120, textAlignVertical: 'top' },
  helper: { color: C.textMuted, fontSize: 11, marginTop: 6, alignSelf: 'flex-end' },
  errTxt: { color: C.error, fontSize: 12, marginTop: 6 },

  attachRow: { flexDirection: 'row', gap: 10 },
  attachBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: C.primarySoft,
    borderWidth: 1, borderColor: C.primaryBorder,
    borderRadius: 12, flex: 1, justifyContent: 'center',
  },
  attachBtnTxt: { color: C.text, fontSize: 13, fontWeight: '600' },

  pendingList: { marginTop: 12, gap: 8 },
  pendingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    borderRadius: 10,
  },
  pendingTxt: { flex: 1, color: C.text, fontSize: 12 },

  criticalNotice: {
    marginTop: 16, padding: 12,
    flexDirection: 'row', gap: 10,
    backgroundColor: C.errorSoft, borderWidth: 1, borderColor: C.errorBorder,
    borderRadius: 12,
  },
  criticalNoticeTxt: { flex: 1, color: C.text, fontSize: 12, lineHeight: 17 },

  footer: {
    padding: 16, paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg,
  },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, backgroundColor: C.primary, borderRadius: 999,
  },
  submitTxt: { color: C.text, fontSize: 15, fontWeight: '700' },
});
