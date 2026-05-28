// ════════════════════════════════════════════════════════════════════════════
//  src/shared-ui/auth/RecoveryCodesModal.tsx
//
//  Sprint 13.M2 — one-time display of MFA recovery codes on mobile.
//
//  Mirrors the web CodesBlock UX (copy all / acknowledge before continuing).
//  Codes are never persisted client-side — the regenerate_recovery_codes RPC
//  returns plaintext once and stores only sha256 hashes.
// ════════════════════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

const COLORS = {
  bg: 'rgba(2,4,32,0.92)',
  card: '#0F172A',
  border: '#1F2937',
  borderViolet: 'rgba(124,58,237,0.40)',
  borderAmber: 'rgba(251,191,36,0.36)',
  amberSoft: 'rgba(251,191,36,0.08)',
  violet: '#7C3AED',
  violetLight: '#A78BFA',
  violetSoft: 'rgba(124,58,237,0.12)',
  text: '#F1F5F9',
  textMuted: '#94A3B8',
  textDim: '#64748B',
  emerald: '#10B981',
  amber: '#FBBF24',
};

interface Props {
  visible: boolean;
  codes: string[];
  onClose: () => void;
}

export function RecoveryCodesModal({ visible, codes, onClose }: Props) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);

  // Reset on close so a future open starts clean.
  React.useEffect(() => {
    if (!visible) {
      setAcknowledged(false);
      setCopied(false);
    }
  }, [visible]);

  async function onCopyAll() {
    try {
      await Clipboard.setStringAsync(codes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (err) {
      Alert.alert(
        'Copy failed',
        err instanceof Error ? err.message : 'Clipboard unavailable.',
      );
    }
  }

  function onDone() {
    if (!acknowledged) return;
    onClose();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.kicker}>Recovery codes · save now</Text>
                <Text style={styles.title}>
                  These are your only way back in
                </Text>
                <Text style={styles.body}>
                  Each code may be used ONCE if you lose access to your
                  authenticator app. They will not be shown again.
                </Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.codesGrid}>
              {codes.map((c, i) => (
                <View key={c} style={styles.codeChip}>
                  <Text style={styles.codeIndex}>
                    {String(i + 1).padStart(2, '0')}
                  </Text>
                  <Text style={styles.codeText}>{c}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity onPress={onCopyAll} style={styles.copyBtn}>
              <Ionicons
                name={copied ? 'checkmark' : 'copy-outline'}
                size={16}
                color={COLORS.violetLight}
              />
              <Text style={styles.copyText}>
                {copied ? 'Copied to clipboard' : 'Copy all 10 codes'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.ackRow}
              activeOpacity={0.8}
              onPress={() => setAcknowledged((v) => !v)}
            >
              <Ionicons
                name={acknowledged ? 'checkbox' : 'square-outline'}
                size={22}
                color={
                  acknowledged ? COLORS.violetLight : COLORS.textMuted
                }
              />
              <Text style={styles.ackText}>
                I have saved my recovery codes in a secure location
                (password manager, encrypted file, printed and stored
                offline).
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onDone}
              disabled={!acknowledged}
              style={[
                styles.doneBtn,
                !acknowledged && styles.doneBtnDisabled,
              ]}
            >
              <Text
                style={[
                  styles.doneText,
                  !acknowledged && styles.doneTextDisabled,
                ]}
              >
                Done
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.bg,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.borderAmber,
    borderBottomWidth: 0,
    maxHeight: '92%',
  },
  scroll: {
    padding: 20,
    paddingBottom: 40,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  kicker: {
    color: COLORS.amber,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  title: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  body: {
    color: COLORS.textMuted,
    fontSize: 13,
    lineHeight: 18,
    maxWidth: 280,
  },
  closeBtn: {
    height: 32,
    width: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  codesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  codeChip: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'rgba(255,255,255,0.02)',
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  codeIndex: {
    color: COLORS.textDim,
    fontSize: 10,
    fontWeight: '700',
    marginRight: 6,
    letterSpacing: 0.6,
  },
  codeText: {
    color: COLORS.text,
    fontSize: 14,
    letterSpacing: 1.4,
    fontVariant: ['tabular-nums'],
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderViolet,
    backgroundColor: COLORS.violetSoft,
    gap: 8,
    marginBottom: 18,
  },
  copyText: {
    color: COLORS.violetLight,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  ackRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderAmber,
    backgroundColor: COLORS.amberSoft,
    marginBottom: 16,
  },
  ackText: {
    flex: 1,
    color: COLORS.text,
    fontSize: 12,
    lineHeight: 17,
    marginLeft: 10,
  },
  doneBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.violet,
    alignItems: 'center',
  },
  doneBtnDisabled: {
    backgroundColor: 'rgba(124,58,237,0.18)',
  },
  doneText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  doneTextDisabled: {
    color: COLORS.textMuted,
  },
});
