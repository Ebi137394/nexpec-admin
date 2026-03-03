// Quick test script to check Supabase connection
// Run with: node scripts/test-supabase-connection.js

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

console.log('🔍 Testing Supabase Connection...\n');
console.log('URL:', supabaseUrl ? '✅ Set' : '❌ Missing');
console.log('Key:', supabaseKey ? '✅ Set (first 20 chars: ' + supabaseKey.substring(0, 20) + '...)' : '❌ Missing');

if (!supabaseUrl || !supabaseKey) {
  console.error('\n❌ Missing environment variables!');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Test connection
(async () => {
  try {
    console.log('\n📡 Testing API connection...');
    const { data, error } = await supabase.from('profiles').select('count').limit(1);
    
    if (error) {
      console.error('❌ Connection failed:', error.message);
      console.error('Code:', error.code);
      console.error('Details:', error.details);
      process.exit(1);
    }
    
    console.log('✅ Connection successful!');
    console.log('✅ Supabase is reachable');
    process.exit(0);
  } catch (error) {
    console.error('❌ Network error:', error.message);
    console.error('This might be a network connectivity issue');
    process.exit(1);
  }
})();

