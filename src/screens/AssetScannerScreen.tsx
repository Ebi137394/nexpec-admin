import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  StatusBar,
  ScrollView,
  Modal,
  TextInput,
  Platform,
  Alert,
  Easing,
  Vibration,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppNavigationProp } from '../navigation/types';

// ============================================================================
// THEME & CONSTANTS
// ============================================================================

const COLORS = {
  // Primary Theme
  background: '#0A0E17',
  surface: '#111827',
  surfaceLight: '#1F2937',
  surfaceHighlight: '#252F3F',
  
  // Neon Colors (Cyberpunk)
  neonCyan: '#00F5FF',
  neonCyanDim: 'rgba(0, 245, 255, 0.5)',
  neonCyanGlow: 'rgba(0, 245, 255, 0.2)',
  neonCyanFaint: 'rgba(0, 245, 255, 0.1)',
  neonPink: '#FF00FF',
  neonPinkDim: 'rgba(255, 0, 255, 0.5)',
  neonGreen: '#00FF88',
  neonOrange: '#FF6B00',
  neonYellow: '#FFFF00',
  
  // Scanner Colors
  scannerBg: '#050810',
  gridLine: 'rgba(0, 245, 255, 0.08)',
  laserGlow: 'rgba(0, 245, 255, 0.8)',
  
  // Text Colors
  text: '#FFFFFF',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  
  // Status Colors
  success: '#10B981',
  successBg: 'rgba(16, 185, 129, 0.15)',
  warning: '#F59E0B',
  error: '#EF4444',
  
  // UI Elements
  border: '#374151',
  overlay: 'rgba(0, 0, 0, 0.85)',
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SCANNER_SIZE = SCREEN_WIDTH * 0.72;
const CORNER_LENGTH = 30;
const CORNER_WIDTH = 4;

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface ScannedAsset {
  id: string;
  name: string;
  type: string;
  icon: string;
  location: string;
  scannedAt: Date;
  status: 'active' | 'maintenance' | 'offline';
}

interface AssetInfo {
  id: string;
  name: string;
  type: string;
  location: string;
  lastInspection: string;
  status: 'active' | 'maintenance' | 'offline';
  manufacturer: string;
  installDate: string;
}

// ============================================================================
// MOCK DATA
// ============================================================================

const MOCK_SCAN_HISTORY: ScannedAsset[] = [
  {
    id: 'VLV-001',
    name: 'Gate Valve A1',
    type: 'valve',
    icon: '🔧',
    location: 'Sector 7-A',
    scannedAt: new Date(Date.now() - 3600000),
    status: 'active',
  },
  {
    id: 'PMP-042',
    name: 'Pump Station 42',
    type: 'pump',
    icon: '⚙️',
    location: 'Zone B-3',
    scannedAt: new Date(Date.now() - 7200000),
    status: 'active',
  },
  {
    id: 'MTR-007',
    name: 'Flow Meter 7',
    type: 'meter',
    icon: '📊',
    location: 'Pipeline 3',
    scannedAt: new Date(Date.now() - 10800000),
    status: 'maintenance',
  },
  {
    id: 'TNK-103',
    name: 'Storage Tank 103',
    type: 'tank',
    icon: '🛢️',
    location: 'Terminal A',
    scannedAt: new Date(Date.now() - 14400000),
    status: 'active',
  },
  {
    id: 'SNS-088',
    name: 'Pressure Sensor',
    type: 'sensor',
    icon: '📡',
    location: 'Sector 2-C',
    scannedAt: new Date(Date.now() - 18000000),
    status: 'offline',
  },
];

const MOCK_ASSET_INFO: AssetInfo = {
  id: 'VLV-404',
  name: 'Valve #404',
  type: 'Ball Valve',
  location: 'Pipeline Section 7-B, Node 12',
  lastInspection: '2024-10-15',
  status: 'active',
  manufacturer: 'Cameron Valves Inc.',
  installDate: '2021-03-22',
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// Animated Corner Component
const ScannerCorner: React.FC<{
  position: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
  pulseAnim: Animated.Value;
}> = ({ position, pulseAnim }) => {
  const cornerStyles = {
    topLeft: { top: 0, left: 0, borderTopWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH },
    topRight: { top: 0, right: 0, borderTopWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH },
    bottomLeft: { bottom: 0, left: 0, borderBottomWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH },
    bottomRight: { bottom: 0, right: 0, borderBottomWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH },
  };

  return (
    <Animated.View
      style={[
        styles.corner,
        cornerStyles[position],
        {
          opacity: pulseAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [0.6, 1],
          }),
          shadowOpacity: pulseAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [0.3, 0.8],
          }),
        },
      ]}
    />
  );
};

// Scanning Laser Component
const ScanningLaser: React.FC<{ scanAnim: Animated.Value; isScanning: boolean }> = ({
  scanAnim,
  isScanning,
}) => {
  if (!isScanning) return null;

  return (
    <Animated.View
      style={[
        styles.laserContainer,
        {
          transform: [
            {
              translateY: scanAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, SCANNER_SIZE - 10],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.laserLine} />
      <View style={styles.laserGlow} />
    </Animated.View>
  );
};

// Grid Overlay Component
const GridOverlay: React.FC = () => {
  const gridLines = [];
  const gridSize = 20;
  const numLines = Math.floor(SCANNER_SIZE / gridSize);

  // Horizontal lines
  for (let i = 0; i <= numLines; i++) {
    gridLines.push(
      <View
        key={`h-${i}`}
        style={[
          styles.gridLineHorizontal,
          { top: i * gridSize },
        ]}
      />
    );
  }

  // Vertical lines
  for (let i = 0; i <= numLines; i++) {
    gridLines.push(
      <View
        key={`v-${i}`}
        style={[
          styles.gridLineVertical,
          { left: i * gridSize },
        ]}
      />
    );
  }

  return <View style={styles.gridContainer}>{gridLines}</View>;
};

// Crosshair Component
const Crosshair: React.FC<{ pulseAnim: Animated.Value }> = ({ pulseAnim }) => (
  <View style={styles.crosshairContainer}>
    <Animated.View
      style={[
        styles.crosshairHorizontal,
        {
          opacity: pulseAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [0.3, 0.6],
          }),
        },
      ]}
    />
    <Animated.View
      style={[
        styles.crosshairVertical,
        {
          opacity: pulseAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [0.3, 0.6],
          }),
        },
      ]}
    />
    <Animated.View
      style={[
        styles.crosshairCenter,
        {
          transform: [
            {
              scale: pulseAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.8, 1.2],
              }),
            },
          ],
        },
      ]}
    />
  </View>
);

// HUD Info Display
const HUDInfo: React.FC<{ isScanning: boolean }> = ({ isScanning }) => (
  <View style={styles.hudContainer}>
    <View style={styles.hudRow}>
      <View style={styles.hudItem}>
        <Text style={styles.hudLabel}>MODE</Text>
        <Text style={styles.hudValue}>QR / BARCODE</Text>
      </View>
      <View style={styles.hudItem}>
        <View style={[styles.hudStatus, isScanning && styles.hudStatusActive]} />
        <Text style={[styles.hudValue, isScanning && styles.hudValueActive]}>
          {isScanning ? 'SCANNING' : 'READY'}
        </Text>
      </View>
    </View>
  </View>
);

// Flashlight Button Component
const FlashlightButton: React.FC<{
  isOn: boolean;
  onToggle: () => void;
}> = ({ isOn, onToggle }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.9, duration: 100, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    onToggle();
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[styles.controlButton, isOn && styles.controlButtonActive]}
        onPress={handlePress}
        activeOpacity={0.8}
      >
        <Text style={styles.controlButtonIcon}>{isOn ? '🔦' : '💡'}</Text>
        <Text style={[styles.controlButtonText, isOn && styles.controlButtonTextActive]}>
          {isOn ? 'ON' : 'OFF'}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Scan History Item Component
const ScanHistoryItem: React.FC<{
  asset: ScannedAsset;
  onPress: () => void;
  index: number;
}> = ({ asset, onPress, index }) => {
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: 1,
      duration: 400,
      delay: index * 100,
      useNativeDriver: true,
    }).start();
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return COLORS.success;
      case 'maintenance': return COLORS.warning;
      case 'offline': return COLORS.error;
      default: return COLORS.textMuted;
    }
  };

  return (
    <Animated.View
      style={[
        styles.historyItemContainer,
        {
          opacity: slideAnim,
          transform: [
            {
              translateX: slideAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [50, 0],
              }),
            },
          ],
        },
      ]}
    >
      <TouchableOpacity style={styles.historyItem} onPress={onPress} activeOpacity={0.7}>
        <View style={styles.historyIconContainer}>
          <Text style={styles.historyIcon}>{asset.icon}</Text>
          <View style={[styles.historyStatusDot, { backgroundColor: getStatusColor(asset.status) }]} />
        </View>
        <Text style={styles.historyId}>{asset.id}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Asset Found Sheet Component
const AssetFoundSheet: React.FC<{
  visible: boolean;
  asset: AssetInfo;
  onClose: () => void;
  onOpenForm: () => void;
}> = ({ visible, asset, onClose, onOpenForm }) => {
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: 65,
          friction: 11,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: SCREEN_HEIGHT,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  if (!visible) return null;

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'active':
        return { label: 'Active', color: COLORS.success, bg: COLORS.successBg };
      case 'maintenance':
        return { label: 'Maintenance', color: COLORS.warning, bg: 'rgba(245, 158, 11, 0.15)' };
      case 'offline':
        return { label: 'Offline', color: COLORS.error, bg: 'rgba(239, 68, 68, 0.15)' };
      default:
        return { label: 'Unknown', color: COLORS.textMuted, bg: COLORS.surfaceLight };
    }
  };

  const statusConfig = getStatusConfig(asset.status);

  return (
    <Modal transparent visible={visible} animationType="none">
      <View style={styles.sheetWrapper}>
        <Animated.View style={[styles.sheetBackdrop, { opacity: backdropAnim }]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <Animated.View
          style={[styles.sheetContent, { transform: [{ translateY: slideAnim }] }]}
        >
          {/* Handle */}
          <View style={styles.sheetHandle}>
            <View style={styles.sheetHandleBar} />
          </View>

          {/* Success Animation */}
          <View style={styles.successIconContainer}>
            <View style={styles.successIconRing}>
              <View style={styles.successIconInner}>
                <Text style={styles.successIcon}>✓</Text>
              </View>
            </View>
            <Text style={styles.successText}>Asset Found!</Text>
          </View>

          {/* Asset Card */}
          <View style={styles.assetCard}>
            <View style={styles.assetCardHeader}>
              <View style={styles.assetIconLarge}>
                <Text style={styles.assetIconLargeText}>🔧</Text>
              </View>
              <View style={styles.assetCardTitleContainer}>
                <Text style={styles.assetCardId}>{asset.id}</Text>
                <Text style={styles.assetCardName}>{asset.name}</Text>
              </View>
              <View style={[styles.assetStatusBadge, { backgroundColor: statusConfig.bg }]}>
                <View style={[styles.assetStatusDot, { backgroundColor: statusConfig.color }]} />
                <Text style={[styles.assetStatusText, { color: statusConfig.color }]}>
                  {statusConfig.label}
                </Text>
              </View>
            </View>

            <View style={styles.assetDivider} />

            {/* Asset Details Grid */}
            <View style={styles.assetDetailsGrid}>
              <View style={styles.assetDetailItem}>
                <Text style={styles.assetDetailIcon}>📍</Text>
                <View>
                  <Text style={styles.assetDetailLabel}>Location</Text>
                  <Text style={styles.assetDetailValue}>{asset.location}</Text>
                </View>
              </View>
              <View style={styles.assetDetailItem}>
                <Text style={styles.assetDetailIcon}>🔩</Text>
                <View>
                  <Text style={styles.assetDetailLabel}>Type</Text>
                  <Text style={styles.assetDetailValue}>{asset.type}</Text>
                </View>
              </View>
              <View style={styles.assetDetailItem}>
                <Text style={styles.assetDetailIcon}>🏭</Text>
                <View>
                  <Text style={styles.assetDetailLabel}>Manufacturer</Text>
                  <Text style={styles.assetDetailValue}>{asset.manufacturer}</Text>
                </View>
              </View>
              <View style={styles.assetDetailItem}>
                <Text style={styles.assetDetailIcon}>📅</Text>
                <View>
                  <Text style={styles.assetDetailLabel}>Last Inspection</Text>
                  <Text style={styles.assetDetailValue}>{asset.lastInspection}</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.sheetActions}>
            <TouchableOpacity style={styles.secondaryButton} onPress={onClose}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={onOpenForm}>
              <Text style={styles.primaryButtonIcon}>📋</Text>
              <Text style={styles.primaryButtonText}>Open Inspection Form</Text>
            </TouchableOpacity>
          </View>

          {/* Quick Actions */}
          <View style={styles.quickActions}>
            <TouchableOpacity style={styles.quickActionButton}>
              <Text style={styles.quickActionIcon}>📜</Text>
              <Text style={styles.quickActionText}>History</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickActionButton}>
              <Text style={styles.quickActionIcon}>📷</Text>
              <Text style={styles.quickActionText}>Photos</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickActionButton}>
              <Text style={styles.quickActionIcon}>📍</Text>
              <Text style={styles.quickActionText}>Navigate</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickActionButton}>
              <Text style={styles.quickActionIcon}>⚠️</Text>
              <Text style={styles.quickActionText}>Report</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

// Manual Entry Modal Component
const ManualEntryModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  onSubmit: (assetId: string) => void;
}> = ({ visible, onClose, onSubmit }) => {
  const [assetId, setAssetId] = useState('');
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: SCREEN_HEIGHT,
        duration: 300,
        useNativeDriver: true,
      }).start();
      setAssetId('');
    }
  }, [visible]);

  const handleSubmit = () => {
    if (assetId.trim()) {
      onSubmit(assetId.trim());
      setAssetId('');
    } else {
      Alert.alert('Error', 'Please enter an Asset ID');
    }
  };

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={styles.modalOverlay}>
        <TouchableOpacity style={styles.modalBackdrop} onPress={onClose} />
        <Animated.View
          style={[styles.manualEntryCard, { transform: [{ translateY: slideAnim }] }]}
        >
          <View style={styles.manualEntryHeader}>
            <Text style={styles.manualEntryTitle}>Manual Entry</Text>
            <TouchableOpacity onPress={onClose} style={styles.manualEntryClose}>
              <Text style={styles.manualEntryCloseText}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.manualEntrySubtitle}>
            Enter the asset ID or serial number manually
          </Text>

          <View style={styles.manualEntryInputContainer}>
            <Text style={styles.manualEntryInputIcon}>🏷️</Text>
            <TextInput
              style={styles.manualEntryInput}
              placeholder="e.g., VLV-404, PMP-042"
              placeholderTextColor={COLORS.textMuted}
              value={assetId}
              onChangeText={setAssetId}
              autoCapitalize="characters"
              autoFocus
            />
          </View>

          <View style={styles.manualEntryFormats}>
            <Text style={styles.manualEntryFormatsLabel}>Supported formats:</Text>
            <View style={styles.manualEntryFormatChips}>
              <View style={styles.formatChip}>
                <Text style={styles.formatChipText}>VLV-XXX</Text>
              </View>
              <View style={styles.formatChip}>
                <Text style={styles.formatChipText}>PMP-XXX</Text>
              </View>
              <View style={styles.formatChip}>
                <Text style={styles.formatChipText}>MTR-XXX</Text>
              </View>
            </View>
          </View>

          <TouchableOpacity style={styles.manualEntryButton} onPress={handleSubmit}>
            <Text style={styles.manualEntryButtonText}>Search Asset</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
};

// ============================================================================
// MAIN SCREEN COMPONENT
// ============================================================================

const AssetScannerScreen: React.FC = () => {
  const navigation = useNavigation<AppNavigationProp>();

  // State
  const [isFlashlightOn, setIsFlashlightOn] = useState(false);
  const [isScanning, setIsScanning] = useState(true);
  const [showAssetSheet, setShowAssetSheet] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [scanHistory, setScanHistory] = useState<ScannedAsset[]>(MOCK_SCAN_HISTORY);

  // Animation Refs
  const scanAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const headerAnim = useRef(new Animated.Value(0)).current;

  // Effects
  useEffect(() => {
    // Header entrance animation
    Animated.timing(headerAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();

    // Start pulse animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Rotation animation for decorative elements
    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 8000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  // Scanning laser animation
  useEffect(() => {
    if (isScanning) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(scanAnim, {
            toValue: 1,
            duration: 2000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(scanAnim, {
            toValue: 0,
            duration: 2000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      scanAnim.setValue(0);
    }
  }, [isScanning]);

  // Handlers
  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleToggleFlashlight = () => {
    setIsFlashlightOn(prev => !prev);
    Vibration.vibrate(50);
  };

  const handleSimulateScan = () => {
    setIsScanning(false);
    Vibration.vibrate([0, 100, 50, 100]);
    
    // Show success animation
    setTimeout(() => {
      setShowAssetSheet(true);
    }, 500);
  };

  const handleCloseAssetSheet = () => {
    setShowAssetSheet(false);
    setIsScanning(true);
  };

  const handleOpenInspectionForm = () => {
    setShowAssetSheet(false);
    Alert.alert(
      '📋 Inspection Form',
      'Opening inspection form for Valve #404...',
      [{ text: 'OK', onPress: () => setIsScanning(true) }]
    );
  };

  const handleManualEntry = (assetId: string) => {
    setShowManualEntry(false);
    setIsScanning(false);
    
    setTimeout(() => {
      setShowAssetSheet(true);
    }, 500);
  };

  const handleHistoryItemPress = (asset: ScannedAsset) => {
    Alert.alert(
      asset.name,
      `ID: ${asset.id}\nLocation: ${asset.location}\nStatus: ${asset.status}`,
      [{ text: 'View Details' }, { text: 'Cancel', style: 'cancel' }]
    );
  };

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // ============================================================================
  // MAIN RENDER
  // ============================================================================

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* ===== CAMERA VIEW (MOCK) ===== */}
      <View style={styles.cameraContainer}>
        {/* Background with noise effect simulation */}
        <View style={styles.cameraMock}>
          {/* Scan line effect background */}
          <View style={styles.scanLines}>
            {[...Array(50)].map((_, i) => (
              <View key={i} style={styles.scanLine} />
            ))}
          </View>

          {/* Vignette effect */}
          <View style={styles.vignette} />

          {/* Flashlight effect */}
          {isFlashlightOn && <View style={styles.flashlightEffect} />}
        </View>

        {/* ===== HUD OVERLAY ===== */}
        <View style={styles.hudOverlay}>
          {/* Top HUD */}
          <Animated.View
            style={[
              styles.topHud,
              {
                opacity: headerAnim,
                transform: [{
                  translateY: headerAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-30, 0],
                  }),
                }],
              },
            ]}
          >
            <View style={styles.topHudLeft}>
              <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.7}>
                <Text style={styles.backButtonText}>←</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.topHudCenter}>
              <Text style={styles.screenTitle}>ASSET SCANNER</Text>
              <HUDInfo isScanning={isScanning} />
            </View>
            <View style={styles.topHudRight}>
              <FlashlightButton isOn={isFlashlightOn} onToggle={handleToggleFlashlight} />
            </View>
          </Animated.View>

          {/* ===== SCANNER VIEWFINDER ===== */}
          <View style={styles.scannerArea}>
            {/* Decorative ring */}
            <Animated.View
              style={[
                styles.decorativeRing,
                { transform: [{ rotate: spin }] },
              ]}
            />

            {/* Main scanner box */}
            <View style={styles.scannerBox}>
              {/* Grid overlay */}
              <GridOverlay />

              {/* Crosshair */}
              <Crosshair pulseAnim={pulseAnim} />

              {/* Scanning laser */}
              <ScanningLaser scanAnim={scanAnim} isScanning={isScanning} />

              {/* Corners */}
              <ScannerCorner position="topLeft" pulseAnim={pulseAnim} />
              <ScannerCorner position="topRight" pulseAnim={pulseAnim} />
              <ScannerCorner position="bottomLeft" pulseAnim={pulseAnim} />
              <ScannerCorner position="bottomRight" pulseAnim={pulseAnim} />

              {/* Scanner instruction */}
              <View style={styles.scannerInstruction}>
                <Text style={styles.scannerInstructionText}>
                  {isScanning ? 'Align QR code or barcode within frame' : 'Processing...'}
                </Text>
              </View>
            </View>
          </View>

          {/* ===== BOTTOM CONTROLS ===== */}
          <View style={styles.bottomControls}>
            {/* Simulate Scan Button */}
            <TouchableOpacity
              style={[styles.simulateScanButton, !isScanning && styles.simulateScanButtonDisabled]}
              onPress={handleSimulateScan}
              disabled={!isScanning}
              activeOpacity={0.8}
            >
              <View style={styles.simulateScanIconContainer}>
                <Animated.View
                  style={[
                    styles.simulateScanRing,
                    {
                      transform: [{
                        scale: pulseAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [1, 1.3],
                        }),
                      }],
                      opacity: pulseAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.6, 0],
                      }),
                    },
                  ]}
                />
                <View style={styles.simulateScanIcon}>
                  <Text style={styles.simulateScanIconText}>⚡</Text>
                </View>
              </View>
              <Text style={styles.simulateScanText}>Simulate Scan</Text>
            </TouchableOpacity>

            {/* Manual Entry Link */}
            <TouchableOpacity
              style={styles.manualEntryLink}
              onPress={() => setShowManualEntry(true)}
            >
              <Text style={styles.manualEntryIcon}>⌨️</Text>
              <Text style={styles.manualEntryText}>Enter Asset ID manually</Text>
            </TouchableOpacity>

            {/* Scan History */}
            <View style={styles.historySection}>
              <View style={styles.historySectionHeader}>
                <Text style={styles.historySectionTitle}>Recent Scans</Text>
                <View style={styles.historyBadge}>
                  <Text style={styles.historyBadgeText}>{scanHistory.length}</Text>
                </View>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.historyScrollContent}
              >
                {scanHistory.map((asset, index) => (
                  <ScanHistoryItem
                    key={asset.id}
                    asset={asset}
                    onPress={() => handleHistoryItemPress(asset)}
                    index={index}
                  />
                ))}
              </ScrollView>
            </View>
          </View>
        </View>
      </View>

      {/* ===== ASSET FOUND BOTTOM SHEET ===== */}
      <AssetFoundSheet
        visible={showAssetSheet}
        asset={MOCK_ASSET_INFO}
        onClose={handleCloseAssetSheet}
        onOpenForm={handleOpenInspectionForm}
      />

      {/* ===== MANUAL ENTRY MODAL ===== */}
      <ManualEntryModal
        visible={showManualEntry}
        onClose={() => setShowManualEntry(false)}
        onSubmit={handleManualEntry}
      />
    </View>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  // Container
  container: {
    flex: 1,
    backgroundColor: COLORS.scannerBg,
  },

  // Camera View
  cameraContainer: {
    flex: 1,
  },
  cameraMock: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.scannerBg,
  },
  scanLines: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.03,
  },
  scanLine: {
    height: 2,
    backgroundColor: COLORS.neonCyan,
    marginBottom: 4,
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    borderWidth: 80,
    borderColor: 'rgba(0, 0, 0, 0.7)',
  },
  flashlightEffect: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 200, 0.1)',
  },

  // HUD Overlay
  hudOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },

  // Top HUD
  topHud: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 20,
  },
  topHudLeft: {
    width: 50,
  },
  topHudCenter: {
    flex: 1,
    alignItems: 'center',
  },
  topHudRight: {
    width: 50,
    alignItems: 'flex-end',
  },
  screenTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.neonCyan,
    letterSpacing: 3,
    textShadowColor: COLORS.neonCyan,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(31, 41, 55, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  backButtonText: {
    fontSize: 24,
    color: COLORS.text,
  },

  // HUD Info
  hudContainer: {
    marginTop: 12,
  },
  hudRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  hudItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hudLabel: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginRight: 6,
    letterSpacing: 1,
  },
  hudValue: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  hudValueActive: {
    color: COLORS.neonCyan,
  },
  hudStatus: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.textMuted,
    marginRight: 6,
  },
  hudStatusActive: {
    backgroundColor: COLORS.neonCyan,
    shadowColor: COLORS.neonCyan,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 8,
  },

  // Control Button
  controlButton: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(31, 41, 55, 0.8)',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  controlButtonActive: {
    backgroundColor: COLORS.neonCyanGlow,
    borderColor: COLORS.neonCyan,
  },
  controlButtonIcon: {
    fontSize: 20,
  },
  controlButtonText: {
    fontSize: 9,
    color: COLORS.textMuted,
    marginTop: 4,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  controlButtonTextActive: {
    color: COLORS.neonCyan,
  },

  // Scanner Area
  scannerArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  decorativeRing: {
    position: 'absolute',
    width: SCANNER_SIZE + 60,
    height: SCANNER_SIZE + 60,
    borderRadius: (SCANNER_SIZE + 60) / 2,
    borderWidth: 1,
    borderColor: COLORS.neonCyanFaint,
    borderStyle: 'dashed',
  },
  scannerBox: {
    width: SCANNER_SIZE,
    height: SCANNER_SIZE,
    position: 'relative',
  },

  // Scanner Corners
  corner: {
    position: 'absolute',
    width: CORNER_LENGTH,
    height: CORNER_LENGTH,
    borderColor: COLORS.neonCyan,
    shadowColor: COLORS.neonCyan,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },

  // Grid
  gridContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  gridLineHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: COLORS.gridLine,
  },
  gridLineVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: COLORS.gridLine,
  },

  // Crosshair
  crosshairContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  crosshairHorizontal: {
    position: 'absolute',
    width: SCANNER_SIZE * 0.3,
    height: 1,
    backgroundColor: COLORS.neonCyan,
  },
  crosshairVertical: {
    position: 'absolute',
    width: 1,
    height: SCANNER_SIZE * 0.3,
    backgroundColor: COLORS.neonCyan,
  },
  crosshairCenter: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.neonCyan,
    backgroundColor: 'transparent',
  },

  // Scanning Laser
  laserContainer: {
    position: 'absolute',
    left: 10,
    right: 10,
    height: 4,
  },
  laserLine: {
    height: 2,
    backgroundColor: COLORS.neonCyan,
    shadowColor: COLORS.neonCyan,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 4,
  },
  laserGlow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -8,
    height: 20,
    backgroundColor: COLORS.laserGlow,
    opacity: 0.3,
  },

  // Scanner Instruction
  scannerInstruction: {
    position: 'absolute',
    bottom: -40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  scannerInstructionText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },

  // Bottom Controls
  bottomControls: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },

  // Simulate Scan Button
  simulateScanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.neonCyan,
    paddingVertical: 18,
    borderRadius: 16,
    marginBottom: 16,
    shadowColor: COLORS.neonCyan,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  simulateScanButtonDisabled: {
    backgroundColor: COLORS.surfaceLight,
    shadowOpacity: 0,
  },
  simulateScanIconContainer: {
    marginRight: 12,
    position: 'relative',
  },
  simulateScanRing: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: COLORS.background,
    top: -8,
    left: -8,
  },
  simulateScanIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  simulateScanIconText: {
    fontSize: 14,
  },
  simulateScanText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.background,
  },

  // Manual Entry Link
  manualEntryLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginBottom: 20,
  },
  manualEntryIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  manualEntryText: {
    fontSize: 14,
    color: COLORS.neonCyan,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },

  // History Section
  historySection: {
    marginBottom: 8,
  },
  historySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  historySectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    letterSpacing: 0.5,
  },
  historyBadge: {
    backgroundColor: COLORS.surfaceLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginLeft: 10,
  },
  historyBadgeText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  historyScrollContent: {
    paddingRight: 20,
  },
  historyItemContainer: {
    marginRight: 12,
  },
  historyItem: {
    width: 72,
    height: 88,
    backgroundColor: 'rgba(31, 41, 55, 0.8)',
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  historyIconContainer: {
    position: 'relative',
    marginBottom: 8,
  },
  historyIcon: {
    fontSize: 28,
  },
  historyStatusDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: COLORS.surfaceLight,
  },
  historyId: {
    fontSize: 10,
    color: COLORS.textSecondary,
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  // Asset Found Sheet
  sheetWrapper: {
    flex: 1,
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.overlay,
  },
  sheetContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  sheetHandle: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  sheetHandleBar: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.border,
  },

  // Success Animation
  successIconContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  successIconRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.successBg,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  successIconInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.success,
    justifyContent: 'center',
    alignItems: 'center',
  },
  successIcon: {
    fontSize: 28,
    color: COLORS.text,
  },
  successText: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.success,
  },

  // Asset Card
  assetCard: {
    backgroundColor: COLORS.background,
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  assetCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  assetIconLarge: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: COLORS.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  assetIconLargeText: {
    fontSize: 28,
  },
  assetCardTitleContainer: {
    flex: 1,
  },
  assetCardId: {
    fontSize: 13,
    color: COLORS.neonCyan,
    fontWeight: '600',
    letterSpacing: 1,
  },
  assetCardName: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 2,
  },
  assetStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  assetStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  assetStatusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  assetDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 16,
  },
  assetDetailsGrid: {
    gap: 14,
  },
  assetDetailItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  assetDetailIcon: {
    fontSize: 18,
    marginRight: 12,
    width: 24,
    textAlign: 'center',
  },
  assetDetailLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  assetDetailValue: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
    marginTop: 1,
  },

  // Sheet Actions
  sheetActions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  primaryButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: COLORS.neonCyan,
    shadowColor: COLORS.neonCyan,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  primaryButtonIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.background,
  },

  // Quick Actions
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  quickActionButton: {
    alignItems: 'center',
    padding: 12,
  },
  quickActionIcon: {
    fontSize: 24,
    marginBottom: 6,
  },
  quickActionText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },

  // Manual Entry Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.overlay,
  },
  manualEntryCard: {
    width: SCREEN_WIDTH - 48,
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  manualEntryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  manualEntryTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
  },
  manualEntryClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  manualEntryCloseText: {
    fontSize: 18,
    color: COLORS.textSecondary,
  },
  manualEntrySubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 24,
  },
  manualEntryInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  manualEntryInputIcon: {
    fontSize: 18,
    marginRight: 12,
  },
  manualEntryInput: {
    flex: 1,
    fontSize: 18,
    color: COLORS.text,
    paddingVertical: 16,
    fontWeight: '600',
    letterSpacing: 1,
  },
  manualEntryFormats: {
    marginBottom: 24,
  },
  manualEntryFormatsLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 10,
  },
  manualEntryFormatChips: {
    flexDirection: 'row',
    gap: 10,
  },
  formatChip: {
    backgroundColor: COLORS.surfaceLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  formatChipText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  manualEntryButton: {
    backgroundColor: COLORS.neonCyan,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: COLORS.neonCyan,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  manualEntryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.background,
  },
});

export default AssetScannerScreen;
