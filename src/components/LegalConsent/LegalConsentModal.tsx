// src/components/LegalConsent/LegalConsentModal.tsx

import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Dimensions,
  Platform,
  StatusBar,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  FadeIn,
  SlideInUp,
  SlideInDown,
  FadeOut,
} from 'react-native-reanimated';
import { Controller } from 'react-hook-form';
import { 
  ShieldCheck, 
  X, 
  AlertTriangle, 
  Clock, 
  MapPin,
  Info,
  Lock,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { PolicyScrollView } from './PolicyScrollView';
import { ConsentCheckbox } from './ConsentCheckbox';
import { SignaturePad } from './SignaturePad';
import { VerifiedAnimation } from './VerifiedAnimation';
import { useLegalConsent } from '../../hooks/useLegalConsent';
import { ConsentGatewayProps, LegalConsentResult } from '../../types/consent.types';
import { DEFAULT_LEGAL_TEXT, CONSENT_CHECKBOXES } from '../../constants/legalText';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export const LegalConsentModal: React.FC<ConsentGatewayProps> = ({
  visible,
  onClose,
  onConsentComplete,
  userId,
  documentId,
  documentTitle = 'Confidential Project Documents',
  policyVersion = '2.1.0',
  customPolicyText,
  requireAllConsents = true,
  expirationDays = 365,
}) => {
  const [showSuccess, setShowSuccess] = useState(false);
  const [consentResult, setConsentResult] = useState<LegalConsentResult | null>(null);

  const {
    form,
    status,
    hasScrolledToBottom,
    signatureData,
    metadata,
    error,
    isSubmitting,
    canSubmit,
    setHasScrolledToBottom,
    setSignatureData,
    clearSignature,
    submitConsent,
    resetForm,
    fetchMetadata,
  } = useLegalConsent({
    userId,
    documentId,
    policyVersion,
    onSuccess: (result) => {
      setConsentResult(result);
      setShowSuccess(true);
    },
    onError: (err) => {
      Alert.alert(
        'Submission Error',
        err.message || 'Failed to record consent. Please try again.',
        [{ text: 'OK' }]
      );
    },
  });

  const { control, formState: { errors } } = form;

  // Fetch metadata when modal opens
  useEffect(() => {
    if (visible) {
      fetchMetadata();
    }
  }, [visible, fetchMetadata]);

  // Handle close with confirmation
  const handleClose = useCallback(() => {
    if (hasScrolledToBottom || signatureData) {
      Alert.alert(
        'Cancel Consent?',
        'Your progress will be lost. Are you sure you want to exit?',
        [
          { text: 'Continue Signing', style: 'cancel' },
          {
            text: 'Exit',
            style: 'destructive',
            onPress: () => {
              resetForm();
              onClose();
            },
          },
        ]
      );
    } else {
      resetForm();
      onClose();
    }
  }, [hasScrolledToBottom, signatureData, resetForm, onClose]);

  // Handle successful animation completion
  const handleAnimationComplete = useCallback(() => {
    setTimeout(() => {
      setShowSuccess(false);
      if (consentResult) {
        onConsentComplete(consentResult);
      }
      resetForm();
      onClose();
    }, 1500);
  }, [consentResult, onConsentComplete, resetForm, onClose]);

  // Handle submit
  const handleSubmit = async () => {
    const result = await submitConsent();
    // Success/error is handled by the hook callbacks
  };

  const policyText = customPolicyText || DEFAULT_LEGAL_TEXT;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <StatusBar barStyle="light-content" backgroundColor="#020420" />
      
      <View style={styles.container}>
        {/* Background Gradient */}
        <LinearGradient
          colors={['#020420', '#0F172A', '#020420']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />

        {/* Header */}
        <Animated.View 
          entering={SlideInDown.duration(400)}
          style={styles.header}
        >
          <View style={styles.headerContent}>
            <View style={styles.headerLeft}>
              <View style={styles.iconContainer}>
                <ShieldCheck size={28} color="#7C3AED" />
              </View>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Legal Consent Required</Text>
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {documentTitle}
                </Text>
              </View>
            </View>
            
            <TouchableOpacity
              style={styles.closeButton}
              onPress={handleClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <X size={24} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Metadata Bar */}
          {metadata && (
            <View style={styles.metadataBar}>
              <View style={styles.metadataItem}>
                <Clock size={12} color="#64748B" />
                <Text style={styles.metadataText}>
                  {new Date().toLocaleDateString()}
                </Text>
              </View>
              <View style={styles.metadataDivider} />
              <View style={styles.metadataItem}>
                <MapPin size={12} color="#64748B" />
                <Text style={styles.metadataText}>
                  IP: {metadata.ipAddress.substring(0, 15)}...
                </Text>
              </View>
              <View style={styles.metadataDivider} />
              <View style={styles.metadataItem}>
                <Lock size={12} color="#64748B" />
                <Text style={styles.metadataText}>v{policyVersion}</Text>
              </View>
            </View>
          )}
        </Animated.View>

        {/* Main Content */}
        <KeyboardAvoidingView 
          style={styles.keyboardView}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            style={styles.mainScroll}
            contentContainerStyle={styles.mainScrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Section 1: Legal Policy */}
            <Animated.View 
              entering={FadeIn.delay(200)}
              style={styles.section}
            >
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionNumber}>1</Text>
                <Text style={styles.sectionTitle}>Review Legal Agreement</Text>
                {hasScrolledToBottom && (
                  <View style={styles.completedBadge}>
                    <Text style={styles.completedText}>✓</Text>
                  </View>
                )}
              </View>
              
              <View style={styles.policyContainer}>
                <PolicyScrollView
                  policyText={policyText}
                  onScrolledToBottom={setHasScrolledToBottom}
                  hasScrolledToBottom={hasScrolledToBottom}
                />
              </View>
            </Animated.View>

            {/* Section 2: Consent Checkboxes */}
            <Animated.View 
              entering={FadeIn.delay(300)}
              style={[styles.section, !hasScrolledToBottom && styles.sectionDisabled]}
            >
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionNumber}>2</Text>
                <Text style={styles.sectionTitle}>Confirm Your Consent</Text>
              </View>

              {!hasScrolledToBottom && (
                <View style={styles.warningBanner}>
                  <AlertTriangle size={16} color="#F59E0B" />
                  <Text style={styles.warningText}>
                    Please scroll to the end of the document above to continue
                  </Text>
                </View>
              )}

              <View style={styles.checkboxContainer}>
                {CONSENT_CHECKBOXES.map((checkbox) => (
                  <Controller
                    key={checkbox.id}
                    control={control}
                    name={checkbox.id}
                    render={({ field: { onChange, value } }) => (
                      <ConsentCheckbox
                        id={checkbox.id}
                        label={checkbox.label}
                        description={checkbox.description}
                        checked={value}
                        required={checkbox.required}
                        disabled={!hasScrolledToBottom}
                        error={errors[checkbox.id]?.message}
                        onToggle={onChange}
                      />
                    )}
                  />
                ))}
              </View>
            </Animated.View>

            {/* Section 3: Signature */}
            <Animated.View 
              entering={FadeIn.delay(400)}
              style={[
                styles.section, 
                (!hasScrolledToBottom || Object.keys(errors).length > 0) && styles.sectionDisabled
              ]}
            >
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionNumber}>3</Text>
                <Text style={styles.sectionTitle}>Electronic Signature</Text>
                {signatureData && !signatureData.isEmpty && (
                  <View style={styles.completedBadge}>
                    <Text style={styles.completedText}>✓</Text>
                  </View>
                )}
              </View>

              <View style={styles.signatureInfo}>
                <Info size={14} color="#7C3AED" />
                <Text style={styles.signatureInfoText}>
                  By signing below, you confirm that you have read and understood all terms 
                  and agree to be legally bound by this agreement.
                </Text>
              </View>

              <SignaturePad
                onSignatureChange={setSignatureData}
                signatureData={signatureData}
                disabled={!hasScrolledToBottom || Object.keys(errors).length > 0}
              />
            </Animated.View>

            {/* Error Display */}
            {error && (
              <Animated.View 
                entering={FadeIn}
                exiting={FadeOut}
                style={styles.errorBanner}
              >
                <AlertTriangle size={18} color="#EF4444" />
                <Text style={styles.errorBannerText}>{error}</Text>
              </Animated.View>
            )}

            {/* Bottom Spacer */}
            <View style={styles.bottomSpacer} />
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Footer with Submit Button */}
        <Animated.View 
          entering={SlideInUp.delay(500)}
          style={styles.footer}
        >
          <LinearGradient
            colors={['transparent', '#020420']}
            style={styles.footerGradient}
          />
          <View style={styles.footerContent}>
            <View style={styles.footerInfo}>
              <Text style={styles.footerInfoText}>
                {canSubmit 
                  ? 'Ready to submit your consent'
                  : 'Complete all steps above to continue'
                }
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.submitButton,
                !canSubmit && styles.submitButtonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={!canSubmit || isSubmitting}
              activeOpacity={0.8}
            >
              {isSubmitting ? (
                <>
                  <ActivityIndicator color="#FFFFFF" size="small" />
                  <Text style={styles.submitButtonText}>Submitting...</Text>
                </>
              ) : (
                <>
                  <ShieldCheck size={22} color="#FFFFFF" />
                  <Text style={styles.submitButtonText}>
                    Accept & Sign Agreement
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* Success Animation Overlay */}
        <VerifiedAnimation
          visible={showSuccess}
          onAnimationComplete={handleAnimationComplete}
          userName={userId}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020420',
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : StatusBar.currentHeight || 40,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: '#0F172A',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 2,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  metadataBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  metadataItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metadataText: {
    color: '#64748B',
    fontSize: 11,
  },
  metadataDivider: {
    width: 1,
    height: 12,
    backgroundColor: '#334155',
    marginHorizontal: 12,
  },
  keyboardView: {
    flex: 1,
  },
  mainScroll: {
    flex: 1,
  },
  mainScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionDisabled: {
    opacity: 0.6,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#7C3AED',
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 28,
    marginRight: 12,
    overflow: 'hidden',
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
    flex: 1,
  },
  completedBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
  },
  completedText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  policyContainer: {
    height: 300,
    borderRadius: 12,
    overflow: 'hidden',
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    padding: 14,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    gap: 10,
  },
  warningText: {
    color: '#F59E0B',
    fontSize: 13,
    flex: 1,
    fontWeight: '500',
  },
  checkboxContainer: {
    gap: 0,
  },
  signatureInfo: {
    flexDirection: 'row',
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    padding: 14,
    borderRadius: 10,
    marginBottom: 16,
    gap: 10,
    alignItems: 'flex-start',
  },
  signatureInfoText: {
    color: '#CBD5E1',
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    padding: 14,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    gap: 10,
  },
  errorBannerText: {
    color: '#EF4444',
    fontSize: 13,
    flex: 1,
    fontWeight: '500',
  },
  bottomSpacer: {
    height: 120,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  footerGradient: {
    height: 30,
  },
  footerContent: {
    backgroundColor: '#020420',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  footerInfo: {
    marginBottom: 14,
  },
  footerInfoText: {
    color: '#64748B',
    fontSize: 13,
    textAlign: 'center',
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#7C3AED',
    paddingVertical: 18,
    borderRadius: 14,
    gap: 10,
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  submitButtonDisabled: {
    backgroundColor: '#334155',
    shadowOpacity: 0,
    elevation: 0,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
});

export default LegalConsentModal;