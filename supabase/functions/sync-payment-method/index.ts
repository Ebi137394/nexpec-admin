// ════════════════════════════════════════════════════════════════════════════════
// supabase/functions/sync-payment-method/index.ts
// 
// NEXPEC — Stripe Payment Method Sync
// Syncs a Stripe SetupIntent's payment method to Supabase payment_methods table.
// ════════════════════════════════════════════════════════════════════════════════

import Stripe from 'npm:stripe@17.7.0';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-key',
  'Access-Control-Max-Age': '86400', 
};

function jsonResponse(body: Record<string, unknown>, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function errorResponse(message: string, status: number = 500, code?: string): Response {
  console.error(`[sync-payment-method] ERROR (${status}): ${message}`);
  return jsonResponse({ error: message, code: code ?? (status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR'), success: false }, status);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return errorResponse(`Method ${req.method} not allowed.`, 405, 'METHOD_NOT_ALLOWED');

  try {
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) return errorResponse('Payment service is not configured.', 503, 'SERVICE_UNAVAILABLE');

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-12-18.acacia', httpClient: Stripe.createFetchHttpClient(), typescript: true });

    let body: Record<string, unknown>;
    try { body = JSON.parse(await req.text()); } catch (e) { return errorResponse('Invalid JSON.', 400, 'INVALID_JSON'); }

    const setupIntentId = body.setup_intent_id as string | undefined;
    const userId = body.user_id as string | undefined;

    if (!setupIntentId) return errorResponse('Missing setup_intent_id', 400, 'MISSING_SETUP_INTENT_ID');
    if (!userId) return errorResponse('Missing user_id', 400, 'MISSING_USER_ID');

    const sanitizedSetupIntentId = setupIntentId.trim();
    const sanitizedUserId = userId.trim();

    // 1. Get SetupIntent from Stripe
    const setupIntent = await stripe.setupIntents.retrieve(sanitizedSetupIntentId);
    if (setupIntent.status !== 'succeeded') return errorResponse('Payment setup not completed.', 400, 'SETUP_NOT_COMPLETED');

    const paymentMethodId = setupIntent.payment_method as string | null;
    if (!paymentMethodId) return errorResponse('No payment method attached.', 400, 'NO_PAYMENT_METHOD');

    // 2. Get PaymentMethod details from Stripe
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    const card = paymentMethod.card;
    if (!card) return errorResponse('Only cards are supported.', 400, 'UNSUPPORTED_PAYMENT_TYPE');

    // 3. Connect to Supabase using SERVICE ROLE KEY (Admin Access to bypass RLS)
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse('Database service not configured.', 503, 'DATABASE_UNAVAILABLE');
    }

    // 4. Check if it's the first card
    const checkResponse = await fetch(
      `${supabaseUrl}/rest/v1/payment_methods?user_id=eq.${encodeURIComponent(sanitizedUserId)}&select=id&limit=1`,
      {
        method: 'GET',
        headers: { 'apikey': supabaseServiceKey, 'Authorization': `Bearer ${supabaseServiceKey}` },
      }
    );
    const existingMethods = await checkResponse.json();
    const isFirstCard = Array.isArray(existingMethods) && existingMethods.length === 0;

    // 5. Insert the card into Supabase
    const insertPayload = {
      user_id: sanitizedUserId,
      type: 'visa', // Or use logic based on card.brand
      label: `${card.brand.toUpperCase()} Card`,
      last_four: card.last4,
      is_default: isFirstCard,
      brand: card.brand,
      exp_month: card.exp_month,
      exp_year: card.exp_year,
      stripe_pm_id: paymentMethodId,
      info: `Exp ${String(card.exp_month).padStart(2, '0')}/${String(card.exp_year).slice(-2)}`,
    };

    const insertResponse = await fetch(`${supabaseUrl}/rest/v1/payment_methods`, {
      method: 'POST',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(insertPayload),
    });

    if (!insertResponse.ok) throw new Error(`Supabase insert failed: ${insertResponse.status}`);
    
    return jsonResponse({ success: true, message: 'Payment method synced successfully' });

  } catch (error: any) {
    console.error('[sync-payment-method] UNHANDLED ERROR:', error.message);
    return errorResponse(error.message || 'Internal server error', 500, 'UNHANDLED_EXCEPTION');
  }
});