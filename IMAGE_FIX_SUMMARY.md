# Image Loading Fix Summary

## Problem
Images were failing to load in the Review Report screen with the error "Failed to Load Image" even though the bucket was set to PUBLIC.

## Root Causes Identified
1. **RLS Policies**: Missing or incorrect Row Level Security policies for the `anon` role to SELECT from `storage.objects`
2. **Upload Logic**: Base64 data URI prefix (`data:image/png;base64,`) was not being stripped properly before upload
3. **Image Component**: No cache-busting mechanism, potentially serving stale/cached images

## Solutions Implemented

### 1. Database & RLS (SQL Script)
**File**: `fix_storage_rls.sql`

- ✅ Ensures `report-images` bucket is PUBLIC
- ✅ Creates `anon_select_report_images` policy for unauthenticated SELECT access
- ✅ Creates policies for authenticated users (INSERT, UPDATE, DELETE)
- ✅ Includes verification queries

**To apply**: Run the SQL script in your Supabase SQL Editor.

### 2. Upload Logic Fix
**File**: `app/submit-report.tsx`

**Changes**:
- ✅ **Proper Base64 Detection**: Checks if URI starts with `data:`
- ✅ **Prefix Stripping**: Uses regex `/^data:image\/[a-zA-Z]+;base64,/` to strip the prefix
- ✅ **MIME Type Extraction**: Extracts content type from data URI (e.g., `image/png`, `image/jpeg`)
- ✅ **Explicit Content-Type**: Sets `contentType` explicitly to `image/png` or `image/jpeg` based on detected type
- ✅ **Cross-Platform Support**: Handles both web (Blob) and mobile (ArrayBuffer) correctly
- ✅ **Base64 Decoding**: Uses `base64-arraybuffer` decode function for mobile platforms

**Key Code**:
```typescript
// Detects base64 data URI
if (uri.startsWith('data:')) {
  const mimeMatch = uri.match(/data:image\/([^;]+);base64,/);
  // Strips prefix
  const base64Regex = /^data:image\/[a-zA-Z]+;base64,/;
  base64Data = uri.replace(base64Regex, '');
  // Sets explicit content type
  contentType = `image/${imageType}`;
}
```

### 3. Image Component Fix
**File**: `app/review-report.tsx`

**Changes**:
- ✅ **Cache-Busting**: Adds timestamp query parameter (`?t=${Date.now()}&cache=no`)
- ✅ **Helper Function**: `getImageUrl()` constructs URL with cache-busting
- ✅ **Cache Policy**: Changed from `"disk"` to `"none"` to prevent stale cache
- ✅ **Key Prop**: Uses timestamp in key to force re-render on retry

**Key Code**:
```typescript
const getImageUrl = (url: string | undefined): string => {
  if (!url) return '';
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}t=${Date.now()}&cache=no`;
};
```

## Testing Checklist

1. **Run SQL Script**:
   - Open Supabase Dashboard → SQL Editor
   - Run `fix_storage_rls.sql`
   - Verify bucket is public: `SELECT * FROM storage.buckets WHERE id = 'report-images';`
   - Verify policies exist: Check `pg_policies` table

2. **Test Upload**:
   - Submit a new report with an image
   - Check console logs for upload process
   - Verify image appears in Supabase Storage dashboard
   - Verify public URL is generated correctly

3. **Test Display**:
   - Open Review Report screen
   - Verify image loads without errors
   - Check browser/network tab for successful image request
   - Verify cache-busting parameter is in URL

4. **Test Public Access**:
   - Copy image URL from database
   - Open in incognito browser (unauthenticated)
   - Should load successfully (proves RLS is working)

## Expected Results

✅ Images upload successfully with correct content type
✅ Images display in Review Report screen
✅ Public URLs are accessible without authentication
✅ Cache-busting prevents stale image issues
✅ Proper error handling and logging

## Files Modified

1. `fix_storage_rls.sql` - New SQL script for RLS policies
2. `app/submit-report.tsx` - Fixed upload function
3. `app/review-report.tsx` - Fixed image display component

## Next Steps

1. Run the SQL script in Supabase
2. Test image upload from Submit Report screen
3. Test image display in Review Report screen
4. Monitor console logs for any remaining issues

