import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import { useTheme } from '@/providers/ThemeProvider';
import { getColors } from '@/src/constants/theme';
import { useLanguage } from '@/src/i18n/LanguageProvider';

// Pre-defined Skills List
// Note: We will wrap these in t() inside the render function so they can be translated if you add them to the dictionary later.
const SKILLS_LIST = [
  // Materials & Welding
  'CWI Welding Inspector', 'CSWIP 3.1/3.2', 'NDT: Ultrasonic (UT)', 'NDT: Magnetic Particle (MT)',
  'NDT: Radiography (RT)', 'NDT: Penetrant (PT)', 'NDT: Eddy Current', 'Visual Inspection (VT)',
  'NACE Coating Inspector', 'Corrosion Specialist', 'Metallurgy Expert',

  // Mechanical & Piping
  'API 510 Pressure Vessels', 'API 570 Piping', 'API 653 Storage Tanks', 'API 580 RBI',
  'Rotating Equipment', 'Vibration Analysis', 'Hydraulics & Pneumatics', 'HVAC Systems',
  'Pumps & Compressors', 'Valves & Actuators', 'Cranes & Lifting Gear',

  // Electrical & Instrumentation
  'Electrical Inspector', 'High Voltage Systems', 'Low Voltage Systems', 'Instrumentation & Control',
  'PLC / SCADA', 'Thermography (Infrared)', 'PAT Testing', 'Solar/PV Systems',
  'Power Transformers', 'Cable Testing',

  // Civil & Structural
  'Structural Steel', 'Concrete Inspection', 'Bridge Inspection', 'Roads & Asphalt',

  // Safety & General
  'HSE Manager', 'OSHA Certified', 'Rope Access (IRATA)', 'Confined Space',
  'Drone Pilot (UAV)', 'QA/QC Manager', 'ISO 9001 Auditor'
];

export default function SkillsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { isDarkMode } = useTheme();
  const colors = getColors(isDarkMode);

  // ✅ Enable Translation & RTL
  const { t, isRTL } = useLanguage();

  const [skills, setSkills] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    // ★ SPEC-FIX-002: escape hatch for the auth-resolved-but-no-user
    //   case. The original code only handled `user` truthy and left
    //   `loading=true` forever otherwise, causing an infinite spinner
    //   when the screen was opened during a signed-out / cold-boot
    //   state. We bail to a non-loading state instead so the screen
    //   renders an actionable surface rather than hanging.
    //
    //   `useAuth` exposes `user` as `null | undefined | User`. We
    //   treat both falsy values identically here — the screen has no
    //   meaningful content without a user, and the auth provider will
    //   re-emit once it resolves, re-running this effect.
    if (user) {
      checkUserTypeAndRedirect();
      return;
    }
    if (user === null) {
      // Auth resolved, no user. Stop spinning.
      setLoading(false);
    }
    // user === undefined → still resolving; keep the spinner.
  }, [user]);

  const checkUserTypeAndRedirect = async () => {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', currentUser.id)
        .single();

      if (error) throw error;

      // Redirect agencies to company overview instead of skills
      if (data?.role === 'agency') {
        router.replace('/profile/edit');
        return;
      }

      fetchSkills();
    } catch (error) {
      console.error('Error checking user type:', error);
      setLoading(false);
    }
  };

  const fetchSkills = async () => {
    try {
      setLoading(true);
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('skills')
        .eq('id', currentUser.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      setSkills(data?.skills || []);
    } catch (error) {
      console.error('Error fetching skills:', error);
      Alert.alert(t('Error'), t('Failed to load skills')); // Translated error
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSkill = async (skill: string) => {
    try {
      setSaving(true);
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) return;

      let updatedSkills: string[];
      if (skills.includes(skill)) {
        // Remove skill
        updatedSkills = skills.filter(s => s !== skill);
      } else {
        // Add skill
        updatedSkills = [...skills, skill];
      }

      const { error } = await supabase
        .from('profiles')
        .update({ skills: updatedSkills })
        .eq('id', currentUser.id);

      if (error) throw error;

      setSkills(updatedSkills);
    } catch (error: any) {
      console.error('Error toggling skill:', error);
      Alert.alert(t('Error'), error.message || t('Failed to update skill'));
    } finally {
      setSaving(false);
    }
  };

  // Filter skills based on search query
  const filteredSkills = SKILLS_LIST.filter(skill =>
    skill.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
          >
            {/* Flip arrow for RTL */}
            <Ionicons name={isRTL ? "arrow-forward" : "arrow-back"} size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('Specialist Skills')}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header with RTL support */}
      <View style={[styles.header, { borderBottomColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)', flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name={isRTL ? "arrow-forward" : "arrow-back"} size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('Specialist Skills')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Search Input with RTL support */}
        <View style={[
          styles.searchContainer,
          {
            backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)',
            borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)',
            flexDirection: isRTL ? 'row-reverse' : 'row' // RTL layout
          }
        ]}>
          <Ionicons
            name="search"
            size={20}
            color={colors.textMuted}
            style={[styles.searchIcon, isRTL ? { marginLeft: 12, marginRight: 0 } : { marginRight: 12 }]}
          />
          <TextInput
            style={[
              styles.searchInput,
              {
                color: colors.text,
                backgroundColor: isDarkMode ? 'rgba(0, 0, 0, 0.2)' : 'rgba(255, 255, 255, 0.8)',
                textAlign: isRTL ? 'right' : 'left' // Text alignment
              }
            ]}
            placeholder={t('Search skills...')}
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton}>
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Selected Skills Count */}
        <View style={styles.selectedHeader}>
          <Text style={[styles.selectedCount, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>
            {t('Selected:')} {skills.length} {skills.length === 1 ? t('skill') : t('skills')}
          </Text>
        </View>

        {/* Skills List */}
        <View style={styles.skillsSection}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>
            {t('Available Skills')} ({filteredSkills.length})
          </Text>
          {filteredSkills.length > 0 ? (
            <View style={[styles.skillsGrid, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
              {filteredSkills.map((skill, index) => {
                const isSelected = skills.includes(skill);
                return (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.skillCard,
                      {
                        backgroundColor: isSelected ? '#4ade80' : 'rgba(255, 255, 255, 0.1)',
                        borderColor: isSelected ? '#4ade80' : 'rgba(255, 255, 255, 0.2)',
                        borderWidth: 1,
                        flexDirection: isRTL ? 'row-reverse' : 'row' // Chip content direction
                      }
                    ]}
                    onPress={() => handleToggleSkill(skill)}
                    activeOpacity={0.7}
                    disabled={saving}
                  >
                    <Text style={styles.skillCardText}>
                      {/* Using t(skill) allows translating specific technical terms later if needed, otherwise falls back to English */}
                      {t(skill as any)}
                    </Text>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={16} color="#FFFFFF" style={isRTL ? { marginRight: 4 } : { marginLeft: 4 }} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="search-outline" size={48} color={colors.textMuted} />
              <Text style={[styles.emptyStateText, { color: colors.textMuted }]}>{t('No skills found')}</Text>
              <Text style={[styles.emptyStateSubtext, { color: colors.textMuted }]}>
                {t('Try a different search term')}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  searchContainer: {
    alignItems: 'center',
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  searchIcon: {
    // margins handled inline for RTL
  },
  searchInput: {
    flex: 1,
    padding: 0,
    fontSize: 15,
  },
  clearButton: {
    marginLeft: 8,
    padding: 4,
  },
  selectedHeader: {
    marginBottom: 20,
  },
  selectedCount: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  skillsSection: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  skillsGrid: {
    flexWrap: 'wrap',
    gap: 10,
  },
  skillCard: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    alignSelf: 'flex-start',
    gap: 6,
  },
  skillCardText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  checkIcon: {
    // margins handled inline
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 16,
  },
  emptyStateSubtext: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
});
