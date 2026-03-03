import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { Mail, ChevronLeft } from 'lucide-react-native';

export const ForgotPasswordScreen = ({ navigation }: any) => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleResetPassword = async () => {
    if (!email) {
      Alert.alert('Error', 'Please enter your email address.');
      return;
    }

    setLoading(true);
    // ارسال ایمیل بازیابی رمز عبور
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'nexpec://reset-password', // آدرس Deep Link اپلیکیشن شما
    });

    setLoading(false);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Success', 'Check your email for the password reset link!');
      navigation.goBack();
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
        <ChevronLeft color="#94A3B8" size={24} />
      </TouchableOpacity>

      <Text style={styles.title}>Reset Password</Text>
      <Text style={styles.subtitle}>Enter your email to receive a reset link.</Text>

      <View style={styles.inputContainer}>
        <Mail size={20} color="#94A3B8" />
        <TextInput
          style={styles.input}
          placeholder="Email Address"
          placeholderTextColor="#64748B"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
      </View>

      <TouchableOpacity 
        style={[styles.resetBtn, loading && { opacity: 0.6 }]} 
        onPress={handleResetPassword}
        disabled={loading}
      >
        <Text style={styles.resetBtnText}>
          {loading ? 'Sending...' : 'Send Reset Link'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020420', padding: 24, justifyContent: 'center' },
  backBtn: { position: 'absolute', top: 60, left: 20 },
  title: { color: '#FFF', fontSize: 28, fontWeight: '700', marginBottom: 8 },
  subtitle: { color: '#94A3B8', fontSize: 16, marginBottom: 32 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', borderRadius: 12, paddingHorizontal: 16, marginBottom: 24, borderWidth: 1, borderColor: '#1E293B' },
  input: { flex: 1, color: '#FFF', height: 55, marginLeft: 12 },
  resetBtn: { backgroundColor: '#00CFD5', height: 55, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  resetBtnText: { color: '#020420', fontSize: 16, fontWeight: '700' }
});