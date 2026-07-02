import React from 'react';
import { Redirect } from 'expo-router';
import SupabaseDebugger from '@/components/SupabaseDebugger';

export default function DebugScreen() {
  // Dev-only diagnostic surface — never reachable in production builds.
  if (!__DEV__) { return <Redirect href="/" />; }
  return <SupabaseDebugger />;
}

