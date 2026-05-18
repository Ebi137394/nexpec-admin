import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Text,
  ScrollView,
  Alert,
  Platform,
  Animated,
  Dimensions,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Rect as SvgRect, G } from 'react-native-svg';
import { PanResponder } from 'react-native';

// ─── Types ───────────────────────────────────────────────────────────
interface SafetyCheck {
  id: string;
  label: string;
  description: string;
  icon: string;
  checked: boolean;
  critical: boolean; // If true, this item is non-negotiable
}

interface JSAModalProps {
  visible: boolean;
  jobTitle: string;
  jobLocation?: string;
  onApproved: (checklist: SafetyCheck[], signatureData: string) => void;
  onCancel: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────
const { width: SCREEN_W } = Dimensions.get('window');

const THEME = {
  bg: '#0A0000',
  surface: '#1A0A0A',
  dangerDark: '#2D0A0A',
  dangerMid: '#5C1010',
  dangerBright: '#FF2222',
  dangerGlow: 'rgba(255, 34, 34, 0.3)',
  warning: '#FF8800',
  success: '#00FF66',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.55)',
  border: 'rgba(255, 34, 34, 0.2)',
  glass: 'rgba(255, 255, 255, 0.04)',
};

const DEFAULT_CHECKS: Omit<SafetyCheck, 'checked'>[] = [
  {
    id: 'ppe',
    label: 'PPE Verified',
    description: 'All required personal protective equipment is worn and in good condition.',
    icon: 'shield-checkmark',
    critical: true,
  },
  {
    id: 'gas_monitor',
    label: 'Gas Monitor Active',
    description: 'Atmospheric monitoring device is calibrated, turned on, and reading safe levels.',
    icon: 'pulse',
    critical: true,
  },
  {
    id: 'permit_work',
    label: 'Work Permit Obtained',
    description: 'Valid work permit / hot work permit has been issued for this task.',
    icon: 'document-text',
    critical: true,
  },
  {
    id: 'hazard_assess',
    label: 'Hazards Assessed',
    description: 'Potential hazards have been identified and mitigations are in place.',
    icon: 'warning',
    critical: true,
  },
  {
    id: 'emergency_plan',
    label: 'Emergency Plan Reviewed',
    description: 'Evacuation routes, muster points, and emergency contacts are known.',
    icon: 'exit',
    critical: false,
  },
  {
    id: 'tool_inspect',
    label: 'Tools & Equipment Inspected',
    description: 'All inspection tools are calibrated and equipment is functioning properly.',
    icon: 'construct',
    critical: false,
  },
  {
    id: 'communication',
    label: 'Communication Verified',
    description: 'Radio / phone communication with control room or supervisor is confirmed.',
    icon: 'radio',
    critical: false,
  },
];

// ─── Signature Pad Sub-Component ──────────────────────────────────
interface SignaturePadProps {
  onSignatureChange: (hasSignature: boolean, pathData: string) => void;
}

const SignaturePad: React.FC<SignaturePadProps> = ({ onSignatureChange }) => {
  const [paths, setPaths] = useState<string[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,

      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        const point = { x: locationX, y: locationY };
        setPoints([point]);
        setCurrentPath(`M ${point.x.toFixed(1)} ${point.y.toFixed(1)}`);
      },

      onPanResponderMove: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        const point = { x: locationX, y: locationY };
        setPoints((prev) => {
          const newPts = [...prev, point];
          // Build quadratic bezier path
          if (newPts.length < 2) return newPts;
          let d = `M ${newPts[0].x.toFixed(1)} ${newPts[0].y.toFixed(1)}`;
          for (let i = 1; i < newPts.length; i++) {
            const p = newPts[i - 1];
            const c = newPts[i];
            const mx = ((p.x + c.x) / 2).toFixed(1);
            const my = ((p.y + c.y) / 2).toFixed(1);
            d += ` Q ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${mx} ${my}`;
          }
          setCurrentPath(d);
          return newPts;
        });
      },

      onPanResponderRelease: () => {
        if (currentPath) {
          setPaths((prev) => {
            const newPaths = [...prev, currentPath];
            onSignatureChange(newPaths.length > 0, newPaths.join(' '));
            return newPaths;
          });
        }
        setCurrentPath('');
        setPoints([]);
      },
    })
  ).current;

  const clearSignature = () => {
    setPaths([]);
    setCurrentPath('');
    setPoints([]);
    onSignatureChange(false, '');
  };

  return (
    <View style={sigStyles.container}>
      <View style={sigStyles.header}>
        <Text style={sigStyles.label}>Digital Signature *</Text>
        <TouchableOpacity onPress={clearSignature} style={sigStyles.clearBtn}>
          <Ionicons name="refresh" size={14} color={THEME.textSecondary} />
          <Text style={sigStyles.clearText}>Clear</Text>
        </TouchableOpacity>
      </View>
      <View style={sigStyles.pad} {...panResponder.panHandlers}>
        {paths.length === 0 && !currentPath && (
          <Text style={sigStyles.placeholder}>Sign here with your finger</Text>
        )}
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
          {paths.map((d, i) => (
            <Path
              key={i}
              d={d}
              stroke="#FFFFFF"
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {currentPath ? (
            <Path
              d={currentPath}
              stroke="#FFFFFF"
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.7}
            />
          ) : null}
        </Svg>
      </View>
    </View>
  );
};

const sigStyles = StyleSheet.create({
  container: { marginTop: 20 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.dangerBright,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: THEME.glass,
  },
  clearText: {
    fontSize: 12,
    color: THEME.textSecondary,
    fontWeight: '600',
  },
  pad: {
    height: 120,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: THEME.border,
    borderStyle: 'dashed',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  placeholder: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.2)',
    fontStyle: 'italic',
  },
});

// ─── Main Component ──────────────────────────────────────────────────
const JSAModal: React.FC<JSAModalProps> = ({
  visible,
  jobTitle,
  jobLocation,
  onApproved,
  onCancel,
}) => {
  const [checks, setChecks] = useState<SafetyCheck[]>(
    DEFAULT_CHECKS.map((c) => ({ ...c, checked: false }))
  );
  const [hasSignature, setHasSignature] = useState(false);
  const [signatureData, setSignatureData] = useState('');
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setChecks(DEFAULT_CHECKS.map((c) => ({ ...c, checked: false })));
      setHasSignature(false);
      setSignatureData('');
    }
  }, [visible]);

  // Pulsing animation for the warning icon
  useEffect(() => {
    if (!visible) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [visible]);

  const toggleCheck = useCallback((id: string) => {
    setChecks((prev) =>
      prev.map((c) => (c.id === id ? { ...c, checked: !c.checked } : c))
    );
  }, []);

  const allChecked = checks.every((c) => c.checked);
  const criticalChecked = checks.filter((c) => c.critical).every((c) => c.checked);
  const checkedCount = checks.filter((c) => c.checked).length;
  const canProceed = allChecked && hasSignature;

  const handleProceed = useCallback(() => {
    if (!canProceed) {
      Alert.alert(
        'Safety Requirements Incomplete',
        'All safety checks must be verified and a digital signature must be provided before proceeding.',
        [{ text: 'Understood', style: 'default' }]
      );
      return;
    }
    onApproved(checks, signatureData);
  }, [canProceed, checks, signatureData, onApproved]);

  const handleCancel = useCallback(() => {
    const hasProgress = checks.some((c) => c.checked);
    if (hasProgress) {
      Alert.alert(
        'Abandon Safety Checklist?',
        'Your progress will be lost. You must complete the JSA before starting any inspection work.',
        [
          { text: 'Continue JSA', style: 'cancel' },
          { text: 'Abandon', style: 'destructive', onPress: onCancel },
        ]
      );
    } else {
      onCancel();
    }
  }, [checks, onCancel]);

  const handleSignatureChange = useCallback((hasSig: boolean, data: string) => {
    setHasSignature(hasSig);
    setSignatureData(data);
  }, []);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={handleCancel}
    >
      <StatusBar barStyle="light-content" backgroundColor={THEME.bg} />
      <View style={styles.container}>
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleCancel}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={24} color={THEME.textSecondary} />
            </TouchableOpacity>

            <View style={styles.headerBadge}>
              <Ionicons name="shield-checkmark" size={14} color={THEME.dangerBright} />
              <Text style={styles.headerBadgeText}>MANDATORY</Text>
            </View>
          </View>

          <Animated.View
            style={[styles.warningIconWrapper, { transform: [{ scale: pulseAnim }] }]}
          >
            <View style={styles.warningIcon}>
              <Ionicons name="warning" size={36} color={THEME.dangerBright} />
            </View>
          </Animated.View>

          <Text style={styles.title}>Pre-Job Safety Analysis</Text>
          <Text style={styles.subtitle}>
            All items must be verified before inspection can begin
          </Text>

          <View style={styles.jobInfoCard}>
            <View style={styles.jobInfoRow}>
              <Ionicons name="briefcase" size={16} color={THEME.warning} />
              <Text style={styles.jobInfoText} numberOfLines={1}>
                {jobTitle}
              </Text>
            </View>
            {jobLocation && (
              <View style={styles.jobInfoRow}>
                <Ionicons name="location" size={16} color={THEME.textSecondary} />
                <Text style={styles.jobInfoTextSec} numberOfLines={1}>
                  {jobLocation}
                </Text>
              </View>
            )}
          </View>

          {/* Progress Bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${(checkedCount / checks.length) * 100}%`,
                    backgroundColor: allChecked ? THEME.success : THEME.dangerBright,
                  },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {checkedCount}/{checks.length} verified
            </Text>
          </View>
        </View>

        {/* ── Checklist ── */}
        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {checks.map((check, index) => (
            <TouchableOpacity
              key={check.id}
              style={[
                styles.checkItem,
                check.checked && styles.checkItemChecked,
              ]}
              onPress={() => toggleCheck(check.id)}
              activeOpacity={0.7}
            >
              <View style={styles.checkItemLeft}>
                <View
                  style={[
                    styles.checkBox,
                    check.checked && styles.checkBoxChecked,
                  ]}
                >
                  {check.checked && (
                    <Ionicons name="checkmark-sharp" size={18} color="#020617" />
                  )}
                </View>
                <View style={styles.checkItemContent}>
                  <View style={styles.checkItemHeader}>
                    <Text
                      style={[
                        styles.checkItemLabel,
                        check.checked && styles.checkItemLabelChecked,
                      ]}
                    >
                      {check.label}
                    </Text>
                    {check.critical && (
                      <View style={styles.criticalBadge}>
                        <Text style={styles.criticalBadgeText}>CRITICAL</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.checkItemDesc}>{check.description}</Text>
                </View>
              </View>
              <Ionicons
                name={check.icon as any}
                size={24}
                color={check.checked ? THEME.success : 'rgba(255, 255, 255, 0.15)'}
              />
            </TouchableOpacity>
          ))}

          {/* ── Signature Pad ── */}
          <SignaturePad onSignatureChange={handleSignatureChange} />

          {/* Bottom Spacer */}
          <View style={{ height: 120 }} />
        </ScrollView>

        {/* ── Footer ── */}
        <View style={styles.footer}>
          {!canProceed && (
            <View style={styles.footerWarning}>
              <Ionicons name="lock-closed" size={14} color={THEME.dangerBright} />
              <Text style={styles.footerWarningText}>
                {!allChecked
                  ? `${checks.length - checkedCount} item(s) remaining`
                  : 'Signature required to proceed'}
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.proceedButton,
              !canProceed && styles.proceedButtonDisabled,
            ]}
            onPress={handleProceed}
            disabled={!canProceed}
            activeOpacity={0.8}
          >
            <Ionicons
              name={canProceed ? 'shield-checkmark' : 'lock-closed'}
              size={22}
              color={canProceed ? '#020617' : 'rgba(255, 255, 255, 0.3)'}
            />
            <Text
              style={[
                styles.proceedButtonText,
                !canProceed && styles.proceedButtonTextDisabled,
              ]}
            >
              {canProceed ? 'SAFETY VERIFIED — START INSPECTION' : 'COMPLETE ALL CHECKS TO PROCEED'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

// ─── Styles ────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 56 : (StatusBar.currentHeight || 24) + 12,
    paddingBottom: 16,
    backgroundColor: THEME.surface,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cancelButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: THEME.glass,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: THEME.dangerDark,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  headerBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.dangerBright,
    letterSpacing: 1.5,
  },
  warningIconWrapper: {
    alignSelf: 'center',
    marginBottom: 10,
  },
  warningIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: THEME.dangerDark,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: THEME.dangerBright,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: THEME.textPrimary,
    textAlign: 'center',
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 13,
    color: THEME.textSecondary,
    textAlign: 'center',
    marginBottom: 14,
  },
  jobInfoCard: {
    backgroundColor: THEME.glass,
    borderRadius: 12,
    padding: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    marginBottom: 14,
  },
  jobInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  jobInfoText: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME.textPrimary,
    flex: 1,
  },
  jobInfoTextSec: {
    fontSize: 13,
    color: THEME.textSecondary,
    flex: 1,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  progressBar: {
    flex: 1,
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.textSecondary,
    minWidth: 65,
    textAlign: 'right',
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 10,
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: THEME.dangerDark,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  checkItemChecked: {
    backgroundColor: 'rgba(0, 255, 102, 0.06)',
    borderColor: 'rgba(0, 255, 102, 0.2)',
  },
  checkItemLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    gap: 14,
  },
  checkBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: THEME.dangerBright,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
    marginTop: 2,
  },
  checkBoxChecked: {
    backgroundColor: THEME.success,
    borderColor: THEME.success,
  },
  checkItemContent: {
    flex: 1,
  },
  checkItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  checkItemLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: THEME.textPrimary,
  },
  checkItemLabelChecked: {
    color: THEME.success,
  },
  checkItemDesc: {
    fontSize: 12,
    color: THEME.textSecondary,
    lineHeight: 17,
  },
  criticalBadge: {
    backgroundColor: THEME.dangerMid,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  criticalBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: THEME.dangerBright,
    letterSpacing: 0.8,
  },
  footer: {
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 36 : 16,
    backgroundColor: THEME.surface,
    borderTopWidth: 1,
    borderTopColor: THEME.border,
  },
  footerWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 10,
  },
  footerWarningText: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.dangerBright,
  },
  proceedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: THEME.success,
    paddingVertical: 16,
    borderRadius: 14,
  },
  proceedButtonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  proceedButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#020617',
    letterSpacing: 0.8,
  },
  proceedButtonTextDisabled: {
    color: 'rgba(255, 255, 255, 0.25)',
    fontSize: 12,
  },
});

export default JSAModal;