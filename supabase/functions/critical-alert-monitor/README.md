# Critical Alert Monitor - Supabase Edge Function

This edge function monitors inspection events and automatically creates critical alerts when failures or incidents are detected.

## Overview

The Critical Alert Monitor is triggered via database webhooks on the `inspection_events` table. When an inspection event has `result = 'fail'` OR `type = 'incident'`, it automatically creates an alert in the `alerts` table and can optionally send notifications to external systems like Slack.

## Features

- **Real-time monitoring**: Instantly processes inspection events as they are inserted
- **Smart alerting**: Only creates alerts for critical events (failures or incidents)
- **Asset integration**: Automatically looks up asset tag numbers for meaningful alerts
- **Idempotency**: Prevents duplicate alerts for the same event
- **External notifications**: Optional Slack integration for immediate team notification
- **Flexible deployment**: Multiple webhook configuration options

## Architecture

```
inspection_events (INSERT) → Database Webhook → Edge Function → alerts table
                                                              ↓
                                                      Optional: Slack/Email
```

## Files Structure

```
supabase/functions/critical-alert-monitor/
├── index.ts              # Main edge function implementation
├── deno.json             # Deno module imports
├── deploy.sh            # Deployment script
├── webhook-config.sql   # Database trigger configuration
├── test-critical-alert.ts # Test script
└── README.md            # This file
```

## Installation

### 1. Deploy the Edge Function

```bash
# Make the deployment script executable
chmod +x supabase/functions/critical-alert-monitor/deploy.sh

# Run the deployment
./supabase/functions/critical-alert-monitor/deploy.sh
```

### 2. Set Required Secrets

The function requires the following secrets to be configured:

```bash
# Set the webhook secret (used for authentication)
supabase secrets set WEBHOOK_SECRET="your-random-secret-here"

# Optional: Set Slack webhook URL for notifications
supabase secrets set SLACK_WEBHOOK_URL="https://hooks.slack.com/services/T.../B.../xxx"
```

### 3. Configure Database Webhook

#### Option A: Supabase Dashboard (Recommended)

1. Go to **Database** → **Webhooks** → **Create**
2. Configure:
   - **Table**: `inspection_events`
   - **Events**: `INSERT`
   - **Type**: `Supabase Edge Function`
   - **Function**: `critical-alert-monitor`
   - **Headers**: Add `Authorization = Bearer <WEBHOOK_SECRET>`

#### Option B: SQL Trigger

Execute the SQL from `webhook-config.sql`:

```sql
-- Run the trigger creation script
\i supabase/functions/critical-alert-monitor/webhook-config.sql
```

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SUPABASE_URL` | Your Supabase project URL | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for admin access | Yes |
| `WEBHOOK_SECRET` | Secret for webhook authentication | Yes |
| `SLACK_WEBHOOK_URL` | Slack webhook URL for notifications | No |

### Database Schema Requirements

The function expects the following tables to exist:

#### `inspection_events` Table
```sql
CREATE TABLE inspection_events (
  id UUID PRIMARY KEY,
  asset_id UUID REFERENCES assets(id),
  type TEXT NOT NULL, -- 'inspection', 'incident', etc.
  result TEXT, -- 'pass', 'fail', null
  severity TEXT, -- 'low', 'medium', 'high', 'critical'
  summary TEXT,
  performed_by TEXT,
  performed_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB
);
```

#### `assets` Table
```sql
CREATE TABLE assets (
  id UUID PRIMARY KEY,
  tag_number TEXT NOT NULL,
  description TEXT,
  location TEXT,
  category TEXT,
  metadata JSONB
);
```

#### `alerts` Table
```sql
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES inspection_events(id),
  asset_id UUID REFERENCES assets(id),
  alert_type TEXT NOT NULL, -- 'critical_fail', 'incident', 'anomaly'
  title TEXT NOT NULL,
  message TEXT,
  severity TEXT NOT NULL, -- 'medium', 'high', 'critical'
  status TEXT DEFAULT 'new', -- 'new', 'acknowledged', 'resolved', 'dismissed'
  acknowledged_by TEXT,
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Usage

### Testing

Test the function with the provided test script:

```bash
# Run the test script
deno run --allow-net --allow-env supabase/functions/critical-alert-monitor/test-critical-alert.ts
```

### Manual Testing

You can manually test the webhook by inserting test data:

```sql
-- Test incident
INSERT INTO inspection_events (id, asset_id, type, result, severity, summary, performed_by, performed_at)
VALUES (
  gen_random_uuid(),
  'your-asset-id',
  'incident',
  null,
  'critical',
  'Equipment malfunction detected',
  'test-inspector',
  NOW()
);

-- Test failed inspection
INSERT INTO inspection_events (id, asset_id, type, result, severity, summary, performed_by, performed_at)
VALUES (
  gen_random_uuid(),
  'your-asset-id',
  'inspection',
  'fail',
  'high',
  'Safety compliance violation',
  'test-inspector',
  NOW()
);
```

## Alert Types

The function creates different alert types based on the event:

| Event Type | Alert Type | Severity | Description |
|------------|------------|----------|-------------|
| `incident` | `incident` | `critical` | Critical incident reported |
| `inspection` + `result = 'fail'` | `critical_fail` | `high` or `critical` | Failed inspection |
| Other events | No alert created | - | Non-critical events ignored |

## Alert Message Format

### Incident Alerts
```
🚨 Incident Reported — [ASSET_TAG]

Asset: [ASSET_TAG]
Event type: incident
Severity: [SEVERITY]
Summary: [SUMMARY]
Performed by: [PERFORMED_BY]
Date: [TIMESTAMP]
```

### Failed Inspection Alerts
```
⚠️ Inspection FAILED — [ASSET_TAG]

Asset: [ASSET_TAG]
Event type: inspection
Result: fail
Severity: [SEVERITY]
Summary: [SUMMARY]
Performed by: [PERFORMED_BY]
Date: [TIMESTAMP]
```

## Monitoring and Debugging

### Function Logs

Check the function logs in Supabase Dashboard:
1. Go to **Functions** → **critical-alert-monitor**
2. View logs for recent executions

### Database Verification

Verify alerts are being created correctly:

```sql
-- Check recent alerts
SELECT * FROM alerts ORDER BY created_at DESC LIMIT 10;

-- Check for specific event
SELECT * FROM alerts WHERE event_id = 'your-event-id';
```

### Webhook Testing

Test the webhook endpoint directly:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-webhook-secret" \
  -d '{
    "type": "INSERT",
    "table": "inspection_events",
    "schema": "public",
    "record": {
      "id": "test-123",
      "asset_id": "asset-123",
      "type": "incident",
      "result": null,
      "severity": "critical",
      "summary": "Test incident",
      "performed_by": "test-user",
      "performed_at": "2024-01-01T12:00:00Z",
      "metadata": {}
    },
    "old_record": null
  }' \
  https://your-project.supabase.co/functions/v1/critical-alert-monitor
```

## Troubleshooting

### Common Issues

1. **Function not triggered**: Check webhook configuration in Supabase Dashboard
2. **Authentication errors**: Verify `WEBHOOK_SECRET` is set correctly
3. **Asset lookup failures**: Ensure asset exists in the `assets` table
4. **Duplicate alerts**: Function includes idempotency checks, but verify unique constraints

### Error Responses

- `401 Unauthorized`: Invalid or missing webhook secret
- `400 Bad Request`: Invalid JSON payload
- `500 Internal Server Error`: Database connection or query issues

## Security

- **Webhook Authentication**: All requests must include a valid `Authorization` header
- **Service Role Access**: Function uses service role key for admin database access
- **Input Validation**: Function validates and sanitizes all input data
- **Error Handling**: Sensitive information is not exposed in error responses

## Performance

- **Response Time**: Function processes events in under 1 second
- **Rate Limiting**: Built-in protection against duplicate events
- **Database Load**: Minimal impact with efficient queries and indexing

## Extending the Function

### Adding New Alert Types

Modify the `deriveAlertType()` function in `index.ts`:

```typescript
function deriveAlertType(event: InspectionEvent): string {
  if (event.type === "incident") return "incident";
  if (event.result === "fail") return "critical_fail";
  if (event.type === "maintenance") return "maintenance_required"; // New type
  return "anomaly";
}
```

### Adding New Notification Channels

Extend the notification section in `index.ts`:

```typescript
// Add Teams notification
const teamsWebhookUrl = Deno.env.get("TEAMS_WEBHOOK_URL");
if (teamsWebhookUrl) {
  await fetch(teamsWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `${title}\n${message}`
    })
  });
}
```

## Deployment Notes

- Function is deployed using `supabase functions deploy`
- No external dependencies beyond Supabase SDK
- Compatible with all Supabase regions
- Automatic scaling based on webhook volume

## Support

For issues, questions, or feature requests:

1. Check the troubleshooting section above
2. Review function logs in Supabase Dashboard
3. Test with the provided test script
4. Verify database schema and webhook configuration