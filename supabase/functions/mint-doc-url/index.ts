// ════════════════════════════════════════════════════════════════════════════
//  mint-doc-url — server-authorized signed-URL minting for private buckets.
//
//  RED TEAM P0 (document IDOR) fix, Option A. After 20260801236000 the private
//  buckets are owner+admin only at the storage-RLS layer, so the client can no
//  longer createSignedUrl directly for files it doesn't own. This function:
//    1. identifies the caller from their JWT,
//    2. authorizes EACH requested path via public.nx_can_access_doc()
//       (admin / storage-owner / job-party — deny-by-default),
//    3. mints the signed URL with the service-role key (bypasses storage RLS)
//       ONLY for authorized paths.
//
//  Request:  { bucket, path }            → { url, urls }
//        or  { bucket, paths: [...], ttl} → { url:<first>, urls:{path:url|null} }
//  Unauthorized paths come back as null (never throws the whole batch).
// ════════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'unauthenticated' }, 401);

    // Identify the caller from their JWT (anon client carrying their auth header).
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: 'unauthenticated' }, 401);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const bucket = String((body as any).bucket ?? '');
    const ttlRaw = parseInt(String((body as any).ttl ?? '3600'), 10);
    const ttl = Math.min(Math.max(Number.isFinite(ttlRaw) ? ttlRaw : 3600, 60), 86400);
    const paths: string[] = Array.isArray((body as any).paths)
      ? (body as any).paths.map((p: unknown) => String(p))
      : (body as any).path
        ? [String((body as any).path)]
        : [];

    if (!bucket || paths.length === 0) return json({ error: 'bucket and path(s) required' }, 400);
    if (paths.length > 50) return json({ error: 'too many paths (max 50)' }, 400);

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const urls: Record<string, string | null> = {};
    for (const path of paths) {
      const { data: allowed, error: authzErr } = await svc.rpc('nx_can_access_doc', {
        p_uid: user.id,
        p_bucket: bucket,
        p_path: path,
      });
      if (authzErr || allowed !== true) {
        urls[path] = null;
        continue;
      }
      const { data: signed, error: signErr } = await svc.storage
        .from(bucket)
        .createSignedUrl(path, ttl);
      urls[path] = signErr ? null : (signed?.signedUrl ?? null);
    }

    return json({ url: urls[paths[0]] ?? null, urls }, 200);
  } catch (e) {
    // Internal detail stays server-side (logs only) — never in the response.
    console.error('[mint-doc-url] failed:', e);
    return json({ error: 'Internal error' }, 500);
  }
});
