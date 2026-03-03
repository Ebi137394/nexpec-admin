// ─── 🕵️ NETWORK SPY ──────────────────────────────────────────────
const originalFetch = global.fetch;
global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input.toString();

  // Only spy on your Supabase REST calls
  if (url.includes(process.env.EXPO_PUBLIC_SUPABASE_URL ?? '')) {
    const method = init?.method ?? 'GET';
    const urlObj = new URL(url);
    const table = urlObj.pathname.replace('/rest/v1/', '');
    const select = urlObj.searchParams.get('select') ?? '(all columns)';
    const filters = urlObj.searchParams.toString()
      .replace(`select=${select}`, '')
      .replace(/^&|&$/g, '');

    console.log('\n🔍 SUPABASE QUERY INTERCEPTED');
    console.log(`   Method : ${method}`);
    console.log(`   Table  : ${table}`);
    console.log(`   Select : ${select}`);
    if (filters) console.log(`   Filters: ${filters}`);

    // Log request body for INSERT/UPDATE
    if (init?.body) {
      console.log(`   Body   :`, JSON.parse(init.body as string));
    }
    console.log('─'.repeat(50));
  }

  return originalFetch(input, init);
};
// ─────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

console.log('✅ Supabase client created');
