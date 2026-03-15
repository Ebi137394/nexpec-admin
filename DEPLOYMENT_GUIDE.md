# NEXPEC Contractor Verification System Deployment Guide

This guide provides the steps to deploy the contractor verification system including the Deno Edge Function, database migrations, and configuration.

## Prerequisites

- Supabase CLI installed and configured
- Access to your Supabase project
- Admin privileges for the Supabase project

## Deployment Steps

### 1. Deploy the Edge Function

Deploy the contractor verification function to Supabase Edge Functions:

```bash
supabase functions deploy verify-contractor --no-verify-jwt
```

**Note:** We handle JWT verification manually in the function for custom admin role validation.

### 2. Set up Environment Secrets (Optional)

If you need to configure external service tokens, set them as secrets:

```bash
# For Expo Push Notifications (if using external Expo service)
supabase secrets set EXPO_ACCESS_TOKEN=your-expo-access-token

# For other external services as needed
supabase secrets set YOUR_SERVICE_TOKEN=your-service-token
```

### 3. Run Database Migrations

Apply the database schema changes:

```bash
supabase db push
```

Or manually run the SQL files via Supabase Dashboard SQL Editor:

- `supabase/migrations/20250129125400_add_contractor_payout_amount.sql`
- Any additional migration files for verification tables

### 4. Configure Database Tables

Ensure the following tables exist in your database:

#### Required Tables:
- `profiles` - User profiles with verification_status field
- `contractor_certifications` - Contractor certificate information
- `user_roles` - User role assignments (for admin verification)
- `verification_audit_log` - Audit trail for verification changes (optional)

#### Required Fields:
- `profiles.verification_status` - ENUM: 'unverified', 'pending', 'verified', 'rejected'
- `profiles.verified_at` - Timestamp when verified
- `profiles.verified_by` - Admin who verified
- `profiles.rejection_reason` - Reason for rejection (if applicable)
- `contractor_certifications.is_verified` - Certificate verification status
- `contractor_certifications.expiry_date` - Certificate expiry date

### 5. Set up RLS Policies (Row Level Security)

Ensure proper RLS policies are in place for security:

```sql
-- Allow admins to read all profiles
CREATE POLICY "Admin can read all profiles" ON profiles
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role = 'admin'
  )
);

-- Allow admins to update verification status
CREATE POLICY "Admin can update verification status" ON profiles
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role = 'admin'
  )
);
```

### 6. Configure Push Notifications

Set up the verification notification channel:

```sql
-- Create notification channel for verification updates
INSERT INTO notification_channels (id, name, color, description) 
VALUES ('verification-updates', 'Verification Updates', '#7C3AED', 'Contractor verification status updates');
```

### 7. Test the Deployment

1. **Test Function Deployment:**
   ```bash
   # Test the function is deployed
   supabase functions list
   ```

2. **Test Function Invocation:**
   ```bash
   # Test with curl (replace with your Supabase URL and token)
   curl -X POST https://your-project.supabase.co/functions/v1/verify-contractor \
     -H "Authorization: Bearer your-jwt-token" \
     -H "Content-Type: application/json" \
     -d '{
       "contractor_id": "test-contractor-id",
       "new_status": "pending"
     }'
   ```

3. **Test Admin Interface:**
   - Navigate to the verification screen in your app
   - Verify that pending verifications load correctly
   - Test verify and reject functionality

## Troubleshooting

### Common Issues

1. **Function Deployment Fails:**
   - Check that the `supabase/functions/verify-contractor/mod.ts` file exists
   - Ensure proper file structure and permissions
   - Verify Supabase CLI is properly configured

2. **JWT Verification Errors:**
   - Ensure admin users have the 'admin' role in the `user_roles` table
   - Check that JWT tokens are valid and not expired
   - Verify the Supabase service role key is properly configured

3. **Database Connection Issues:**
   - Ensure the Supabase URL and service role key are correct
   - Check that required tables and columns exist
   - Verify RLS policies are properly configured

4. **Push Notification Failures:**
   - Check that Expo push tokens are properly stored in user profiles
   - Verify the Expo Push API is accessible
   - Ensure the notification channel is configured

### Debug Commands

```bash
# Check function logs
supabase functions logs verify-contractor

# Check database connection
supabase db remote commit

# Verify environment variables
supabase secrets list
```

## Security Considerations

1. **Admin Role Verification:**
   - Only users with 'admin' role can verify contractors
   - Function validates admin privileges before processing

2. **Certificate Validation:**
   - Contractors must have valid, verified certificates to be verified
   - Function checks certificate expiry dates

3. **Audit Trail:**
   - All verification actions are logged with timestamps
   - Admin who performed verification is tracked

4. **JWT Security:**
   - Function validates JWT tokens manually
   - Proper error handling for invalid tokens

## Monitoring

1. **Function Logs:**
   - Monitor function execution via Supabase Dashboard
   - Check for errors or failed verifications

2. **Database Monitoring:**
   - Monitor verification status changes
   - Track certificate verification rates

3. **Push Notification Monitoring:**
   - Monitor notification delivery success rates
   - Check for failed push notifications

## Next Steps

1. **Integrate with Admin Dashboard:**
   - Add verification screen to admin navigation
   - Implement role-based access control

2. **Enhance User Experience:**
   - Add loading states and error handling
   - Implement real-time updates for verification status

3. **Add Additional Features:**
   - Bulk verification operations
   - Verification analytics and reporting
   - Certificate expiry notifications

4. **Production Considerations:**
   - Set up monitoring and alerting
   - Implement backup and recovery procedures
   - Configure proper scaling for high traffic

## Support

For issues or questions:
1. Check the Supabase documentation
2. Review function logs in the Supabase Dashboard
3. Verify database schema and RLS policies
4. Test with sample data to isolate issues