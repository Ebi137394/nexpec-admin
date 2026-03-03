// src/components/LegalConsent/SignaturePad.tsx

import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Dimensions,
  Platform,
  StatusBar,
} from 'react-native';
import SignatureScreen, { SignatureViewRef } from 'react-native-signature-canvas';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  FadeIn,
  FadeOut,
  SlideInUp,
  SlideOutDown,
} from 'react-native-reanimated';
import { Pen, Eraser, Check, X, Maximize2, RotateCcw } from 'lucide-react-native';
import { SignatureData } from '../../types/consent.types';

interface SignaturePadProps {
  onSignatureChange: (data: SignatureData | null) => void;
  signatureData: SignatureData | null;
  disabled?: boolean;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export const SignaturePad: React.FC<SignaturePadProps> = ({
  onSignatureChange,
  signatureData,
  disabled = false,
}) => {
  const signatureRef = useRef<SignatureViewRef>(null);
  const fullscreenSignatureRef = useRef<SignatureViewRef>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [strokeCount, setStrokeCount] = useState(0);
  const [isEmpty, setIsEmpty] = useState(true);
  const buttonScale = useSharedValue(1);

  const webStyle = `
    .m-signature-pad {
      box-shadow: none;
      border: none;
      background-color: #1E293B;
    }
    .m-signature-pad--body {
      border: none;
      background-color: #1E293B;
    }
    .m-signature-pad--footer {
      display: none;
      margin: 0;
    }
    body, html {
      background-color: #1E293B;
      margin: 0;
      padding: 0;
    }
    canvas {
      background-color: #1E293B !important;
    }
  `;

  const handleSignature = useCallback((signature: string) => {
    if (signature && signature !== 'data:image/png;base64,') {
      onSignatureChange({
        base64: signature,
        isEmpty: false,
        strokeCount,
      });
      setIsEmpty(false);
    }
  }, [onSignatureChange, strokeCount]);

  const handleEmpty = useCallback(() => {
    setIsEmpty(true);
    setStrokeCount(0);
    onSignatureChange(null);
  }, [onSignatureChange]);

  const handleBegin = useCallback(() => {
    setStrokeCount(prev => prev + 1);
    setIsEmpty(false);
  }, []);

  const handleClear = useCallback(() => {
    signatureRef.current?.clearSignature();
    fullscreenSignatureRef.current?.clearSignature();
    setStrokeCount(0);
    setIsEmpty(true);
    onSignatureChange(null);
  }, [onSignatureChange]);

  const handleConfirmSignature = useCallback(() => {
    if (isFullscreen) {
      fullscreenSignatureRef.current?.readSignature();
    } else {
      signatureRef.current?.readSignature();
    }
  }, [isFullscreen]);

  const handleFullscreenOpen = () => {
    setIsFullscreen(true);
  };

  const handleFullscreenClose = () => {
    // Capture signature before closing
    if (!isEmpty) {
      fullscreenSignatureRef.current?.readSignature();
    }
    setIsFullscreen(false);
  };

  const handleFullscreenConfirm = () => {
    fullscreenSignatureRef.current?.readSignature();
    setTimeout(() => {
      setIsFullscreen(false);
    }, 100);
  };

  const buttonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pen size={18} color="#7C3AED" />
          <Text style={styles.headerTitle}>Electronic Signature</Text>
        </View>
        <TouchableOpacity
          style={styles.fullscreenButton}
          onPress={handleFullscreenOpen}
          disabled={disabled}
        >
          <Maximize2 size={18} color="#94A3B8" />
          <Text style={styles.fullscreenText}>Expand</Text>
        </TouchableOpacity>
      </View>

      {/* Signature Status */}
      {signatureData && !signatureData.isEmpty && (
        <View style={styles.signedIndicator}>
          <Check size={16} color="#10B981" />
          <Text style={styles.signedText}>Signature captured</Text>
        </View>
      )}

      {/* Compact Signature Area */}
      <View style={[styles.signatureContainer, disabled && styles.disabled]}>
        {!disabled && (
          <View style={styles.signatureWrapper}>
            <SignatureScreen
              ref={signatureRef}
              onOK={handleSignature}
              onEmpty={handleEmpty}
              onBegin={handleBegin}
              webStyle={webStyle}
              backgroundColor="#1E293B"
              penColor="#FFFFFF"
              minWidth={2}
              maxWidth={4}
              dotSize={3}
              autoClear={false}
              descriptionText=""
            />
          </View>
        )}
        
        {disabled && (
          <View style={styles.disabledOverlay}>
            <Text style={styles.disabledText}>
              Complete all requirements above to sign
            </Text>
          </View>
        )}

        {/* Signature Line */}
        <View style={styles.signatureLine}>
          <View style={styles.line} />
          <Text style={styles.signatureLabel}>Sign above this line</Text>
        </View>
      </View>

      {/* Action Buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.clearButton]}
          onPress={handleClear}
          disabled={disabled || isEmpty}
        >
          <Eraser size={18} color="#94A3B8" />
          <Text style={styles.clearButtonText}>Clear</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.confirmButton, isEmpty && styles.confirmButtonDisabled]}
          onPress={handleConfirmSignature}
          disabled={disabled || isEmpty}
        >
          <Check size={18} color="#FFFFFF" />
          <Text style={styles.confirmButtonText}>Confirm Signature</Text>
        </TouchableOpacity>
      </View>

      {/* Fullscreen Signature Modal */}
      <Modal
        visible={isFullscreen}
        animationType="slide"
        presentationStyle="fullScreen"
        supportedOrientations={['portrait', 'landscape']}
        statusBarTranslucent
      >
        <View style={styles.fullscreenContainer}>
          <StatusBar hidden />
          
          {/* Fullscreen Header */}
          <Animated.View 
            entering={FadeIn.delay(200)}
            style={styles.fullscreenHeader}
          >
            <TouchableOpacity
              style={styles.fullscreenCloseButton}
              onPress={handleFullscreenClose}
            >
              <X size={24} color="#FFFFFF" />
            </TouchableOpacity>
            
            <Text style={styles.fullscreenTitle}>Sign Here</Text>
            
            <TouchableOpacity
              style={styles.fullscreenClearButton}
              onPress={handleClear}
            >
              <RotateCcw size={20} color="#FFFFFF" />
              <Text style={styles.fullscreenClearText}>Clear</Text>
            </TouchableOpacity>
          </Animated.View>

          {/* Fullscreen Signature Canvas */}
          <View style={styles.fullscreenSignatureArea}>
            <SignatureScreen
              ref={fullscreenSignatureRef}
              onOK={handleSignature}
              onEmpty={handleEmpty}
              onBegin={handleBegin}
              webStyle={webStyle}
              backgroundColor="#1E293B"
              penColor="#FFFFFF"
              minWidth={3}
              maxWidth={6}
              dotSize={4}
              autoClear={false}
              descriptionText=""
            />
            
            {/* Center Line Guide */}
            <View style={styles.fullscreenGuide}>
              <View style={styles.fullscreenGuideLine} />
              <Text style={styles.fullscreenGuideText}>
                Sign on this line
              </Text>
            </View>
          </View>

          {/* Fullscreen Footer */}
          <Animated.View 
            entering={SlideInUp.delay(300)}
            style={styles.fullscreenFooter}
          >
            <TouchableOpacity
              style={[
                styles.fullscreenConfirmButton,
                isEmpty && styles.fullscreenConfirmButtonDisabled,
              ]}
              onPress={handleFullscreenConfirm}
              disabled={isEmpty}
            >
              <Check size={24} color="#FFFFFF" />
              <Text style={styles.fullscreenConfirmText}>
                {isEmpty ? 'Please sign above' : 'Confirm Signature'}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#F1F5F9',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 10,
  },
  fullscreenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    backgroundColor: '#1E293B',
    borderRadius: 8,
  },
  fullscreenText: {
    color: '#94A3B8',
    fontSize: 13,
    marginLeft: 6,
  },
  signedIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(16, 185, 129, 0.2)',
  },
  signedText: {
    color: '#10B981',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  signatureContainer: {
    height: 180,
    backgroundColor: '#1E293B',
    position: 'relative',
  },
  signatureWrapper: {
    flex: 1,
  },
  disabled: {
    opacity: 0.5,
  },
  disabledOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledText: {
    color: '#64748B',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  signatureLine: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  line: {
    height: 1,
    backgroundColor: '#475569',
    width: '100%',
  },
  signatureLabel: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 4,
    fontStyle: 'italic',
  },
  actions: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 10,
    gap: 8,
  },
  clearButton: {
    backgroundColor: '#1E293B',
    flex: 0.4,
  },
  clearButtonText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: '#7C3AED',
    flex: 0.6,
  },
  confirmButtonDisabled: {
    backgroundColor: '#334155',
    opacity: 0.7,
  },
  confirmButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  // Fullscreen styles
  fullscreenContainer: {
    flex: 1,
    backgroundColor: '#020420',
  },
  fullscreenHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    backgroundColor: '#0F172A',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  fullscreenCloseButton: {
    padding: 8,
  },
  fullscreenTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  fullscreenClearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  fullscreenClearText: {
    color: '#FFFFFF',
    fontSize: 14,
    marginLeft: 6,
  },
  fullscreenSignatureArea: {
    flex: 1,
    backgroundColor: '#1E293B',
    position: 'relative',
  },
  fullscreenGuide: {
    position: 'absolute',
    bottom: '40%',
    left: 40,
    right: 40,
    alignItems: 'center',
  },
  fullscreenGuideLine: {
    height: 2,
    backgroundColor: '#475569',
    width: '100%',
  },
  fullscreenGuideText: {
    color: '#64748B',
    fontSize: 14,
    marginTop: 8,
    fontStyle: 'italic',
  },
  fullscreenFooter: {
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
    backgroundColor: '#0F172A',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  fullscreenConfirmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    backgroundColor: '#7C3AED',
    borderRadius: 12,
    gap: 10,
  },
  fullscreenConfirmButtonDisabled: {
    backgroundColor: '#334155',
  },
  fullscreenConfirmText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
});