# NEXPEC Consent Management System

## Overview

The NEXPEC Consent Management System provides a comprehensive solution for managing electronic consent and legal agreements within the application. This system ensures compliance with data protection regulations and provides users with a clear, legally binding way to consent to terms and conditions.

## Features

### Frontend Components

1. **LegalConsentModal** (`src/components/LegalConsent/LegalConsentModal.tsx`)
   - Main consent gateway component
   - Three-step consent process: Review, Confirm, Sign
   - Animated UI with progress indicators
   - Real-time validation and error handling

2. **PolicyScrollView** (`src/components/LegalConsent/PolicyScrollView.tsx`)
   - Scrollable legal policy viewer
   - Tracks scroll position to ensure users read full document
   - Visual indicators for scroll progress

3. **ConsentCheckbox** (`src/components/LegalConsent/ConsentCheckbox.tsx`)
   - Individual consent checkboxes with descriptions
   - Required field validation
   - Error state management

4. **SignaturePad** (`src/components/LegalConsent/SignaturePad.tsx`)
   - Electronic signature capture
   - Real-time signature preview
   - Clear signature functionality

5. **VerifiedAnimation** (`src/components/LegalConsent/VerifiedAnimation.tsx`)
   - Success animation after consent completion
   - Confetti and checkmark animations

### Backend Services

1. **Supabase Function** (`supabase/functions/send-consent-receipt/mod.ts`)
   - Webhook processor for new consent records
   - PDF receipt generation using jsPDF
   - Email delivery via Resend API
   - Automatic audit trail creation

2. **Database Schema** (`supabase/migrations/20250130120000_create_legal_consents.sql`)
   - `legal_consents` table with comprehensive fields
   - Row Level Security (RLS) policies
   - Indexes for performance optimization
   - Helper functions for consent validation

3. **Frontend Service** (`src/services/consentService.ts`)
   - Singleton service for consent operations
   - Consent validation and history management
   - Metadata collection (IP, device info, geolocation)

## Data Flow

### 1. Consent Collection

```
User → LegalConsentModal → useLegalConsent Hook → consentService → Supabase
```

1. User opens consent modal
2. User scrolls through legal policy
3. User checks all required consent checkboxes
4. User provides electronic signature
5. System validates all requirements
6. Consent data is saved to Supabase

### 2. Receipt Processing

```
Supabase INSERT → Webhook → send-consent-receipt Function → PDF + Email
```

1. New consent record triggers webhook
2. Function fetches user profile
3. PDF receipt is generated with signature
4. Email is sent with PDF attachment
5. Audit trail is created

### 3. Consent Validation

```
Application → consentService → Supabase Query → Validation Result
```

1. Application checks if user has valid consent
2. Service queries database for existing consents
3. Validates consent age and completeness
4. Returns validation result

## Key Components

### Types and Interfaces

```typescript
// Core consent data structure
interface LegalConsentResult {
  id?: string;
  userId: string;
  documentId: string;
  signature: SignatureData;
  consents: ConsentFormData;
  metadata: ConsentMetadata;
  createdAt: string;
  version: string;
  status: 'pending' | 'completed' | 'expired' | 'revoked';
}
```

### Consent States

- **pending**: Consent in progress
- **completed**: Consent successfully recorded
- **expired**: Consent older than 1 year
- **revoked**: Consent manually revoked

### Required Consents

1. **NDA Acceptance**: Non-disclosure agreement
2. **Data Processing**: Consent to data collection and processing
3. **Confidentiality**: Acknowledgment of confidentiality obligations
4. **Liability**: Acceptance of liability terms

## Usage Examples

### Basic Consent Check

```typescript
import { consentService } from '../services/consentService';

// Check if user has valid consent
const result = await consentService.checkConsent(
  userId, 
  'inspection_report', 
  '2.1.0'
);

if (!result.hasConsent || result.needsNewConsent) {
  // Show consent modal
  setShowConsentModal(true);
}
```

### Saving New Consent

```typescript
import { consentService } from '../services/consentService';

const consentResult = await consentService.saveConsent(
  userId,
  documentId,
  signatureData,
  {
    ndaAccepted: true,
    dataProcessingAccepted: true,
    confidentialityAccepted: true,
    liabilityAccepted: true,
  },
  '2.1.0'
);
```

### Getting Consent History

```typescript
const history = await consentService.getConsentHistory(userId);
```

## Configuration

### Environment Variables

```bash
# Supabase
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key

# Email Service
RESEND_API_KEY=your_resend_api_key
```

### Supabase Setup

1. Run the migration to create the `legal_consents` table
2. Set up the `send-consent-receipt` function
3. Configure webhook on the `legal_consents` table
4. Set up RLS policies for security

### Function Deployment

```bash
# Deploy the function
supabase functions deploy send-consent-receipt

# Set environment variables
supabase secrets set SUPABASE_URL=your_url
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_key
supabase secrets set RESEND_API_KEY=your_resend_key
```

## Security Features

### Data Protection

- **Row Level Security**: Users can only access their own consents
- **Encrypted Storage**: Sensitive data is encrypted at rest
- **Audit Trail**: Complete logging of all consent actions
- **IP Tracking**: Geolocation and IP address logging

### Validation

- **Signature Verification**: Digital signature validation
- **Timestamp Validation**: Accurate time tracking
- **Policy Versioning**: Version control for legal documents
- **Expiration Tracking**: Automatic expiration detection

## PDF Receipt Features

### Generated Content

- **Header**: NEXPEC branding and logo
- **Consent Details**: Complete consent information
- **User Information**: User profile data
- **Signature Section**: Electronic signature display
- **Audit Trail**: IP, timestamp, and device information
- **Legal Text**: Summary of agreement terms

### Email Delivery

- **Professional Template**: Branded email design
- **PDF Attachment**: Detailed receipt as PDF
- **Delivery Tracking**: Email delivery confirmation
- **Error Handling**: Graceful failure handling

## Testing

### Unit Tests

```typescript
// Test consent validation
describe('ConsentService', () => {
  it('should validate consent correctly', async () => {
    const result = await consentService.checkConsent(userId, documentId);
    expect(result.hasConsent).toBe(true);
  });
});
```

### Integration Tests

```typescript
// Test PDF generation
describe('send-consent-receipt function', () => {
  it('should generate PDF and send email', async () => {
    // Mock webhook payload
    const payload = { /* webhook data */ };
    
    // Call function
    const response = await fetch(functionUrl, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    
    expect(response.status).toBe(200);
  });
});
```

## Troubleshooting

### Common Issues

1. **Function Deployment Failures**
   - Check environment variables are set
   - Verify Supabase URL and keys are correct
   - Ensure Resend API key is valid

2. **PDF Generation Errors**
   - Check jsPDF import is working
   - Verify base64 logo is valid
   - Ensure sufficient memory allocation

3. **Email Delivery Failures**
   - Verify Resend API key
   - Check email domain verification
   - Review email template syntax

### Debugging

```typescript
// Enable debug logging
console.log('Consent metadata:', metadata);
console.log('Signature data:', signatureData);
console.log('Consent result:', consentResult);
```

## Compliance

### GDPR Compliance

- **Data Minimization**: Only collect necessary data
- **Purpose Limitation**: Clear purpose for data collection
- **Storage Limitation**: Automatic expiration after 1 year
- **User Rights**: Easy consent revocation

### Legal Compliance

- **Electronic Signatures**: Legally binding digital signatures
- **Audit Trail**: Complete record of consent process
- **Policy Versioning**: Track changes to legal documents
- **Data Retention**: Appropriate retention periods

## Future Enhancements

### Planned Features

1. **Multi-language Support**: Internationalization for legal text
2. **Template System**: Configurable consent templates
3. **Bulk Operations**: Mass consent management
4. **Analytics**: Consent usage statistics
5. **Integration**: Third-party legal service integration

### Performance Optimizations

1. **Caching**: Metadata and consent status caching
2. **Pagination**: Large consent history pagination
3. **Compression**: PDF and email attachment optimization
4. **CDN**: Static asset delivery optimization

## Support

For questions or issues related to the consent management system:

1. Check the troubleshooting section above
2. Review the test cases for expected behavior
3. Check Supabase logs for function errors
4. Contact the development team with specific error details

## License

This consent management system is part of the NEXPEC application and follows the same licensing terms.