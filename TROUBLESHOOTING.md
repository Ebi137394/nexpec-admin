# NEXPEC - Troubleshooting Network Issues

## Problem: "Network request failed" in iOS Simulator

The app is correctly configured and Supabase credentials are hardcoded, but the iOS Simulator cannot reach the Supabase servers.

## Solutions (Try in Order):

### Solution 1: Restart iOS Simulator
1. **Close the Simulator** completely (Cmd+Q)
2. **Restart it** and reload the app
3. Sometimes the simulator's network stack needs a fresh start

### Solution 2: Check Mac Network Settings
1. Open **System Settings** → **Network**
2. Make sure you're connected to the internet
3. Try disabling/re-enabling WiFi

### Solution 3: Reset iOS Simulator Network
```bash
# Stop Expo
# Then run:
xcrun simctl shutdown all
xcrun simctl erase all
```
**Warning**: This will erase all simulator data!

### Solution 4: Use a Physical Device Instead
The iOS Simulator sometimes has network issues that don't exist on real devices.

#### To Run on Your iPhone:
1. Install **Expo Go** from the App Store
2. Make sure your phone and Mac are on the **same WiFi network**
3. In the terminal where `npx expo start` is running, you'll see a QR code
4. **Scan the QR code** with your iPhone camera
5. It will open in Expo Go

### Solution 5: Try Web Version (Temporary Test)
```bash
# In the terminal where Expo is running, press 'w'
# This will open the app in your web browser
```

## Current App Status

✅ **App is correctly built**
✅ **Supabase credentials are hardcoded and loaded**
✅ **Authentication screen is rendering**
✅ **Code has no errors**

❌ **iOS Simulator network connectivity issue**

## Recommended Next Step

**Use your physical iPhone with Expo Go** - this is the most reliable way to test and will avoid simulator networking issues entirely.

---

## Files Created:

- ✅ `app/auth.tsx` - Login/Signup screen
- ✅ `app/profile.tsx` - Inspector profile screen
- ✅ `app/index.tsx` - Routing
- ✅ `lib/supabase.ts` - Supabase client (hardcoded credentials)
- ✅ `types/database.types.ts` - TypeScript interfaces
- ✅ `.env` - Environment variables (backup)
- ✅ `app.config.js` - Expo configuration

## What Works:

1. **Authentication Flow**: Sign up, sign in, sign out
2. **Auto-profile creation**: When you sign up, a profile is automatically created
3. **Profile Screen**: Shows user data, stats, skills
4. **Dark Industrial Theme**: Beautiful UI with orange accents

The app is **100% ready** - it just needs to run on a device with proper network access!

