# ════════════════════════════════════════════════════════════════
# INCOGNITO BROWSER TEST PROCEDURE
# ════════════════════════════════════════════════════════════════

## Step 1: Get your project reference
1. Go to **Supabase Dashboard** → **Settings** → **API**
2. Copy the **"Reference ID"** (e.g., `sxqpjxhslzzcdrdctatm`)

## Step 2: Get a file name from your storage
1. Go to **Supabase Dashboard** → **Storage** → **report-images** → **reports**
2. Copy a file name (e.g., `user123_1234567890_abc123.png`)

## Step 3: Construct the URL
**Format:**
```
https://[PROJECT_REF].supabase.co/storage/v1/object/public/[BUCKET]/[FOLDER]/[FILENAME]
```

**Example:**
```
https://sxqpjxhslzzcdrdctatm.supabase.co/storage/v1/object/public/report-images/reports/user123_1234567890_abc123.png
```

## Step 4: Test in Incognito/Private browser
1. Open new incognito window:
   - **Chrome/Edge**: `Ctrl+Shift+N` (Windows) or `Cmd+Shift+N` (Mac)
   - **Firefox**: `Ctrl+Shift+P` (Windows) or `Cmd+Shift+P` (Mac)
   - **Safari**: `Cmd+Shift+N` (Mac)
2. Paste the URL in the address bar
3. Press **Enter**

### Expected Results:
- ✅ **Image displays** → Storage is working correctly!
- ❌ **403 Forbidden** → RLS policies not working - re-run SQL script
- ❌ **404 Not Found** → File doesn't exist or path is incorrect
- ❌ **CORS error** → Check bucket CORS settings

---

# ════════════════════════════════════════════════════════════════
# CURL TEST (Alternative)
# ════════════════════════════════════════════════════════════════

## Test without any authentication

```bash
curl -I "https://sxqpjxhslzzcdrdctatm.supabase.co/storage/v1/object/public/report-images/reports/user123_1234567890_abc123.png"
```

### Expected Response:
```
HTTP/2 200 
content-type: image/png
content-length: [size]
access-control-allow-origin: *
cache-control: public, max-age=3600
```

### Error Responses:

**HTTP/2 403 Forbidden:**
- Bucket is not truly public
- RLS SELECT policy missing for `anon` role
- Re-run the SQL script to fix policies

**HTTP/2 404 Not Found:**
- File doesn't exist at that path
- Check the file path in Storage dashboard

**Connection refused / Timeout:**
- Network issue
- Check your internet connection
- Verify the project reference is correct

---

# ════════════════════════════════════════════════════════════════
# QUICK DIAGNOSTIC QUERIES
# ════════════════════════════════════════════════════════════════

Run these in Supabase SQL Editor to diagnose issues:

## Check if bucket is public:
```sql
SELECT id, name, public, created_at
FROM storage.buckets
WHERE id = 'report-images';
```
**Expected:** `public = true`

## Check RLS policies:
```sql
SELECT 
  policyname,
  cmd as operation,
  roles,
  qual as using_expression
FROM pg_policies
WHERE schemaname = 'storage' 
  AND tablename = 'objects'
  AND policyname LIKE '%report-images%';
```
**Expected:** At least one policy with `cmd = 'SELECT'` and `roles = '{anon,public}'`

## Check if files exist:
```sql
SELECT 
  name,
  bucket_id,
  created_at,
  metadata->>'mimetype' as mimetype
FROM storage.objects
WHERE bucket_id = 'report-images'
ORDER BY created_at DESC
LIMIT 10;
```

---

# ════════════════════════════════════════════════════════════════
# TROUBLESHOOTING CHECKLIST
# ════════════════════════════════════════════════════════════════

- [ ] Bucket exists and is set to **Public** in Storage dashboard
- [ ] RLS policy exists for `SELECT` operation on `anon`/`public` role
- [ ] File path in URL matches the actual file path in Storage
- [ ] Project reference in URL is correct
- [ ] No typos in bucket name (`report-images`)
- [ ] File was uploaded successfully (check Storage dashboard)
- [ ] Network security config allows Supabase domains (for mobile apps)

---

# ════════════════════════════════════════════════════════════════
# USING THE HELPER FUNCTION
# ════════════════════════════════════════════════════════════════

You can also use the helper function in your code:

```typescript
import { constructPublicUrl } from '../lib/storageHelpers';

const PROJECT_REF = 'sxqpjxhslzzcdrdctatm';
const BUCKET_NAME = 'report-images';
const FILE_PATH = 'reports/user123_1234567890_abc123.png';

const publicUrl = constructPublicUrl(PROJECT_REF, BUCKET_NAME, FILE_PATH);
console.log('Public URL:', publicUrl);
```

This ensures consistent URL formatting across your application.

