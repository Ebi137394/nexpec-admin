import React, { useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { getColors } from '@/src/constants/theme';
import { useLanguage } from '@/src/i18n/LanguageProvider';

// ✅ This list matches your screenshots exactly
// IMPORTANT: The 'id' here must match the keys in translations.ts
const LANGUAGES = [
  { id: 'en', name: 'English (United States)', flag: '🇺🇸' },
  { id: 'fa', name: 'Persian (فارسی)', flag: '🦁☀️' },
  { id: 'en-GB', name: 'English (United Kingdom)', flag: '🇬🇧' },
  { id: 'es', name: 'Spanish (Español)', flag: '🇪🇸' },
  { id: 'fr', name: 'French (Français)', flag: '🇫🇷' },
  { id: 'de', name: 'German (Deutsch)', flag: '🇩🇪' },
  { id: 'tr', name: 'Turkish (Türkçe)', flag: '🇹🇷' },
  { id: 'ar', name: 'Arabic (العربية)', flag: '🇸🇦' },
  { id: 'zh', name: 'Chinese (Simplified)', flag: '🇨🇳' },
  { id: 'ja', name: 'Japanese (日本語)', flag: '🇯🇵' },
  { id: 'ru', name: 'Russian (Русский)', flag: '🇷🇺' },
  { id: 'it', name: 'Italian (Italiano)', flag: '🇮🇹' },
];

export default function LanguageScreen() {
  const router = useRouter();
  const { isDarkMode } = useTheme();
  const colors = getColors(isDarkMode);
  
  const { language: currentLanguage, setLanguage } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');

  const handleSelectLanguage = async (languageId: string) => {
    // 🔓 UNLOCKED: This array now includes ALL your languages.
    // Before, 'fr' and others were missing from here, causing the "Coming Soon" error.
    const validLanguages = ['en', 'en-GB', 'fa', 'es', 'fr', 'de', 'ar', 'tr', 'zh', 'ja', 'ru', 'it'];
    
    if (validLanguages.includes(languageId)) {
      try {
        await setLanguage(languageId);
        // Optional: Go back automatically after selection
        // router.back(); 
        Alert.alert("Success", "Language updated");
      } catch (error) {
        console.error('Error saving language:', error);
      }
    } else {
      // This should never happen now for the list above
      Alert.alert("Coming Soon", "Translation for this language is currently being added.");
    }
  };

  const filteredLanguages = LANGUAGES.filter(lang =>
    lang.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Language Settings</Text>
        <View style={{ width: 40 }} />
      </View>
      
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Search Bar */}
        <View style={[styles.searchContainer, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}>
          <Ionicons name="search" size={20} color={colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search languages..."
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

        {/* Languages List */}
        <View style={styles.languagesList}>
          {filteredLanguages.map((item) => {
            const isSelected = currentLanguage === item.id;
            return (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.languageItem,
                  {
                    backgroundColor: isSelected ? (isDarkMode ? 'rgba(0, 245, 255, 0.15)' : 'rgba(0, 245, 255, 0.2)') : (isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)'),
                    borderColor: isSelected ? colors.primary : (isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)'),
                    borderWidth: isSelected ? 2 : 1,
                  }
                ]}
                onPress={() => handleSelectLanguage(item.id)}
              >
                <View style={styles.languageLeft}>
                  <Text style={styles.flagEmoji}>{item.flag}</Text>
                  <Text style={[styles.languageName, { color: colors.text }]}>{item.name}</Text>
                </View>
                {isSelected && <Ionicons name="checkmark-circle" size={24} color={colors.primary} />}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1 },
  backButton: { padding: 8 },
  headerTitle: { fontSize: 20, fontWeight: '700' },
  content: { flex: 1, padding: 20 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, padding: 16, borderRadius: 16, borderWidth: 1 },
  searchIcon: { marginRight: 12 },
  searchInput: { flex: 1, padding: 0, fontSize: 15 },
  clearButton: { marginLeft: 8, padding: 4 },
  languagesList: { gap: 12 },
  languageItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderRadius: 12, borderWidth: 1 },
  languageLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  flagEmoji: { fontSize: 24 },
  languageName: { fontSize: 16, fontWeight: '500', flex: 1 },
});