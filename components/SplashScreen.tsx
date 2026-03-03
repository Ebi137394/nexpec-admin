import React, { useEffect } from 'react';
import { View, Image, StyleSheet, StatusBar, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { COLORS, SIZES } from '../src/constants/theme';

interface SplashScreenProps {
  onFinish: () => void;
}

const SplashScreen = ({ onFinish }: SplashScreenProps) => {
  const scale = useSharedValue(0.5);
  const opacity = useSharedValue(0);
  const textOpacity = useSharedValue(0);

  useEffect(() => {
    // Start animations
    opacity.value = withTiming(1, {
      duration: 800,
      easing: Easing.out(Easing.ease),
    });

    scale.value = withSequence(
      withTiming(1.1, {
        duration: 600,
        easing: Easing.out(Easing.ease),
      }),
      withTiming(1, {
        duration: 200,
        easing: Easing.inOut(Easing.ease),
      })
    );

    // Fade in loading text after logo appears
    textOpacity.value = withTiming(1, {
      duration: 500,
      delay: 1000,
      easing: Easing.out(Easing.ease),
    });

    // Navigate after animation completes
    const timer = setTimeout(() => {
      onFinish();
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const textAnimatedStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
  }));

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      
      {/* بخش لوگو */}
      <Animated.View style={[styles.logoContainer, animatedStyle]}>
        <Image 
          source={require('../assets/images/logo.png')} 
          style={styles.logo}
          resizeMode="contain"
        />
      </Animated.View>

      {/* متن لودینگ پایین صفحه */}
      <Animated.View style={[styles.footer, textAnimatedStyle]}>
        <Text style={styles.loadingText}>INITIALIZING NEXPEC SYSTEMS...</Text>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background, // همرنگ شدن با پس‌زمینه لوگو
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    // اضافه کردن یک هاله نور (Shadow) پشت لوگو برای افکت نئونی بیشتر
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  logo: {
    width: SIZES.logoWidth * 1.5, // کمی بزرگتر برای اسپلش
    height: SIZES.logoHeight * 1.5,
  },
  footer: {
    position: 'absolute',
    bottom: 50,
  },
  loadingText: {
    color: COLORS.primary,
    fontSize: 10,
    letterSpacing: 2,
    fontFamily: 'System', // بعداً فونت کاستوم اضافه می‌کنیم
    opacity: 0.8,
    fontWeight: '600',
  },
});

export default SplashScreen;
