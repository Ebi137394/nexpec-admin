# Network Request Failed - Troubleshooting

## خطا: `[TypeError: Network request failed]`

### ✅ راه‌حل‌های مرحله به مرحله:

### 1. بررسی Environment Variables
```bash
# بررسی کنید که .env file وجود دارد
cat .env

# باید شامل این باشد:
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 2. Restart Metro با Clear Cache
```bash
# Stop Metro (Ctrl+C)
# سپس:
npx expo start --clear
```

### 3. بررسی Supabase URL
- ✅ باید با `https://` شروع شود
- ✅ باید به درستی format شده باشد
- ❌ نباید trailing slash داشته باشد

### 4. بررسی Network Connection
```bash
# Test connection
curl https://your-project.supabase.co/rest/v1/

# یا در browser باز کنید
```

### 5. بررسی iOS Simulator Network
```bash
# اگر در iOS Simulator هستید:
# Settings > General > Reset > Reset Network Settings
```

### 6. بررسی Android Emulator
```bash
# در Android Emulator:
# Settings > Network & Internet > Reset
```

### 7. بررسی App Config
در `app.config.js` باید این تنظیمات باشد:
```js
ios: {
  infoPlist: {
    NSAppTransportSecurity: {
      NSAllowsArbitraryLoads: true,
      NSExceptionDomains: {
        'supabase.co': {
          NSExceptionAllowsInsecureHTTPLoads: true,
          NSIncludesSubdomains: true,
        },
      },
    },
  },
},
android: {
  usesCleartextTraffic: true,
},
```

### 8. اگر در Expo Go هستید
Expo Go ممکن است network restrictions داشته باشد. بهتر است از development build استفاده کنید:
```bash
npx expo run:ios
# یا
npx expo run:android
```

### 9. Debug Logging
در `lib/supabase.ts` logging اضافه شده است. console را چک کنید:
- ✅ "Supabase initialized" = Config درست است
- ❌ "Network error" = Connection problem

### 10. Common Issues:
- ❌ `.env` file در root directory نیست
- ❌ Environment variables با `EXPO_PUBLIC_` شروع نمی‌شوند
- ❌ Metro bundler cache نشده
- ❌ Supabase project paused یا deleted شده
- ❌ Firewall یا VPN blocking requests

### 11. Quick Fix:
```bash
# 1. Check .env exists
ls -la .env

# 2. Restart with clear cache
npx expo start --clear

# 3. Rebuild if needed
npx expo run:ios --clear
```

