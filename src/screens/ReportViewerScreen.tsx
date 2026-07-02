import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Dimensions,
  StatusBar,
  Image,
  Platform,
  Share,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  Share2,
  Download,
  Atom,
  MapPin,
  Settings,
  BarChart3,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  MessageSquare,
  PenTool,
  Maximize,
  ShieldCheck,
  Printer,
} from 'lucide-react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';

// ============================================
// TYPES & INTERFACES
// ============================================

interface InspectionItem {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'na';
  notes?: string;
  photos?: string[];
  severity?: 'critical' | 'major' | 'minor';
}

interface InspectionReport {
  reportId: string;
  inspectionDate: Date;
  generatedDate: Date;
  inspector: {
    name: string;
    id: string;
    signature?: string;
  };
  location: {
    site: string;
    unit: string;
    area: string;
  };
  equipment: {
    name: string;
    serialNumber: string;
    type: string;
  };
  summary: {
    totalItems: number;
    passed: number;
    failed: number;
    notApplicable: number;
    overallStatus: 'approved' | 'rejected' | 'pending';
  };
  items: InspectionItem[];
  comments: string;
}

// ============================================
// THEME CONSTANTS
// ============================================

const THEME = {
  // Primary Colors
  darkBg: '#0A0E17',
  neonCyan: '#7C3AED',
  
  // Document Colors (Paper-like for dark mode)
  paperBg: '#1A1F2E',
  paperBgLight: '#1E2438',
  paperBorder: '#2A3245',
  
  // Surface Colors
  surfaceDark: '#0D1520',
  surfaceLight: '#141B2B',
  
  // Text Colors
  textPrimary: '#FFFFFF',
  textSecondary: '#8B95A5',
  textMuted: '#5A6577',
  textDark: '#C5CDD9',
  
  // Status Colors
  successGreen: '#2ED573',
  alertRed: '#FF4757',
  warningOrange: '#FFA502',
  infoBlue: '#3498DB',
  
  // Accents
  cyanGlow: 'rgba(124, 58, 237, 0.15)',
  cyanGlowIntense: 'rgba(124, 58, 237, 0.3)',
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DOCUMENT_MARGIN = 16;
const DOCUMENT_WIDTH = SCREEN_WIDTH - (DOCUMENT_MARGIN * 2);

// ============================================
// MOCK DATA
// ============================================

const mockReport: InspectionReport = {
  reportId: 'INS-2024-001',
  inspectionDate: new Date('2024-01-15T09:30:00'),
  generatedDate: new Date(),
  inspector: {
    name: 'John Anderson',
    id: 'EMP-4521',
    signature: 'John Anderson',
  },
  location: {
    site: 'Houston Refinery Complex',
    unit: 'Unit A - Processing',
    area: 'Sector 7 - Pipeline Network',
  },
  equipment: {
    name: 'Primary Flow Control Valve',
    serialNumber: 'FCV-2024-78542',
    type: 'Industrial Valve Assembly',
  },
  summary: {
    totalItems: 24,
    passed: 19,
    failed: 3,
    notApplicable: 2,
    overallStatus: 'rejected',
  },
  items: [
    {
      id: '1',
      name: 'Valve Body Integrity',
      status: 'pass',
    },
    {
      id: '2',
      name: 'Seal Condition',
      status: 'fail',
      severity: 'critical',
      notes: 'Visible wear and minor leakage detected at the primary seal interface.',
      photos: [
        'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=200',
        'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=200',
      ],
    },
    {
      id: '3',
      name: 'Actuator Response',
      status: 'pass',
    },
    {
      id: '4',
      name: 'Pressure Rating Check',
      status: 'fail',
      severity: 'major',
      notes: 'Operating pressure exceeds recommended limits by 12%. Recalibration required.',
      photos: [
        'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=200',
      ],
    },
    {
      id: '5',
      name: 'Electrical Connections',
      status: 'pass',
    },
    {
      id: '6',
      name: 'Corrosion Assessment',
      status: 'fail',
      severity: 'minor',
      notes: 'Surface oxidation observed on external housing. Cosmetic only, no structural impact.',
      photos: [
        'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=200',
      ],
    },
  ],
  comments: 'Inspection completed under normal operating conditions. Recommend immediate attention to seal condition and pressure calibration before next operational cycle.',
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

const formatDate = (date: Date, format: 'full' | 'short' = 'full'): string => {
  if (format === 'short') {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getSeverityColor = (severity?: string): string => {
  switch (severity) {
    case 'critical':
      return THEME.alertRed;
    case 'major':
      return THEME.warningOrange;
    case 'minor':
      return THEME.infoBlue;
    default:
      return THEME.textSecondary;
  }
};

// ============================================
// SUB-COMPONENTS
// ============================================

// Header Component
interface HeaderProps {
  reportId: string;
  onBack: () => void;
  onShare: () => void;
  onDownload: () => void;
}

const Header: React.FC<HeaderProps> = ({ reportId, onBack, onShare, onDownload }) => {
  return (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={onBack}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <ChevronLeft size={24} color={THEME.textPrimary} />
      </TouchableOpacity>

      <View style={styles.headerTitleContainer}>
        <Text style={styles.headerTitle}>Report</Text>
        <Text style={styles.headerSubtitle}>#{reportId}</Text>
      </View>

      <View style={styles.headerActions}>
        <TouchableOpacity style={styles.headerActionButton} onPress={onShare}>
          <Share2 size={22} color={THEME.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerActionButton} onPress={onDownload}>
          <Download size={22} color={THEME.textPrimary} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

// Document Header Section
interface DocumentHeaderProps {
  report: InspectionReport;
}

const DocumentHeader: React.FC<DocumentHeaderProps> = ({ report }) => {
  return (
    <View style={styles.documentHeader}>
      {/* Company Logo & Branding */}
      <View style={styles.companySection}>
        <View style={styles.logoContainer}>
          <View style={styles.logoIcon}>
            <Atom size={28} color={THEME.neonCyan} />
          </View>
          <View style={styles.logoText}>
            <Text style={styles.companyName}>NEXPEC</Text>
            <Text style={styles.companyTagline}>Industrial Inspections</Text>
          </View>
        </View>
        <View style={styles.reportBadge}>
          <Text style={styles.reportBadgeText}>INSPECTION REPORT</Text>
        </View>
      </View>

      {/* Divider */}
      <View style={styles.headerDivider}>
        <View style={styles.dividerLine} />
        <View style={styles.dividerAccent} />
      </View>

      {/* Report Meta Information */}
      <View style={styles.metaGrid}>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Report ID</Text>
          <Text style={styles.metaValue}>{report.reportId}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Inspection Date</Text>
          <Text style={styles.metaValue}>{formatDate(report.inspectionDate, 'short')}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Inspector</Text>
          <Text style={styles.metaValue}>{report.inspector.name}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Inspector ID</Text>
          <Text style={styles.metaValue}>{report.inspector.id}</Text>
        </View>
      </View>

      {/* Location & Equipment Info */}
      <View style={styles.infoCards}>
        <View style={styles.infoCard}>
          <View style={styles.infoCardHeader}>
            <MapPin size={16} color={THEME.neonCyan} />
            <Text style={styles.infoCardTitle}>Location</Text>
          </View>
          <Text style={styles.infoCardText}>{report.location.site}</Text>
          <Text style={styles.infoCardSubtext}>{report.location.unit}</Text>
          <Text style={styles.infoCardSubtext}>{report.location.area}</Text>
        </View>

        <View style={styles.infoCard}>
          <View style={styles.infoCardHeader}>
            <Settings size={16} color={THEME.neonCyan} />
            <Text style={styles.infoCardTitle}>Equipment</Text>
          </View>
          <Text style={styles.infoCardText}>{report.equipment.name}</Text>
          <Text style={styles.infoCardSubtext}>S/N: {report.equipment.serialNumber}</Text>
          <Text style={styles.infoCardSubtext}>{report.equipment.type}</Text>
        </View>
      </View>
    </View>
  );
};

// Summary Table Section
interface SummaryTableProps {
  summary: InspectionReport['summary'];
}

const SummaryTable: React.FC<SummaryTableProps> = ({ summary }) => {
  const passRate = Math.round((summary.passed / summary.totalItems) * 100);
  
  return (
    <View style={styles.documentSection}>
      <View style={styles.sectionHeader}>
        <BarChart3 size={20} color={THEME.neonCyan} />
        <Text style={styles.sectionTitle}>Inspection Summary</Text>
      </View>

      {/* Overall Status Banner */}
      <View style={[
        styles.statusBanner,
        summary.overallStatus === 'approved' && styles.statusBannerApproved,
        summary.overallStatus === 'rejected' && styles.statusBannerRejected,
        summary.overallStatus === 'pending' && styles.statusBannerPending,
      ]}>
        {summary.overallStatus === 'approved' ? (
          <CheckCircle2 size={24} color={THEME.successGreen} />
        ) : summary.overallStatus === 'rejected' ? (
          <XCircle size={24} color={THEME.alertRed} />
        ) : (
          <Clock size={24} color={THEME.warningOrange} />
        )}
        <Text style={[
          styles.statusBannerText,
          { color: summary.overallStatus === 'approved' ? THEME.successGreen : 
                   summary.overallStatus === 'rejected' ? THEME.alertRed : THEME.warningOrange }
        ]}>
          {summary.overallStatus.toUpperCase()}
        </Text>
      </View>

      {/* Stats Grid */}
      <View style={styles.statsGrid}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{summary.totalItems}</Text>
          <Text style={styles.statLabel}>Total Items</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: THEME.successGreen }]}>{summary.passed}</Text>
          <Text style={styles.statLabel}>Passed</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: THEME.alertRed }]}>{summary.failed}</Text>
          <Text style={styles.statLabel}>Failed</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: THEME.textMuted }]}>{summary.notApplicable}</Text>
          <Text style={styles.statLabel}>N/A</Text>
        </View>
      </View>

      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressLabel}>Pass Rate</Text>
          <Text style={styles.progressValue}>{passRate}%</Text>
        </View>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${passRate}%` }]} />
        </View>
        <View style={styles.progressLegend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: THEME.successGreen }]} />
            <Text style={styles.legendText}>Pass</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: THEME.alertRed }]} />
            <Text style={styles.legendText}>Fail</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: THEME.textMuted }]} />
            <Text style={styles.legendText}>N/A</Text>
          </View>
        </View>
      </View>
    </View>
  );
};

// Defects Section
interface DefectsSectionProps {
  items: InspectionItem[];
}

const DefectsSection: React.FC<DefectsSectionProps> = ({ items }) => {
  const failedItems = items.filter(item => item.status === 'fail');

  if (failedItems.length === 0) {
    return (
      <View style={styles.documentSection}>
        <View style={styles.sectionHeader}>
          <AlertTriangle size={20} color={THEME.alertRed} />
          <Text style={styles.sectionTitle}>Defects Found</Text>
        </View>
        <View style={styles.noDefectsContainer}>
          <CheckCircle2 size={40} color={THEME.successGreen} />
          <Text style={styles.noDefectsText}>No defects found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.documentSection}>
      <View style={styles.sectionHeader}>
        <AlertTriangle size={20} color={THEME.alertRed} />
        <Text style={styles.sectionTitle}>Defects Found ({failedItems.length})</Text>
      </View>

      {failedItems.map((item, index) => (
        <View key={item.id} style={styles.defectCard}>
          {/* Defect Header */}
          <View style={styles.defectHeader}>
            <View style={styles.defectNumberBadge}>
              <Text style={styles.defectNumber}>{index + 1}</Text>
            </View>
            <View style={styles.defectTitleContainer}>
              <Text style={styles.defectTitle}>{item.name}</Text>
              {item.severity && (
                <View style={[
                  styles.severityBadge,
                  { backgroundColor: `${getSeverityColor(item.severity)}20` }
                ]}>
                  <Text style={[
                    styles.severityText,
                    { color: getSeverityColor(item.severity) }
                  ]}>
                    {item.severity.toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Defect Notes */}
          {item.notes && (
            <View style={styles.defectNotes}>
              <Text style={styles.defectNotesLabel}>Inspector Notes:</Text>
              <Text style={styles.defectNotesText}>{item.notes}</Text>
            </View>
          )}

          {/* Photo Evidence */}
          {item.photos && item.photos.length > 0 && (
            <View style={styles.photosContainer}>
              <Text style={styles.photosLabel}>Photo Evidence:</Text>
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                style={styles.photosScroll}
              >
                {item.photos.map((photo, photoIndex) => (
                  <TouchableOpacity key={photoIndex} style={styles.photoWrapper}>
                    <Image
                      source={{ uri: photo }}
                      style={styles.photoThumbnail}
                      resizeMode="cover"
                    />
                    <View style={styles.photoOverlay}>
                      <Maximize size={16} color={THEME.textPrimary} />
                    </View>
                    <View style={styles.photoBadge}>
                      <Text style={styles.photoBadgeText}>{photoIndex + 1}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      ))}
    </View>
  );
};

// Comments Section
interface CommentsSectionProps {
  comments: string;
}

const CommentsSection: React.FC<CommentsSectionProps> = ({ comments }) => {
  return (
    <View style={styles.documentSection}>
      <View style={styles.sectionHeader}>
        <MessageSquare size={20} color={THEME.neonCyan} />
        <Text style={styles.sectionTitle}>Additional Comments</Text>
      </View>
      <View style={styles.commentsBox}>
        <Text style={styles.commentsText}>{comments}</Text>
      </View>
    </View>
  );
};

// Signature Section
interface SignatureSectionProps {
  inspector: InspectionReport['inspector'];
  generatedDate: Date;
}

const SignatureSection: React.FC<SignatureSectionProps> = ({ inspector, generatedDate }) => {
  return (
    <View style={styles.documentSection}>
      <View style={styles.sectionHeader}>
        <PenTool size={20} color={THEME.neonCyan} />
        <Text style={styles.sectionTitle}>Digital Signature</Text>
      </View>

      <View style={styles.signatureContainer}>
        <View style={styles.signatureBox}>
          {/* Mock Signature */}
          <View style={styles.signatureMock}>
            <Text style={styles.signatureText}>{inspector.signature || inspector.name}</Text>
            <View style={styles.signatureUnderline} />
          </View>
          
          <View style={styles.signatureInfo}>
            <Text style={styles.signatureLabel}>Digitally signed by</Text>
            <Text style={styles.signatureName}>{inspector.name}</Text>
            <Text style={styles.signatureId}>ID: {inspector.id}</Text>
          </View>
        </View>

        <View style={styles.timestampBox}>
          <Clock size={16} color={THEME.textMuted} />
          <View style={styles.timestampInfo}>
            <Text style={styles.timestampLabel}>Generated On</Text>
            <Text style={styles.timestampValue}>{formatDate(generatedDate)}</Text>
          </View>
        </View>

        {/* Verification Badge */}
        <View style={styles.verificationBadge}>
          <ShieldCheck size={18} color={THEME.successGreen} />
          <Text style={styles.verificationText}>Digitally Verified</Text>
        </View>
      </View>

      {/* Footer Disclaimer */}
      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>
          This document is an official inspection report generated by NEXPEC Industrial Inspection System. 
          The digital signature above certifies the authenticity and accuracy of the information contained herein.
        </Text>
      </View>
    </View>
  );
};

// Document Footer
const DocumentFooter: React.FC = () => {
  return (
    <View style={styles.documentFooter}>
      <View style={styles.footerDivider} />
      <View style={styles.footerContent}>
        <Text style={styles.footerText}>NEXPEC Industrial Inspections</Text>
        <Text style={styles.footerDot}>•</Text>
        <Text style={styles.footerText}>Confidential</Text>
        <Text style={styles.footerDot}>•</Text>
        <Text style={styles.footerText}>Page 1 of 1</Text>
      </View>
      <Text style={styles.footerCopyright}>
        © 2024 NEXPEC Corp. All rights reserved.
      </Text>
    </View>
  );
};

// Floating Action Button
interface FABProps {
  onPress: () => void;
}

const FloatingActionButton: React.FC<FABProps> = ({ onPress }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.9,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[styles.fabContainer, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        style={styles.fab}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.9}
      >
        <View style={styles.fabContent}>
          <Printer size={22} color="#FFFFFF" />
          <Text style={styles.fabText}>Print / Export</Text>
        </View>
      </TouchableOpacity>
      {/* Glow Effect */}
      <View style={styles.fabGlow} />
    </Animated.View>
  );
};

// ============================================
// MAIN SCREEN COMPONENT
// ============================================

const ReportViewerScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const scrollViewRef = useRef<ScrollView>(null);
  const [report] = useState<InspectionReport>(mockReport);

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleShare = useCallback(async () => {
    try {
      await Share.share({
        message: `NEXPEC Inspection Report #${report.reportId}\n\nInspection Date: ${formatDate(report.inspectionDate, 'short')}\nInspector: ${report.inspector.name}\nStatus: ${report.summary.overallStatus.toUpperCase()}\n\nSummary:\n- Total Items: ${report.summary.totalItems}\n- Passed: ${report.summary.passed}\n- Failed: ${report.summary.failed}`,
        title: `Report #${report.reportId}`,
      });
    } catch (error) {
      console.error('Share error:', error);
    }
  }, [report]);

  const handleDownload = useCallback(() => {
    Alert.alert(
      'Download Report',
      'Choose download format:',
      [
        { text: 'PDF Document', onPress: () => console.log('Download PDF') },
        { text: 'Excel Spreadsheet', onPress: () => console.log('Download Excel') },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }, []);

  const handlePrintExport = useCallback(() => {
    Alert.alert(
      'Print / Export',
      'Select an option:',
      [
        { text: 'Print', onPress: () => console.log('Print') },
        { text: 'Export as PDF', onPress: () => console.log('Export PDF') },
        { text: 'Send via Email', onPress: () => console.log('Email') },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={THEME.darkBg} />

      <Header
        reportId={report.reportId}
        onBack={handleBack}
        onShare={handleShare}
        onDownload={handleDownload}
      />

      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Document Container - Paper Effect */}
        <View style={styles.documentContainer}>
          {/* Paper Shadow Effect */}
          <View style={styles.paperShadow} />
          
          {/* Main Document */}
          <View style={styles.document}>
            {/* Document Edge Accent */}
            <View style={styles.documentEdge} />
            
            <DocumentHeader report={report} />
            <SummaryTable summary={report.summary} />
            <DefectsSection items={report.items} />
            <CommentsSection comments={report.comments} />
            <SignatureSection 
              inspector={report.inspector} 
              generatedDate={report.generatedDate} 
            />
            <DocumentFooter />
          </View>
        </View>

        {/* Bottom Spacing for FAB */}
        <View style={styles.fabSpacer} />
      </ScrollView>

      <FloatingActionButton onPress={handlePrintExport} />
    </SafeAreaView>
  );
};

// ============================================
// STYLES
// ============================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.darkBg,
  },

  // Header Styles
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: THEME.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleContainer: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: THEME.textPrimary,
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.neonCyan,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  headerActionButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: THEME.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Scroll View
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: DOCUMENT_MARGIN,
    paddingBottom: 100,
  },

  // Document Container
  documentContainer: {
    position: 'relative',
  },
  paperShadow: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: -8,
    bottom: -8,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 8,
  },
  document: {
    backgroundColor: THEME.paperBg,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: THEME.paperBorder,
  },
  documentEdge: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: THEME.neonCyan,
  },

  // Document Header
  documentHeader: {
    padding: 24,
    paddingLeft: 28,
    borderBottomWidth: 1,
    borderBottomColor: THEME.paperBorder,
  },
  companySection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: `${THEME.neonCyan}20`,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  logoText: {
    justifyContent: 'center',
  },
  companyName: {
    fontSize: 24,
    fontWeight: '800',
    color: THEME.textPrimary,
    letterSpacing: 2,
  },
  companyTagline: {
    fontSize: 11,
    fontWeight: '500',
    color: THEME.textSecondary,
    letterSpacing: 1,
    marginTop: 2,
  },
  reportBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: THEME.surfaceLight,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: THEME.paperBorder,
  },
  reportBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: THEME.textSecondary,
    letterSpacing: 1,
  },
  headerDivider: {
    marginBottom: 20,
  },
  dividerLine: {
    height: 1,
    backgroundColor: THEME.paperBorder,
  },
  dividerAccent: {
    width: 60,
    height: 3,
    backgroundColor: THEME.neonCyan,
    marginTop: -2,
    borderRadius: 2,
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 20,
    marginHorizontal: -8,
  },
  metaItem: {
    width: '50%',
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  metaLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: THEME.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  metaValue: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME.textDark,
  },
  infoCards: {
    flexDirection: 'row',
    gap: 12,
  },
  infoCard: {
    flex: 1,
    padding: 14,
    backgroundColor: THEME.paperBgLight,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.paperBorder,
  },
  infoCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  infoCardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.neonCyan,
    marginLeft: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoCardText: {
    fontSize: 13,
    fontWeight: '600',
    color: THEME.textDark,
    marginBottom: 4,
  },
  infoCardSubtext: {
    fontSize: 11,
    color: THEME.textSecondary,
    marginBottom: 2,
  },

  // Document Section
  documentSection: {
    padding: 24,
    paddingLeft: 28,
    borderBottomWidth: 1,
    borderBottomColor: THEME.paperBorder,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME.textPrimary,
    marginLeft: 10,
  },

  // Summary Section
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 8,
    marginBottom: 20,
  },
  statusBannerApproved: {
    backgroundColor: `${THEME.successGreen}15`,
    borderWidth: 1,
    borderColor: `${THEME.successGreen}30`,
  },
  statusBannerRejected: {
    backgroundColor: `${THEME.alertRed}15`,
    borderWidth: 1,
    borderColor: `${THEME.alertRed}30`,
  },
  statusBannerPending: {
    backgroundColor: `${THEME.warningOrange}15`,
    borderWidth: 1,
    borderColor: `${THEME.warningOrange}30`,
  },
  statusBannerText: {
    fontSize: 16,
    fontWeight: '800',
    marginLeft: 10,
    letterSpacing: 2,
  },
  statsGrid: {
    flexDirection: 'row',
    backgroundColor: THEME.paperBgLight,
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    color: THEME.textPrimary,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: THEME.textMuted,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statDivider: {
    width: 1,
    backgroundColor: THEME.paperBorder,
    marginVertical: 4,
  },
  progressContainer: {
    marginTop: 4,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.textSecondary,
  },
  progressValue: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.neonCyan,
  },
  progressBar: {
    height: 8,
    backgroundColor: THEME.surfaceLight,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: THEME.successGreen,
    borderRadius: 4,
  },
  progressLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 12,
    gap: 20,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  legendText: {
    fontSize: 11,
    color: THEME.textSecondary,
  },

  // Defects Section
  noDefectsContainer: {
    alignItems: 'center',
    padding: 30,
    backgroundColor: THEME.paperBgLight,
    borderRadius: 8,
  },
  noDefectsText: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME.textSecondary,
    marginTop: 10,
  },
  defectCard: {
    backgroundColor: THEME.paperBgLight,
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: THEME.alertRed,
  },
  defectHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  defectNumberBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: THEME.alertRed,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  defectNumber: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.textPrimary,
  },
  defectTitleContainer: {
    flex: 1,
  },
  defectTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.textDark,
    marginBottom: 6,
  },
  severityBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  severityText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  defectNotes: {
    marginBottom: 12,
    paddingLeft: 40,
  },
  defectNotesLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: THEME.textMuted,
    marginBottom: 4,
  },
  defectNotesText: {
    fontSize: 13,
    color: THEME.textSecondary,
    lineHeight: 18,
  },
  photosContainer: {
    paddingLeft: 40,
  },
  photosLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: THEME.textMuted,
    marginBottom: 8,
  },
  photosScroll: {
    marginHorizontal: -4,
  },
  photoWrapper: {
    position: 'relative',
    marginHorizontal: 4,
  },
  photoThumbnail: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: THEME.surfaceLight,
  },
  photoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0,
  },
  photoBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: THEME.darkBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: THEME.textPrimary,
  },

  // Comments Section
  commentsBox: {
    padding: 16,
    backgroundColor: THEME.paperBgLight,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: THEME.neonCyan,
  },
  commentsText: {
    fontSize: 13,
    color: THEME.textSecondary,
    lineHeight: 20,
    fontStyle: 'italic',
  },

  // Signature Section
  signatureContainer: {
    backgroundColor: THEME.paperBgLight,
    borderRadius: 8,
    padding: 20,
    marginBottom: 16,
  },
  signatureBox: {
    marginBottom: 16,
  },
  signatureMock: {
    alignItems: 'center',
    marginBottom: 16,
  },
  signatureText: {
    fontSize: 28,
    fontFamily: Platform.OS === 'ios' ? 'Snell Roundhand' : 'cursive',
    color: THEME.textPrimary,
    fontWeight: '400',
    fontStyle: 'italic',
  },
  signatureUnderline: {
    width: 180,
    height: 1,
    backgroundColor: THEME.textMuted,
    marginTop: 8,
  },
  signatureInfo: {
    alignItems: 'center',
  },
  signatureLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: THEME.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  signatureName: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.textDark,
  },
  signatureId: {
    fontSize: 12,
    color: THEME.textSecondary,
    marginTop: 2,
  },
  timestampBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: THEME.paperBorder,
  },
  timestampInfo: {
    marginLeft: 10,
  },
  timestampLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: THEME.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  timestampValue: {
    fontSize: 12,
    color: THEME.textSecondary,
  },
  verificationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    paddingVertical: 8,
    backgroundColor: `${THEME.successGreen}15`,
    borderRadius: 6,
  },
  verificationText: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.successGreen,
    marginLeft: 6,
  },
  disclaimer: {
    padding: 12,
    backgroundColor: THEME.surfaceLight,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: THEME.paperBorder,
  },
  disclaimerText: {
    fontSize: 10,
    color: THEME.textMuted,
    lineHeight: 15,
    textAlign: 'center',
  },

  // Document Footer
  documentFooter: {
    padding: 20,
    paddingLeft: 28,
    alignItems: 'center',
  },
  footerDivider: {
    width: '100%',
    height: 1,
    backgroundColor: THEME.paperBorder,
    marginBottom: 16,
  },
  footerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  footerText: {
    fontSize: 10,
    color: THEME.textMuted,
  },
  footerDot: {
    fontSize: 10,
    color: THEME.textMuted,
    marginHorizontal: 8,
  },
  footerCopyright: {
    fontSize: 9,
    color: THEME.textMuted,
    opacity: 0.7,
  },

  // FAB
  fabSpacer: {
    height: 80,
  },
  fabContainer: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    backgroundColor: THEME.neonCyan,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 30,
    shadowColor: THEME.neonCyan,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  fabContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fabText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginLeft: 8,
  },
  fabGlow: {
    position: 'absolute',
    width: 160,
    height: 60,
    borderRadius: 30,
    backgroundColor: THEME.neonCyan,
    opacity: 0.2,
    zIndex: -1,
  },
});

export default ReportViewerScreen;
