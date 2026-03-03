#!/bin/bash
# deploy.sh

echo "🚀 Deploying NEXPEC Contract Generation System..."

# 1. Link to Supabase project (if not already linked)
supabase link --project-ref your-project-ref

# 2. Push database migrations
echo "📦 Running database migrations..."
supabase db push

# 3. Set Edge Function secrets
echo "🔐 Setting secrets..."
supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
supabase secrets set FROM_EMAIL=contracts@nexpec.com
supabase secrets set NEXPEC_URL=https://nexpec.com

# 4. Deploy Edge Function
echo "⚡ Deploying Edge Function..."
supabase functions deploy generate-contract --no-verify-jwt

# 5. Verify deployment
echo "✅ Verifying deployment..."
supabase functions list

echo "🎉 Deployment complete!"