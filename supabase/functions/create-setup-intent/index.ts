// ════════════════════════════════════════════════════════════════════════════════
// supabase/functions/create-setup-intent/index.ts
// 
// NEXPEC — Stripe SetupIntent Creator
// Creates a Stripe Customer + SetupIntent for securely saving payment methods.
//
// Runtime: Supabase Edge Functions (Deno)
// Auth: Expects { user_id: string } in POST body
// Returns: { setupIntentClientSecret: string }
// ════════════════════════════════════════════════════════════════════════════════

import Stripe from 'npm:stripe@17.7.0';
import { requireUser } from '../_shared/auth.ts';

// ── CORS Headers ────────────────────────────────────────────
// Applied to EVERY response (preflight, success, and error).
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-api-key',
  'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
};

// ── Helper: Build JSON Response ─────────────────────────────
function jsonResponse(
  body: Record<string, unknown>,
  status: number = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

// ── Helper: Build Error Response ────────────────────────────
function errorResponse(
  message: string,
  status: number = 500,
  code?: string
): Response {
  console.error(`[create-setup-intent] ERROR (${status}): ${message}`);
  return jsonResponse(
    {
      error: message,
      code: code ?? (status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR'),
      success: false,
    },
    status
  );
}

// ════════════════════════════════════════════════════════════
// MAIN SERVER
// ════════════════════════════════════════════════════════════

Deno.serve(async (req: Request): Promise<Response> => {
  // ── 1. Handle CORS Preflight ────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  // ── 2. Reject non-POST methods ─────────────────────────
  if (req.method !== 'POST') {
    return errorResponse(
      `Method ${req.method} not allowed. Use POST.`,
      405,
      'METHOD_NOT_ALLOWED'
    );
  }

  try {
    // ── 3. Validate Stripe Secret Key ───────────────────
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');

    if (!stripeSecretKey) {
      console.error(
        '[create-setup-intent] STRIPE_SECRET_KEY is not set in environment.'
      );
      return errorResponse(
        'Payment service is not configured. Contact support.',
        503,
        'SERVICE_UNAVAILABLE'
      );
    }

    // Sanity check: ensure it looks like a real Stripe key
    if (
      !stripeSecretKey.startsWith('sk_live_') &&
      !stripeSecretKey.startsWith('sk_test_')
    ) {
      console.error(
        '[create-setup-intent] STRIPE_SECRET_KEY does not look like a valid Stripe secret key.'
      );
      return errorResponse(
        'Payment service misconfigured. Contact support.',
        503,
        'INVALID_CONFIG'
      );
    }

    // ── 4. Initialize Stripe ────────────────────────────
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-12-18.acacia',
      httpClient: Stripe.createFetchHttpClient(),
      typescript: true,
    });

    // ── 5. Parse & Validate Request Body ────────────────
    let body: Record<string, unknown>;

    try {
      const rawBody = await req.text();

      if (!rawBody || rawBody.trim().length === 0) {
        return errorResponse(
          'Request body is empty. Expected JSON with { user_id: string }.',
          400,
          'EMPTY_BODY'
        );
      }

      body = JSON.parse(rawBody);
    } catch (parseError) {
      return errorResponse(
        'Invalid JSON in request body.',
        400,
        'INVALID_JSON'
      );
    }

    const userId = body.user_id as string | undefined;

    if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
      return errorResponse(
        'Missing or invalid "user_id" field. Expected a non-empty string.',
        400,
        'MISSING_USER_ID'
      );
    }

    // Basic UUID-ish format check (Supabase auth IDs are UUIDs)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId.trim())) {
      return errorResponse(
        'Invalid "user_id" format. Expected a UUID.',
        400,
        'INVALID_USER_ID_FORMAT'
      );
    }

    const sanitizedUserId = userId.trim();

    // ★ Auth (Phase 2): verify the caller's JWT and enforce self-only. This
    //   endpoint previously trusted body.user_id with NO auth → any caller
    //   could create a SetupIntent against ANY user's Stripe customer (IDOR).
    try {
      const { userId: callerId } = await requireUser(req);
      if (sanitizedUserId !== callerId) {
        return errorResponse('You can only manage your own payment methods.', 403, 'FORBIDDEN_NOT_SELF');
      }
    } catch (e) {
      if (e instanceof Response) return e;
      return errorResponse('Authentication failed.', 401, 'AUTH_FAILED');
    }

    console.log(
      `[create-setup-intent] Processing request for user: ${sanitizedUserId}`
    );

    // ── 6. Check for Existing Stripe Customer ───────────
    // Search by metadata to avoid creating duplicate customers
    let stripeCustomerId: string;

    try {
      const existingCustomers = await stripe.customers.search({
        query: `metadata["supabase_user_id"]:"${sanitizedUserId}"`,
        limit: 1,
      });

      if (existingCustomers.data.length > 0) {
        // Reuse existing customer
        stripeCustomerId = existingCustomers.data[0].id;
        console.log(
          `[create-setup-intent] Found existing Stripe customer: ${stripeCustomerId}`
        );
      } else {
        // Create new Stripe Customer
        const email = (body.email as string) || undefined;

        const newCustomer = await stripe.customers.create({
          metadata: {
            supabase_user_id: sanitizedUserId,
            platform: 'nexpec',
            created_via: 'create-setup-intent',
          },
          ...(email && { email }),
        });

        stripeCustomerId = newCustomer.id;
        console.log(
          `[create-setup-intent] Created new Stripe customer: ${stripeCustomerId}`
        );
      }
    } catch (customerError: unknown) {
      const errMsg =
        customerError instanceof Error
          ? customerError.message
          : 'Unknown error during customer creation';
      console.error(
        `[create-setup-intent] Stripe Customer error: ${errMsg}`
      );
      return errorResponse(
        'Failed to create or retrieve payment profile.',
        502,
        'STRIPE_CUSTOMER_ERROR'
      );
    }

    // ── 7. Create SetupIntent ───────────────────────────
    let setupIntent: Stripe.SetupIntent;

    try {
      setupIntent = await stripe.setupIntents.create({
        customer: stripeCustomerId,
        // Enable automatic payment methods for maximum compatibility
        // (cards, bank debits, etc. based on your Stripe Dashboard settings)
        automatic_payment_methods: {
          enabled: true,
        },
        // off_session = card can be charged later without customer present
        usage: 'off_session',
        metadata: {
          supabase_user_id: sanitizedUserId,
          platform: 'nexpec',
        },
      });

      console.log(
        `[create-setup-intent] SetupIntent created: ${setupIntent.id} for customer: ${stripeCustomerId}`
      );
    } catch (setupError: unknown) {
      const errMsg =
        setupError instanceof Error
          ? setupError.message
          : 'Unknown error during SetupIntent creation';
      console.error(
        `[create-setup-intent] Stripe SetupIntent error: ${errMsg}`
      );
      return errorResponse(
        'Failed to initialize payment setup.',
        502,
        'STRIPE_SETUP_INTENT_ERROR'
      );
    }

    // ── 8. Validate the client_secret exists ────────────
    if (!setupIntent.client_secret) {
      console.error(
        `[create-setup-intent] SetupIntent ${setupIntent.id} has no client_secret`
      );
      return errorResponse(
        'Payment setup completed but no client secret returned.',
        500,
        'MISSING_CLIENT_SECRET'
      );
    }

    // ── 9. Return Success Response ──────────────────────
    console.log(
      `[create-setup-intent] ✅ Success — returning client_secret for SI: ${setupIntent.id}`
    );

    return jsonResponse({
      setupIntentClientSecret: setupIntent.client_secret,
      customerId: stripeCustomerId,
      setupIntentId: setupIntent.id,
      success: true,
    });
  } catch (unexpectedError: unknown) {
    // ── Global Catch: Unexpected Errors ──────────────────
    const errMsg =
      unexpectedError instanceof Error
        ? unexpectedError.message
        : 'An unexpected error occurred';
    const errStack =
      unexpectedError instanceof Error ? unexpectedError.stack : undefined;

    console.error(
      `[create-setup-intent] UNHANDLED ERROR: ${errMsg}`,
      errStack
    );

    // Check for specific Stripe error types
    if (
      unexpectedError &&
      typeof unexpectedError === 'object' &&
      'type' in unexpectedError
    ) {
      const stripeErr = unexpectedError as {
        type: string;
        message: string;
        statusCode?: number;
      };

      switch (stripeErr.type) {
        case 'StripeAuthenticationError':
          return errorResponse(
            'Payment service authentication failed. Contact support.',
            503,
            'STRIPE_AUTH_ERROR'
          );
        case 'StripeRateLimitError':
          return errorResponse(
            'Payment service is busy. Please try again in a moment.',
            429,
            'STRIPE_RATE_LIMIT'
          );
        case 'StripeConnectionError':
          return errorResponse(
            'Could not connect to payment service. Please try again.',
            503,
            'STRIPE_CONNECTION_ERROR'
          );
        default:
          return errorResponse(
            stripeErr.message || 'Payment service error.',
            stripeErr.statusCode || 500,
            `STRIPE_${stripeErr.type.toUpperCase()}`
          );
      }
    }

    return errorResponse(
      'An internal error occurred. Please try again later.',
      500,
      'UNHANDLED_EXCEPTION'
    );
  }
});