import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  StatusBar,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, ArrowRight, FileText, Share2 } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { LinearGradient } from 'expo-linear-gradient';

// THEME
const COLORS = {
  background: '#0A0E17',
  surface: '#141B2D',
  primary: '#00F5FF',
  success: '#00D68F',
  text: '#FFFFFF',
  textSecondary: '#A0AEC0',
};

const { width } = Dimensions.get('window');

const InspectionSuccessScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // Animations
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  useEffect(() => {
    // Sequence: Scale Icon -> Fade Text -> Slide Buttons
    Animated.sequence([
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: 50,
          friction: 8,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, []);

  const handleDone = () => {
    // Reset to Dashboard (Tab 0)
    navigation.reset({
      index: 0,
      routes: [{ name: 'Main' }],
    });
  };

  const handleViewReport = () => {
    navigation.navigate('ReportViewer', { reportId: 'INS-2024-001' });
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      
      {/* Background Glow */}
      <View style={styles.glowContainer}>
        <View style={styles.glow} />
      </View>

      <View style={styles.content}>
        {/* Animated Check Circle */}
        <Animated.View style={[styles.iconContainer, { transform: [{ scale: scaleAnim }] }]}>
          <LinearGradient
            colors={[COLORS.success, '#00A86B']}
            style={styles.circleGradient}
          >
            <Check size={64} color="#FFF" strokeWidth={3} />
          </LinearGradient>
          {/* Pulse Effect Rings */}
          <View style={[styles.ring, { width: 140, height: 140, opacity: 0.2 }]} />
          <View style={[styles.ring, { width: 180, height: 180, opacity: 0.1 }]} />
        </Animated.View>

        {/* Text Content */}
        <Animated.View style={[styles.textContainer, { opacity: fadeAnim }]}>
          <Text style={styles.title}>Inspection Complete!</Text>
          <Text style={styles.subtitle}>
            Report #INS-2024-001 has been successfully verified and synced to the cloud.
          </Text>
          
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Items Checked</Text>
              <Text style={styles.statValue}>24/24</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Issues Found</Text>
              <Text style={[styles.statValue, { color: COLORS.success }]}>0</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Sync Status</Text>
              <Text style={[styles.statValue, { color: COLORS.primary }]}>Synced</Text>
            </View>
          </View>
        </Animated.View>

        {/* Action Buttons */}
        <Animated.View 
          style={[
            styles.footer, 
            { 
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }] 
            }
          ]}
        >
          <View style={styles.secondaryButtons}>
            <TouchableOpacity style={styles.outlineButton} onPress={handleViewReport}>
              <FileText size={20} color={COLORS.textSecondary} />
              <Text style={styles.outlineButtonText}>View PDF</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.outlineButton}>
              <Share2 size={20} color={COLORS.textSecondary} />
              <Text style={styles.outlineButtonText}>Share</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.primaryButton} onPress={handleDone}>
            <LinearGradient
              colors={[COLORS.primary, '#00C8D4']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.gradientButton}
            >
              <Text style={styles.primaryButtonText}>Back to Dashboard</Text>
              <ArrowRight size={20} color="#000" />
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  glowContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: -1,
  },
  glow: {
    width: width * 0.8,
    height: width * 0.8,
    borderRadius: width * 0.4,
    backgroundColor: COLORS.success,
    opacity: 0.05,
    blurRadius: 50, // Note: blurRadius works differently on Android/iOS, simpler opacity is safer
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  
  // Icon Styles
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
  },
  circleGradient: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.success,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 15,
    zIndex: 10,
  },
  ring: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.success,
  },

  // Text Styles
  textContainer: {
    alignItems: 'center',
    marginBottom: 50,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 30,
  },
  
  // Stats
  statsRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  stat: {
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  statLabel: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  statDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },

  // Footer / Buttons
  footer: {
    width: '100%',
    position: 'absolute',
    bottom: 40,
  },
  secondaryButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 20,
  },
  outlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: COLORS.surface,
    gap: 8,
  },
  outlineButtonText: {
    color: COLORS.textSecondary,
    fontWeight: '600',
    fontSize: 14,
  },
  primaryButton: {
    width: '100%',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  gradientButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    borderRadius: 16,
    gap: 8,
  },
  primaryButtonText: {
    color: '#0A0E17',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default InspectionSuccessScreen;
