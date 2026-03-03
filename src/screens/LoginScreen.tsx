// src/screens/LoginScreen.tsx
// Wrapper for React Navigation - redirects to Expo Router version

import React from 'react';
import { LoginScreenProps } from '../navigation/types';
import { useRouter } from 'expo-router';

const LoginScreen: React.FC<LoginScreenProps> = () => {
  const router = useRouter();
  
  // Redirect to Expo Router version
  React.useEffect(() => {
    router.replace('/auth/sign-in');
  }, []);

  return null;
};

export default LoginScreen;

