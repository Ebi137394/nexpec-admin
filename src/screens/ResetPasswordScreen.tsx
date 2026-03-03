import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { Lock, Eye, EyeOff, ShieldCheck } from 'lucide-react-native';

export const ResetPasswordScreen = ({ navigation }: any) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleUpdatePassword = async () => {
    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match.');
      return;
    }

    setLoading(true);
    // بروزرسانی رمز عبور کاربر در Supabase
    const { error } = await supabase.auth.updateUser({
      password: password
    });

    setLoading(false);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Success', 'Your password has been updated successfully!', [
        { text: 'Login Now', onPress: () => navigation.replace('SignIn') }
      ]);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.iconBox}>
        <ShieldCheck size={48} color="#00CFD5" />
      </View>
      
      <Text style={styles.title}>Set New Password</Text>
      <Text style={styles.subtitle}>Enter your new secure password below.</Text>

      {/* New Password Input */}
      <View style={styles.inputContainer}>
        <Lock size={20} color="#94A3B8" />
        <TextInput
          style={styles.input}
          placeholder="New Password"
          placeholderTextColor="#64748B"
          secureTextEntry={!showPassword}
          value={password}
          onChangeText={setPassword}
        />
        <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
          {showPassword ? <EyeOff size={20} color="#94A3B8" /> : <Eye size={20} color="#94A3B8" />}
        </TouchableOpacity>
      </View>

      {/* Confirm Password Input */}
      <View style={styles.inputContainer}>
        <Lock size={20} color="#94A3B8" />
        <TextInput
          style={styles.input}
          placeholder="Confirm New Password"
          placeholderTextColor="#64748B"
          secureTextEntry={!showPassword}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
        />
      </View>

      <TouchableOpacity 
        style={[styles.updateBtn, loading && { opacity: 0.6 }]} 
        onPress={handleUpdatePassword}
        disabled={loading}
      >
        {loading ? <ActivityIndicator color="#020420" /> : <Text style={styles.updateBtnText}>Update Password</Text>}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020420', padding: 24, justifyContent: 'center' },
  iconBox: { alignItems: 'center', marginBottom: 24 },
  title: { color: '#FFF', fontSize: 28, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  subtitle: { color: '#94A3B8', fontSize: 16, textAlign: 'center', marginBottom: 32 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', borderRadius: 12, paddingHorizontal: 16, marginBottom: 16, borderWidth: 1, borderColor: '#1E293B' },
  input: { flex: 1, color: '#FFF', height: 55, marginLeft: 12 },
  updateBtn: { backgroundColor: '#00CFD5', height: 55, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 16 },
  updateBtnText: { color: '#020420', fontSize: 16, fontWeight: '700' }
});