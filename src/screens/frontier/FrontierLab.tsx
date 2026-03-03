// src/screens/frontier/FrontierLab.tsx
// ─────────────────────────────────────────────────────
// "The Lab" — Frontier Experiments Launcher
// ─────────────────────────────────────────────────────

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ScrollView,
  Platform,
  StatusBar,
} from 'react-native';

// ── Frontier Components ──────────────────────────────
// NOTE: Import paths assume these exist from previous tasks:
import LiveStreamHub from '../../components/frontier/streaming/LiveStreamHub';
// import AudioDiagnose from '../components/frontier/audio/AudioDiagnose';
// import TimeLapseViewer from '../components/frontier/vision/TimeLapseViewer';

// ── Theme ────────────────────────────────────────────
const THEME = {
  bgPrimary: '#020617',
  bgSecondary: '#0f172a',
  bgTertiary: '#1e293b',
  accentCyan: '#00f0ff',
  accentRed: '#ff003c',
  accentGreen: '#00ff88',
  accentAmber: '#ffaa00',
  accentPurple: '#a855f7',
  accentPink: '#f472b6',
  textPrimary: '#e2e8f0',
  textSecondary: '#94a3b8',
  textMuted: '#475569',
  border: 'rgba(0, 240, 255, 0.12)',
  borderWarn: 'rgba(255, 170, 0, 0.3)',
  cardBg: 'rgba(15, 23, 42, 0.8)',
};

// ── Types ────────────────────────────────────────────
type ActiveModule = null | 'audio' | 'timelapse' | 'streaming';

interface LabCard {
  id: ActiveModule;
  title: string;
  subtitle: string;
  icon: string;
  accentColor: string;
  status: 'STABLE' | 'BETA' | 'ALPHA';
  description: string;
  version: string;
}

// ── Lab Cards Data ───────────────────────────────────
const LAB_CARDS: LabCard[] = [
  {
    id: 'audio',
    title: 'Audio Diagnostics',
    subtitle: 'Acoustic Analysis Engine',
    icon: '🎙',
    accentColor: THEME.accentPurple,
    status: 'BETA',
    description:
      'Real-time FFT waveform analysis, anomaly detection, and acoustic signature profiling for mechanical inspection.',
    version: 'v0.9.2',
  },
  {
    id: 'timelapse',
    title: '4D Visualization',
    subtitle: 'Temporal Layer Renderer',
    icon: '⏳',
    accentColor: THEME.accentCyan,
    status: 'ALPHA',
    description:
      'Multi-dimensional time-lapse viewer with decay progression, historical overlay, and structural drift mapping.',
    version: 'v0.4.1',
  },
  {
    id: 'streaming',
    title: 'Remote Command',
    subtitle: 'Mission Control HUD',
    icon: '📡',
    accentColor: THEME.accentGreen,
    status: 'STABLE',
    description:
      'Live streaming interface with telemetry overlay, client interaction channel, and encrypted P2P feed.',
    version: 'v1.2.0',
  },
];

// ── Status Badge Colors ──────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  STABLE: THEME.accentGreen,
  BETA: THEME.accentAmber,
  ALPHA: THEME.accentRed,
};

// ── Placeholder for modules not yet wired ────────────
const PlaceholderModule: React.FC<{
  title: string;
  onClose: () => void;
}> = ({ title, onClose }) => (
  <View style={placeholderStyles.container}>
    <View style={placeholderStyles.content}>
      <Text style={placeholderStyles.icon}>🔬</Text>
      <Text style={placeholderStyles.title}>{title}</Text>
      <Text style={placeholderStyles.subtitle}>
        Module loaded from previous task.{'\n'}
        Replace this placeholder with the real import.
      </Text>
      <TouchableOpacity style={placeholderStyles.backBtn} onPress={onClose}>
        <Text style={placeholderStyles.backBtnText}>← RETURN TO LAB</Text>
      </TouchableOpacity>
    </View>
  </View>
);

const placeholderStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bgPrimary,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  content: {
    alignItems: 'center',
    gap: 16,
  },
  icon: {
    fontSize: 48,
  },
  title: {
    color: THEME.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  subtitle: {
    color: THEME.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  backBtn: {
    marginTop: 16,
    backgroundColor: 'rgba(0, 240, 255, 0.1)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  backBtnText: {
    color: THEME.accentCyan,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 1,
  },
});

// ── Hazard Stripes Component ─────────────────────────
const HazardStripes: React.FC = () => (
  <View style={styles.hazardContainer}>
    {Array.from({ length: 20 }).map((_, i) => (
      <View
        key={i}
        style={[
          styles.hazardStripe,
          { backgroundColor: i % 2 === 0 ? THEME.accentAmber : '#000' },
        ]}
      />
    ))}
  </View>
);

// ── Animated Lab Card ────────────────────────────────
const AnimatedLabCard: React.FC<{
  card: LabCard;
  index: number;
  onPress: () => void;
}> = ({ card, index, onPress }) => {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 60,
        friction: 8,
        delay: index * 150,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 500,
        delay: index * 150,
        useNativeDriver: true,
      }),
    ]).start();
  }, [scaleAnim, translateY, index]);

  return (
    <Animated.View
      style={[
        styles.cardWrapper,
        {
          opacity: scaleAnim,
          transform: [{ translateY }, { scale: scaleAnim }],
        },
      ]}
    >
      <TouchableOpacity
        style={[
          styles.card,
          { borderColor: card.accentColor + '40' },
        ]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {/* Card Header */}
        <View style={styles.cardHeader}>
          <Text style={styles.cardIcon}>{card.icon}</Text>
          <View style={styles.cardHeaderRight}>
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor: STATUS_COLORS[card.status] + '20',
                  borderColor: STATUS_COLORS[card.status] + '50',
                },
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: STATUS_COLORS[card.status] },
                ]}
              />
              <Text
                style={[
                  styles.statusText,
                  { color: STATUS_COLORS[card.status] },
                ]}
              >
                {card.status}
              </Text>
            </View>
            <Text style={styles.versionText}>{card.version}</Text>
          </View>
        </View>

        {/* Card Body */}
        <View style={styles.cardBody}>
          <Text style={[styles.cardTitle, { color: card.accentColor }]}>
            {card.title}
          </Text>
          <Text style={styles.cardSubtitle}>{card.subtitle}</Text>
          <Text style={styles.cardDescription}>{card.description}</Text>
        </View>

        {/* Card Footer */}
        <View
          style={[
            styles.cardFooter,
            { borderTopColor: card.accentColor + '20' },
          ]}
        >
          <View style={styles.launchRow}>
            <Text style={styles.launchHint}>TAP TO LAUNCH</Text>
            <Text style={[styles.launchArrow, { color: card.accentColor }]}>
              →
            </Text>
          </View>
        </View>

        {/* Accent glow line */}
        <View
          style={[
            styles.cardGlowLine,
            { backgroundColor: card.accentColor },
          ]}
        />
      </TouchableOpacity>
    </Animated.View>
  );
};

// ══════════════════════════════════════════════════════
// ██ MAIN COMPONENT: FrontierLab
// ══════════════════════════════════════════════════════
interface FrontierLabProps {
  onExit?: () => void;
}

const FrontierLab: React.FC<FrontierLabProps> = ({ onExit }) => {
  const [activeModule, setActiveModule] = useState<ActiveModule>(null);
  const headerPulse = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(headerPulse, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(headerPulse, {
          toValue: 0.6,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [headerPulse]);

  // ── Render Active Module Full-Screen ───────────
  if (activeModule !== null) {
    switch (activeModule) {
      case 'streaming':
        return <LiveStreamHub onClose={() => setActiveModule(null)} />;

      case 'audio':
        // Replace with: <AudioDiagnose onClose={() => setActiveModule(null)} />
        return (
          <PlaceholderModule
            title="Audio Diagnostics"
            onClose={() => setActiveModule(null)}
          />
        );

      case 'timelapse':
        // Replace with: <TimeLapseViewer onClose={() => setActiveModule(null)} />
        return (
          <PlaceholderModule
            title="4D Visualization"
            onClose={() => setActiveModule(null)}
          />
        );

      default:
        return null;
    }
  }

  // ── Render Lab Menu ────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={THEME.bgPrimary} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header Section ──────────────────────── */}
        <View style={styles.headerSection}>
          {/* Exit button */}
          {onExit && (
            <TouchableOpacity style={styles.exitBtn} onPress={onExit}>
              <Text style={styles.exitBtnText}>✕ EXIT LAB</Text>
            </TouchableOpacity>
          )}

          {/* Hazard Warning */}
          <HazardStripes />

          <View style={styles.warningBanner}>
            <Text style={styles.warningIcon}>⚠️</Text>
            <View style={styles.warningTextContainer}>
              <Text style={styles.warningTitle}>EXPERIMENTAL ZONE</Text>
              <Text style={styles.warningSubtitle}>
                AUTHORIZED PERSONNEL ONLY — FEATURES MAY BE UNSTABLE
              </Text>
            </View>
          </View>

          <HazardStripes />

          {/* Lab Title */}
          <View style={styles.titleSection}>
            <Animated.Text
              style={[styles.labEmoji, { opacity: headerPulse }]}
            >
              🧪
            </Animated.Text>
            <Text style={styles.labTitle}>THE FRONTIER LAB</Text>
            <Text style={styles.labSubtitle}>
              Research & Development • Build 2024.12.07
            </Text>
            <View style={styles.classificationBadge}>
              <Text style={styles.classificationText}>
                CLASSIFICATION: INTERNAL
              </Text>
            </View>
          </View>
        </View>

        {/* ── Module Cards Grid ───────────────────── */}
        <View style={styles.cardsSection}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionDividerLine} />
            <Text style={styles.sectionTitle}>MODULES</Text>
            <View style={styles.sectionDividerLine} />
          </View>

          {LAB_CARDS.map((card, index) => (
            <AnimatedLabCard
              key={card.id}
              card={card}
              index={index}
              onPress={() => setActiveModule(card.id)}
            />
          ))}
        </View>

        {/* ── Footer ──────────────────────────────── */}
        <View style={styles.footer}>
          <View style={styles.footerDivider} />
          <Text style={styles.footerText}>
            ◆ STRUCTURA FRONTIER R&D DIVISION ◆
          </Text>
          <Text style={styles.footerSubtext}>
            "The future of inspection is being built here."
          </Text>
          <View style={styles.footerStats}>
            <Text style={styles.footerStat}>MODULES: 3</Text>
            <Text style={styles.footerStatDivider}>|</Text>
            <Text style={styles.footerStat}>STABLE: 1</Text>
            <Text style={styles.footerStatDivider}>|</Text>
            <Text style={styles.footerStat}>EXPERIMENTAL: 2</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

// ══════════════════════════════════════════════════════
// ██ STYLES
// ══════════════════════════════════════════════════════
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bgPrimary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 60,
  },

  // ── Header ─────────────────────────────────────
  headerSection: {
    paddingTop: Platform.OS === 'ios' ? 60 : 20,
  },
  exitBtn: {
    alignSelf: 'flex-start',
    marginLeft: 16,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 0, 60, 0.3)',
    backgroundColor: 'rgba(255, 0, 60, 0.08)',
  },
  exitBtnText: {
    color: THEME.accentRed,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 1,
  },

  // ── Hazard Stripes ────────────────────────────
  hazardContainer: {
    flexDirection: 'row',
    height: 6,
    overflow: 'hidden',
  },
  hazardStripe: {
    width: 20,
    height: 6,
    transform: [{ skewX: '-30deg' }],
    marginHorizontal: -2,
  },

  // ── Warning Banner ────────────────────────────
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 12,
    padding: 14,
    backgroundColor: 'rgba(255, 170, 0, 0.06)',
    borderWidth: 1,
    borderColor: THEME.borderWarn,
    borderRadius: 8,
    gap: 12,
  },
  warningIcon: {
    fontSize: 28,
  },
  warningTextContainer: {
    flex: 1,
    gap: 4,
  },
  warningTitle: {
    color: THEME.accentAmber,
    fontSize: 13,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 2,
  },
  warningSubtitle: {
    color: 'rgba(255, 170, 0, 0.6)',
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 1,
    lineHeight: 14,
  },

  // ── Title Section ──────────────────────────────
  titleSection: {
    alignItems: 'center',
    paddingVertical: 28,
    gap: 8,
  },
  labEmoji: {
    fontSize: 52,
    marginBottom: 4,
  },
  labTitle: {
    color: THEME.textPrimary,
    fontSize: 26,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 4,
    textAlign: 'center',
  },
  labSubtitle: {
    color: THEME.textMuted,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 1,
  },
  classificationBadge: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(0, 240, 255, 0.2)',
    backgroundColor: 'rgba(0, 240, 255, 0.05)',
  },
  classificationText: {
    color: THEME.accentCyan,
    fontSize: 9,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 2,
  },

  // ── Cards Section ──────────────────────────────
  cardsSection: {
    paddingHorizontal: 16,
    gap: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  sectionDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: THEME.border,
  },
  sectionTitle: {
    color: THEME.textMuted,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 3,
  },

  // ── Card ───────────────────────────────────────
  cardWrapper: {
    marginBottom: 4,
  },
  card: {
    backgroundColor: THEME.cardBg,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  cardIcon: {
    fontSize: 36,
  },
  cardHeaderRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  statusText: {
    fontSize: 9,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 1,
  },
  versionText: {
    color: THEME.textMuted,
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  cardBody: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 4,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 1,
  },
  cardSubtitle: {
    color: THEME.textSecondary,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 1,
    marginBottom: 6,
  },
  cardDescription: {
    color: THEME.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  cardFooter: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  launchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  launchHint: {
    color: THEME.textMuted,
    fontSize: 9,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 2,
  },
  launchArrow: {
    fontSize: 18,
    fontWeight: '700',
  },
  cardGlowLine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },

  // ── Footer ─────────────────────────────────────
  footer: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
    gap: 8,
  },
  footerDivider: {
    width: 60,
    height: 1,
    backgroundColor: THEME.border,
    marginBottom: 8,
  },
  footerText: {
    color: THEME.textMuted,
    fontSize: 10,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 2,
  },
  footerSubtext: {
    color: THEME.textMuted,
    fontSize: 11,
    fontStyle: 'italic',
    opacity: 0.6,
  },
  footerStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  footerStat: {
    color: THEME.textMuted,
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 1,
  },
  footerStatDivider: {
    color: THEME.textMuted,
    fontSize: 9,
    opacity: 0.3,
  },
});

export default FrontierLab;