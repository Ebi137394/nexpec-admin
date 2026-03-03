import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShieldCheck, Mail, Lock, User } from 'lucide-react-native';
import { router } from 'expo-router';
import { supabase, supabaseReady } from '../lib/supabase';

type AuthMode = 'signin' | 'signup';

export default function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [clientReady, setClientReady] = useState(false);

  // Wait for Supabase client to be fully initialized
  useEffect(() => {
    let mounted = true;
    
    supabaseReady().then(() => {
      if (mounted) {
        setClientReady(true);
      }
    }).catch((error) => {
      if (mounted) {
        console.error('Supabase initialization error:', error);
        Alert.alert(
          'Connection Error',
          'Could not connect to the authentication service. ' +
          'Check your network and restart the app.'
        );
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  const handleSignIn = async () => {
    // Guard 1: Verify the client object exists
    if (!supabase) {
      console.error('[Auth] supabase object is undefined — check import path');
      Alert.alert('Error', 'Authentication service failed to load.');
      return;
    }

    // Guard 2: Wait for client initialization
    if (!clientReady) {
      console.warn('[Auth] Sign-in attempted before client was ready');
      Alert.alert('Please Wait', 'Still connecting to the server…');
      return;
    }

    if (!email || !password) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password,
      });

      if (error) throw error;

      if (data.user) {
        // Navigate to tabs (home screen) on success
        router.replace('/(tabs)');
      }
    } catch (error: any) {
      Alert.alert('Sign In Failed', error.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async () => {
    if (!email || !password || !fullName) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    try {
      setLoading(true);

      // Step 1: Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password: password,
      });

      if (authError) throw authError;

      if (authData.user) {
        // Step 2: Create profile in public.profiles table
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: authData.user.id,
            full_name: fullName.trim(),
            role: 'inspector',
            verification_status: false,
            job_title: 'Inspector',
            base_location: 'To be set',
            avatar_url: null,
          });

        if (profileError) {
          console.error('Profile creation error:', profileError);
          // Don't throw - user is created, they can update profile later
        }

        Alert.alert(
          'Success',
          'Account created successfully! Please check your email to verify your account.',
          [
            {
              text: 'OK',
              onPress: () => {
                setMode('signin');
                setPassword('');
              },
            },
          ]
        );
      }
    } catch (error: any) {
      Alert.alert('Sign Up Failed', error.message || 'Could not create account');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    if (mode === 'signin') {
      handleSignIn();
    } else {
      handleSignUp();
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0F172A]" edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView
          contentContainerClassName="flex-grow"
          keyboardShouldPersistTaps="handled"
        >
          <View className="flex-1 px-6 pt-12 pb-6">
            {/* Header with Logo */}
            <View className="items-center mb-12">
              <View className="mb-6">
                <ShieldCheck size={80} color="#F59E0B" fill="#F59E0B" />
              </View>
              <Text className="text-white text-4xl font-bold mb-2">NEXPEC</Text>
              <Text className="text-gray-400 text-lg">Industrial Inspection Platform</Text>
            </View>

            {/* Mode Toggle */}
            <View className="flex-row mb-8 bg-[#1E293B] rounded-lg p-1">
              <TouchableOpacity
                className={`flex-1 py-3 rounded-lg ${
                  mode === 'signin' ? 'bg-[#F59E0B]' : 'bg-transparent'
                }`}
                onPress={() => setMode('signin')}
                disabled={loading}
              >
                <Text
                  className={`text-center font-semibold ${
                    mode === 'signin' ? 'text-white' : 'text-gray-400'
                  }`}
                >
                  Sign In
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                className={`flex-1 py-3 rounded-lg ${
                  mode === 'signup' ? 'bg-[#F59E0B]' : 'bg-transparent'
                }`}
                onPress={() => setMode('signup')}
                disabled={loading}
              >
                <Text
                  className={`text-center font-semibold ${
                    mode === 'signup' ? 'text-white' : 'text-gray-400'
                  }`}
                >
                  Create Account
                </Text>
              </TouchableOpacity>
            </View>

            {/* Input Fields */}
            <View className="space-y-4 mb-6">
              {/* Full Name (Sign Up Only) */}
              {mode === 'signup' && (
                <View className="mb-4">
                  <View className="flex-row items-center bg-[#1E293B] rounded-lg px-4 py-4 border border-gray-700">
                    <User size={20} color="#94A3B8" />
                    <TextInput
                      className="flex-1 text-white ml-3 text-base"
                      placeholder="Full Name"
                      placeholderTextColor="#64748B"
                      value={fullName}
                      onChangeText={setFullName}
                      autoCapitalize="words"
                      editable={!loading}
                    />
                  </View>
                </View>
              )}

              {/* Email */}
              <View className="mb-4">
                <View className="flex-row items-center bg-[#1E293B] rounded-lg px-4 py-4 border border-gray-700">
                  <Mail size={20} color="#94A3B8" />
                  <TextInput
                    className="flex-1 text-white ml-3 text-base"
                    placeholder="Email Address"
                    placeholderTextColor="#64748B"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    editable={!loading}
                  />
                </View>
              </View>

              {/* Password */}
              <View className="mb-6">
                <View className="flex-row items-center bg-[#1E293B] rounded-lg px-4 py-4 border border-gray-700">
                  <Lock size={20} color="#94A3B8" />
                  <TextInput
                    className="flex-1 text-white ml-3 text-base"
                    placeholder="Password"
                    placeholderTextColor="#64748B"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="password"
                    editable={!loading}
                  />
                </View>
                {mode === 'signup' && (
                  <Text className="text-gray-500 text-sm mt-2 ml-1">
                    Minimum 6 characters
                  </Text>
                )}
              </View>
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              className={`rounded-lg py-4 items-center mb-4 ${
                loading ? 'bg-gray-600' : 'bg-[#F59E0B]'
              }`}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text className="text-white font-bold text-lg">
                  {mode === 'signin' ? 'Sign In' : 'Create Account'}
                </Text>
              )}
            </TouchableOpacity>

            {/* Footer Info */}
            {mode === 'signup' && (
              <Text className="text-gray-500 text-sm text-center mt-4">
                By creating an account, you agree to NEXPEC's terms of service and privacy
                policy.
              </Text>
            )}

            {mode === 'signin' && (
              <TouchableOpacity className="mt-4" disabled={loading}>
                <Text className="text-[#F59E0B] text-center">Forgot Password?</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

