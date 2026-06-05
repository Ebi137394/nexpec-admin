import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, StatusBar, Alert, Platform, Modal, TextInput, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
// 🌟 وارد کردن پکیج سنسور که نصب کردی — defensive loader (Expo Go safe)
import LocalAuthentication from '@/src/services/_localAuthSafe';
// Sprint 13.M2 — recovery codes lane (mirrors web MfaSection)
import { MfaRecoveryCodesCard } from '@/src/shared-ui/auth/MfaRecoveryCodesCard';

// 🎨 THEME CONSTANTS (NEXPEC Standard)
const COLORS = {
  background: '#020420',
  surface: '#0F172A',
  surfaceLight: '#1E293B',
  border: '#1F2937',
  primary: '#7C3AED',
  primaryLight: '#8B5CF6',
  primaryBg: 'rgba(124, 58, 237, 0.12)',
  red: '#EF4444',
  redBg: 'rgba(239, 68, 68, 0.1)',
  green: '#10B981',
  greenBg: 'rgba(16, 185, 129, 0.1)',
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
};

export default function SecuritySettingsScreen() {
  const router = useRouter();

  // 🌟 Real 2FA States
  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [is2FAModalVisible, setIs2FAModalVisible] = useState(false);
  const [totpSecret, setTotpSecret] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [factorId, setFactorId] = useState('');
  const [isVerifying2FA, setIsVerifying2FA] = useState(false);

  // 🌟 استیت‌های مربوط به سنسور
  // 🌟 استیت‌های مربوط به سنسور
  const [isBiometricEnabled, setIsBiometricEnabled] = useState(false);
  const [isBiometricSupported, setIsBiometricSupported] = useState(false);

  const [isPasswordModalVisible, setIsPasswordModalVisible] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [isLoggingOutOthers, setIsLoggingOutOthers] = useState(false);

  // 🌟 وقتی صفحه باز میشه وضعیت سنسور و 2FA رو چک میکنه
  useEffect(() => {
    (async () => {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      setIsBiometricSupported(compatible);

      // Check if 2FA is already enrolled in Supabase
      try {
        const { data, error } = await supabase.auth.mfa.listFactors();
        if (data && data.totp && data.totp.length > 0) {
          const isVerified = data.totp.some(factor => factor.status === 'verified');
          setIs2FAEnabled(isVerified);
        }
      } catch (err) {
        console.log("Error checking 2FA:", err);
      }
    })();
  }, []);

 // 🚀 تابع واقعی برای فعال و غیرفعال کردن 2FA
  const handle2FAToggle = async (newValue: boolean) => {
    if (newValue) {
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !sessionData.session) throw new Error("Local session missing. Please log out and log back in.");

        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData.user) throw new Error(`Server sync error: ${userError?.message || "Invalid user"}`);

        const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
        if (error) throw error;
        
        setFactorId(data.id);
        setTotpSecret(data.totp.secret);
        setIs2FAModalVisible(true);
        
        setFactorId(data.id);
        setTotpSecret(data.totp.secret); // این کدیه که کاربر باید تو اپلیکیشن بزنه
        setIs2FAModalVisible(true);
      } catch (error: any) {
        Alert.alert("Authentication Error", error.message || "Could not enroll 2FA. Please log out and back in.");
        setIs2FAEnabled(false); // اطمینان صد در صد از خاموش موندن دکمه
      }
    } else {
      // 2. Unenroll TOTP
      Alert.alert(
        "Disable 2FA",
        "Are you sure you want to remove Two-Factor Authentication? Your account will be less secure.",
        [
          { text: "Cancel", style: "cancel", onPress: () => setIs2FAEnabled(true) },
          { text: "Disable", style: "destructive", onPress: async () => {
              try {
                const { data } = await supabase.auth.mfa.listFactors();
                if (data && data.totp && data.totp.length > 0) {
                  // ★ N+1-MFA-UNENROLL-001 — Pre-strike this awaited
                  //   each unenroll in a serial for-loop, so disabling
                  //   N TOTP factors took N × round-trip time. The
                  //   unenroll calls are independent — Promise.all
                  //   fires them concurrently. Net latency drops to
                  //   max(individual) instead of sum(individual).
                  await Promise.all(
                    data.totp.map((factor) =>
                      supabase.auth.mfa.unenroll({ factorId: factor.id }),
                    ),
                  );
                }
                setIs2FAEnabled(false);
                Alert.alert("Success", "Two-Factor Authentication disabled.");
              } catch (error: any) {
                Alert.alert("Error", "Could not disable 2FA.");
                setIs2FAEnabled(true);
              }
            } 
          }
        ]
      );
    }
  };

  const verify2FACode = async () => {
    if (totpCode.length < 6) {
      Alert.alert("Invalid Code", "Please enter the 6-digit code.");
      return;
    }
    
    setIsVerifying2FA(true);
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId });
      if (challenge.error) throw challenge.error;

      const verify = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.data.id,
        code: totpCode,
      });

      if (verify.error) throw verify.error;

      setIs2FAEnabled(true);
      setIs2FAModalVisible(false);
      setTotpCode('');
      Alert.alert("Secured!", "Two-Factor Authentication is now active.");
    } catch (error: any) {
      Alert.alert("Verification Failed", error.message || "Invalid code. Try again.");
      setIs2FAEnabled(false);
    } finally {
      setIsVerifying2FA(false);
    }
  };

  // 🚀 تابع واقعی برای فعال کردن اثر انگشت/تشخیص چهره
  const handleBiometricToggle = async (newValue: boolean) => {
    if (newValue) {
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!isEnrolled) {
        Alert.alert("Unavailable", "No Face ID or Touch ID is set up on this device.");
        return;
      }

      // اینجا سنسور گوشی فعال میشه
      const auth = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to enable Biometric Login',
        fallbackLabel: 'Use Passcode',
      });

      if (auth.success) {
        setIsBiometricEnabled(true);
        Alert.alert("Success", "Biometric login enabled successfully!");
      } else {
        setIsBiometricEnabled(false);
      }
    } else {
      setIsBiometricEnabled(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (newPassword.length < 6) {
      Alert.alert("Weak Password", "Password should be at least 6 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert("Mismatch", "The passwords do not match. Please try again.");
      return;
    }

    setIsUpdatingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      
      if (error) throw error;
      
      Alert.alert("Success", "Your password has been updated securely.");
      setIsPasswordModalVisible(false);
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to update password.");
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const handleLogoutAll = () => {
    Alert.alert(
      "Log Out All Devices",
      "Are you sure you want to sign out of every other device except this one?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Log Out Others", 
          style: "destructive", 
          onPress: async () => {
            setIsLoggingOutOthers(true);
            try {
              const { error } = await supabase.auth.signOut({ scope: 'others' });
              if (error) throw error;
              Alert.alert("Secured", "All other sessions have been terminated.");
            } catch (err: any) {
              Alert.alert("Error", err.message || "Could not log out other sessions.");
            } finally {
              setIsLoggingOutOthers(false);
            }
          } 
        }
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete Account",
      "This action is PERMANENT. You will lose all your data, jobs, and history. Are you absolutely sure?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Yes, Delete Everything", 
          style: "destructive", 
          onPress: async () => {
            try {
              const { error } = await supabase.rpc('delete_user');
              
              if (error) throw error;

              await supabase.auth.signOut();
              
              Alert.alert("Account Deleted", "Your account has been permanently removed.");
              
              router.replace('/(auth)/login'); 
              
            } catch (err: any) {
              Alert.alert("Error", err.message || "Failed to delete account.");
            }
          } 
        }
      ]
    );
  };

  const SectionHeader = ({ title }: { title: string }) => (
    <Text style={st.sectionHeader}>{title}</Text>
  );

  const SettingRow = ({ icon, title, subtitle, onPress, rightElement, isDestructive = false }: any) => (
    <TouchableOpacity 
      style={st.rowContainer} 
      onPress={onPress} 
      activeOpacity={onPress ? 0.7 : 1}
      disabled={!onPress}
    >
      <View style={[st.iconWrap, isDestructive && st.iconWrapDestructive]}>
        <Ionicons name={icon} size={20} color={isDestructive ? COLORS.red : COLORS.primaryLight} />
      </View>
      <View style={st.rowTextContainer}>
        <Text style={[st.rowTitle, isDestructive && st.rowTitleDestructive]}>{title}</Text>
        {subtitle && <Text style={st.rowSubtitle}>{subtitle}</Text>}
      </View>
      <View style={st.rowRight}>
        {rightElement || (onPress && <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />)}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={st.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      
      <View style={st.header}>
        <TouchableOpacity style={st.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>Security Settings</Text>
        <View style={st.backBtnPlaceholder} />
      </View>

      <ScrollView contentContainerStyle={st.scrollContent} showsVerticalScrollIndicator={false}>
        
        <SectionHeader title="Authentication" />
        <View style={st.card}>
          <SettingRow 
            icon="key-outline" 
            title="Change Password" 
            subtitle="Update your account password" 
            onPress={() => setIsPasswordModalVisible(true)} 
          />
        </View>

        <SectionHeader title="Advanced Security" />
        <View style={st.card}>
          <SettingRow
            icon="shield-checkmark-outline"
            title="Two-Factor Authentication"
            subtitle={is2FAEnabled ? 'Active, authenticator app' : 'Add a second sign-in step (TOTP)'}
            rightElement={
              <Switch
                value={is2FAEnabled}
                onValueChange={(val) => {
                  handle2FAToggle(val);
                }}
                trackColor={{ false: COLORS.surfaceLight, true: COLORS.primary }}
                thumbColor={Platform.OS === 'ios' ? '#FFF' : is2FAEnabled ? '#FFF' : COLORS.textSecondary}
              />
            }
          />
          <View style={st.divider} />
          <SettingRow
            icon="finger-print-outline"
            title="Biometric Login"
            subtitle="Face ID / Touch ID"
            rightElement={
              <Switch
                value={isBiometricEnabled}
                onValueChange={handleBiometricToggle} // 🌟 تابع واقعی به اینجا وصل شد
                disabled={!isBiometricSupported}
                trackColor={{ false: COLORS.surfaceLight, true: COLORS.primary }}
                thumbColor={Platform.OS === 'ios' ? '#FFF' : isBiometricEnabled ? '#FFF' : COLORS.textSecondary}
              />
            }
          />
        </View>

        {/* Sprint 13.M2 — recovery-codes lane. Self-suppresses while 2FA
            is off; surfaces a Generate CTA once 2FA is on, or a status
            pill + Regenerate button when codes already exist. */}
        <MfaRecoveryCodesCard enabled={is2FAEnabled} />

        <SectionHeader title="Active Sessions" />
        <View style={st.card}>
          <SettingRow 
            icon="phone-portrait-outline" 
            title="This Device" 
            subtitle="Active right now" 
            rightElement={<Text style={st.activeSessionText}>Current</Text>}
          />
          <View style={st.divider} />
          <TouchableOpacity style={st.logoutAllBtn} onPress={handleLogoutAll} activeOpacity={0.7} disabled={isLoggingOutOthers}>
            {isLoggingOutOthers ? (
              <ActivityIndicator color={COLORS.primaryLight} size="small" />
            ) : (
              <Text style={st.logoutAllBtnText}>Log out of all other devices</Text>
            )}
          </TouchableOpacity>
        </View>

        <SectionHeader title="Danger Zone" />
        <View style={[st.card, { borderColor: COLORS.redBg, borderWidth: 1 }]}>
          <SettingRow 
            icon="trash-outline" 
            title="Delete Account" 
            subtitle="Permanently delete your account and data" 
            onPress={handleDeleteAccount}
            isDestructive={true}
          />
        </View>

        <Text style={st.footerText}>NEXPEC Security Protocol v1.2</Text>
      </ScrollView>

      <Modal visible={isPasswordModalVisible} animationType="slide" transparent={true} onRequestClose={() => setIsPasswordModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={st.modalOverlay}>
          <View style={st.modalContent}>
            <View style={st.modalHeader}>
              <Text style={st.modalTitle}>Change Password</Text>
              <TouchableOpacity onPress={() => setIsPasswordModalVisible(false)} style={st.modalCloseBtn}>
                <Ionicons name="close" size={24} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={st.inputGroup}>
              <Text style={st.inputLabel}>New Password</Text>
              <TextInput 
                style={st.input} 
                placeholder="Enter new password" 
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry 
                value={newPassword}
                onChangeText={setNewPassword}
              />
            </View>

            <View style={st.inputGroup}>
              <Text style={st.inputLabel}>Confirm New Password</Text>
              <TextInput 
                style={st.input} 
                placeholder="Repeat new password" 
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry 
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
            </View>

            <TouchableOpacity 
              style={[st.modalSubmitBtn, (!newPassword || !confirmPassword || isUpdatingPassword) && st.modalSubmitBtnDisabled]} 
              onPress={handleUpdatePassword}
              disabled={!newPassword || !confirmPassword || isUpdatingPassword}
            >
              {isUpdatingPassword ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Text style={st.modalSubmitText}>Update Password</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    {/* 🔐 2FA SETUP MODAL */}
      <Modal visible={is2FAModalVisible} animationType="slide" transparent={true} onRequestClose={() => setIs2FAModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={st.modalOverlay}>
          <View style={st.modalContent}>
            <View style={st.modalHeader}>
              <Text style={st.modalTitle}>Set Up 2FA</Text>
              <TouchableOpacity onPress={() => { setIs2FAModalVisible(false); setIs2FAEnabled(false); }} style={st.modalCloseBtn}>
                <Ionicons name="close" size={24} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={{color: COLORS.textSecondary, fontSize: 14, marginBottom: 16, lineHeight: 20}}>
              1. Open your Authenticator App (Google, Authy, etc.){'\n'}
              2. Add a new setup key manually.{'\n'}
              3. Enter this exact secret key:
            </Text>

            <View style={{backgroundColor: COLORS.background, padding: 12, borderRadius: 8, marginBottom: 20, borderWidth: 1, borderColor: COLORS.primaryLight, alignItems: 'center'}}>
              <Text style={{color: COLORS.primaryLight, fontSize: 16, fontWeight: 'bold', letterSpacing: 1}} selectable={true}>
                {totpSecret}
              </Text>
              <Text style={{color: COLORS.textMuted, fontSize: 11, marginTop: 6}}>Long-press to copy key</Text>
            </View>

            <View style={st.inputGroup}>
              <Text style={st.inputLabel}>Enter 6-Digit Code</Text>
              <TextInput 
                style={st.input} 
                placeholder="000000" 
                placeholderTextColor={COLORS.textMuted}
                keyboardType="number-pad"
                maxLength={6}
                value={totpCode}
                onChangeText={setTotpCode}
              />
            </View>

            <TouchableOpacity 
              style={[st.modalSubmitBtn, (!totpCode || totpCode.length < 6 || isVerifying2FA) && st.modalSubmitBtnDisabled]} 
              onPress={verify2FACode}
              disabled={!totpCode || totpCode.length < 6 || isVerifying2FA}
            >
              {isVerifying2FA ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Text style={st.modalSubmitText}>Verify & Enable</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  backBtn: { padding: 8, marginLeft: -8 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary },
  backBtnPlaceholder: { width: 40 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 40, paddingTop: 10 },
  sectionHeader: { fontSize: 13, fontWeight: '800', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 24, marginBottom: 8, marginLeft: 4 },
  card: { backgroundColor: COLORS.surface, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  rowContainer: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  iconWrap: { width: 40, height: 40, borderRadius: 10, backgroundColor: COLORS.surfaceLight, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  iconWrapDestructive: { backgroundColor: COLORS.redBg },
  rowTextContainer: { flex: 1, justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 3 },
  rowTitleDestructive: { color: COLORS.red },
  rowSubtitle: { fontSize: 13, color: COLORS.textMuted },
  rowRight: { marginLeft: 10, justifyContent: 'center', alignItems: 'center' },
  divider: { height: 1, backgroundColor: COLORS.border, marginLeft: 70 },
  activeSessionText: { fontSize: 12, fontWeight: '700', color: COLORS.green, backgroundColor: COLORS.greenBg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: 'hidden' },
  logoutAllBtn: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surfaceLight },
  logoutAllBtnText: { fontSize: 14, fontWeight: '700', color: COLORS.primaryLight },
  footerText: { textAlign: 'center', marginTop: 40, fontSize: 12, color: COLORS.textMuted, fontWeight: '600', letterSpacing: 0.5 },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24, borderWidth: 1, borderColor: COLORS.border },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textPrimary },
  modalCloseBtn: { padding: 4 },
  inputGroup: { marginBottom: 16 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8, marginLeft: 4 },
  input: { backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 14, color: COLORS.textPrimary, fontSize: 15 },
  modalSubmitBtn: { backgroundColor: COLORS.primary, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 10 },
  modalSubmitBtnDisabled: { backgroundColor: COLORS.surfaceLight, opacity: 0.7 },
  modalSubmitText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
});