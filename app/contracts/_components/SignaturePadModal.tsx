// app/contracts/_components/SignaturePadModal.tsx
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Full-screen digital signature capture.
//
//  • Uses `react-native-signature-canvas` (which uses
//    `react-native-webview` under the hood) for the actual
//    drawing surface.
//  • On confirm, stores the signature as a base64 data URI
//    directly in the contract row (client_signature or
//    contractor_signature) — easiest to render later, no
//    storage round-trip.
//  • Auto-promotes contract status:
//      draft   → pending_signature
//      either side already signed → active
//
//  Install once:
//      npx expo install react-native-signature-canvas react-native-webview
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ActivityIndicator,
  Alert,
  StatusBar,
  Platform,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import SignatureScreen from 'react-native-signature-canvas';
import {
  X,
  PenLine,
  ShieldCheck,
  RotateCcw,
  Sparkles,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';

// ── Brand (mirrors contracts hub) ──
const C = {
  bg: '#020420',
  primary: '#7C3AED',
  primaryDeep: '#5B21B6',
  primaryBright: '#9333EA',
  primaryGlow: 'rgba(124, 58, 237, 0.22)',
  cyan: '#00FFFF',
  cyanGlow: 'rgba(0, 255, 255, 0.16)',
  cyanBorder: 'rgba(0, 255, 255, 0.30)',
  surface: 'rgba(255, 255, 255, 0.03)',
  surfaceElev: '#0A0E2E',
  surfaceCard: '#0E1438',
  border: 'rgba(255, 255, 255, 0.06)',
  borderStrong: 'rgba(124, 58, 237, 0.32)',
  text: '#FFFFFF',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textDim: '#475569',
  success: '#10F995',
  warning: '#F59E0B',
  danger: '#EF4444',
};

interface ContractLite {
  id: string;
  client_id: string;
  contractor_id: string;
  status?: string | null;
  total_amount_cents?: number | null;     // ★ Task 4
  client_signature?: string | null;
  contractor_signature?: string | null;
  client?: { full_name?: string | null; company_name?: string | null } | null;
  contractor?: {
    full_name?: string | null;
    company_name?: string | null;
  } | null;
}

// ★ Task 4: input is integer CENTS — divide by 100 first.
const formatMoney = (cents?: number | null) => {
  if (cents == null || !Number.isFinite(Number(cents))) return '$0';
  return `$${(Number(cents) / 100).toLocaleString()}`;
};

// HTML/CSS injected into the signature WebView so the canvas
// blends with our dark theme.
const WEB_STYLE = `
  body, html { background: #0E1438 !important; margin: 0; padding: 0; }
  .m-signature-pad {
    box-shadow: none !important;
    border: none !important;
    border-radius: 0 !important;
    background: #0E1438 !important;
  }
  .m-signature-pad--body {
    border: none !important;
    background: #0E1438 !important;
  }
  .m-signature-pad--body canvas {
    background: #0E1438 !important;
  }
  .m-signature-pad--footer {
    display: none !important;
  }
`;

export default function SignaturePadModal({
  visible,
  contract,
  userId,
  onClose,
  onSigned,
}: {
  visible: boolean;
  contract: ContractLite | null;
  userId: string | null;
  onClose: () => void;
  onSigned: () => void;
}) {
  const insets = useSafeAreaInsets();
  const sigRef = useRef<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hasInk, setHasInk] = useState(false);

  // Reset on every open
  useEffect(() => {
    if (visible) {
      setHasInk(false);
      setSubmitting(false);
      // tiny delay so the WebView is mounted before we touch it
      setTimeout(() => {
        try {
          sigRef.current?.clearSignature?.();
        } catch {}
      }, 60);
    }
  }, [visible]);

  if (!contract || !userId) return null;

  const meIsClient = userId === contract.client_id;
  const counterpartName =
    (meIsClient
      ? contract.contractor?.full_name || contract.contractor?.company_name
      : contract.client?.full_name || contract.client?.company_name) ||
    (meIsClient ? 'Contractor' : 'Client');
  const myRoleLabel = meIsClient ? 'CLIENT' : 'CONTRACTOR';

  const handleOK = useCallback(
    async (signatureBase64: string) => {
      if (!contract || !userId) return;
      if (!signatureBase64 || signatureBase64.length < 100) {
        // sanity guard against accidental empty captures
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
          () => {},
        );
        Alert.alert('Signature too small', 'Try again with a longer mark.');
        return;
      }
      setSubmitting(true);
      try {
        const nowIso = new Date().toISOString();
        const updates: Record<string, any> = {};
        if (meIsClient) {
          updates.client_signature = signatureBase64;
          updates.client_signed_at = nowIso;
        } else {
          updates.contractor_signature = signatureBase64;
          updates.contractor_signed_at = nowIso;
        }
        // Auto-advance status
        const otherAlreadySigned = meIsClient
          ? !!contract.contractor_signature
          : !!contract.client_signature;
        if (otherAlreadySigned) {
          updates.status = 'active';
        } else if (contract.status === 'draft') {
          updates.status = 'pending_signature';
        }

        const { error } = await supabase
          .from('contracts')
          .update(updates)
          .eq('id', contract.id);
        if (error) throw error;

        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => {});

        Alert.alert(
          'Signed ✓',
          otherAlreadySigned
            ? 'Both parties have now signed. The contract is active.'
            : `Your signature is locked in. We'll notify ${counterpartName.split(' ')[0]} to sign.`,
        );
        onSigned();
        onClose();
      } catch (e: any) {
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        ).catch(() => {});
        Alert.alert(
          'Sign failed',
          e?.message ?? 'Could not record your signature.',
        );
      } finally {
        setSubmitting(false);
      }
    },
    [contract, userId, meIsClient, counterpartName, onSigned, onClose],
  );

  const handleConfirm = () => {
    if (!hasInk || submitting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    sigRef.current?.readSignature?.();
  };

  const handleClear = () => {
    sigRef.current?.clearSignature?.();
    setHasInk(false);
    Haptics.selectionAsync().catch(() => {});
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
      transparent={false}
    >
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View pointerEvents="none" style={s.glowTopLeft} />
        <View pointerEvents="none" style={s.glowMidRight} />

        <SafeAreaView style={s.flex1} edges={['top']}>
          {/* HEADER */}
          <View style={s.header}>
            <Pressable
              onPress={onClose}
              disabled={submitting}
              style={({ pressed }) => [
                s.iconBtn,
                pressed && { transform: [{ scale: 0.92 }] },
              ]}
              hitSlop={8}
            >
              <X size={20} color={C.text} />
            </Pressable>
            <View style={s.headerCenter}>
              <Text style={s.kicker}>BINDING SIGNATURE</Text>
              <Text style={s.title}>Sign the agreement</Text>
            </View>
            <View style={s.iconBtn}>
              <ShieldCheck size={18} color={C.cyan} />
            </View>
          </View>

          {/* DOCUMENT CONTEXT */}
          <View style={s.contextCard}>
            <LinearGradient
              colors={['rgba(124, 58, 237, 0.12)', 'rgba(0, 255, 255, 0.06)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={s.contextRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.contextLabel}>SIGNING AS</Text>
                <Text style={s.contextRole}>{myRoleLabel}</Text>
              </View>
              <View style={s.contextDivider} />
              <View style={{ flex: 1.4, alignItems: 'flex-end' }}>
                <Text style={s.contextLabel}>COUNTERPARTY</Text>
                <Text style={s.contextValue} numberOfLines={1}>
                  {counterpartName}
                </Text>
              </View>
            </View>
            {contract.total_amount_cents ? (
              <>
                <View style={s.contextHr} />
                <View style={s.contextRow}>
                  <Text style={s.contextLabel}>TOTAL AMOUNT</Text>
                  <Text style={s.contextAmount}>
                    {formatMoney(contract.total_amount_cents)}
                  </Text>
                </View>
              </>
            ) : null}
          </View>

          {/* SIGNATURE CANVAS */}
          <View style={s.canvasWrap}>
            <View style={s.canvasFrame}>
              <SignatureScreen
                ref={sigRef}
                onOK={handleOK}
                onBegin={() => setHasInk(true)}
                onClear={() => setHasInk(false)}
                onEmpty={() => setHasInk(false)}
                webStyle={WEB_STYLE}
                backgroundColor="#0E1438"
                penColor="#FFFFFF"
                imageType="image/png"
                minWidth={1.2}
                maxWidth={3.2}
                autoClear={false}
                trimWhitespace
                descriptionText=""
              />
              {/* Decorative legal-document overlays */}
              <View pointerEvents="none" style={s.signLine} />
              <View pointerEvents="none" style={s.signXLabel}>
                <Text style={s.signXLabelText}>X</Text>
              </View>
              <Text pointerEvents="none" style={s.lineLabel}>
                SIGN HERE
              </Text>
              {!hasInk ? (
                <View pointerEvents="none" style={s.canvasHint}>
                  <PenLine size={14} color={C.textMuted} />
                  <Text style={s.canvasHintText}>
                    Sign with your finger or stylus
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={s.legalFootnote}>
              <Sparkles size={11} color={C.textMuted} />
              <Text style={s.legalText}>
                By signing you acknowledge this is a legally-binding electronic
                signature, recorded with a UTC timestamp.
              </Text>
            </View>
          </View>

          {/* FOOTER */}
          <View
            style={[
              s.footer,
              { paddingBottom: Math.max(insets.bottom, 16) },
            ]}
          >
            <Pressable
              onPress={handleClear}
              disabled={submitting}
              style={({ pressed }) => [
                s.clearBtn,
                pressed && { transform: [{ scale: 0.97 }] },
              ]}
            >
              <RotateCcw size={14} color={C.textSecondary} />
              <Text style={s.clearText}>Clear</Text>
            </Pressable>

            <Pressable
              onPress={handleConfirm}
              disabled={!hasInk || submitting}
              style={({ pressed }) => [
                s.signBtn,
                (!hasInk || submitting) && s.signBtnDisabled,
                pressed && hasInk && { transform: [{ scale: 0.99 }] },
              ]}
            >
              {hasInk && !submitting ? (
                <LinearGradient
                  colors={[C.primary, C.primaryBright, C.primaryDeep]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <PenLine size={16} color="#FFFFFF" />
              )}
              <Text style={s.signText}>
                {submitting ? 'Recording signature…' : 'Save Signature'}
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  flex1: { flex: 1 },

  glowTopLeft: {
    position: 'absolute',
    top: -160,
    left: -120,
    width: 360,
    height: 360,
    borderRadius: 200,
    backgroundColor: C.primary,
    opacity: 0.20,
  },
  glowMidRight: {
    position: 'absolute',
    top: 280,
    right: -140,
    width: 320,
    height: 320,
    borderRadius: 200,
    backgroundColor: C.cyan,
    opacity: 0.06,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.surfaceElev,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  kicker: {
    color: C.cyan,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.6,
    marginBottom: 2,
  },
  title: {
    color: C.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },

  // Context
  contextCard: {
    marginHorizontal: 20,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: C.surfaceElev,
    borderWidth: 1,
    borderColor: C.borderStrong,
    overflow: 'hidden',
    marginBottom: 16,
  },
  contextRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  contextDivider: {
    width: 1,
    height: 32,
    backgroundColor: C.border,
    marginHorizontal: 12,
  },
  contextHr: {
    height: 1,
    backgroundColor: C.border,
    marginVertical: 10,
  },
  contextLabel: {
    color: C.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 3,
  },
  contextRole: {
    color: C.cyan,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  contextValue: {
    color: C.text,
    fontSize: 14,
    fontWeight: '700',
  },
  contextAmount: {
    color: C.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },

  // Canvas
  canvasWrap: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  canvasFrame: {
    flex: 1,
    backgroundColor: '#0E1438',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
    position: 'relative',
  },
  signLine: {
    position: 'absolute',
    bottom: 60,
    left: 28,
    right: 28,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  signXLabel: {
    position: 'absolute',
    bottom: 64,
    left: 16,
  },
  signXLabelText: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 22,
    fontWeight: '800',
  },
  lineLabel: {
    position: 'absolute',
    bottom: 36,
    right: 28,
    color: C.textDim,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2,
  },
  canvasHint: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    transform: [{ translateY: -10 }],
  },
  canvasHintText: {
    color: C.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },

  legalFootnote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 4,
  },
  legalText: {
    color: C.textMuted,
    fontSize: 10.5,
    flex: 1,
    lineHeight: 14,
  },

  // Footer
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: C.bg,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 13,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: C.border,
  },
  clearText: {
    color: C.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  signBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 13,
    overflow: 'hidden',
    backgroundColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
  },
  signBtnDisabled: {
    backgroundColor: 'rgba(124, 58, 237, 0.18)',
    shadowOpacity: 0,
    elevation: 0,
  },
  signText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
