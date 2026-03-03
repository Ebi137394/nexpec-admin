import 'react-native-gesture-handler'; // 1. این خط باید حتماً اول باشد
import 'react-native-url-polyfill/auto'; // 2. CRITICAL: Must be line 2, before any other imports

import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler'; // 2. ایمپورت حیاتی

// اینجا باید نویگیتور اصلی (که شامل اسپلش و لاگین است) را صدا بزنید
// نه MainNavigator را (مگر اینکه فقط بخواهید تب‌ها را تست کنید)
import AppNavigator from './navigation/AppNavigator'; 

const COLORS = {
  background: '#0A0E17',
};

const App: React.FC = () => {
  return (
    // 3. اضافه کردن ویوی مدیریت جسچرها
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar 
          barStyle="light-content" 
          backgroundColor={COLORS.background} 
          translucent={true}
        />
        {/* 4. اجرای کل سیستم نویگیشن */}
        <AppNavigator />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
};

export default App;
