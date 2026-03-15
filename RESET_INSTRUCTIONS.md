# Supabase Project Reset Instructions

## ⚠️ WARNING
This process will **DELETE ALL DATA** from your Supabase project. Make sure you have backups if needed.

---

## Step 1: Run the SQL Reset Script

1. Open your **Supabase Dashboard**
2. Navigate to **SQL Editor** (left sidebar)
3. Click **New Query**
4. Copy and paste the entire contents of `reset_supabase_project.sql`
5. Click **Run** (or press `Ctrl/Cmd + Enter`)
6. Verify the output shows:
   - All tables have `row_count = 0`
   - `remaining_files = 0` for storage
   - Bucket query returns `0 rows`

---

## Step 2: Create New Storage Bucket via UI

### Navigate to Storage:
1. In Supabase Dashboard, click **Storage** in the left sidebar
2. Click **New bucket** button (top right)

### Configure the Bucket:
1. **Bucket name**: `report-images`
2. **Public bucket**: ✅ **Toggle ON** (This is critical!)
3. **File size limit**: Leave default or set to your preference (e.g., 5MB)
4. **Allowed MIME types**: Leave empty (allows all types) OR specify:
   - `image/png`
   - `image/jpeg`
   - `image/jpg`
   - `image/gif`
   - `image/webp`
5. Click **Create bucket**

---

## Step 3: Set Storage Policies via UI

### Navigate to Policies:
1. In **Storage**, click on the `report-images` bucket
2. Click the **Policies** tab (next to "Files")
3. You'll see a table with policy rules

### Create SELECT Policy (Public Read Access):

1. Click **New Policy** button
2. Select **For full customization** (or use template)
3. Configure:
   - **Policy name**: `Public read access`
   - **Allowed operation**: ✅ **SELECT**
   - **Target roles**: `public`
   - **USING expression**: 
     ```sql
     bucket_id = 'report-images'
     ```
   - **WITH CHECK expression**: Leave empty (not needed for SELECT)
4. Click **Review** then **Save policy**

### Create INSERT Policy (Authenticated Upload):

1. Click **New Policy** button again
2. Select **For full customization**
3. Configure:
   - **Policy name**: `Authenticated insert access`
   - **Allowed operation**: ✅ **INSERT**
   - **Target roles**: `authenticated`
   - **USING expression**: 
     ```sql
     bucket_id = 'report-images'
     ```
   - **WITH CHECK expression**: 
     ```sql
     bucket_id = 'report-images' AND auth.uid()::text = (storage.foldername(name))[1]
     ```
     *(This ensures users can only upload to their own folder)*
   
   **OR** for simpler access (all authenticated users can upload anywhere):
   ```sql
   bucket_id = 'report-images'
   ```
4. Click **Review** then **Save policy**

### Optional: Create UPDATE and DELETE Policies:

**UPDATE Policy:**
- **Policy name**: `Authenticated update access`
- **Allowed operation**: ✅ **UPDATE**
- **Target roles**: `authenticated`
- **USING expression**: 
  ```sql
  bucket_id = 'report-images' AND auth.uid()::text = (storage.foldername(name))[1]
  ```
- **WITH CHECK expression**: Same as USING

**DELETE Policy:**
- **Policy name**: `Authenticated delete access`
- **Allowed operation**: ✅ **DELETE**
- **Target roles**: `authenticated`
- **USING expression**: 
  ```sql
  bucket_id = 'report-images' AND auth.uid()::text = (storage.foldername(name))[1]
  ```

---

## Step 4: Verify Setup

### Test Bucket Access:
Run this in SQL Editor:
```sql
-- Check bucket exists and is public
SELECT id, name, public, created_at
FROM storage.buckets
WHERE id = 'report-images';

-- Check policies exist
SELECT 
  policyname,
  cmd as operation,
  roles
FROM pg_policies
WHERE schemaname = 'storage' 
  AND tablename = 'objects'
  AND policyname LIKE '%report-images%';
```

### Expected Results:
- Bucket should show `public = true`
- You should see at least 2 policies (SELECT for public, INSERT for authenticated)

---

## Step 5: Test Image Upload

After setup, test uploading an image from your app. The upload should work and images should render correctly.

---

## Troubleshooting

### "must be owner" Error:
- This means you're trying to create policies via SQL as a non-owner
- **Solution**: Use the UI method above instead

### Bucket Not Public:
- Go to Storage → `report-images` bucket → Settings
- Toggle **Public bucket** to ON
- Save

### Images Still Not Loading:
1. Check the bucket is public: `SELECT public FROM storage.buckets WHERE id = 'report-images';`
2. Verify policies exist (see Step 4)
3. Check image URLs in your app are correct
4. Verify network security configs in your app (Android/iOS)

---

## Quick Reference: Policy Templates

### Public SELECT (Read):
```sql
bucket_id = 'report-images'
```

### Authenticated INSERT (Upload):
```sql
bucket_id = 'report-images'
```

### Authenticated UPDATE (Modify):
```sql
bucket_id = 'report-images' AND auth.uid()::text = (storage.foldername(name))[1]
```

### Authenticated DELETE (Remove):
```sql
bucket_id = 'report-images' AND auth.uid()::text = (storage.foldername(name))[1]
```

---

## ✅ Reset Complete Checklist

- [ ] SQL reset script executed successfully
- [ ] All tables show 0 rows
- [ ] Storage bucket deleted
- [ ] New `report-images` bucket created via UI
- [ ] Bucket is set to **Public**
- [ ] SELECT policy created for `public` role
- [ ] INSERT policy created for `authenticated` role
- [ ] Verification queries pass
- [ ] Test image upload works
- [ ] Test image rendering works

---

**Your Supabase project is now clean and ready for fresh testing!** 🎉

