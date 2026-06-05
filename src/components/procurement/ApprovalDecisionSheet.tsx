// ════════════════════════════════════════════════════════════════════════════
//  src/components/procurement/ApprovalDecisionSheet.tsx
//
//  Bottom sheet that captures an approver's decision (Approve / Reject)
//  plus an optional comment. Mirrors the web ApprovalDecisionDialog
//  one-to-one in fields and visual language, just rendered as a sheet.
//
//  STRICT TOKENS — locked per UI rules:
//    background  #020420
//    primary     #7C3AED
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import {
  X,
  AlertTriangle,
  Check,
  ThumbsDown,
  Building2,
  Hash,
  Loader2,
} from 'lucide-react-native';

import type { PendingApprovalRow } from '@nexpec/shared-core';

const TOKENS = {
  bg: '#020420',
  surface: '#0B0F2E',
  surfaceHi: '#11163A',
  primary: '#7C3AED',
  primaryGlow: '#A78BFA',
  cyan: '#22D3EE',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.12)',
  textPrimary: '#FFFFFF',
  textSecondary: '#A1A1AA',
  textTertiary: '#71717A',
  textMuted: '#52525B',
  rose: '#F43F5E',
  emerald: '#34D399',
} as const;

interface Props {
  sheetRef: React.Ref<BottomSheetModal>;
  request: PendingApprovalRow | null;
  isSubmitting: boolean;
  onSubmit: (
    decision: 'approved' | 'rejected',
    comment?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}

export function ApprovalDecisionSheet({
  sheetRef,
  request,
  isSubmitting,
  onSubmit,
}: Props) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] = useState<
    'approved' | 'rejected' | null
  >(null);

  // Reset state whenever a new request is opened.
  useEffect(() => {
    if (!request) return;
    setComment('');
    setError(null);
    setPendingDecision(null);
  }, [request?.request_id]);

  const snapPoints = useMemo(() => ['72%'], []);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.78}
        pressBehavior="close"
      />
    ),
    [],
  );

  const handle = async (decision: 'approved' | 'rejected') => {
    if (decision === 'rejected' && !comment.trim()) {
      setError('A reason is required for a rejection.');
      return;
    }
    setError(null);
    setPendingDecision(decision);
    const res = await onSubmit(decision, comment.trim() || undefined);
    if (!res.ok) {
      setError(res.error ?? 'Could not record decision.');
      setPendingDecision(null);
      return;
    }
    setPendingDecision(null);
    (sheetRef as React.MutableRefObject<BottomSheetModal | null>)
      ?.current?.dismiss();
  };

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      index={0}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
      enablePanDownToClose
      enableDynamicSizing={false}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
    >
      <BottomSheetView style={styles.content}>
        {request ? (
          <DecisionBody
            request={request}
            comment={comment}
            onCommentChange={setComment}
            error={error}
            pendingDecision={pendingDecision}
            isSubmitting={isSubmitting}
            onApprove={() => handle('approved')}
            onReject={() => handle('rejected')}
            onClose={() =>
              (sheetRef as React.MutableRefObject<BottomSheetModal | null>)
                ?.current?.dismiss()
            }
          />
        ) : (
          <View style={styles.centeredState}>
            <Text style={styles.centeredStateText}>No request selected.</Text>
          </View>
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
}

/* ─── body ─────────────────────────────────────────────────────────── */

function DecisionBody({
  request,
  comment,
  onCommentChange,
  error,
  pendingDecision,
  isSubmitting,
  onApprove,
  onReject,
  onClose,
}: {
  request: PendingApprovalRow;
  comment: string;
  onCommentChange: (s: string) => void;
  error: string | null;
  pendingDecision: 'approved' | 'rejected' | null;
  isSubmitting: boolean;
  onApprove: () => void;
  onReject: () => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.headerLabel}>APPROVAL DECISION</Text>
          <Text style={styles.headerTitle} numberOfLines={2}>
            {request.job_title}
          </Text>
          <View style={styles.headerMeta}>
            <View style={styles.headerMetaItem}>
              <Building2 size={11} color={TOKENS.textTertiary} strokeWidth={1.75} />
              <Text style={styles.headerMetaText} numberOfLines={1}>
                {request.org_name}
              </Text>
            </View>
            {request.department_name && (
              <Text style={styles.headerMetaText} numberOfLines={1}>
                {request.department_name}
              </Text>
            )}
            {request.cost_center && (
              <View style={styles.costCenterChip}>
                <Hash size={9} color={TOKENS.textSecondary} strokeWidth={2} />
                <Text style={styles.costCenterText}>{request.cost_center}</Text>
              </View>
            )}
          </View>
        </View>
        <Pressable
          onPress={onClose}
          style={styles.closeBtn}
          accessibilityLabel="Close"
        >
          <X size={16} color={TOKENS.textTertiary} strokeWidth={2} />
        </Pressable>
      </View>

      {/* Amount + requester */}
      <View style={styles.tileRow}>
        <View style={[styles.tile, styles.tileViolet]}>
          <Text style={styles.tileLabel}>AMOUNT REQUESTED</Text>
          <Text style={styles.tileValue}>
            {formatMoney(request.amount_cents, request.currency)}
          </Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>REQUESTED BY</Text>
          <Text style={styles.tileValue} numberOfLines={1}>
            {request.requested_by_label}
          </Text>
          <Text style={styles.tileMeta}>
            {formatRelative(request.requested_at)}
          </Text>
        </View>
      </View>

      {/* Quorum context */}
      <View style={styles.contextBlock}>
        <Text style={styles.contextLabel}>QUORUM</Text>
        <Text style={styles.contextText}>
          <Text style={styles.contextNumber}>
            {request.approved_count}
          </Text>
          {' of '}
          {request.min_approvers_required} approval
          {request.min_approvers_required === 1 ? '' : 's'} so far, valid
          approvers:{' '}
          {request.required_approver_roles
            .map((r) => prettyRole(String(r)))
            .join(', ')}
        </Text>
      </View>

      {/* Comment */}
      <Text style={styles.fieldLabel}>
        COMMENT{' '}
        <Text style={styles.fieldLabelMuted}>(required for rejection)</Text>
      </Text>
      <BottomSheetTextInput
        value={comment}
        onChangeText={onCommentChange}
        placeholder="e.g. Confirmed against Q3 envelope; clear to proceed."
        placeholderTextColor={TOKENS.textMuted}
        multiline
        numberOfLines={3}
        maxLength={1000}
        editable={!isSubmitting}
        style={styles.textArea}
      />
      <Text style={styles.fieldHint}>
        Audit-stamped with your identity, role, and decision time.
      </Text>

      {/* Error banner */}
      {error && (
        <View style={styles.errorBanner}>
          <AlertTriangle size={12} color={TOKENS.rose} strokeWidth={1.75} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Decision buttons */}
      <View style={styles.btnRow}>
        <Pressable
          onPress={onReject}
          disabled={isSubmitting}
          style={({ pressed }) => [
            styles.btn,
            styles.btnReject,
            pressed && Platform.OS === 'ios' && styles.btnPressed,
            isSubmitting && styles.btnDisabled,
          ]}
        >
          {isSubmitting && pendingDecision === 'rejected' ? (
            <ActivityIndicator size="small" color={'#FECDD3'} />
          ) : (
            <ThumbsDown size={14} color={'#FECDD3'} strokeWidth={1.75} />
          )}
          <Text style={[styles.btnText, { color: '#FECDD3' }]}>REJECT</Text>
        </Pressable>
        <Pressable
          onPress={onApprove}
          disabled={isSubmitting}
          style={({ pressed }) => [
            styles.btn,
            styles.btnApprove,
            pressed && Platform.OS === 'ios' && styles.btnPressed,
            isSubmitting && styles.btnDisabled,
          ]}
        >
          {isSubmitting && pendingDecision === 'approved' ? (
            <ActivityIndicator size="small" color={TOKENS.primaryGlow} />
          ) : (
            <Check size={14} color={TOKENS.primaryGlow} strokeWidth={2} />
          )}
          <Text style={[styles.btnText, { color: TOKENS.primaryGlow }]}>
            APPROVE
          </Text>
        </Pressable>
      </View>
    </>
  );
}

/* ─── formatters ─────────────────────────────────────────────────── */

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toLocaleString()}`;
  }
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.round(sec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function prettyRole(r: string): string {
  return r.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ─── styles ─────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: TOKENS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: TOKENS.borderStrong,
  },
  handleIndicator: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    width: 36,
    height: 4,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
    backgroundColor: TOKENS.surface,
  },

  /* header */
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TOKENS.border,
    marginBottom: 14,
  },
  headerLabel: {
    color: TOKENS.primaryGlow,
    opacity: 0.85,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  headerTitle: {
    color: TOKENS.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 4,
  },
  headerMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  headerMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerMetaText: {
    color: TOKENS.textTertiary,
    fontSize: 11,
  },
  costCenterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TOKENS.border,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  costCenterText: {
    color: TOKENS.textSecondary,
    fontSize: 9,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  closeBtn: {
    padding: 4,
    borderRadius: 6,
  },

  /* tiles */
  tileRow: {
    flexDirection: 'row',
    gap: 8,
  },
  tile: {
    flex: 1,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TOKENS.border,
    backgroundColor: TOKENS.surfaceHi,
    padding: 10,
  },
  tileViolet: {
    borderColor: 'rgba(124,58,237,0.30)',
    backgroundColor: 'rgba(124,58,237,0.06)',
  },
  tileLabel: {
    color: TOKENS.textTertiary,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  tileValue: {
    color: TOKENS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  tileMeta: {
    color: TOKENS.textTertiary,
    fontSize: 10,
    marginTop: 2,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },

  /* context */
  contextBlock: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TOKENS.border,
    backgroundColor: TOKENS.surfaceHi,
    borderRadius: 12,
    padding: 10,
    marginTop: 10,
  },
  contextLabel: {
    color: TOKENS.textTertiary,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  contextText: {
    color: TOKENS.textSecondary,
    fontSize: 12,
    marginTop: 4,
    lineHeight: 17,
  },
  contextNumber: {
    color: TOKENS.textPrimary,
    fontWeight: '700',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },

  /* field */
  fieldLabel: {
    color: TOKENS.textTertiary,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginTop: 14,
    marginBottom: 6,
  },
  fieldLabelMuted: {
    color: TOKENS.textMuted,
    fontWeight: '600',
  },
  textArea: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TOKENS.border,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 12,
    color: TOKENS.textPrimary,
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  fieldHint: {
    color: TOKENS.textMuted,
    fontSize: 10,
    marginTop: 6,
  },

  /* error */
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(244,63,94,0.30)',
    backgroundColor: 'rgba(244,63,94,0.08)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 12,
  },
  errorText: {
    flex: 1,
    color: '#FECDD3',
    fontSize: 12,
    lineHeight: 16,
  },

  /* buttons */
  btnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: TOKENS.border,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  btnReject: {
    borderColor: 'rgba(244,63,94,0.30)',
    backgroundColor: 'rgba(244,63,94,0.10)',
  },
  btnApprove: {
    borderColor: 'rgba(124,58,237,0.40)',
    backgroundColor: 'rgba(124,58,237,0.18)',
  },
  btnPressed: { opacity: 0.7 },
  btnDisabled: { opacity: 0.5 },
  btnText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
  },

  /* fallback */
  centeredState: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  centeredStateText: {
    color: TOKENS.textTertiary,
    fontSize: 12,
  },
});
