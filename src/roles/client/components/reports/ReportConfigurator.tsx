// src/components/client/reports/ReportConfigurator.tsx

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  Animated,
  Dimensions,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Design Tokens ───────────────────────────────────────────────
const COLORS = {
  bg: '#020617',
  surface: '#0B1120',
  surfaceElevated: '#111827',
  surfaceBorder: '#1E293B',
  cardBg: '#0F172A',
  primary: '#3B82F6',
  primaryMuted: 'rgba(59, 130, 246, 0.15)',
  accent: '#7C3AED',
  success: '#10B981',
  successMuted: 'rgba(16, 185, 129, 0.12)',
  warning: '#F59E0B',
  warningMuted: 'rgba(245, 158, 11, 0.12)',
  danger: '#EF4444',
  text: '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textDim: '#475569',
  border: '#1E293B',
  borderLight: '#334155',
  white: '#FFFFFF',
};

// ─── Preset Theme Colors ─────────────────────────────────────────
const THEME_PRESETS = [
  { name: 'NEXPEC Blue', color: '#3B82F6', textColor: '#FFFFFF' },
  { name: 'Shell Yellow', color: '#FACC15', textColor: '#020617' },
  { name: 'ADNOC Teal', color: '#06B6D4', textColor: '#FFFFFF' },
  { name: 'Aramco Green', color: '#10B981', textColor: '#FFFFFF' },
  { name: 'TotalEnergies Red', color: '#EF4444', textColor: '#FFFFFF' },
  { name: 'BP Green', color: '#22C55E', textColor: '#FFFFFF' },
  { name: 'Corporate Gray', color: '#64748B', textColor: '#FFFFFF' },
  { name: 'Petrobras Blue', color: '#1D4ED8', textColor: '#FFFFFF' },
];

// ─── Mock Report Data ────────────────────────────────────────────
const MOCK_REPORT_SECTIONS = [
  { id: 'exec_summary', label: 'Executive Summary', enabled: true, pages: 2 },
  { id: 'scope_work', label: 'Scope of Work', enabled: true, pages: 4 },
  { id: 'inspection_data', label: 'Inspection Data & Findings', enabled: true, pages: 12 },
  { id: 'photo_evidence', label: 'Photographic Evidence', enabled: true, pages: 8 },
  { id: 'ndt_results', label: 'NDT Results & Analysis', enabled: true, pages: 6 },
  { id: 'corrosion_map', label: 'Corrosion Mapping', enabled: false, pages: 3 },
  { id: 'risk_matrix', label: 'Risk Assessment Matrix', enabled: true, pages: 2 },
  { id: 'recommendations', label: 'Recommendations', enabled: true, pages: 3 },
  { id: 'appendices', label: 'Appendices & Certificates', enabled: false, pages: 5 },
  { id: 'compliance', label: 'Compliance & Standards', enabled: true, pages: 2 },
];

const MOCK_PROJECT = {
  name: 'Platform Alpha, Annual Structural Inspection',
  code: 'PRJ-2024-0847',
  location: 'Arabian Gulf, Block 7',
  inspector: 'Mohammed Al-Rashid, API 653/570',
  date: '2024-12-15',
};

// ─── Sub-Components ──────────────────────────────────────────────

interface SectionToggleProps {
  section: typeof MOCK_REPORT_SECTIONS[0];
  onToggle: (id: string) => void;
  accentColor: string;
}

const SectionToggle: React.FC<SectionToggleProps> = ({ section, onToggle, accentColor }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.97, duration: 80, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start();
    onToggle(section.id);
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[
          styles.sectionRow,
          section.enabled && { borderColor: accentColor + '40' },
        ]}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <View style={styles.sectionToggleLeft}>
          <View
            style={[
              styles.toggleTrack,
              section.enabled
                ? { backgroundColor: accentColor + '30', borderColor: accentColor }
                : { backgroundColor: COLORS.surfaceElevated, borderColor: COLORS.borderLight },
            ]}
          >
            <Animated.View
              style={[
                styles.toggleThumb,
                section.enabled
                  ? { backgroundColor: accentColor, transform: [{ translateX: 18 }] }
                  : { backgroundColor: COLORS.textMuted, transform: [{ translateX: 2 }] },
              ]}
            />
          </View>
          <View style={styles.sectionInfo}>
            <Text
              style={[
                styles.sectionLabel,
                !section.enabled && { color: COLORS.textMuted },
              ]}
            >
              {section.label}
            </Text>
            <Text style={styles.sectionPages}>{section.pages} pages</Text>
          </View>
        </View>
        <Ionicons
          name={section.enabled ? 'checkmark-circle' : 'ellipse-outline'}
          size={18}
          color={section.enabled ? accentColor : COLORS.textDim}
        />
      </TouchableOpacity>
    </Animated.View>
  );
};

interface ColorSwatchProps {
  preset: typeof THEME_PRESETS[0];
  selected: boolean;
  onSelect: () => void;
}

const ColorSwatch: React.FC<ColorSwatchProps> = ({ preset, selected, onSelect }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 1.15, duration: 100, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    onSelect();
  };

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.7} style={styles.swatchContainer}>
      <Animated.View
        style={[
          styles.swatchOuter,
          selected && { borderColor: preset.color, borderWidth: 2 },
          { transform: [{ scale: scaleAnim }] },
        ]}
      >
        <View style={[styles.swatch, { backgroundColor: preset.color }]}>
          {selected && (
            <Ionicons name="checkmark" size={16} color={preset.textColor} />
          )}
        </View>
      </Animated.View>
      <Text style={[styles.swatchLabel, selected && { color: COLORS.text }]} numberOfLines={1}>
        {preset.name}
      </Text>
    </TouchableOpacity>
  );
};

// ─── Live Preview Mini-Component ─────────────────────────────────
interface LivePreviewProps {
  accentColor: string;
  companyName: string;
  projectCode: string;
  clientRef: string;
  preparedFor: string;
  logoUploaded: boolean;
  enabledSections: number;
  totalPages: number;
}

const LivePreview: React.FC<LivePreviewProps> = ({
  accentColor,
  companyName,
  projectCode,
  clientRef,
  preparedFor,
  logoUploaded,
  enabledSections,
  totalPages,
}) => {
  return (
    <View style={styles.previewContainer}>
      <View style={styles.previewLabel}>
        <Feather name="eye" size={13} color={COLORS.textMuted} />
        <Text style={styles.previewLabelText}>LIVE PREVIEW</Text>
      </View>

      {/* Mini PDF page */}
      <View style={styles.previewPage}>
        {/* Header bar */}
        <View style={[styles.previewHeader, { backgroundColor: accentColor }]}>
          <View style={styles.previewLogoArea}>
            {logoUploaded ? (
              <View style={styles.previewLogoPlaceholder}>
                <Ionicons name="image" size={10} color={accentColor} />
              </View>
            ) : (
              <Text style={styles.previewLogoText}>LOGO</Text>
            )}
          </View>
          <View style={styles.previewHeaderRight}>
            <View style={[styles.previewTextLine, { width: 40, backgroundColor: '#FFFFFF90' }]} />
            <View style={[styles.previewTextLine, { width: 28, backgroundColor: '#FFFFFF60', marginTop: 2 }]} />
          </View>
        </View>

        {/* Content area */}
        <View style={styles.previewContent}>
          <View style={[styles.previewTextLine, { width: '70%', height: 4, backgroundColor: accentColor + '60' }]} />
          <View style={[styles.previewTextLine, { width: '50%', marginTop: 4 }]} />
          <View style={[styles.previewTextLine, { width: '85%', marginTop: 3 }]} />
          <View style={[styles.previewTextLine, { width: '65%', marginTop: 3 }]} />

          {/* Stats row */}
          <View style={styles.previewStatsRow}>
            <View style={[styles.previewStatBox, { borderColor: accentColor + '40' }]}>
              <Text style={[styles.previewStatNum, { color: accentColor }]}>{enabledSections}</Text>
              <Text style={styles.previewStatLabel}>Sections</Text>
            </View>
            <View style={[styles.previewStatBox, { borderColor: accentColor + '40' }]}>
              <Text style={[styles.previewStatNum, { color: accentColor }]}>{totalPages}</Text>
              <Text style={styles.previewStatLabel}>Pages</Text>
            </View>
          </View>

          {/* More lines */}
          <View style={[styles.previewTextLine, { width: '90%', marginTop: 6 }]} />
          <View style={[styles.previewTextLine, { width: '75%', marginTop: 3 }]} />
        </View>

        {/* Footer */}
        <View style={[styles.previewFooter, { borderTopColor: accentColor + '30' }]}>
          <Text style={styles.previewFooterText} numberOfLines={1}>
            {projectCode || 'PRJ-CODE'} • {preparedFor || 'Client Name'}
          </Text>
        </View>
      </View>
    </View>
  );
};

// ─── Main Component ──────────────────────────────────────────────
interface ReportConfiguratorProps {
  projectId?: string;
  onClose?: () => void;
  onGenerate?: (config: Record<string, unknown>) => void;
}

const ReportConfigurator: React.FC<ReportConfiguratorProps> = ({
  projectId,
  onClose,
  onGenerate,
}) => {
  // ── State ────────────────────────────────────────────────────────
  const [selectedTheme, setSelectedTheme] = useState(0);
  const [logoUploaded, setLogoUploaded] = useState(false);
  const [projectCode, setProjectCode] = useState(MOCK_PROJECT.code);
  const [clientRef, setClientRef] = useState('CR-2024-GULF-447');
  const [preparedFor, setPreparedFor] = useState('Gulf Petroleum Services LLC');
  const [companyName, setCompanyName] = useState('');
  const [sections, setSections] = useState(MOCK_REPORT_SECTIONS);
  const [generating, setGenerating] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  // ── Computed ─────────────────────────────────────────────────────
  const accentColor = THEME_PRESETS[selectedTheme].color;
  const enabledSections = sections.filter((s) => s.enabled);
  const totalPages = enabledSections.reduce((sum, s) => sum + s.pages, 0);

  // ── Handlers ─────────────────────────────────────────────────────
  const handleToggleSection = useCallback((id: string) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    );
  }, []);

  const handleLogoUpload = () => {
    Alert.alert(
      'Upload Company Logo',
      'Select an image to replace the NEXPEC logo on generated reports.',
      [
        { text: 'Camera', onPress: () => setLogoUploaded(true) },
        { text: 'Photo Library', onPress: () => setLogoUploaded(true) },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleRemoveLogo = () => {
    setLogoUploaded(false);
  };

  const handleGeneratePDF = () => {
    if (enabledSections.length === 0) {
      Alert.alert('No Sections Selected', 'Please enable at least one report section.');
      return;
    }

    setGenerating(true);

    // Simulate PDF generation
    setTimeout(() => {
      setGenerating(false);

      const config = {
        projectCode,
        clientRef,
        preparedFor,
        accentColor,
        logoUploaded,
        sections: enabledSections.map((s) => s.id),
        totalPages,
        generatedAt: new Date().toISOString(),
      };

      if (onGenerate) {
        onGenerate(config);
      }

      Alert.alert(
        '✅ PDF Generated Successfully',
        `Report "${MOCK_PROJECT.name}" has been generated.\n\n` +
          `• ${enabledSections.length} sections included\n` +
          `• ${totalPages} pages total\n` +
          `• Theme: ${THEME_PRESETS[selectedTheme].name}\n` +
          `• File: ${projectCode}_Report.pdf\n\n` +
          `The file has been saved to your Downloads folder.`,
        [
          { text: 'Share', onPress: () => Alert.alert('Share', 'Opening share sheet...') },
          { text: 'Done', style: 'default' },
        ]
      );
    }, 2200);
  };

  const handleSelectAll = () => {
    const allEnabled = sections.every((s) => s.enabled);
    setSections((prev) => prev.map((s) => ({ ...s, enabled: !allEnabled })));
  };

  // ── Render ───────────────────────────────────────────────────────
  return (
    <Animated.View
      style={[
        styles.container,
        { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
      ]}
    >
      {/* ── Top Bar ────────────────────────────────────────────────── */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onClose} style={styles.topBarButton}>
          <Ionicons name="chevron-back" size={22} color={COLORS.textSecondary} />
        </TouchableOpacity>
        <View style={styles.topBarCenter}>
          <Text style={styles.topBarTitle}>Report Configurator</Text>
          <Text style={styles.topBarSubtitle}>{MOCK_PROJECT.name}</Text>
        </View>
        <TouchableOpacity
          onPress={() => setShowPreview(!showPreview)}
          style={[styles.topBarButton, showPreview && { backgroundColor: accentColor + '20' }]}
        >
          <Ionicons
            name={showPreview ? 'eye' : 'eye-off-outline'}
            size={20}
            color={showPreview ? accentColor : COLORS.textMuted}
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Live Preview ──────────────────────────────────────────── */}
        {showPreview && (
          <LivePreview
            accentColor={accentColor}
            companyName={companyName}
            projectCode={projectCode}
            clientRef={clientRef}
            preparedFor={preparedFor}
            logoUploaded={logoUploaded}
            enabledSections={enabledSections.length}
            totalPages={totalPages}
          />
        )}

        {/* ── Section: Brand Identity ───────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIcon, { backgroundColor: accentColor + '18' }]}>
              <MaterialCommunityIcons name="palette-outline" size={18} color={accentColor} />
            </View>
            <Text style={styles.sectionTitle}>Brand Identity</Text>
          </View>

          {/* Logo Upload */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Company Logo</Text>
            {logoUploaded ? (
              <View style={styles.logoUploadedRow}>
                <View style={[styles.logoPreviewBox, { borderColor: accentColor + '40' }]}>
                  <Ionicons name="business" size={24} color={accentColor} />
                  <Text style={[styles.logoUploadedText, { color: accentColor }]}>Logo Uploaded</Text>
                </View>
                <TouchableOpacity onPress={handleRemoveLogo} style={styles.logoRemoveBtn}>
                  <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.logoUploadButton}
                onPress={handleLogoUpload}
                activeOpacity={0.7}
              >
                <View style={styles.logoUploadInner}>
                  <Ionicons name="cloud-upload-outline" size={28} color={COLORS.textMuted} />
                  <Text style={styles.logoUploadText}>Upload Company Logo</Text>
                  <Text style={styles.logoUploadHint}>Replaces NEXPEC branding • PNG, SVG</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>

          {/* Theme Color */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Report Accent Color</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.swatchRow}
            >
              {THEME_PRESETS.map((preset, index) => (
                <ColorSwatch
                  key={preset.name}
                  preset={preset}
                  selected={selectedTheme === index}
                  onSelect={() => setSelectedTheme(index)}
                />
              ))}
            </ScrollView>
          </View>
        </View>

        {/* ── Section: Header & Footer Information ──────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIcon, { backgroundColor: COLORS.warningMuted }]}>
              <Ionicons name="document-text-outline" size={18} color={COLORS.warning} />
            </View>
            <Text style={styles.sectionTitle}>Header & Footer Information</Text>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Project Code</Text>
            <View style={styles.inputWrapper}>
              <Feather name="hash" size={16} color={COLORS.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.textInput}
                value={projectCode}
                onChangeText={setProjectCode}
                placeholder="e.g., PRJ-2024-0847"
                placeholderTextColor={COLORS.textDim}
                selectionColor={accentColor}
              />
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Client Reference</Text>
            <View style={styles.inputWrapper}>
              <Feather name="bookmark" size={16} color={COLORS.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.textInput}
                value={clientRef}
                onChangeText={setClientRef}
                placeholder="e.g., CR-2024-GULF-447"
                placeholderTextColor={COLORS.textDim}
                selectionColor={accentColor}
              />
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Prepared For</Text>
            <View style={styles.inputWrapper}>
              <Feather name="briefcase" size={16} color={COLORS.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.textInput}
                value={preparedFor}
                onChangeText={setPreparedFor}
                placeholder="e.g., Gulf Petroleum Services LLC"
                placeholderTextColor={COLORS.textDim}
                selectionColor={accentColor}
              />
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Company Name (Footer)</Text>
            <View style={styles.inputWrapper}>
              <Feather name="globe" size={16} color={COLORS.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.textInput}
                value={companyName}
                onChangeText={setCompanyName}
                placeholder="e.g., NEXPEC International"
                placeholderTextColor={COLORS.textDim}
                selectionColor={accentColor}
              />
            </View>
          </View>
        </View>

        {/* ── Section: Report Contents ──────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIcon, { backgroundColor: COLORS.successMuted }]}>
              <Ionicons name="layers-outline" size={18} color={COLORS.success} />
            </View>
            <View style={styles.sectionHeaderTextGroup}>
              <Text style={styles.sectionTitle}>Report Contents</Text>
              <Text style={styles.sectionSubtitle}>
                {enabledSections.length}/{sections.length} sections • ~{totalPages} pages
              </Text>
            </View>
            <TouchableOpacity onPress={handleSelectAll} style={styles.selectAllBtn}>
              <Text style={[styles.selectAllText, { color: accentColor }]}>
                {sections.every((s) => s.enabled) ? 'Deselect All' : 'Select All'}
              </Text>
            </TouchableOpacity>
          </View>

          {sections.map((section) => (
            <SectionToggle
              key={section.id}
              section={section}
              onToggle={handleToggleSection}
              accentColor={accentColor}
            />
          ))}
        </View>

        {/* ── Report Summary Card ───────────────────────────────────── */}
        <View style={[styles.summaryCard, { borderColor: accentColor + '30' }]}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Format</Text>
            <Text style={styles.summaryValue}>PDF / A4</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Estimated Size</Text>
            <Text style={styles.summaryValue}>~{(totalPages * 0.4).toFixed(1)} MB</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Theme</Text>
            <View style={styles.summaryThemeRow}>
              <View style={[styles.summaryThemeDot, { backgroundColor: accentColor }]} />
              <Text style={styles.summaryValue}>{THEME_PRESETS[selectedTheme].name}</Text>
            </View>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Branding</Text>
            <Text style={styles.summaryValue}>{logoUploaded ? 'Custom Logo' : 'NEXPEC Default'}</Text>
          </View>
        </View>

        {/* Spacer for bottom button */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* ── Fixed Bottom Action ─────────────────────────────────────── */}
      <View style={styles.bottomAction}>
        <View style={styles.bottomActionInner}>
          <View style={styles.bottomActionInfo}>
            <Text style={styles.bottomActionPages}>{totalPages} pages</Text>
            <Text style={styles.bottomActionDot}>•</Text>
            <Text style={styles.bottomActionSections}>{enabledSections.length} sections</Text>
          </View>

          <TouchableOpacity
            style={[
              styles.generateButton,
              { backgroundColor: accentColor },
              generating && { opacity: 0.7 },
            ]}
            onPress={handleGeneratePDF}
            disabled={generating}
            activeOpacity={0.8}
          >
            {generating ? (
              <View style={styles.generatingRow}>
                <ActivityIndicator size="small" color={THEME_PRESETS[selectedTheme].textColor} />
                <Text
                  style={[
                    styles.generateButtonText,
                    { color: THEME_PRESETS[selectedTheme].textColor, marginLeft: 10 },
                  ]}
                >
                  Generating...
                </Text>
              </View>
            ) : (
              <View style={styles.generatingRow}>
                <MaterialCommunityIcons
                  name="file-pdf-box"
                  size={22}
                  color={THEME_PRESETS[selectedTheme].textColor}
                />
                <Text
                  style={[
                    styles.generateButtonText,
                    { color: THEME_PRESETS[selectedTheme].textColor },
                  ]}
                >
                  Generate PDF
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 56 : 16,
    paddingBottom: 12,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  topBarButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarCenter: {
    flex: 1,
    marginHorizontal: 12,
  },
  topBarTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: 0.2,
  },
  topBarSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },

  // ── Preview ───────────────────
  previewContainer: {
    marginBottom: 20,
    alignItems: 'center',
  },
  previewLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 6,
  },
  previewLabelText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 1.5,
  },
  previewPage: {
    width: SCREEN_WIDTH * 0.55,
    aspectRatio: 0.707, // A4 ratio
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  previewLogoArea: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  previewLogoPlaceholder: {
    width: 18,
    height: 18,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewLogoText: {
    fontSize: 7,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  previewHeaderRight: {
    alignItems: 'flex-end',
  },
  previewTextLine: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#E2E8F0',
    width: '60%',
  },
  previewContent: {
    flex: 1,
    padding: 10,
  },
  previewStatsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  previewStatBox: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 4,
    padding: 4,
    alignItems: 'center',
  },
  previewStatNum: {
    fontSize: 10,
    fontWeight: '800',
  },
  previewStatLabel: {
    fontSize: 5,
    color: '#94A3B8',
    marginTop: 1,
  },
  previewFooter: {
    borderTopWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  previewFooterText: {
    fontSize: 5,
    color: '#94A3B8',
  },

  // ── Sections ──────────────────
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  sectionIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: 0.2,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  sectionHeaderTextGroup: {
    flex: 1,
  },
  selectAllBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceElevated,
  },
  selectAllText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // ── Fields ────────────────────
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 8,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    height: 48,
  },
  inputIcon: {
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },

  // ── Logo Upload ───────────────
  logoUploadButton: {
    borderWidth: 1.5,
    borderColor: COLORS.borderLight,
    borderStyle: 'dashed',
    borderRadius: 12,
    overflow: 'hidden',
  },
  logoUploadInner: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 6,
  },
  logoUploadText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  logoUploadHint: {
    fontSize: 11,
    color: COLORS.textDim,
  },
  logoUploadedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoPreviewBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  logoUploadedText: {
    fontSize: 14,
    fontWeight: '600',
  },
  logoRemoveBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Color Swatches ────────────
  swatchRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 4,
  },
  swatchContainer: {
    alignItems: 'center',
    width: 60,
  },
  swatchOuter: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchLabel: {
    fontSize: 9,
    color: COLORS.textDim,
    marginTop: 5,
    textAlign: 'center',
    fontWeight: '600',
  },

  // ── Section Toggles ───────────
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 6,
  },
  sectionToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  toggleTrack: {
    width: 40,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    marginRight: 12,
  },
  toggleThumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
    position: 'absolute',
    top: 0.5,
  },
  sectionInfo: {
    flex: 1,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  sectionPages: {
    fontSize: 11,
    color: COLORS.textDim,
    marginTop: 2,
  },

  // ── Summary Card ──────────────
  summaryCard: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  summaryLabel: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  summaryValue: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: COLORS.border,
  },
  summaryThemeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  summaryThemeDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },

  // ── Bottom Action ─────────────
  bottomAction: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.surface + 'F5',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  bottomActionInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bottomActionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bottomActionPages: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  bottomActionDot: {
    fontSize: 13,
    color: COLORS.textDim,
  },
  bottomActionSections: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  generateButton: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    minWidth: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  generatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  generateButtonText: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});

export default ReportConfigurator;