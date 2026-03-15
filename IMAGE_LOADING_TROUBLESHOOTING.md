# Image Loading Troubleshooting Guide

## Current Error
```
Failed to Load Image
URL: https://sxqpjxhslzzcdrdctatm.supabase.co/storage/v1/object/public/report-images/reports/0a4130bc-bcc9-4c95-bb40-326d54f84d93_1767117076365.png
```

## Quick Diagnostic Steps

### Step 1: Test URL in Incognito Browser
1. Copy the URL: `https://sxqpjxhslzzcdrdctatm.supabase.co/storage/v1/object/public/report-images/reports/0a4130bc-bcc9-4c95-bb40-326d54f84d93_1767117076365.png`
2. Open incognito/private browser window
3. Paste URL and press Enter

**Expected Results:**
- ✅ **Image displays** → URL is correct, issue is in app
- ❌ **403 Forbidden** → RLS policy issue (see Step 2)
- ❌ **404 Not Found** → File doesn't exist (see Step 3)

### Step 2: Check RLS Policies (If 403 Error)

Run this in **Supabase SQL Editor**:

```sql
-- Check if bucket is public
SELECT id, name, public 
FROM storage.buckets 
WHERE id = 'report-images';
-- Should show: public = true

-- Check RLS policies
SELECT 
  policyname,
  cmd as operation,
  roles,
  qual as using_expression
FROM pg_policies
WHERE schemaname = 'storage' 
  AND tablename = 'objects'
  AND policyname LIKE '%report-images%';
-- Should show at least one SELECT policy for 'anon' or 'public' role
```

**If bucket is not public or policy is missing:**

```sql
-- Make bucket public
UPDATE storage.buckets
SET public = true
WHERE id = 'report-images';

-- Create public SELECT policy
CREATE POLICY "Allow public read for report-images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'report-images');
```

### Step 3: Verify File Exists (If 404 Error)

1. Go to **Supabase Dashboard** → **Storage** → **report-images** → **reports**
2. Look for file: `0a4130bc-bcc9-4c95-bb40-326d54f84d93_1767117076365.png`
3. If file doesn't exist:
   - Check if upload completed successfully
   - Verify the file path in your upload code
   - Re-upload the image

### Step 4: Test with CURL

```bash
curl -I "https://sxqpjxhslzzcdrdctatm.supabase.co/storage/v1/object/public/report-images/reports/0a4130bc-bcc9-4c95-bb40-326d54f84d93_1767117076365.png"
```

**Expected Response:**
```
HTTP/2 200
content-type: image/png
access-control-allow-origin: *
```

**If you get 403:**
- Bucket is not public
- RLS policy is missing
- Run the SQL from Step 2

### Step 5: Check App Configuration

Verify these are set correctly:

**Android (`app.config.js`):**
```javascript
android: {
  usesCleartextTraffic: true,
  networkSecurityConfig: './android/app/src/main/res/xml/network_security_config.xml',
}
```

**iOS (`app.config.js`):**
```javascript
ios: {
  infoPlist: {
    NSAppTransportSecurity: {
      NSAllowsArbitraryLoads: true,
    },
  },
}
```

### Step 6: Use Diagnostic Function

In your app, you can use the diagnostic function:

```typescript
import { diagnoseImageUrl } from '../lib/imageDiagnostics';

// Test the URL
const results = await diagnoseImageUrl(report.image_url);
console.log('Diagnostic results:', results);
```

This will log detailed information about:
- URL validity
- HTTP status code
- Content-Type
- CORS headers
- Specific error messages

## Common Issues & Solutions

### Issue 1: 403 Forbidden
**Cause:** RLS policy not allowing public access

**Solution:**
1. Make bucket public in Storage dashboard
2. Create SELECT policy for `anon`/`public` role
3. Run SQL from Step 2

### Issue 2: 404 Not Found
**Cause:** File doesn't exist at that path

**Solution:**
1. Check Storage dashboard for actual file path
2. Verify upload completed successfully
3. Check if file was moved or deleted

### Issue 3: CORS Error
**Cause:** CORS headers not set correctly

**Solution:**
1. Ensure bucket is public
2. Check Supabase Storage CORS settings
3. Verify network security configs

### Issue 4: Network Error (Mobile)
**Cause:** Network security blocking cleartext traffic

**Solution:**
1. Verify `network_security_config.xml` exists
2. Check `app.config.js` settings
3. Rebuild native code: `npx expo prebuild --clean`

## Quick Fix SQL Script

Run this complete fix in Supabase SQL Editor:

```sql
-- 1. Make bucket public
UPDATE storage.buckets
SET public = true
WHERE id = 'report-images';

-- 2. Drop existing policies
DROP POLICY IF EXISTS "Allow public read for report-images" ON storage.objects;

-- 3. Create new public SELECT policy
CREATE POLICY "Allow public read for report-images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'report-images');

-- 4. Verify
SELECT id, name, public FROM storage.buckets WHERE id = 'report-images';
SELECT policyname, cmd, roles FROM pg_policies 
WHERE schemaname = 'storage' AND tablename = 'objects' 
AND policyname LIKE '%report-images%';
```

## Testing Checklist

- [ ] URL works in incognito browser
- [ ] CURL returns HTTP 200
- [ ] Bucket is set to public
- [ ] RLS SELECT policy exists for public role
- [ ] File exists in Storage dashboard
- [ ] Network security configs are correct
- [ ] App has been rebuilt after config changes

## Still Not Working?

1. Check browser console for detailed error messages
2. Use the diagnostic function in your app
3. Verify the exact file path matches what's in Storage
4. Try uploading a new image and test that URL
5. Check Supabase project logs for any errors

