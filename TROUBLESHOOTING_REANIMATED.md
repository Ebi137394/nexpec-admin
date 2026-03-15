# Troubleshooting react-native-reanimated

## مشکل: Animations کار نمی‌کنند

### ✅ راه‌حل‌های مرحله به مرحله:

### 1. بررسی babel.config.js
```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'react-native-reanimated/plugin', // باید آخرین باشد
    ],
  };
};
```

### 2. Clear Cache و Restart
```bash
# Stop Metro bundler (Ctrl+C)

# Clear cache و restart
npx expo start --clear

# یا
npm start -- --reset-cache
```

### 3. Rebuild Native Code (مهم!)
```bash
# برای iOS
npx expo run:ios

# برای Android  
npx expo run:android

# یا rebuild کامل
rm -rf node_modules
npm install
npx expo prebuild --clean
npx expo run:ios  # یا android
```

### 4. بررسی Import
```typescript
// ✅ درست
import Animated, { useSharedValue, withSpring } from 'react-native-reanimated';

// ❌ اشتباه
import { Animated } from 'react-native'; // این کار نمی‌کند!
```

### 5. بررسی Package Version
```json
// package.json باید داشته باشد:
"react-native-reanimated": "~3.16.1"
```

### 6. اگر هنوز کار نمی‌کند:
```bash
# 1. Delete node_modules و reinstall
rm -rf node_modules
npm install

# 2. Clear Expo cache
npx expo start --clear

# 3. Rebuild native
npx expo prebuild --clean
npx expo run:ios
```

### ⚠️ نکات مهم:
- بعد از تغییر babel.config.js حتماً rebuild کنید (reload کافی نیست!)
- در Expo Go ممکن است بعضی animations کار نکنند - از development build استفاده کنید
- مطمئن شوید `react-native-reanimated/plugin` آخرین plugin در babel.config.js است

