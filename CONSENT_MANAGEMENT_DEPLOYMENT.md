# Consent Management System - Deployment Guide

This guide provides step-by-step instructions for deploying the complete consent management system to your Supabase project.

## 🚀 Quick Start

### 1. Deploy the Edge Function

```bash
# Deploy the send-consent-receipt function
supabase functions deploy send-consent-receipt --project-ref your-project-ref
```

### 2. Set Environment Variables

```bash
# Set required secrets
supabase secrets set RESEND_API_KEY=re_your_api_key --project-ref your-project-ref
supabase secrets set FROM_EMAIL=legal@yourdomain.com --project-ref your-project-ref

# Optional: Set custom branding
supabase secrets set COMPANY_NAME="Your Company" --project-ref your-project-ref
supabase secrets set COMPANY_LOGO_URL="https://yourdomain.com/logo.png" --project-ref your-project-ref
```

### 3. Run Database Migration

```bash
# Apply the legal_consents table and related views
supabase db push
```

### 4. Configure Webhook

1. Go to your Supabase dashboard
2. Navigate to **Database** → **Webhooks**
3. Create a new webhook:
   - **Table**: `legal_consents`
   - **Events**: `INSERT`
   - **URL**: `https://your-project-ref.supabase.co/functions/v1/send-consent-receipt`
   - **Headers**: Add `Content-Type: application/json`

## 🔧 Detailed Setup

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RESEND_API_KEY` | ✅ | Your Resend API key for email delivery |
| `FROM_EMAIL` | ✅ | Email address for sending consent receipts |
| `COMPANY_NAME` | ❌ | Your company name for branding (defaults to "NEXPEC") |
| `COMPANY_LOGO_URL` | ❌ | Logo URL for email templates |

### Storage Configuration

The system automatically creates a `legal-receipts` bucket with the following RLS policies:

```sql
-- Allow authenticated users to read their own receipts
CREATE POLICY "Users can read their own receipts" ON storage.objects
FOR SELECT USING (
  bucket_id = 'legal-receipts' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow service role to manage all receipts
CREATE POLICY "Service role full access" ON storage.objects
FOR ALL TO service_role USING (bucket_id = 'legal-receipts');
```

### Function Configuration

The function is configured with:
- **JWT Verification**: Disabled for webhook compatibility
- **Import Map**: Uses `pdf-lib` and `@supabase/supabase-js`
- **CORS**: Enabled for development

## 🧪 Testing

### Local Testing

```bash
# Serve the function locally
supabase functions serve send-consent-receipt --env-file .env.local

# Test direct invocation
curl -X POST http://localhost:54321/functions/v1/send-consent-receipt \
  -H "Content-Type: application/json" \
  -d '{"consent_id": "your-consent-uuid"}'

# Test webhook payload
curl -X POST http://localhost:54321/functions/v1/send-consent-receipt \
  -H "Content-Type: application/json" \
  -d '{
    "record": {
      "id": "your-consent-uuid",
      "user_id": "user-uuid",
      "document_id": "privacy-policy",
      "signed_at": "2025-01-30T12:00:00Z"
    }
  }'
```

### Production Testing

1. **Create a test consent record**:
   ```sql
   INSERT INTO legal_consents (user_id, document_id, policy_version, consents, signature_data)
   VALUES (
     'test-user-uuid',
     'privacy-policy',
     '1.0',
     '{"marketing": true, "data_processing": true}',
     '{"signature": "data:image/png;base64,..."}'
   );
   ```

2. **Check the webhook logs** in your Supabase dashboard
3. **Verify email delivery** in your Resend dashboard
4. **Check PDF generation** in the `legal-receipts` storage bucket

## 📊 Monitoring

### Audit Logs

The system automatically logs all consent activities to the `consent_audit_logs` table:

```sql
-- View recent consent activities
SELECT * FROM consent_audit_logs 
ORDER BY created_at DESC 
LIMIT 10;

-- Check for failed email deliveries
SELECT * FROM consent_audit_logs 
WHERE action = 'RECEIPT_GENERATED' 
AND details->>'email_sent' = 'false';
```

### Function Logs

Monitor function execution in your Supabase dashboard:
- **Database** → **Edge Functions** → **Logs**
- Look for errors related to PDF generation or email delivery

## 🔒 Security Considerations

### RLS Policies

The system includes comprehensive Row Level Security:

```sql
-- Users can only access their own consents
CREATE POLICY "Users can read their own consents" ON legal_consents
FOR SELECT USING (user_id = auth.uid());

-- Users can only update their own consents
CREATE POLICY "Users can update their own consents" ON legal_consents
FOR UPDATE USING (user_id = auth.uid());

-- Service role has full access for processing
CREATE POLICY "Service role full access" ON legal_consents
FOR ALL TO service_role USING (true);
```

### Data Protection

- **Encryption**: All consent data is encrypted at rest
- **Expiration**: Consents automatically expire after 1 year
- **Revocation**: Users can revoke consent at any time
- **Audit Trail**: Complete logging of all consent activities

## 🚨 Troubleshooting

### Common Issues

1. **Function Deployment Fails**
   - Check that all dependencies are in `import_map.json`
   - Verify environment variables are set
   - Check function logs for specific errors

2. **Emails Not Sending**
   - Verify `RESEND_API_KEY` is valid
   - Check that `FROM_EMAIL` is verified in Resend
   - Review email delivery logs

3. **PDF Generation Fails**
   - Ensure `pdf-lib` is properly imported
   - Check that consent data is valid
   - Verify user profile exists

4. **Storage Access Issues**
   - Confirm RLS policies are applied
   - Check that service role has storage permissions
   - Verify bucket exists and is configured correctly

### Debug Commands

```bash
# Check function status
supabase functions list

# View function logs
supabase functions logs send-consent-receipt

# Test database connection
supabase sql "SELECT * FROM legal_consents LIMIT 1;"

# Check storage buckets
supabase storage list
```

## 📈 Performance Optimization

### Caching Strategies

- **Profile Data**: Cache user profiles to reduce database queries
- **Policy Text**: Cache legal policy text to improve load times
- **PDF Templates**: Cache PDF generation templates

### Database Optimization

- **Indexes**: The migration creates optimal indexes
- **Partitioning**: Consider partitioning for large datasets
- **Connection Pooling**: Configure appropriate pool sizes

## 🔄 Maintenance

### Regular Tasks

1. **Monitor Storage Usage**
   ```sql
   -- Check storage bucket size
   SELECT pg_size_pretty(pg_total_relation_size('storage.objects'));
   ```

2. **Review Audit Logs**
   ```sql
   -- Clean up old audit logs (optional)
   DELETE FROM consent_audit_logs 
   WHERE created_at < NOW() - INTERVAL '1 year';
   ```

3. **Update Policy Versions**
   ```sql
   -- Update policy version when policies change
   UPDATE legal_consents 
   SET needs_new_consent = true 
   WHERE policy_version < '2.0';
   ```

### Updates and Patches

When updating the system:

1. **Backup your data** before making changes
2. **Test in development** first
3. **Deploy functions** before database changes
4. **Monitor for errors** after deployment

## 📞 Support

For additional support:

1. Check the [CONSENT_MANAGEMENT_GUIDE.md](./CONSENT_MANAGEMENT_GUIDE.md) for detailed implementation information
2. Review function logs in your Supabase dashboard
3. Test with the provided example components
4. Verify all environment variables are correctly set

## 🎯 Next Steps

1. **Integrate with your existing UI** using the provided components
2. **Customize the legal policies** to match your requirements
3. **Set up monitoring** for production usage
4. **Train your team** on the consent management workflow

The system is now ready for production use with full legal compliance, professional documentation, and excellent user experience!