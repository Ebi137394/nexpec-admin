// src/components/client/sharing/WebReportShare.tsx

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Alert,
  Share,
  Dimensions,
  Platform,
  Clipboard,
  TextInput,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ─── Design Tokens ───────────────────────────────────────────────
const COLORS = {
  bg: '#020617',
  surface: '#0B1120',
  surfaceElevated: '#111827',
  cardBg: '#0F172A',
  primary: '#3B82F6',
  primaryMuted: 'rgba(59, 130, 246, 0.15)',
  accent: '#7C3AED',
  success: '#10B981',
  successBg: 'rgba(16, 185, 129, 0.12)',
  warning: '#F59E0B',
  warningBg: 'rgba(245, 158, 11, 0.12)',
  danger: '#EF4444',
  dangerBg: 'rgba(239, 68, 68, 0.12)',
  purple: '#8B5CF6',
  purpleBg: 'rgba(139, 92, 246, 0.12)',
  text: '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textDim: '#475569',
  border: '#1E293B',
  borderLight: '#334155',
  white: '#FFFFFF',
};

// ─── Mock Link ───────────────────────────────────────────────────
const generateMockLink = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let hash = '';
  for (let i = 0; i < 5; i++) {
    hash += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `nex.pec/v/${hash}`;
};

// ─── QR Code Placeholder ────────────────────────────────────────
// (Uses a visual placeholder; swap for react-native-qrcode-svg in production)
interface QRPlaceholderProps {
  value: string;
  size: number;
  color: string;
}

const QRCodePlaceholder: React.FC<QRPlaceholderProps> = ({ value, size, color }) => {
  // Generate a deterministic-looking pattern from the value string
  const cells = 11;
  const cellSize = size / cells;

  const generatePattern = (): boolean[][] => {
    const grid: boolean[][] = [];
    for (let row = 0; row < cells; row++) {
      grid[row] = [];
      for (let col = 0; col < cells; col++) {
        // Finder patterns (top-left, top-right, bottom-left)
        const isFinderTL = row < 3 && col < 3;
        const isFinderTR = row < 3 && col >= cells - 3;
        const isFinderBL = row >= cells - 3 && col < 3;

        if (isFinderTL || isFinderTR || isFinderBL) {
          const innerTL = row >= 0 && row <= 2 && col >= 0 && col <= 2;
          const outerRingTL = (row === 0 || row === 2 || col === 0 || col === 2);
          const centerTL = row === 1 && col === 1;

          const innerTR = row >= 0 && row <= 2 && col >= cells - 3 && col <= cells - 1;
          const outerRingTR = (row === 0 || row === 2 || col === cells - 3 || col === cells - 1);
          const centerTR = row === 1 && col === cells - 2;

          const innerBL = row >= cells - 3 && row <= cells - 1 && col >= 0 && col <= 2;
          const outerRingBL = (row === cells - 3 || row === cells - 1 || col === 0 || col === 2);
          const centerBL = row === cells - 2 && col === 1;

          if (isFinderTL) grid[row][col] = outerRingTL || centerTL;
          else if (isFinderTR) grid[row][col] = outerRingTR || centerTR;
          else if (isFinderBL) grid[row][col] = outerRingBL || centerBL;
        } else {
          // Pseudo-random data cells based on value hash
          const seed = (value.charCodeAt(Math.abs(row * col) % value.length) || 42);
          grid[row][col] = ((seed * (row + 1) * (col + 1)) % 7) > 2;
        }
      }
    }
    return grid;
  };

  const pattern = generatePattern();

  return (
    <View style={[qrStyles.container, { width: size, height: size }]}>
      <View style={qrStyles.innerPad}>
        {pattern.map((row, rowIndex) => (
          <View key={rowIndex} style={qrStyles.row}>
            {row.map((filled, colIndex) => (
              <View
                key={colIndex}
                style={[
                  qrStyles.cell,
                  {
                    width: cellSize * 0.85,
                    height: cellSize * 0.85,
                    backgroundColor: filled ? color : 'transparent',
                    borderRadius: cellSize * 0.15,
                  },
                ]}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
};

const qrStyles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerPad: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cell: {
    margin: 0.5,
  },
});

// ─── Permission Toggle Sub-Component ─────────────────────────────
interface PermToggleProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
  accentColor: string;
}

const PermissionToggle: React.FC<PermToggleProps> = ({
  icon,
  label,
  description,
  enabled,
  onToggle,
  accentColor,
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.97, duration: 60, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 60, useNativeDriver: true }),
    ]).start();
    onToggle();
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[
          styles.permToggle,
          enabled && { borderColor: accentColor + '40', backgroundColor: accentColor + '08' },
        ]}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <View style={styles.permLeft}>
          <View
            style={[
              styles.permIconBox,
              { backgroundColor: enabled ? accentColor + '20' : COLORS.surfaceElevated },
            ]}
          >
            {icon}
          </View>
          <View style={styles.permInfo}>
            <Text style={styles.permLabel}>{label}</Text>
            <Text style={styles.permDesc}>{description}</Text>
          </View>
        </View>
        <View
          style={[
            styles.permSwitch,
            enabled
              ? { backgroundColor: accentColor + '30', borderColor: accentColor }
              : { backgroundColor: COLORS.surfaceElevated, borderColor: COLORS.borderLight },
          ]}
        >
          <View
            style={[
              styles.permSwitchThumb,
              enabled
                ? { backgroundColor: accentColor, transform: [{ translateX: 18 }] }
                : { backgroundColor: COLORS.textMuted, transform: [{ translateX: 2 }] },
            ]}
          />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

// ─── Main Component ──────────────────────────────────────────────
interface WebReportShareProps {
  visible: boolean;
  onClose: () => void;
  projectName?: string;
  projectCode?: string;
}

const WebReportShare: React.FC<WebReportShareProps> = ({
  visible,
  onClose,
  projectName = 'Platform Alpha, Annual Structural Inspection',
  projectCode = 'PRJ-2024-0847',
}) => {
  // ── State ────────────────────────────────────────────────────────
  const [shareLink] = useState(generateMockLink());
  const [passwordProtect, setPasswordProtect] = useState(false);
  const [expiresIn48h, setExpiresIn48h] = useState(true);
  const [allowComments, setAllowComments] = useState(false);
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState(false);
  const [linkGenerated, setLinkGenerated] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const checkmarkScale = useRef(new Animated.Value(0)).current;

  // ── Animation on mount ────────────────────────────────────────
  useEffect(() => {
    if (visible) {
      setLinkGenerated(false);
      setCopied(false);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, tension: 50, friction: 10, useNativeDriver: true }),
      ]).start();

      // Simulate link generation
      setTimeout(() => {
        setLinkGenerated(true);
        Animated.spring(checkmarkScale, { toValue: 1, tension: 120, friction: 6, useNativeDriver: true }).start();
      }, 600);
    } else {
      fadeAnim.setValue(0);
      slideAnim.setValue(SCREEN_HEIGHT);
      checkmarkScale.setValue(0);
    }
  }, [visible]);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 300, useNativeDriver: true }),
    ]).start(() => onClose());
  };

  // ── Handlers ─────────────────────────────────────────────────────
  const handleCopyLink = useCallback(() => {
    const fullUrl = `https://${shareLink}`;
    if (Platform.OS !== 'web') {
      Clipboard.setString(fullUrl);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [shareLink]);

  const handleNativeShare = useCallback(async () => {
    try {
      const fullUrl = `https://${shareLink}`;
      await Share.share({
        message: `View the inspection report for ${projectName}: ${fullUrl}`,
        title: `Report: ${projectCode}`,
        url: fullUrl,
      });
    } catch (error) {
      Alert.alert('Share Error', 'Unable to open share sheet.');
    }
  }, [shareLink, projectName, projectCode]);

  // ── Render ───────────────────────────────────────────────────────
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
    >
      <View style={styles.modalOverlay}>
        {/* Backdrop */}
        <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={handleClose} activeOpacity={1} />
        </Animated.View>

        {/* Sheet */}
        <Animated.View
          style={[
            styles.sheet,
            { transform: [{ translateY: slideAnim }] },
          ]}
        >
          {/* ── Handle ───────────────────────────────────────────────── */}
          <View style={styles.handleBar}>
            <View style={styles.handle} />
          </View>

          {/* ── Header ───────────────────────────────────────────────── */}
          <View style={styles.sheetHeader}>
            <View style={styles.headerLeft}>
              <View style={[styles.headerIcon, { backgroundColor: COLORS.primaryMuted }]}>
                <Ionicons name="globe-outline" size={22} color={COLORS.primary} />
              </View>
              <View style={styles.headerText}>
                <Text style={styles.headerTitle}>Share Web Report</Text>
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {projectName}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>

          {/* ── Link Display ─────────────────────────────────────────── */}
          <View style={styles.linkSection}>
            <View style={styles.linkBox}>
              {linkGenerated ? (
                <>
                  <View style={styles.linkUrlRow}>
                    <Animated.View style={{ transform: [{ scale: checkmarkScale }] }}>
                      <View style={styles.linkStatusDot} />
                    </Animated.View>
                    <Text style={styles.linkUrl}>{shareLink}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={handleCopyLink}
                    style={[styles.copyButton, copied && { backgroundColor: COLORS.successBg }]}
                  >
                    <Ionicons
                      name={copied ? 'checkmark' : 'copy-outline'}
                      size={18}
                      color={copied ? COLORS.success : COLORS.primary}
                    />
                  </TouchableOpacity>
                </>
              ) : (
                <View style={styles.linkLoading}>
                  <View style={styles.linkLoadingBar} />
                  <Text style={styles.linkLoadingText}>Generating secure link...</Text>
                </View>
              )}
            </View>
            {copied && (
              <Text style={styles.copiedText}>✓ Link copied to clipboard</Text>
            )}
          </View>

          {/* ── QR Code Section ──────────────────────────────────────── */}
          <View style={styles.qrSection}>
            <View style={styles.qrContainer}>
              <QRCodePlaceholder
                value={shareLink}
                size={140}
                color={COLORS.bg}
              />
            </View>
            <Text style={styles.qrHint}>Scan to open report on any device</Text>
          </View>

          {/* ── Permissions ──────────────────────────────────────────── */}
          <View style={styles.permissionsSection}>
            <Text style={styles.permSectionTitle}>LINK PERMISSIONS</Text>

            <PermissionToggle
              icon={<Ionicons name="lock-closed-outline" size={18} color={passwordProtect ? COLORS.warning : COLORS.textMuted} />}
              label="Password Protect"
              description="Require a password to access report"
              enabled={passwordProtect}
              onToggle={() => setPasswordProtect(!passwordProtect)}
              accentColor={COLORS.warning}
            />

            {/* Password input when enabled */}
            {passwordProtect && (
              <View style={styles.passwordInputWrap}>
                <Feather name="key" size={14} color={COLORS.textMuted} style={{ marginRight: 8 }} />
                <TextInput
                  style={styles.passwordInput}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter link password"
                  placeholderTextColor={COLORS.textDim}
                  secureTextEntry
                  selectionColor={COLORS.warning}
                />
              </View>
            )}

            <PermissionToggle
              icon={<Ionicons name="timer-outline" size={18} color={expiresIn48h ? COLORS.accent : COLORS.textMuted} />}
              label="Expires in 48h"
              description="Link automatically deactivates after 48 hours"
              enabled={expiresIn48h}
              onToggle={() => setExpiresIn48h(!expiresIn48h)}
              accentColor={COLORS.accent}
            />

            <PermissionToggle
              icon={<Ionicons name="chatbubble-ellipses-outline" size={18} color={allowComments ? COLORS.purple : COLORS.textMuted} />}
              label="Allow Comments"
              description="Viewers can leave notes and feedback"
              enabled={allowComments}
              onToggle={() => setAllowComments(!allowComments)}
              accentColor={COLORS.purple}
            />
          </View>

          {/* ── Share Button ─────────────────────────────────────────── */}
          <View style={styles.shareSection}>
            <TouchableOpacity
              style={styles.shareButton}
              onPress={handleNativeShare}
              activeOpacity={0.8}
            >
              <Ionicons name="share-outline" size={20} color={COLORS.white} />
              <Text style={styles.shareButtonText}>Share Report Link</Text>
            </TouchableOpacity>

            <View style={styles.shareHints}>
              <View style={styles.shareHintRow}>
                <Ionicons name="shield-checkmark" size={12} color={COLORS.textDim} />
                <Text style={styles.shareHintText}>
                  {passwordProtect ? 'Password protected' : 'Public access'}
                  {' • '}
                  {expiresIn48h ? 'Expires in 48h' : 'No expiration'}
                </Text>
              </View>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

// ─── Styles ──────────────────────────────────────────────────────
const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: SCREEN_HEIGHT * 0.92,
  },
  handleBar: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.borderLight,
  },

  // ── Header ────────────────────
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: 0.2,
  },
  headerSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },

  // ── Link ──────────────────────
  linkSection: {
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  linkBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  linkUrlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  linkStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.success,
    marginRight: 10,
  },
  linkUrl: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: 0.5,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  copyButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  copiedText: {
    fontSize: 12,
    color: COLORS.success,
    fontWeight: '600',
    marginTop: 8,
    marginLeft: 4,
  },
  linkLoading: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  linkLoadingBar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderTopColor: 'transparent',
  },
  linkLoadingText: {
    fontSize: 13,
    color: COLORS.textMuted,
  },

  // ── QR Code ───────────────────
  qrSection: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  qrContainer: {
    padding: 4,
    borderRadius: 16,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  qrHint: {
    fontSize: 11,
    color: COLORS.textDim,
    marginTop: 10,
    fontWeight: '500',
  },

  // ── Permissions ───────────────
  permissionsSection: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  permSectionTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textDim,
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  permToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  permLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  permIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  permInfo: {
    flex: 1,
  },
  permLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  permDesc: {
    fontSize: 11,
    color: COLORS.textDim,
    marginTop: 2,
  },
  permSwitch: {
    width: 42,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    marginLeft: 8,
  },
  permSwitchThumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
    position: 'absolute',
    top: 1.5,
  },

  // ── Password Input ────────────
  passwordInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.warningBg,
    paddingHorizontal: 14,
    height: 44,
    marginBottom: 8,
    marginLeft: 20,
  },
  passwordInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },

  // ── Share ─────────────────────
  shareSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 16,
    gap: 10,
  },
  shareButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
    letterSpacing: 0.3,
  },
  shareHints: {
    marginTop: 12,
    alignItems: 'center',
  },
  shareHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  shareHintText: {
    fontSize: 11,
    color: COLORS.textDim,
  },
});

export default WebReportShare;