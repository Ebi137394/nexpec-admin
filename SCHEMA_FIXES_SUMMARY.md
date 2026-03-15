# Database Schema Fixes Summary

## Issues Fixed

### 1. ✅ Profile Sync (Error 42703)
**Problem**: Profile screen was using `job_title` but database schema uses `role` and `avatar_url`.

**Files Modified**: `app/(tabs)/profile.tsx`

**Changes**:
- Updated `ProfileData` interface to use `role` and `avatar_url` instead of `job_title`
- Updated `fetchProfile()` to select `role, avatar_url` from database
- Updated `updateProfile()` to save `role` and `avatar_url`
- Updated UI to display `role` instead of `job_title`
- Updated edit form to use `role` field

**Database Columns Used**:
- `full_name` ✅
- `role` ✅ (was `job_title`)
- `avatar_url` ✅ (new)
- `years_experience` ✅
- `certifications` ✅
- `bio` ✅

---

### 2. ✅ Project Listing - Location & Currency
**Problem**: Projects table requires `location` and `currency` fields. Post Job was using `price` instead of `day_rate` and missing `currency`.

**Files Modified**: 
- `app/post-job.tsx`
- `app/(tabs)/index.tsx`

**Changes in `post-job.tsx`**:
- Changed `price` state to `dayRate`
- Added `currency` state (default: 'CAD')
- Updated validation to check `dayRate` instead of `price`
- Updated `projectData` to use `day_rate` and `currency` instead of `price`
- Added currency input field in UI
- Changed status from `'Open'` to `'open'` (lowercase to match database)

**Changes in `index.tsx` (Jobs Listing)**:
- Added `currency` to SELECT query
- Changed status filter from `.eq('status', 'open')` to `.or('status.eq.open,status.eq.Open')` to handle both cases
- Updated display to show currency with day rate: `{currency} {day_rate} /day`

**Database Columns Used**:
- `title` ✅
- `location` ✅ (required, not null)
- `day_rate` ✅ (was `price`)
- `currency` ✅ (required, not null, default: 'USD')
- `description` ✅
- `status` ✅ (case-insensitive: 'open' or 'Open')

---

### 3. ✅ Image Loading - Better Error Handling
**Problem**: Images failing to load even with public URLs. Missing `/public/` token in URL or MIME type issues.

**Files Modified**: `app/review-report.tsx`

**Changes**:
- Enhanced `getImageUrl()` function to:
  - Check if URL is missing `/public/` token
  - Automatically fix URLs by replacing `/object/` with `/object/public/`
  - Add cache-busting query parameters
- Improved `handleImageError()` to:
  - Detect 403 (Forbidden) vs 404 (Not Found) errors
  - Log specific error codes and messages
  - Provide better debugging information
- Enhanced error UI:
  - Shows fixed URL in error message
  - Added "Test URL" button alongside "Retry"
  - Better error messages explaining 403 vs 404

**URL Format Fix**:
```typescript
// Before: https://...supabase.co/storage/v1/object/report-images/...
// After:  https://...supabase.co/storage/v1/object/public/report-images/...
```

---

### 4. ✅ Jobs Listing - Show Projects Correctly
**Problem**: Jobs tab showing "No projects available" even when projects exist.

**Files Modified**: `app/(tabs)/index.tsx`

**Changes**:
- Fixed status filter to handle both 'open' and 'Open' (case-insensitive)
- Added `currency` to SELECT query
- Updated display to show currency with day rate
- Improved error handling and logging

**Query Fix**:
```typescript
// Before: .eq('status', 'open')
// After:  .or('status.eq.open,status.eq.Open')
```

---

## Testing Checklist

### Profile Screen
- [ ] Open Profile tab
- [ ] Verify `full_name`, `role`, `years_experience` display correctly
- [ ] Edit profile and save
- [ ] Verify changes persist in database

### Post Job
- [ ] Create new project with:
  - Title ✅
  - Location ✅ (required)
  - Day Rate ✅ (required)
  - Currency ✅ (default: CAD)
  - Description ✅
- [ ] Verify project appears in Jobs listing
- [ ] Check database has `day_rate` and `currency` fields

### Jobs Listing
- [ ] Verify projects with status 'open' or 'Open' appear
- [ ] Verify currency displays with day rate
- [ ] Test pull-to-refresh
- [ ] Verify no "not-null constraint" errors

### Image Loading
- [ ] Upload image in Submit Report
- [ ] View image in Review Report
- [ ] Test error handling (403/404)
- [ ] Verify URL contains `/public/` token
- [ ] Test "Retry" and "Test URL" buttons

---

## Database Schema Reference

### `profiles` table
```sql
- id (UUID, PRIMARY KEY)
- full_name (TEXT, NOT NULL)
- role (TEXT, NOT NULL)  -- Changed from job_title
- avatar_url (TEXT, NULLABLE)  -- New field
- years_experience (INTEGER)
- certifications (TEXT[])
- bio (TEXT)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

### `projects` table
```sql
- id (UUID, PRIMARY KEY)
- title (TEXT, NOT NULL)
- location (TEXT, NOT NULL)  -- Required
- day_rate (NUMERIC, NOT NULL)  -- Changed from price
- currency (TEXT, NOT NULL, DEFAULT 'USD')  -- Required
- description (TEXT)
- status (TEXT)  -- 'open' or 'Open' (case-insensitive)
- client_id (UUID)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

---

## Notes

- All changes maintain backward compatibility where possible
- Error messages are more descriptive for debugging
- Status filtering now handles case variations
- Image URLs are automatically fixed if missing `/public/` token
- Currency defaults to 'CAD' in Post Job form

