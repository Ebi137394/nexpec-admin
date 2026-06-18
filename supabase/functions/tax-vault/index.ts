// ════════════════════════════════════════════════════════════════════════════
//  tax-vault — the ONLY path that touches TAX_VAULT_KEY.
//
//  The encryption key never reaches a client (browser or mobile bundle). Both
//  web and mobile call this edge function; it injects TAX_VAULT_KEY (Supabase
//  secret) server-side and brokers the pgcrypto vault RPCs using the CALLER'S
//  JWT (so auth.uid() drives the owner/admin checks inside the RPCs).
//
//  POST { action: 'submit', form_type, country, tax_id }
//       → vault_store_tax_id (payee encrypts + stores their own TIN)
//  POST { action: 'reveal', user_id }
//       → admin_decrypt_tax_id (admin-only, audited) → { tax_id }
//
//  Env: TAX_VAULT_KEY, SUPABASE_URL, SUPABASE_ANON_KEY.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { corsHeaders, json } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const key = Deno.env.get('TAX_VAULT_KEY');
  if (!key || key.length < 16) return json(500, { error: 'vault_key_missing' });

  const authz = req.headers.get('Authorization') ?? '';
  if (!authz.startsWith('Bearer ')) return json(401, { error: 'missing_authorization' });

  // Caller-scoped client: PostgREST sets auth.uid() from this JWT, so the RPCs'
  // own owner/admin guards apply. The key is added here, server-side, only.
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authz } }, auth: { persistSession: false } },
  );

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: 'invalid_json' }); }
  const action = String(body.action ?? '');

  if (action === 'submit') {
    const formType = String(body.form_type ?? '');
    const country = String(body.country ?? '');
    const taxId = String(body.tax_id ?? '');
    if (!taxId || taxId.length < 4) return json(400, { error: 'invalid_tax_id' });
    const { data, error } = await sb.rpc('vault_store_tax_id', {
      p_form_type: formType, p_country: country, p_tax_id: taxId, p_key: key,
    });
    if (error) return json(400, { error: error.message });
    return json(200, data);
  }

  if (action === 'reveal') {
    const userId = String(body.user_id ?? '');
    if (!userId) return json(400, { error: 'user_id_required' });
    // admin_decrypt_tax_id self-guards to admins and writes a tax.pii_decrypted audit row.
    const { data, error } = await sb.rpc('admin_decrypt_tax_id', { p_user_id: userId, p_key: key });
    if (error) {
      const status = /NOT_AUTHORIZED/.test(error.message) ? 403 : 400;
      return json(status, { error: error.message });
    }
    return json(200, { tax_id: data });
  }

  return json(400, { error: 'unknown_action' });
});
