// ════════════════════════════════════════════════════════════════════════════
//  resend-webhook — authoritative delivery state from Resend.
//
//  Polling told us about bounces only when we happened to look. This endpoint
//  turns a bounce or complaint into suppression IMMEDIATELY, which is what
//  protects the sending domain's reputation.
//
//  AUTHENTICITY: Resend signs with Svix. We verify the HMAC over
//  `${svix-id}.${svix-timestamp}.${body}` using RESEND_WEBHOOK_SECRET, and
//  reject on timestamp skew to stop replay. An unverified request is refused —
//  anyone can POST to a public function URL.
//
//  Telegram is deliberately NOT notified per delivery. The owner hears about a
//  systemic problem (a bounce spike), never about individual successes.
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const b64ToBytes = (b64: string) =>
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function verifySvix(secret: string, id: string, ts: string, body: string, header: string) {
  // whsec_<base64>; the signature header is "v1,<b64> v1,<b64> …"
  const key = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const cryptoKey = await crypto.subtle.importKey(
    'raw', b64ToBytes(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(`${id}.${ts}.${body}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  // Constant-time-ish compare against every offered signature.
  let ok = false;
  for (const part of header.split(' ')) {
    const sig = part.split(',')[1];
    if (!sig || sig.length !== expected.length) continue;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff === 0) ok = true;
  }
  return ok;
}

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !url || !serviceKey) return json(200, { skipped: 'not configured' });

  const body = await req.text();
  const id = req.headers.get('svix-id') ?? '';
  const ts = req.headers.get('svix-timestamp') ?? '';
  const sig = req.headers.get('svix-signature') ?? '';
  if (!id || !ts || !sig) return json(401, { error: 'unsigned' });

  // Replay window: Svix recommends rejecting beyond 5 minutes of skew.
  const skew = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(skew) || skew > 300) return json(401, { error: 'stale timestamp' });
  if (!(await verifySvix(secret, id, ts, body, sig))) return json(401, { error: 'bad signature' });

  let evt: Record<string, unknown>;
  try { evt = JSON.parse(body); } catch { return json(400, { error: 'bad json' }); }

  const type = String(evt.type ?? '');
  const data = (evt.data ?? {}) as Record<string, unknown>;
  const to = Array.isArray(data.to) ? String(data.to[0] ?? '') : String(data.to ?? '');
  const emailId = String(data.email_id ?? data.id ?? '');
  if (!to) return json(200, { ignored: 'no recipient' });

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  // delivered / opened / clicked need no action beyond the record Resend keeps.
  const HARD = ['email.bounced', 'email.complained'];
  const SOFT = ['email.delivery_delayed', 'email.failed'];

  if (HARD.includes(type)) {
    const reason = type === 'email.complained'
      ? 'complaint reported by recipient'
      : `hard bounce (${String((data as Record<string, unknown>).bounce_type ?? 'permanent')})`;
    // Canonical suppression, keyed on the address Resend actually rejected.
    await db.rpc('nx_apply_email_event', {
      p_email: to, p_event: type, p_reason: reason, p_provider_id: emailId,
    });
  } else if (SOFT.includes(type)) {
    await db.rpc('nx_apply_email_event', {
      p_email: to, p_event: type, p_reason: `provider reported ${type}`, p_provider_id: emailId,
    });
  }

  return json(200, { ok: true, type });
});
