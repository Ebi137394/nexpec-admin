// ════════════════════════════════════════════════════════════════════════════
//  src/shared-ui/auth/MfaRecoveryCodesCard.tsx
//
//  Sprint 13.M2 — recovery-codes management card for the mobile security
//  screen. Mirrors the web MfaSection's recovery-codes lane.
//
//  Self-fetching:
//    • On mount + whenever the enabled prop flips, counts the user's
//      unused codes in public.auth_recovery_codes via direct SELECT
//      (RLS gates to the row owner).
//
//  Three render states, all gated by the `enabled` prop:
//    1. enabled = false        → renders nothing (2FA must be on first)
//    2. enabled, no codes      → "Generate recovery codes" CTA
//    3. enabled, N codes       → status + "Regenerate codes" CTA
//
//  Generate / regenerate both call the regenerate_recovery_codes RPC
//  shipped in migration 20260702120000_auth_recovery_codes.sql. Plaintext
//  codes are surfaced once via <RecoveryCodesModal/> then discarded.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { RecoveryCodesModal } from './RecoveryCodesModal';

const COLORS = {
  background: '#020420',
  surface: '#0F172A',
  surfaceLight: '#1E293B',
  border: '#1F2937',
  borderViolet: 'rgba(124,58,237,0.30)',
  primary: '#7C3AED',
  primaryLight: '#8B5CF6',
  primaryBg: 'rgba(124,58,237,0.12)',
  green: '#10B981',
  greenBg: 'rgba(16,185,129,0.12)',
  amber: '#FBBF24',
  amberBg: 'rgba(251,191,36,0.12)',
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
};

interface Props {
  /** True when the user has a verified TOTP factor. */
  enabled: boolean;
  /** Optional callback fired after a successful regenerate. */
  onCodesRegenerated?: () => void;
}

export function MfaRecoveryCodesCard({
  enabled,
  onCodesRegenerated,
}: Props) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [modalCodes, setModalCodes] = useState<string[]>([]);
  const [modalVisible, setModalVisible] = useState(false);

  const fetchCount = useCallback(async () => {
    if (!enabled) {
      setRemaining(null);
      return;
    }
    setLoadingCount(true);
    try {
      const { count, error } = await supabase
        .from('auth_recovery_codes')
        .select('id', { count: 'exact', head: true })
        .is('used_at', null);
      if (error) {
        console.warn('[MfaRecoveryCodesCard] count error', error.message);
        setRemaining(0);
      } else {
        setRemaining(count ?? 0);
      }
    } catch (err) {
      console.warn('[MfaRecoveryCodesCard] count threw', err);
      setRemaining(0);
    } finally {
      setLoadingCount(false);
    }
  }, [enabled]);

  useEffect(() => {
    void fetchCount();
  }, [fetchCount]);

  function confirmRegenerate(message: string, onConfirm: () => void) {
    Alert.alert('Recovery codes', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Continue',
        style: 'destructive',
        onPress: onConfirm,
      },
    ]);
  }

  async function generateCodes() {
    setGenerating(true);
    try {
      const { data, error } = await supabase.rpc(
        'regenerate_recovery_codes',
      );
      if (error) throw error;
      const codes = (data ?? []) as string[];
      if (codes.length === 0) {
        throw new Error('No codes returned from the server.');
      }
      setModalCodes(codes);
      setModalVisible(true);
      onCodesRegenerated?.();
    } catch (err) {
      Alert.alert(
        'Error',
        err instanceof Error
          ? err.message
          : 'Could not generate recovery codes.',
      );
    } finally {
      setGenerating(false);
    }
  }

  if (!enabled) return null;

  const isFirstGeneration = remaining === 0 || remaining === null;

  return (
    <>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.iconWrap}>
            <Ionicons
              name="key-outline"
              size={20}
              color={COLORS.primaryLight}
            />
          </View>
          <View style={styles.headerTextWrap}>
            <Text style={styles.title}>Recovery codes</Text>
            <Text style={styles.subtitle}>
              {isFirstGeneration
                ? 'Generate single-use codes so you can sign in if you lose access to your authenticator app.'
                : `${remaining} code${remaining === 1 ? '' : 's'} remaining. Each may be used once.`}
            </Text>
          </View>
        </View>

        {/* Status pill row */}
        <View style={styles.statusRow}>
          {loadingCount ? (
            <ActivityIndicator size="small" color={COLORS.primaryLight} />
          ) : (
            <View
              style={[
                styles.pill,
                isFirstGeneration ? styles.pillIdle : styles.pillOk,
              ]}
            >
              <Ionicons
                name={
                  isFirstGeneration
                    ? 'alert-circle-outline'
                    : 'shield-checkmark'
                }
                size={12}
                color={
                  isFirstGeneration ? COLORS.amber : COLORS.green
                }
              />
              <Text
                style={[
                  styles.pillText,
                  isFirstGeneration
                    ? styles.pillTextIdle
                    : styles.pillTextOk,
                ]}
              >
                {isFirstGeneration
                  ? 'No codes yet'
                  : `${remaining}/10 unused`}
              </Text>
            </View>
          )}
          {!loadingCount && remaining !== null && remaining < 3 && remaining > 0 && (
            <View style={[styles.pill, styles.pillWarn]}>
              <Text style={[styles.pillText, styles.pillTextWarn]}>
                Low, regenerate soon
              </Text>
            </View>
          )}
        </View>

        {/* Action button */}
        <TouchableOpacity
          style={[styles.actionBtn, generating && styles.actionBtnDisabled]}
          disabled={generating}
          onPress={() => {
            if (isFirstGeneration) {
              void generateCodes();
            } else {
              confirmRegenerate(
                'Regenerate recovery codes? Any existing codes will be invalidated immediately.',
                () => void generateCodes(),
              );
            }
          }}
        >
          {generating ? (
            <ActivityIndicator size="small" color={COLORS.textPrimary} />
          ) : (
            <>
              <Ionicons
                name={isFirstGeneration ? 'add-circle' : 'refresh'}
                size={16}
                color={COLORS.textPrimary}
              />
              <Text style={styles.actionBtnText}>
                {isFirstGeneration
                  ? 'Generate recovery codes'
                  : 'Regenerate codes'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <RecoveryCodesModal
        visible={modalVisible}
        codes={modalCodes}
        onClose={() => {
          setModalVisible(false);
          setModalCodes([]);
          void fetchCount();
        }}
      />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    marginTop: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  headerTextWrap: {
    flex: 1,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 3,
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    minHeight: 22,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    gap: 4,
  },
  pillIdle: {
    borderColor: 'rgba(251,191,36,0.30)',
    backgroundColor: COLORS.amberBg,
  },
  pillOk: {
    borderColor: 'rgba(16,185,129,0.30)',
    backgroundColor: COLORS.greenBg,
  },
  pillWarn: {
    borderColor: 'rgba(251,191,36,0.30)',
    backgroundColor: COLORS.amberBg,
  },
  pillText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  pillTextIdle: { color: COLORS.amber },
  pillTextOk: { color: COLORS.green },
  pillTextWarn: { color: COLORS.amber },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  actionBtnDisabled: {
    backgroundColor: COLORS.primaryBg,
  },
  actionBtnText: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
