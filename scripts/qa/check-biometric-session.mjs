#!/usr/bin/env node
/**
 * check-biometric-session.mjs — biometric login lifecycle guard.
 *
 * TWO DEFECTS THIS PREVENTS (both observed on device, v19):
 *
 * 1. "Session expired" — supabase-js v2 defaults signOut() to scope 'global',
 *    which revokes EVERY refresh token for the user, including the one saved
 *    to the keystore at biometric enrolment. Logging out therefore killed the
 *    biometric token and restore always failed. signOut must use scope 'local'
 *    for biometric users.
 * 2. "app_cancel" — the sign-in screen auto-prompts on mount AND exposes a
 *    button; two concurrent authenticateAsync() calls make Android cancel the
 *    first. The handler needs a re-entrancy guard.
 *
 * Static and dependency-free, matching the other qa: guards.
 */
import { readFileSync } from 'node:fs';

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const fail = [], pass = [];

// ── 1. signOut scope ──────────────────────────────────────────────────────
const ctx = strip(readFileSync('src/contexts/AuthContext.tsx', 'utf8'));
if (!/supabase\.auth\.signOut\(/.test(ctx)) fail.push('signOut() call not found in AuthContext.');
else if (/supabase\.auth\.signOut\(\s*\)/.test(ctx))
  fail.push("signOut() called with no scope — defaults to 'global' and revokes the biometric refresh token.");
else pass.push('signOut() passes an explicit scope');

if (!/scope:\s*'local'/.test(ctx))
  fail.push("no scope:'local' path — biometric users' stored token would be revoked on logout.");
else pass.push("scope:'local' used for biometric users");

if (!/isBiometricLoginEnabled/.test(ctx))
  fail.push('signOut does not consult isBiometricLoginEnabled — scope choice must depend on it.');
else pass.push('scope choice is conditional on biometric being enabled');

// ── 2. re-entrancy guard on the sign-in screen ────────────────────────────
const signin = strip(readFileSync('app/(auth)/sign-in.tsx', 'utf8'));
const autoPrompt = /initBiometrics|handleBiometricLogin\(\)/.test(signin);
if (autoPrompt && !/biometricBusy/.test(signin))
  fail.push('sign-in auto-prompts biometrics but has no re-entrancy guard → concurrent prompts cause app_cancel.');
else pass.push('biometric handler is re-entrancy guarded');

// ── 3. keystore lifecycle must stay intact ────────────────────────────────
const bio = strip(readFileSync('src/services/BiometricAuth.ts', 'utf8'));
for (const [re, label] of [
  [/SecureStore\.setItemAsync/, 'enrolment writes the token to SecureStore'],
  [/SecureStore\.getItemAsync/, 'restore reads the token from SecureStore'],
  [/SecureStore\.deleteItemAsync/, 'stale token is cleared on failure/disable'],
  [/refreshSession\(\s*\{\s*refresh_token/, 'restore exchanges the stored refresh token'],
]) if (!re.test(bio)) fail.push(`biometric lifecycle regression: ${label} missing.`); else pass.push(label);

console.log('biometric session guard');
for (const p of pass) console.log('  ✓ ' + p);
for (const f of fail) console.log('  ✗ ' + f);
if (fail.length) { console.log(`\n✗ ${fail.length} problem(s) — biometric login would not restore a session.`); process.exit(1); }
console.log('\n✓ clean — biometric enrolment, logout and restore are consistent.');
