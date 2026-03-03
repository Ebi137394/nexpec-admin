#!/bin/bash

# Supabase Edge Function Deployment Script
# This script helps deploy the generate-dispute-report function

echo "🚀 Deploying generate-dispute-report Edge Function..."

# Check if supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI is not installed. Please install it first:"
    echo "   npm install -g @supabase/supabase"
    exit 1
fi

# Check if we're in a Supabase project
if [ ! -f "supabase/config.toml" ]; then
    echo "❌ Not in a Supabase project directory. Please run this script from your project root."
    exit 1
fi

# Navigate to function directory
cd supabase/functions/generate-dispute-report

echo "📁 Function directory: $(pwd)"

# Check if required files exist
required_files=("mod.ts" "config.toml" "import_map.json")
for file in "${required_files[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ Missing required file: $file"
        exit 1
    fi
done

echo "✅ All required files found"

# Deploy the function
echo "📤 Deploying function to Supabase..."
supabase functions deploy generate-dispute-report --project-ref $(supabase config get project_ref 2>/dev/null || echo "")

if [ $? -eq 0 ]; then
    echo "✅ Function deployed successfully!"
    echo ""
    echo "📋 Function Details:"
    echo "   Name: generate-dispute-report"
    echo "   URL: https://[PROJECT_REF].supabase.co/functions/v1/generate-dispute-report"
    echo ""
    echo "🔧 Usage Example:"
    echo "   curl -X POST https://[PROJECT_REF].supabase.co/functions/v1/generate-dispute-report \\"
    echo "        -H 'Content-Type: application/json' \\"
    echo "        -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \\"
    echo "        -d '{\"dispute_id\": \"your-dispute-id\"}'"
    echo ""
    echo "⚠️  Make sure to set the following environment variables in your Supabase project:"
    echo "   - SUPABASE_URL"
    echo "   - SUPABASE_SERVICE_ROLE_KEY"
    echo ""
    echo "🗄️  Required Database Tables:"
    echo "   - disputes (with the fields used in the function)"
    echo "   - activity_logs (for logging)"
    echo ""
    echo "📁 Required Storage Buckets:"
    echo "   - dispute-reports (for storing generated PDFs)"
else
    echo "❌ Function deployment failed!"
    exit 1
fi