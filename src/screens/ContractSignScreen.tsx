import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  PanResponder,
  Dimensions,
  StatusBar,
  Platform,
  Alert,
  GestureResponderEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';

// ============================================================================
// THEME & CONSTANTS
// ============================================================================

const COLORS = {
  // Primary Theme
  background: '#0A0E17',
  surface: '#111827',
  surfaceLight: '#1F2937',
  surfaceHighlight: '#2D3748',
  
  // Document Colors
  document: '#1E2433',
  documentBorder: '#374151',
  documentText: '#E5E7EB',
  
  // Accent Colors
  primary: '#00F5FF',
  primaryDark: '#00C4CC',
  primaryGlow: 'rgba(0, 245, 255, 0.15)',
  
  // Text Colors
  text: '#FFFFFF',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  
  // Status Colors
  success: '#10B981',
  successBg: 'rgba(16, 185, 129, 0.15)',
  warning: '#F59E0B',
  error: '#EF4444',
  
  // Signature Pad
  signatureBg: '#F9FAFB',
  signatureStroke: '#1F2937',
  signaturePlaceholder: '#9CA3AF',
  
  // UI Elements
  border: '#374151',
  disabled: '#4B5563',
  disabledText: '#6B7280',
  checkboxBorder: '#6B7280',
  checkboxActive: '#00F5FF',
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SIGNATURE_PAD_HEIGHT = 180;

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface Point {
  x: number;
  y: number;
}

interface SignaturePath {
  points: Point[];
  color: string;
  width: number;
}

interface CheckboxState {
  nda: boolean;
  liability: boolean;
}

// ============================================================================
// CONTRACT TEXT DATA
// ============================================================================

const CONTRACT_SECTIONS = [
  {
    id: 'header',
    title: 'SERVICE AGREEMENT',
    subtitle: 'Non-Disclosure & Liability Contract',
  },
  {
    id: 'parties',
    title: 'PARTIES',
    content: `This Agreement ("Agreement") is entered into as of the date of digital signature below, by and between:

NEXPEC Corporation ("Company"), a petroleum and energy corporation with principal offices located at Industrial Zone, Sector 7, and

The undersigned Service Provider ("Contractor"), as identified through the NEXPEC Field Operations Platform.

Both parties agree to the terms and conditions set forth in this Agreement.`,
  },
  {
    id: 'nda',
    title: '1. NON-DISCLOSURE AGREEMENT (NDA)',
    content: `1.1 CONFIDENTIAL INFORMATION
The Contractor acknowledges that during the course of engagement, they may have access to and become acquainted with confidential and proprietary information belonging to NEXPEC Corporation, including but not limited to:

• Technical specifications and engineering data
• Operational procedures and safety protocols
• Client information and project details
• Financial data and pricing structures
• Trade secrets and intellectual property
• Security systems and access credentials

1.2 NON-DISCLOSURE OBLIGATIONS
The Contractor agrees to:
a) Hold all Confidential Information in strict confidence
b) Not disclose any Confidential Information to third parties without prior written consent
c) Use Confidential Information solely for the purpose of performing contracted services
d) Return or destroy all Confidential Information upon termination of engagement

1.3 DURATION
This non-disclosure obligation shall remain in effect for a period of five (5) years following the termination of this Agreement or the completion of services, whichever occurs later.

1.4 REMEDIES
The Contractor acknowledges that any breach of this NDA may cause irreparable harm to NEXPEC Corporation, entitling the Company to seek injunctive relief in addition to any other legal remedies.`,
  },
  {
    id: 'scope',
    title: '2. SCOPE OF WORK',
    content: `2.1 SERVICES
The Contractor shall perform the following services as assigned through the NEXPEC Field Operations Platform:

• Equipment inspection and maintenance
• Safety compliance verification
• Technical assessments and reporting
• Emergency response as required
• Documentation and digital reporting

2.2 STANDARDS
All work shall be performed in accordance with:
• Industry best practices and standards
• NEXPEC operational procedures
• Applicable local and international regulations
• Safety Management System (SMS) requirements

2.3 REPORTING
The Contractor shall maintain accurate records and submit timely reports through the designated digital platform, including:
• Daily activity logs
• Equipment inspection reports
• Incident reports (if applicable)
• Photographic documentation as required

2.4 EQUIPMENT
The Contractor shall be responsible for maintaining assigned equipment in good working condition and reporting any malfunctions or calibration requirements immediately.`,
  },
  {
    id: 'liability',
    title: '3. LIABILITY WAIVER',
    content: `3.1 ASSUMPTION OF RISK
The Contractor acknowledges and accepts that petroleum and energy operations involve inherent risks, including but not limited to:

• Exposure to hazardous materials and chemicals
• Working at heights and in confined spaces
• Operation of heavy machinery and equipment
• Exposure to extreme temperatures and weather conditions
• Potential for fires, explosions, or equipment failures
• Remote location operations with limited emergency access

3.2 RELEASE OF LIABILITY
To the maximum extent permitted by law, the Contractor hereby releases, waives, and discharges NEXPEC Corporation, its officers, employees, and agents from any and all liability, claims, demands, or causes of action arising from or related to any loss, damage, or injury that may be sustained while performing services under this Agreement.

3.3 INDEMNIFICATION
The Contractor agrees to indemnify, defend, and hold harmless NEXPEC Corporation from any claims, damages, or expenses arising from:
a) The Contractor's negligence or willful misconduct
b) Breach of this Agreement
c) Violation of any applicable laws or regulations
d) Injury to third parties caused by the Contractor's actions

3.4 INSURANCE
The Contractor shall maintain appropriate personal and professional liability insurance coverage as required by NEXPEC Corporation policies.

3.5 SAFETY COMPLIANCE
The Contractor agrees to:
• Strictly adhere to all safety protocols and procedures
• Use all required personal protective equipment (PPE)
• Report any safety hazards or incidents immediately
• Participate in required safety briefings and training
• Refuse to perform any work deemed unsafe

3.6 MEDICAL FITNESS
The Contractor certifies that they are physically and mentally fit to perform the required services and have disclosed any conditions that may affect their ability to work safely.`,
  },
  {
    id: 'general',
    title: '4. GENERAL PROVISIONS',
    content: `4.1 TERM
This Agreement shall commence upon digital signature and remain in effect for the duration of the assigned project or until terminated by either party.

4.2 TERMINATION
Either party may terminate this Agreement with written notice. Termination shall not affect any obligations that have accrued prior to the termination date.

4.3 GOVERNING LAW
This Agreement shall be governed by and construed in accordance with applicable laws and regulations.

4.4 ENTIRE AGREEMENT
This Agreement constitutes the entire understanding between the parties and supersedes all prior negotiations, representations, or agreements.

4.5 AMENDMENTS
Any modifications to this Agreement must be made in writing and signed by both parties.

4.6 SEVERABILITY
If any provision of this Agreement is found to be unenforceable, the remaining provisions shall continue in full force and effect.

4.7 DIGITAL SIGNATURE
The parties agree that digital signatures shall have the same legal effect as handwritten signatures.`,
  },
  {
    id: 'acknowledgment',
    title: 'ACKNOWLEDGMENT',
    content: `By signing below, the Contractor acknowledges that they have:

✓ Read and understood all terms and conditions of this Agreement
✓ Had the opportunity to seek independent legal advice
✓ Voluntarily agreed to be bound by the terms of this Agreement
✓ Received no promises or representations not contained herein
✓ Authority to enter into this Agreement`,
  },
];

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// Animated Checkbox Component
const AnimatedCheckbox: React.FC<{
  checked: boolean;
  onPress: () => void;
  label: string;
  sublabel?: string;
  required?: boolean;
}> = ({ checked, onPress, label, sublabel, required = true }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const checkAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(checkAnim, {
      toValue: checked ? 1 : 0,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();
  }, [checked]);

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      tension: 100,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[
          styles.checkboxContainer,
          checked && styles.checkboxContainerActive,
        ]}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.9}
      >
        <View
          style={[
            styles.checkbox,
            checked && styles.checkboxChecked,
          ]}
        >
          <Animated.View
            style={[
              styles.checkmark,
              {
                opacity: checkAnim,
                transform: [{
                  scale: checkAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.5, 1],
                  }),
                }],
              },
            ]}
          >
            <Text style={styles.checkmarkText}>✓</Text>
          </Animated.View>
        </View>
        
        <View style={styles.checkboxTextContainer}>
          <View style={styles.checkboxLabelRow}>
            <Text style={styles.checkboxLabel}>{label}</Text>
            {required && (
              <View style={styles.requiredBadge}>
                <Text style={styles.requiredBadgeText}>Required</Text>
              </View>
            )}
          </View>
          {sublabel && (
            <Text style={styles.checkboxSublabel}>{sublabel}</Text>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Progress Indicator Component
const ProgressIndicator: React.FC<{
  scrolled: boolean;
  ndaChecked: boolean;
  liabilityChecked: boolean;
  signed: boolean;
}> = ({ scrolled, ndaChecked, liabilityChecked, signed }) => {
  const steps = [
    { label: 'Read', completed: scrolled, icon: '📖' },
    { label: 'NDA', completed: ndaChecked, icon: '🔒' },
    { label: 'Liability', completed: liabilityChecked, icon: '⚖️' },
    { label: 'Sign', completed: signed, icon: '✍️' },
  ];

  return (
    <View style={styles.progressContainer}>
      {steps.map((step, index) => (
        <React.Fragment key={step.label}>
          <View style={styles.progressStep}>
            <View
              style={[
                styles.progressCircle,
                step.completed && styles.progressCircleCompleted,
              ]}
            >
              <Text style={styles.progressIcon}>
                {step.completed ? '✓' : step.icon}
              </Text>
            </View>
            <Text
              style={[
                styles.progressLabel,
                step.completed && styles.progressLabelCompleted,
              ]}
            >
              {step.label}
            </Text>
          </View>
          {index < steps.length - 1 && (
            <View
              style={[
                styles.progressLine,
                step.completed && styles.progressLineCompleted,
              ]}
            />
          )}
        </React.Fragment>
      ))}
    </View>
  );
};

// Signature Canvas Component using PanResponder
const SignatureCanvas: React.FC<{
  onSignatureChange: (hasSigned: boolean) => void;
  paths: SignaturePath[];
  setPaths: React.Dispatch<React.SetStateAction<SignaturePath[]>>;
}> = ({ onSignatureChange, paths, setPaths }) => {
  const [currentPath, setCurrentPath] = useState<Point[]>([]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        const { locationX, locationY } = evt.nativeEvent;
        setCurrentPath([{ x: locationX, y: locationY }]);
      },
      onPanResponderMove: (evt: GestureResponderEvent) => {
        const { locationX, locationY } = evt.nativeEvent;
        setCurrentPath(prev => [...prev, { x: locationX, y: locationY }]);
      },
      onPanResponderRelease: () => {
        if (currentPath.length > 0) {
          setPaths(prev => [
            ...prev,
            { points: currentPath, color: COLORS.signatureStroke, width: 2.5 },
          ]);
          onSignatureChange(true);
        }
        setCurrentPath([]);
      },
    })
  ).current;

  const renderPath = (path: SignaturePath, index: number) => {
    if (path.points.length < 2) return null;

    return (
      <View key={index} style={StyleSheet.absoluteFill}>
        {path.points.slice(1).map((point, i) => {
          const prevPoint = path.points[i];
          const dx = point.x - prevPoint.x;
          const dy = point.y - prevPoint.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);

          return (
            <View
              key={i}
              style={[
                styles.signatureLine,
                {
                  left: prevPoint.x,
                  top: prevPoint.y - path.width / 2,
                  width: distance,
                  height: path.width,
                  backgroundColor: path.color,
                  transform: [{ rotate: `${angle}deg` }],
                  transformOrigin: 'left center',
                },
              ]}
            />
          );
        })}
      </View>
    );
  };

  const renderCurrentPath = () => {
    if (currentPath.length < 2) return null;

    return (
      <View style={StyleSheet.absoluteFill}>
        {currentPath.slice(1).map((point, i) => {
          const prevPoint = currentPath[i];
          const dx = point.x - prevPoint.x;
          const dy = point.y - prevPoint.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);

          return (
            <View
              key={i}
              style={[
                styles.signatureLine,
                {
                  left: prevPoint.x,
                  top: prevPoint.y - 1.25,
                  width: distance,
                  height: 2.5,
                  backgroundColor: COLORS.signatureStroke,
                  transform: [{ rotate: `${angle}deg` }],
                  transformOrigin: 'left center',
                },
              ]}
            />
          );
        })}
      </View>
    );
  };

  const hasSigned = paths.length > 0 || currentPath.length > 0;

  return (
    <View
      style={styles.signatureCanvas}
      {...panResponder.panHandlers}
    >
      {/* Signature Lines Guide */}
      <View style={styles.signatureGuideLines}>
        <View style={styles.signatureGuideLine} />
      </View>

      {/* Placeholder Text */}
      {!hasSigned && (
        <View style={styles.signaturePlaceholder}>
          <Text style={styles.signaturePlaceholderIcon}>✍️</Text>
          <Text style={styles.signaturePlaceholderText}>
            Sign here
          </Text>
          <Text style={styles.signaturePlaceholderHint}>
            Use your finger to draw your signature
          </Text>
        </View>
      )}

      {/* Render Saved Paths */}
      {paths.map(renderPath)}

      {/* Render Current Path */}
      {renderCurrentPath()}

      {/* Signed Indicator */}
      {hasSigned && (
        <View style={styles.signedIndicator}>
          <Text style={styles.signedIndicatorText}>✓ Signed</Text>
        </View>
      )}
    </View>
  );
};

// Document Section Component
const DocumentSection: React.FC<{
  title: string;
  content?: string;
  subtitle?: string;
  isHeader?: boolean;
}> = ({ title, content, subtitle, isHeader }) => {
  if (isHeader) {
    return (
      <View style={styles.documentHeader}>
        <View style={styles.documentLogo}>
          <Text style={styles.documentLogoText}>N</Text>
        </View>
        <Text style={styles.documentHeaderTitle}>{title}</Text>
        <Text style={styles.documentHeaderSubtitle}>{subtitle}</Text>
        <View style={styles.documentDivider} />
      </View>
    );
  }

  return (
    <View style={styles.documentSection}>
      <Text style={styles.documentSectionTitle}>{title}</Text>
      <Text style={styles.documentSectionContent}>{content}</Text>
    </View>
  );
};

// ============================================================================
// MAIN SCREEN COMPONENT
// ============================================================================

const ContractSignScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const { inspectionId, nextScreen } = (route.params as { inspectionId?: string; nextScreen?: string }) || {};

  // State
  const [checkboxState, setCheckboxState] = useState<CheckboxState>({
    nda: false,
    liability: false,
  });
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [hasSigned, setHasSigned] = useState(false);
  const [signaturePaths, setSignaturePaths] = useState<SignaturePath[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Refs
  const scrollViewRef = useRef<ScrollView>(null);
  const fabAnim = useRef(new Animated.Value(0)).current;
  const headerAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Computed
  const canSubmit = useMemo(() => {
    return (
      hasScrolledToBottom &&
      checkboxState.nda &&
      checkboxState.liability &&
      hasSigned
    );
  }, [hasScrolledToBottom, checkboxState, hasSigned]);

  // Effects
  useEffect(() => {
    Animated.timing(headerAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, []);

  useEffect(() => {
    Animated.spring(fabAnim, {
      toValue: canSubmit ? 1 : 0,
      tension: 50,
      friction: 8,
      useNativeDriver: true,
    }).start();
  }, [canSubmit]);

  // Pulse animation for FAB when enabled
  useEffect(() => {
    if (canSubmit) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.02,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [canSubmit]);

  // Handlers
  const handleScroll = useCallback((event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const paddingToBottom = 50;
    const isAtBottom =
      layoutMeasurement.height + contentOffset.y >=
      contentSize.height - paddingToBottom;

    if (isAtBottom && !hasScrolledToBottom) {
      setHasScrolledToBottom(true);
    }
  }, [hasScrolledToBottom]);

  const handleCheckboxToggle = (key: keyof CheckboxState) => {
    setCheckboxState(prev => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleClearSignature = () => {
    setSignaturePaths([]);
    setHasSigned(false);
  };

  const handleSignatureChange = (signed: boolean) => {
    setHasSigned(signed);
  };

  const handleSubmit = async () => {
    if (!canSubmit || isSubmitting) return;

    setIsSubmitting(true);

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 2000));

    setIsSubmitting(false);

    Alert.alert(
      '✅ Contract Signed Successfully',
      'Your digital signature has been recorded. You may now proceed with the job.',
      [
        {
          text: 'Start Job',
          onPress: () => {
            // Replace the contract screen with the execution screen
            if (nextScreen === 'InspectionExecution') {
              navigation.replace('InspectionExecution', { inspectionId });
            } else {
              // Default: go back
              navigation.goBack();
            }
          },
        },
      ]
    );
  };

  const handleBack = () => {
    Alert.alert(
      'Leave Contract?',
      'Your progress will not be saved. Are you sure you want to leave?',
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => navigation.goBack() },
      ]
    );
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />

      {/* ===== HEADER ===== */}
      <Animated.View
        style={[
          styles.header,
          {
            opacity: headerAnim,
            transform: [{
              translateY: headerAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [-20, 0],
              }),
            }],
          },
        ]}
      >
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Service Agreement</Text>
          <Text style={styles.headerSubtitle}>Please review and sign</Text>
        </View>

        <View style={styles.headerRight}>
          <View style={styles.secureIndicator}>
            <Text style={styles.secureIcon}>🔒</Text>
            <Text style={styles.secureText}>Secure</Text>
          </View>
        </View>
      </Animated.View>

      {/* ===== PROGRESS INDICATOR ===== */}
      <ProgressIndicator
        scrolled={hasScrolledToBottom}
        ndaChecked={checkboxState.nda}
        liabilityChecked={checkboxState.liability}
        signed={hasSigned}
      />

      {/* ===== MAIN CONTENT ===== */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={true}
      >
        {/* Document Container */}
        <View style={styles.documentContainer}>
          {/* Document Content */}
          {CONTRACT_SECTIONS.map((section, index) => (
            <DocumentSection
              key={section.id}
              title={section.title}
              content={section.content}
              subtitle={section.subtitle}
              isHeader={section.id === 'header'}
            />
          ))}

          {/* Date and Reference */}
          <View style={styles.documentMeta}>
            <Text style={styles.documentMetaText}>
              Document Reference: NEXP-SA-{new Date().getFullYear()}-{Math.random().toString(36).substr(2, 6).toUpperCase()}
            </Text>
            <Text style={styles.documentMetaText}>
              Generated: {new Date().toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </Text>
          </View>
        </View>

        {/* Scroll Indicator */}
        {!hasScrolledToBottom && (
          <View style={styles.scrollIndicator}>
            <Text style={styles.scrollIndicatorIcon}>↓</Text>
            <Text style={styles.scrollIndicatorText}>
              Scroll to continue reading
            </Text>
          </View>
        )}

        {/* Read Confirmation */}
        {hasScrolledToBottom && (
          <View style={styles.readConfirmation}>
            <View style={styles.readConfirmationIcon}>
              <Text style={styles.readConfirmationIconText}>✓</Text>
            </View>
            <Text style={styles.readConfirmationText}>
              You have reviewed the entire document
            </Text>
          </View>
        )}

        {/* ===== AGREEMENT CHECKBOXES ===== */}
        <View style={styles.agreementSection}>
          <Text style={styles.sectionTitle}>Agreement Confirmation</Text>
          <Text style={styles.sectionSubtitle}>
            Please confirm your acceptance of the following terms
          </Text>

          <AnimatedCheckbox
            checked={checkboxState.nda}
            onPress={() => handleCheckboxToggle('nda')}
            label="I agree to the Non-Disclosure Agreement"
            sublabel="I understand my obligations regarding confidential information"
          />

          <AnimatedCheckbox
            checked={checkboxState.liability}
            onPress={() => handleCheckboxToggle('liability')}
            label="I accept the Liability Waiver"
            sublabel="I acknowledge the risks and release the company from liability"
          />
        </View>

        {/* ===== SIGNATURE SECTION ===== */}
        <View style={styles.signatureSection}>
          <View style={styles.signatureHeader}>
            <View>
              <Text style={styles.sectionTitle}>Digital Signature</Text>
              <Text style={styles.sectionSubtitle}>
                Draw your signature in the box below
              </Text>
            </View>
            
            {signaturePaths.length > 0 && (
              <TouchableOpacity
                style={styles.clearButton}
                onPress={handleClearSignature}
              >
                <Text style={styles.clearButtonText}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.signaturePadContainer}>
            <SignatureCanvas
              onSignatureChange={handleSignatureChange}
              paths={signaturePaths}
              setPaths={setSignaturePaths}
            />
          </View>

          <View style={styles.signatureInfo}>
            <Text style={styles.signatureInfoIcon}>ℹ️</Text>
            <Text style={styles.signatureInfoText}>
              Your digital signature is legally binding and will be timestamped
            </Text>
          </View>
        </View>

        {/* Bottom Spacing for FAB */}
        <View style={{ height: 120 }} />
      </ScrollView>

      {/* ===== FLOATING ACTION BUTTON ===== */}
      <Animated.View
        style={[
          styles.fabContainer,
          {
            transform: [
              { scale: canSubmit ? pulseAnim : 1 },
            ],
          },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.fab,
            !canSubmit && styles.fabDisabled,
            isSubmitting && styles.fabSubmitting,
          ]}
          onPress={handleSubmit}
          disabled={!canSubmit || isSubmitting}
          activeOpacity={0.8}
        >
          {isSubmitting ? (
            <View style={styles.fabLoading}>
              <Animated.View
                style={[
                  styles.fabLoadingDot,
                  { opacity: pulseAnim },
                ]}
              />
              <Text style={styles.fabLoadingText}>Submitting...</Text>
            </View>
          ) : (
            <>
              <View style={styles.fabIconContainer}>
                <Text style={styles.fabIcon}>{canSubmit ? '✓' : '🔒'}</Text>
              </View>
              <View style={styles.fabTextContainer}>
                <Text
                  style={[
                    styles.fabText,
                    !canSubmit && styles.fabTextDisabled,
                  ]}
                >
                  Confirm & Start Job
                </Text>
                {!canSubmit && (
                  <Text style={styles.fabHintText}>
                    Complete all steps above
                  </Text>
                )}
              </View>
            </>
          )}
        </TouchableOpacity>

        {/* Requirements Checklist */}
        {!canSubmit && (
          <View style={styles.requirementsList}>
            {!hasScrolledToBottom && (
              <Text style={styles.requirementItem}>• Read entire document</Text>
            )}
            {!checkboxState.nda && (
              <Text style={styles.requirementItem}>• Accept NDA</Text>
            )}
            {!checkboxState.liability && (
              <Text style={styles.requirementItem}>• Accept Liability Waiver</Text>
            )}
            {!hasSigned && (
              <Text style={styles.requirementItem}>• Provide signature</Text>
            )}
          </View>
        )}
      </Animated.View>
    </SafeAreaView>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  // Container
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 12 : 8,
    paddingBottom: 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: 24,
    color: COLORS.text,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  headerRight: {
    width: 44,
  },
  secureIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  secureIcon: {
    fontSize: 12,
  },
  secureText: {
    fontSize: 10,
    color: COLORS.success,
    marginLeft: 2,
    fontWeight: '600',
  },

  // Progress Indicator
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    paddingHorizontal: 20,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  progressStep: {
    alignItems: 'center',
  },
  progressCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surfaceLight,
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressCircleCompleted: {
    backgroundColor: COLORS.primaryGlow,
    borderColor: COLORS.primary,
  },
  progressIcon: {
    fontSize: 14,
  },
  progressLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  progressLabelCompleted: {
    color: COLORS.primary,
  },
  progressLine: {
    width: 40,
    height: 2,
    backgroundColor: COLORS.border,
    marginHorizontal: 8,
    marginBottom: 20,
    borderRadius: 1,
  },
  progressLineCompleted: {
    backgroundColor: COLORS.primary,
  },

  // Scroll View
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },

  // Document Container
  documentContainer: {
    margin: 16,
    backgroundColor: COLORS.document,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.documentBorder,
    overflow: 'hidden',
  },
  documentHeader: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
    backgroundColor: COLORS.surfaceHighlight,
  },
  documentLogo: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  documentLogoText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.background,
  },
  documentHeaderTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.text,
    textAlign: 'center',
    letterSpacing: 2,
  },
  documentHeaderSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 8,
    textAlign: 'center',
  },
  documentDivider: {
    width: 60,
    height: 3,
    backgroundColor: COLORS.primary,
    marginTop: 20,
    borderRadius: 2,
  },
  documentSection: {
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(55, 65, 81, 0.5)',
  },
  documentSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: 14,
    letterSpacing: 0.5,
  },
  documentSectionContent: {
    fontSize: 14,
    color: COLORS.documentText,
    lineHeight: 24,
    letterSpacing: 0.2,
  },
  documentMeta: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(55, 65, 81, 0.5)',
    backgroundColor: COLORS.surfaceLight,
  },
  documentMetaText: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 4,
  },

  // Scroll Indicator
  scrollIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    marginHorizontal: 16,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 12,
  },
  scrollIndicatorIcon: {
    fontSize: 18,
    color: COLORS.primary,
    marginRight: 8,
  },
  scrollIndicatorText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },

  // Read Confirmation
  readConfirmation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    marginHorizontal: 16,
    backgroundColor: COLORS.successBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.success,
  },
  readConfirmationIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.success,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  readConfirmationIconText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  readConfirmationText: {
    fontSize: 14,
    color: COLORS.success,
    fontWeight: '600',
  },

  // Agreement Section
  agreementSection: {
    margin: 16,
    padding: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 20,
  },

  // Checkbox Styles
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  checkboxContainerActive: {
    backgroundColor: COLORS.primaryGlow,
    borderColor: COLORS.primary,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.checkboxBorder,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  checkmark: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkText: {
    color: COLORS.background,
    fontSize: 16,
    fontWeight: 'bold',
  },
  checkboxTextContainer: {
    flex: 1,
  },
  checkboxLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  checkboxLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginRight: 8,
  },
  requiredBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  requiredBadgeText: {
    fontSize: 10,
    color: COLORS.warning,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  checkboxSublabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 4,
    lineHeight: 18,
  },

  // Signature Section
  signatureSection: {
    margin: 16,
    padding: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  signatureHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  clearButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  clearButtonText: {
    fontSize: 14,
    color: COLORS.error,
    fontWeight: '600',
  },
  signaturePadContainer: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  signatureCanvas: {
    height: SIGNATURE_PAD_HEIGHT,
    backgroundColor: COLORS.signatureBg,
    position: 'relative',
  },
  signatureGuideLines: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 40,
  },
  signatureGuideLine: {
    height: 1,
    backgroundColor: 'rgba(156, 163, 175, 0.5)',
  },
  signaturePlaceholder: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  signaturePlaceholderIcon: {
    fontSize: 32,
    marginBottom: 8,
    opacity: 0.5,
  },
  signaturePlaceholderText: {
    fontSize: 18,
    color: COLORS.signaturePlaceholder,
    fontWeight: '600',
  },
  signaturePlaceholderHint: {
    fontSize: 13,
    color: COLORS.signaturePlaceholder,
    marginTop: 4,
    opacity: 0.7,
  },
  signatureLine: {
    position: 'absolute',
    borderRadius: 1,
  },
  signedIndicator: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: COLORS.success,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  signedIndicatorText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '700',
  },
  signatureInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingHorizontal: 4,
  },
  signatureInfoIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  signatureInfoText: {
    fontSize: 13,
    color: COLORS.textMuted,
    flex: 1,
  },

  // FAB Container
  fabContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    paddingTop: 16,
    backgroundColor: 'rgba(10, 14, 23, 0.95)',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 18,
    borderRadius: 16,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
  },
  fabDisabled: {
    backgroundColor: COLORS.disabled,
    shadowOpacity: 0,
    elevation: 0,
  },
  fabSubmitting: {
    backgroundColor: COLORS.primaryDark,
  },
  fabIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(10, 14, 23, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  fabIcon: {
    fontSize: 18,
  },
  fabTextContainer: {
    alignItems: 'flex-start',
  },
  fabText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.background,
    letterSpacing: -0.3,
  },
  fabTextDisabled: {
    color: COLORS.disabledText,
  },
  fabHintText: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  fabLoading: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fabLoadingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.background,
    marginRight: 10,
  },
  fabLoadingText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.background,
  },
  requirementsList: {
    marginTop: 12,
    paddingHorizontal: 8,
  },
  requirementItem: {
    fontSize: 12,
    color: COLORS.warning,
    marginBottom: 4,
  },
});

export default ContractSignScreen;
