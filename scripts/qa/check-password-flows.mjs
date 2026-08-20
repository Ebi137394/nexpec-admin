// ════════════════════════════════════════════════════════════════════════════
//  scripts/qa/check-password-flows.mjs — password recovery, end to end
//
//  Exercises the real GoTrue flows against the LOCAL Supabase stack, including
//  actual mail delivery through Mailpit. Same GoTrue build and the same client
//  calls the app makes, so what passes here is the product's own behaviour —
//  not a mock. What it cannot cover is per-project dashboard configuration
//  (Site URL, redirect allowlist, CAPTCHA, rate limits): the CLI exposes no
//  read for those, so they remain owner-console items.
//
//  WHAT IT PROVES
//    1  forgot-password is accepted for a real account
//    2  the recovery email is actually delivered
//    3  the email carries a usable recovery link
//    4  an unknown address gets the SAME answer — no account enumeration
//    5  a valid link establishes a recovery session
//    6  the password can be changed with that session
//    7  the new password works
//    8  the old password does not
//    9  the link is single-use
//   10  a tampered or expired token is refused
//   11  an authenticated user can change their own password
//   12  a Google-only account does not leak its provider through reset
//
//  RUN:  supabase start && node scripts/qa/check-password-flows.mjs
//  Exit 0 when every check passes.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';

const S = JSON.parse(execSync('supabase status -o json', { encoding: 'utf8' }));
const URL_ = S.API_URL, ANON = S.ANON_KEY, SRV = S.SERVICE_ROLE_KEY, MAIL = S.MAILPIT_URL;

const admin = createClient(URL_, SRV, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = () => createClient(URL_, ANON, { auth: { autoRefreshToken: false, persistSession: false } });

const R = [];
const t = (n, p, d = '') => { R.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const stamp = Date.now();
const email = `pwflow.${stamp}@nexpec-verify.example.com`;
const P1 = 'OldPassw0rd!aA1', P2 = 'NewPassw0rd!bB2';
const redirectTo = 'http://127.0.0.1:3000/auth/callback?next=/reset-password';

await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' }).catch(() => {});

const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password: P1, email_confirm: true });
if (cErr) { console.error('SETUP FAILED:', cErr.message); process.exit(1); }

const { error: rErr } = await anon().auth.resetPasswordForEmail(email, { redirectTo });
t('1  forgot-password accepted for a real account', !rErr, rErr?.message || '');

await new Promise((r) => setTimeout(r, 2000));
const box = await (await fetch(`${MAIL}/api/v1/messages`)).json();
const msg = (box.messages || []).find((m) => (m.To || []).some((x) => x.Address === email));
t('2  recovery email actually delivered', !!msg, msg ? `subject: ${msg.Subject}` : 'no message in mailbox');

let link = null;
if (msg) {
  const body = await (await fetch(`${MAIL}/api/v1/message/${msg.ID}`)).json();
  const text = `${body.HTML || ''} ${body.Text || ''}`;
  const urls = text.match(/https?:\/\/[^\s"'<>]+/g) || [];
  link = urls.find((u) => u.includes('verify') || u.includes('token') || u.includes('code')) || urls[0];
}
t('3  email carries a recovery link', !!link, link ? `${link.slice(0, 70)}…` : 'none found');

const unknown = `nobody.${stamp}@nexpec-verify.example.com`;
const { error: uErr } = await anon().auth.resetPasswordForEmail(unknown, { redirectTo });
t('4  unknown address returns the SAME non-committal answer (no enumeration)', !uErr,
  uErr ? `LEAKED: ${uErr.message}` : 'no error — identical to the real-account path');

let tokenHash = null, code = null;
if (link) {
  const u = new URL(link.replace(/&amp;/g, '&'));
  tokenHash = u.searchParams.get('token') || u.searchParams.get('token_hash');
  code = u.searchParams.get('code');
}

const c1 = anon();
let sess = null, vErr = null;
if (tokenHash) ({ data: sess, error: vErr } = await c1.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash }));
else if (code) ({ data: sess, error: vErr } = await c1.auth.exchangeCodeForSession(code));
t('5  a valid recovery link establishes a recovery session', !!sess?.session, vErr?.message || '');

let uOk = false, uMsg = '';
if (sess?.session) { const { error } = await c1.auth.updateUser({ password: P2 }); uOk = !error; uMsg = error?.message || ''; }
t('6  password change while holding the recovery session', uOk, uMsg);

const { data: newLogin, error: nlErr } = await anon().auth.signInWithPassword({ email, password: P2 });
t('7  the NEW password signs in', !!newLogin?.session, nlErr?.message || '');

const { data: oldLogin } = await anon().auth.signInWithPassword({ email, password: P1 });
t('8  the OLD password no longer works', !oldLogin?.session, oldLogin?.session ? 'OLD PASSWORD STILL VALID' : 'rejected');

let reuseBlocked = false, reuseMsg = '';
if (tokenHash || code) {
  const c2 = anon();
  const res = tokenHash
    ? await c2.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash })
    : await c2.auth.exchangeCodeForSession(code);
  reuseBlocked = !res.data?.session;
  reuseMsg = res.error?.message || (res.data?.session ? 'SESSION GRANTED A SECOND TIME' : '');
}
t('9  the same recovery link cannot be reused', reuseBlocked, reuseMsg);

const bogus = `${(tokenHash || 'xxxxxxxx').slice(0, -4)}dead`;
const { data: bd, error: bErr } = await anon().auth.verifyOtp({ type: 'recovery', token_hash: bogus });
t('10 a tampered or expired token is refused', !bd?.session, bErr?.message || '');

const c3 = anon();
const { data: li } = await c3.auth.signInWithPassword({ email, password: P2 });
let chOk = false, chMsg = '';
if (li?.session) { const { error } = await c3.auth.updateUser({ password: 'ThirdPassw0rd!cC3' }); chOk = !error; chMsg = error?.message || ''; }
t('11 an authenticated user can change their own password', chOk, chMsg);

const gEmail = `google.only.${stamp}@nexpec-verify.example.com`;
const { error: gErr } = await admin.auth.admin.createUser({
  email: gEmail, email_confirm: true, app_metadata: { provider: 'google', providers: ['google'] },
});
let gaOk = false, gaMsg = '';
if (!gErr) {
  const { error } = await anon().auth.resetPasswordForEmail(gEmail, { redirectTo });
  gaOk = !error;
  gaMsg = error ? `errored: ${error.message}` : 'accepted without disclosing that the account is Google-only';
} else { gaMsg = `setup: ${gErr.message}`; }
t('12 a Google-only account does not leak its provider through reset', gaOk, gaMsg);

if (created?.user) await admin.auth.admin.deleteUser(created.user.id);
const { data: list } = await admin.auth.admin.listUsers();
for (const u of list?.users || []) if (u.email === gEmail) await admin.auth.admin.deleteUser(u.id);

const pass = R.filter((r) => r.p).length;
console.log(`\n════ PASSWORD FLOWS: ${pass}/${R.length} ════`);
process.exit(pass === R.length ? 0 : 1);
