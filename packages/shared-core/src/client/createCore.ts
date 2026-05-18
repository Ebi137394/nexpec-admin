// ════════════════════════════════════════════════════════════════════════════
//  client/createCore.ts
//
//  Factory that binds the shared-core helpers to a concrete Supabase client.
//  Called ONCE at boot by each platform shell. After this call, any module
//  in the package can read the bound client via `getCore()`.
//
//  Why a factory instead of a top-level singleton:
//    - Mobile and web instantiate Supabase differently (AsyncStorage vs.
//      cookies; on-device URL polyfill vs. server-side Edge runtime).
//    - Server-side Next.js code may need a per-request client with a
//      different cookie context. Future work: `createCore()` can return a
//      scoped core for that case.
//
//  Usage (mobile, app/_layout.tsx):
//      import { createClient } from '@supabase/supabase-js';
//      import { createCore } from '@nexpec/shared-core';
//      const supabase = createClient(URL, ANON_KEY, { auth: { ... } });
//      createCore({ supabase });
//
//  Usage (web, src/app/layout.tsx or middleware):
//      const supabase = createServerClient(URL, ANON_KEY, { cookies });
//      createCore({ supabase });
// ════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';

export interface NexpecCore {
  supabase: SupabaseClient;
}

let _core: NexpecCore | null = null;

export interface CreateCoreOptions {
  supabase: SupabaseClient;
}

export function createCore(options: CreateCoreOptions): NexpecCore {
  if (_core) {
    // Replacing the core mid-flight is legal (test setups, dev hot-reload)
    // but worth a console signal so silent client switches don't surprise.
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[shared-core] core re-initialized — previous bindings replaced');
    }
  }
  _core = { supabase: options.supabase };
  return _core;
}

/**
 * Internal accessor used by the package's modules.
 * Throws if `createCore()` hasn't been called — the consumer forgot to
 * initialize.
 */
export function _requireCore(): NexpecCore {
  if (!_core) {
    throw new Error(
      '[shared-core] core not initialized. Call createCore({ supabase }) from your app\'s boot code before invoking any shared-core function.',
    );
  }
  return _core;
}

/** Test-only reset. Production code should never call this. */
export function _resetCore(): void {
  _core = null;
}
