import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';

// VoiceDrafter removed 2026-05-20 per product directive. The form is
// now typed entry only — no voice-to-text affordance.

// ─── Import JSA Modal ───
import JSAModal from './safety/JSAModal';

const DynamicInspectionForm: React.FC = () => {
  // ─── Your existing form state ───
  const [findings, setFindings] = useState('');
  const [recommendations, setRecommendations] = useState('');
  // activeVoiceField + handleTranscriptionReady removed 2026-05-20 along
  // with the VoiceDrafter component. Typed entry only from here.

  // ─── JSA Modal state ───
  const [isJSAModalVisible, setIsJSAModalVisible] = useState(false);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* ─── Your existing form sections above ─── */}

        {/* FINDINGS Section */}
        <View style={styles.fieldGroup}>
          <View style={styles.fieldHeader}>
            <Text style={styles.fieldLabel}>Inspection Findings</Text>
            <Text
              style={styles.voiceHint}
              onPress={() => setActiveVoiceField('findings')}
            >
              🎤 {activeVoiceField === 'findings' ? 'Active Target' : 'Tap to target'}
            </Text>
          </View>
          <TextInput
            style={[
              styles.textArea,
              activeVoiceField === 'findings' && styles.textAreaActive,
            ]}
            value={findings}
            onChangeText={setFindings}
            onFocus={() => setActiveVoiceField('findings')}
            placeholder="Describe inspection findings..."
            placeholderTextColor="#64748B"
            multiline
            numberOfLines={6}
            textAlignVertical="top"
          />
        </View>

        {/* RECOMMENDATIONS Section */}
        <View style={styles.fieldGroup}>
          <View style={styles.fieldHeader}>
            <Text style={styles.fieldLabel}>Recommendations</Text>
            <Text
              style={styles.voiceHint}
              onPress={() => setActiveVoiceField('recommendations')}
            >
              🎤 {activeVoiceField === 'recommendations' ? 'Active Target' : 'Tap to target'}
            </Text>
          </View>
          <TextInput
            style={[
              styles.textArea,
              activeVoiceField === 'recommendations' && styles.textAreaActive,
            ]}
            value={recommendations}
            onChangeText={setRecommendations}
            onFocus={() => setActiveVoiceField('recommendations')}
            placeholder="Enter recommendations..."
            placeholderTextColor="#64748B"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* JSA SAFETY CHECKLIST Section */}
        <View style={styles.fieldGroup}>
          <View style={styles.fieldHeader}>
            <Text style={styles.fieldLabel}>Safety Checklist</Text>
            <TouchableOpacity
              style={styles.jsaButton}
              onPress={() => setIsJSAModalVisible(true)}
            >
              <Text style={styles.jsaButtonText}>📋 Complete JSA</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.jsaDescription}>
            Complete the Job Safety Analysis before starting inspection work. 
            This ensures all safety protocols are followed and documented.
          </Text>
        </View>

        {/* ─── Rest of your form sections ─── */}
      </ScrollView>

      {/* VoiceDrafter floating affordance removed 2026-05-20 per product directive. */}

      {/* ═══════════════════════════════════════════
          JSA MODAL — Safety checklist modal
          ═══════════════════════════════════════════ */}
      <JSAModal
        visible={isJSAModalVisible}
        jobTitle="Inspection Work"
        jobLocation="Field Site"
        onApproved={(checklist, signatureData) => {
          console.log('JSA completed:', { checklist, signatureData });
          setIsJSAModalVisible(false);
        }}
        onCancel={() => setIsJSAModalVisible(false)}
      />
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 160, // room for floating button
  },
  fieldGroup: {
    marginBottom: 20,
  },
  fieldHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  fieldLabel: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
  },
  voiceHint: {
    color: '#3B82F6',
    fontSize: 12,
    fontWeight: '500',
  },
  textArea: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    color: '#F8FAFC',
    fontSize: 14,
    lineHeight: 22,
    minHeight: 120,
    borderWidth: 1,
    borderColor: '#334155',
  },
  textAreaActive: {
    borderColor: '#3B82F6',
    borderWidth: 1.5,
  },
  jsaButton: {
    backgroundColor: '#10B981',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#059669',
  },
  jsaButtonText: {
    color: '#065F46',
    fontSize: 12,
    fontWeight: '600',
  },
  jsaDescription: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
});

export default DynamicInspectionForm;