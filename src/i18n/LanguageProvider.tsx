// src/i18n/LanguageProvider.tsx
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { View, ActivityIndicator, I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { translations } from './translations';

type Language = keyof typeof translations; // Automatically gets all keys
type TranslationKey = keyof typeof translations['en']['profile'];

interface LanguageContextType {
  language: string;
  setLanguage: (lang: string) => Promise<void>;
  // fallback is accepted at call sites for ergonomics; the impl below still
  // returns the key on a miss, so runtime behavior is unchanged.
  t: (key: string, fallback?: string) => string;
  isRTL: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<string>('en');
  const [isReady, setIsReady] = useState(false);

  // ✅ Allowed all 12 languages here
  const SUPPORTED_LANGUAGES = [
    'en', 'en-GB', 'fa', 'es', 'fr', 'de', 'ar', 'tr', 'zh', 'ja', 'ru', 'it'
  ];

  useEffect(() => {
    loadLanguage();
  }, []);

  const loadLanguage = async () => {
    try {
      const savedLang = await AsyncStorage.getItem('language');
      if (savedLang && SUPPORTED_LANGUAGES.includes(savedLang)) {
        setLanguageState(savedLang);
        
        // Handle RTL
        const isRTL = savedLang === 'fa' || savedLang === 'ar';
        if (isRTL && !I18nManager.isRTL) {
           I18nManager.forceRTL(true);
           I18nManager.allowRTL(true);
        } else if (!isRTL && I18nManager.isRTL) {
           I18nManager.forceRTL(false);
           I18nManager.allowRTL(false);
        }
      }
    } catch (error) {
      console.error('Error loading language:', error);
    } finally {
      setIsReady(true);
    }
  };

  const setLanguage = async (newLang: string) => {
    try {
      await AsyncStorage.setItem('language', newLang);
      setLanguageState(newLang);
      
      const isNewLangRTL = newLang === 'fa' || newLang === 'ar';
      if (isNewLangRTL !== I18nManager.isRTL) {
        I18nManager.allowRTL(isNewLangRTL);
        I18nManager.forceRTL(isNewLangRTL);
      }
      
    } catch (error) {
      console.error('Error saving language:', error);
    }
  };

  const t = (key: string, fallback?: string): string => {
    // @ts-ignore
    return translations[language]?.profile?.[key] || translations['en']?.profile?.[key] || String(key);
  };

  const isRTL = language === 'fa' || language === 'ar';

  const value = {
    language,
    setLanguage,
    t,
    isRTL,
  };

  if (!isReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#020420' }}>
        <ActivityIndicator size="large" color="#7C3AED" />
      </View>
    );
  }

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
};