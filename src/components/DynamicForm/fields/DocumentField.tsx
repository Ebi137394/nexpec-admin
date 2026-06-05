// src/components/DynamicForm/fields/DocumentField.tsx
//
// Custody-grade document upload, dropped into any DynamicForm. For the vendor it
// is one tap ("Upload document"). Underneath: read bytes → SHA-256 fingerprint →
// upload to the private vendor_documents bucket → vendor_document_seal() folds it
// into the Trust Spine (canonical-JSON seal) and enqueues OpenTimestamps. The
// field value carries the doc id + seal so the parent form can bind it.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import { FieldProps } from '../types';
import { NEXPEC_THEME } from '../theme';

const ALLOWED_MIME = [
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

interface DocValue {
  doc_id?: string; filename?: string; path: string; content_sha256: string;
  seal_sha256?: string; ots_status?: string; mime_type?: string; byte_size?: number | null;
}

export const DocumentField: React.FC<FieldProps> = ({ field, value, onChange, onBlur, error }) => {
  const { colors, spacing, borderRadius, fontSize } = NEXPEC_THEME;
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');

  const docType = (field as any).docType || 'other';
  const v: DocValue | null = value && typeof value === 'object' ? value : null;

  const pickAndSeal = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ALLOWED_MIME, copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      setBusy(true);

      setStage('Reading…');
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });

      setStage('Fingerprinting…');
      const contentSha = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64);

      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) { Alert.alert('Not signed in', 'Please sign in again.'); return; }

      const safeName = (asset.name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${uid}/${docType}/${Date.now()}_${safeName}`;
      const contentType = asset.mimeType || 'application/octet-stream';

      setStage('Uploading…');
      const { error: upErr } = await supabase.storage
        .from('vendor_documents')
        .upload(path, decode(base64), { contentType, upsert: false });
      if (upErr) { Alert.alert('Upload failed', upErr.message); return; }

      setStage('Sealing…');
      const { data: sealed, error: sealErr } = await supabase.rpc('vendor_document_seal', {
        p_storage_path: path,
        p_content_sha256: contentSha,
        p_doc_type: docType,
        p_title: asset.name ?? null,
        p_mime_type: contentType,
        p_byte_size: asset.size ?? null,
        p_bound_type: 'vendor',
        p_bound_id: uid,
      });
      if (sealErr) { Alert.alert('Seal failed', sealErr.message); return; }

      const next: DocValue = {
        doc_id: (sealed as any)?.id,
        filename: asset.name ?? 'Document',
        path,
        content_sha256: contentSha,
        seal_sha256: (sealed as any)?.seal_sha256,
        ots_status: (sealed as any)?.ots_status ?? 'pending',
        mime_type: contentType,
        byte_size: asset.size ?? null,
      };
      onChange(next);
      onBlur();
    } catch (e: any) {
      Alert.alert('Could not attach document', e?.message ?? 'Unknown error');
    } finally {
      setBusy(false); setStage('');
    }
  };

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={[styles.label, { color: colors.text, fontSize: fontSize.sm }]}>
        {field.label}{field.required ? ' *' : ''}
      </Text>
      {!!field.helperText && <Text style={[styles.helper, { color: colors.textMuted, fontSize: fontSize.xs }]}>{field.helperText}</Text>}

      {!v ? (
        <TouchableOpacity
          style={[styles.dropzone, { borderColor: error ? colors.error : colors.inputBorder, backgroundColor: colors.inputBackground, borderRadius: borderRadius.md }]}
          activeOpacity={0.85} onPress={pickAndSeal} disabled={busy}
        >
          {busy ? (
            <>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.dzText, { color: colors.textSecondary, fontSize: fontSize.sm }]}>{stage || 'Working…'}</Text>
            </>
          ) : (
            <>
              <Ionicons name="cloud-upload-outline" size={26} color={colors.primaryLight} />
              <Text style={[styles.dzText, { color: colors.text, fontSize: fontSize.sm }]}>Upload document</Text>
              <Text style={[styles.dzSub, { color: colors.textMuted, fontSize: fontSize.xs }]}>PDF, image or Office file, sealed on upload</Text>
            </>
          )}
        </TouchableOpacity>
      ) : (
        <View style={[styles.fileCard, { borderColor: colors.inputBorder, backgroundColor: colors.cardBackground, borderRadius: borderRadius.md }]}>
          <Ionicons name="document-text" size={22} color={colors.primaryLight} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.fileName, { color: colors.text, fontSize: fontSize.sm }]} numberOfLines={1}>{v.filename || 'Document'}</Text>
            <View style={styles.statusRow}>
              <Ionicons name="shield-checkmark" size={12} color={colors.success} />
              <Text style={[styles.statusTxt, { color: colors.success }]}>Sealed</Text>
              <Text style={[styles.dot, { color: colors.textMuted }]}>·</Text>
              {v.ots_status === 'bitcoin_confirmed' ? (
                <>
                  <Ionicons name="logo-bitcoin" size={12} color="#F59E0B" />
                  <Text style={[styles.statusTxt, { color: '#F59E0B' }]}>Bitcoin-anchored</Text>
                </>
              ) : (
                <>
                  <Ionicons name="time-outline" size={12} color="#F59E0B" />
                  <Text style={[styles.statusTxt, { color: '#F59E0B' }]}>Notarization pending</Text>
                </>
              )}
            </View>
            {!!v.seal_sha256 && (
              <Text style={[styles.hash, { color: colors.textMuted, fontSize: 10 }]} numberOfLines={1}>seal {String(v.seal_sha256).slice(0, 18)}…</Text>
            )}
          </View>
          <TouchableOpacity onPress={() => onChange(null)} hitSlop={8} disabled={busy}>
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {!!error && <Text style={[styles.err, { color: colors.error, fontSize: fontSize.xs }]}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  label: { fontWeight: '700', marginBottom: 6 },
  helper: { marginBottom: 8 },
  dropzone: { borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 24, paddingHorizontal: 16 },
  dzText: { fontWeight: '700' },
  dzSub: {},
  fileCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, padding: 12 },
  fileName: { fontWeight: '600' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  statusTxt: { fontSize: 11, fontWeight: '700' },
  dot: { fontSize: 11, marginHorizontal: 2 },
  hash: { marginTop: 3, fontVariant: ['tabular-nums'] },
  err: { marginTop: 6 },
});
