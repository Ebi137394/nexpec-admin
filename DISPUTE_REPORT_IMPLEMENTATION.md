# Dispute Report Implementation Guide

This document provides a comprehensive guide for the dispute resolution report system implementation in the NEXPEC platform.

## 📋 Overview

The dispute report system consists of:
1. **Supabase Edge Function** - Generates PDF reports for resolved disputes
2. **React Native Component** - Downloads and shares dispute reports
3. **Notification System** - Manages user preferences for dispute notifications

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────┐
│   React Native  │    │  Supabase Edge      │    │   Supabase      │
│   Component     │───▶│  Function           │───▶│   Storage       │
│                 │    │  (PDF Generation)   │    │   (Reports)     │
└─────────────────┘    └─────────────────────┘    └─────────────────┘
         │                       │                           │
         ▼                       ▼                           ▼
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────┐
│   User Action   │    │   PDF Generation    │    │   File Storage  │
│   (Download)    │    │   & Processing      │    │   & Management  │
└─────────────────┘    └─────────────────────┘    └─────────────────┘
```

## 📁 File Structure

```
supabase/functions/generate-dispute-report/
├── mod.ts              # Main Edge Function
├── config.toml         # Function Configuration
├── import_map.json     # External Dependencies
└── deploy.sh          # Deployment Script

src/components/
└── DisputeReportDownloader.tsx  # React Native Component

src/utils/
└── notificationUtils.ts  # Notification Management

src/screens/
├── NotificationCenter.tsx      # Notification Center
└── Settings/NotificationSettings.tsx  # Settings UI
```

## 🚀 Quick Start

### 1. Deploy the Edge Function

```bash
cd supabase/functions/generate-dispute-report
chmod +x deploy.sh
./deploy.sh
```

### 2. Use the React Native Component

```tsx
import { DisputeReportDownloader } from '@/components/DisputeReportDownloader';

// In your component
<DisputeReportDownloader 
  dispute={dispute}
  style={{ marginHorizontal: 20 }}
/>
```

### 3. Generate Reports via API

```bash
curl -X POST https://[PROJECT_REF].supabase.co/functions/v1/generate-dispute-report \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
  -d '{"dispute_id": "your-dispute-id"}'
```

## 📋 Database Requirements

### Required Tables

#### disputes table
```sql
CREATE TABLE disputes (
  id UUID PRIMARY KEY,
  project_title TEXT NOT NULL,
  project_id UUID REFERENCES projects(id),
  contractor_name TEXT,
  client_name TEXT,
  dispute_type TEXT,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT CHECK (status IN ('pending', 'in_progress', 'resolved')),
  resolution_details TEXT,
  resolution_date TIMESTAMP WITH TIME ZONE,
  resolved_by TEXT,
  amount_involved NUMERIC,
  evidence_files TEXT[],
  report_url TEXT,
  report_generated_at TIMESTAMP WITH TIME ZONE
);
```

#### activity_logs table
```sql
CREATE TABLE activity_logs (
  id UUID PRIMARY KEY,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### notification_settings table
```sql
CREATE TABLE notification_settings (
  user_id UUID PRIMARY KEY,
  email_disputes BOOLEAN DEFAULT true,
  email_project_updates BOOLEAN DEFAULT true,
  push_disputes BOOLEAN DEFAULT true,
  push_project_updates BOOLEAN DEFAULT true,
  push_contract_updates BOOLEAN DEFAULT true,
  email_contract_updates BOOLEAN DEFAULT true
);
```

### Required Storage Buckets

1. **dispute-reports** - For storing generated PDF files
   - Set appropriate RLS policies
   - Configure public URL access

## 🔧 Configuration

### Environment Variables

Set these in your Supabase project:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for admin access

### RLS Policies

```sql
-- For dispute-reports bucket
CREATE POLICY "Allow read access for authenticated users" ON storage.objects
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow insert for service role" ON storage.objects
FOR INSERT WITH CHECK (auth.role() = 'service_role');
```

## 📱 React Native Component Features

### DisputeReportDownloader Props

```tsx
interface DisputeReportDownloaderProps {
  dispute: {
    id: string;
    status: string;
    title?: string;
  };
  style?: any;
}
```

### Features

- ✅ **Status Validation** - Only shows for resolved disputes
- ✅ **Loading States** - Visual feedback during report generation
- ✅ **Error Handling** - Comprehensive error messages
- ✅ **File Naming** - Smart filename generation
- ✅ **Sharing Integration** - Native sharing capabilities
- ✅ **Accessibility** - Proper ARIA labels and contrast

### Usage Examples

#### Basic Usage
```tsx
<DisputeReportDownloader dispute={dispute} />
```

#### With Custom Styling
```tsx
<DisputeReportDownloader 
  dispute={dispute}
  style={{
    marginHorizontal: 20,
    marginTop: 16
  }}
/>
```

#### In Dispute Details Screen
```tsx
export const DisputeDetailsScreen = ({ route }) => {
  const { dispute } = route.params;

  return (
    <ScrollView>
      <DisputeHeader dispute={dispute} />
      <DisputeDescription dispute={dispute} />
      <DisputeReportDownloader 
        dispute={dispute}
        style={{ marginHorizontal: 20, marginTop: 16 }}
      />
      <DisputeTimeline dispute={dispute} />
    </ScrollView>
  );
};
```

## 📧 Notification Integration

### Using Notification Utilities

```tsx
import { sendNotificationWithSettingsCheck } from '@/utils/notificationUtils';

// Send notification when dispute is resolved
const handleDisputeResolution = async (disputeId: string) => {
  // Generate report
  const reportUrl = await generateDisputeReport(disputeId);
  
  // Send notifications respecting user preferences
  await sendNotificationWithSettingsCheck(
    userId,
    {
      subject: 'Dispute Resolution Complete',
      body: 'Your dispute has been resolved. Download the official report.',
      data: { disputeId, reportUrl }
    },
    {
      subject: 'Dispute Resolution Complete',
      body: 'Your dispute has been resolved.',
      data: { disputeId, reportUrl }
    },
    'email_disputes',
    'push_disputes'
  );
};
```

## 🔍 Troubleshooting

### Common Issues

#### 1. Function Deployment Fails
```bash
# Check if Supabase CLI is installed
supabase --version

# Check project configuration
supabase config get project_ref

# Verify function files exist
ls -la supabase/functions/generate-dispute-report/
```

#### 2. PDF Generation Fails
```bash
# Check function logs
supabase functions logs generate-dispute-report

# Verify dispute data
SELECT * FROM disputes WHERE id = 'your-dispute-id';
```

#### 3. File Download Fails
```bash
# Check storage bucket
supabase storage list

# Verify file permissions
supabase storage get-public-url dispute-reports/your-file.pdf
```

### Debug Commands

```bash
# Test function locally
supabase functions serve generate-dispute-report

# Check function status
supabase functions list

# View function logs
supabase functions logs generate-dispute-report --tail
```

## 📊 Performance Considerations

### Edge Function Optimization
- Use efficient PDF generation
- Implement proper error handling
- Cache frequently accessed data
- Monitor function execution time

### React Native Optimization
- Implement loading states
- Handle large file downloads
- Use proper error boundaries
- Optimize sharing performance

## 🔒 Security Considerations

### Data Protection
- Validate dispute ownership
- Implement proper RLS policies
- Use service role keys securely
- Audit report access

### File Security
- Validate file types
- Implement size limits
- Use secure file naming
- Monitor storage usage

## 🧪 Testing

### Unit Tests

```tsx
// Test dispute report downloader
describe('DisputeReportDownloader', () => {
  it('should not render for unresolved disputes', () => {
    const dispute = { id: '1', status: 'pending' };
    const { queryByTestId } = render(
      <DisputeReportDownloader dispute={dispute} />
    );
    expect(queryByTestId('download-btn')).toBeNull();
  });

  it('should render for resolved disputes', () => {
    const dispute = { id: '1', status: 'resolved' };
    const { getByTestId } = render(
      <DisputeReportDownloader dispute={dispute} />
    );
    expect(getByTestId('download-btn')).toBeTruthy();
  });
});
```

### Integration Tests

```bash
# Test function endpoint
curl -X POST http://localhost:54321/functions/v1/generate-dispute-report \
  -H 'Content-Type: application/json' \
  -d '{"dispute_id": "test-dispute-id"}'
```

## 📈 Monitoring

### Key Metrics
- Function execution time
- PDF generation success rate
- File download success rate
- User engagement with reports

### Logging
- Function execution logs
- Error tracking
- Performance metrics
- User activity logs

## 🔄 Future Enhancements

### Planned Features
- [ ] Report templates customization
- [ ] Batch report generation
- [ ] Report versioning
- [ ] Advanced sharing options
- [ ] Report analytics
- [ ] Offline report access

### Improvements
- [ ] PDF compression optimization
- [ ] Multi-language support
- [ ] Accessibility enhancements
- [ ] Performance monitoring
- [ ] Error recovery mechanisms

## 📞 Support

For issues and questions:
1. Check the troubleshooting section
2. Review function logs
3. Verify database and storage configuration
4. Test with sample data
5. Contact the development team

## 📄 License

This implementation is part of the NEXPEC platform and follows the project's licensing terms.