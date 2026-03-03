import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

interface HeaderLogoProps {
  size?: number;
}

export default function HeaderLogo({ size = 32 }: HeaderLogoProps) {
  return (
    <View style={styles.container}>
      <Image
        source={require('../assets/images/logo.png')}
        style={[styles.logo, { width: size, height: size }]}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    // Size will be set dynamically via props
  },
});

