#!/bin/bash

# Critical Alert Monitor Edge Function Deployment Script

echo "🚀 Deploying critical-alert-monitor edge function..."

# Deploy the edge function
echo "📦 Deploying function..."
supabase functions deploy critical-alert-monitor --no-verify-jwt

if [ $? -eq 0 ]; then
    echo "✅ Function deployed successfully!"
else
    echo "❌ Function deployment failed!"
    exit 1
fi

# Set required secrets
echo "🔐 Setting up secrets..."

# Generate a random webhook secret if not already set
if [ -z "$WEBHOOK_SECRET" ]; then
    WEBHOOK_SECRET=$(openssl rand -base64 32)
    echo "Generated new webhook secret: $WEBHOOK_SECRET"
fi

# Set the webhook secret
supabase secrets set WEBHOOK_SECRET="$WEBHOOK_SECRET"

# Optional: Set Slack webhook URL (comment out if not using Slack)
# supabase secrets set SLACK_WEBHOOK_URL="https://hooks.slack.com/services/T.../B.../xxx"

echo "✅ Secrets configured successfully!"

# Verify deployment
echo "🔍 Verifying deployment..."
supabase functions list | grep "critical-alert-monitor"

echo ""
echo "🎉 Critical Alert Monitor deployment complete!"
echo ""
echo "📋 Next steps:"
echo "1. Configure the database webhook in Supabase Dashboard"
echo "2. Set up the webhook trigger on inspection_events table"
echo "3. Test the function with a sample inspection event"
echo ""
echo "🔗 Function URL: https://<project-ref>.supabase.co/functions/v1/critical-alert-monitor"
echo "🔑 Webhook Secret: $WEBHOOK_SECRET"