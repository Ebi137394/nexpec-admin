// ════════════════════════════════════════════════════════════════════════════
//  D38 regression — offline cold start must never open the stance chooser.
//
//  Observed live on the Android emulator AND the iOS Simulator: an offline
//  cold start failed the profile fetch, AuthContext defaulted to role:null /
//  termsAccepted:false, and the gate parked a fully-onboarded inspector on
//  the stance chooser.
//
//  This suite runs the REAL resolution + cache modules (the exact code
//  AuthContext delegates to) through the five owner-ordered scenarios:
//    1. authenticated + cached stance + offline cold start → cached role served;
//    2. authenticated + no cache + offline cold start → 'none' (offline
//       screen), never a role-less profile;
//    3. genuine ONLINE no-stance account → authoritative network answer with
//       role:null (the chooser is then legitimate);
//    4. reconnect → successful rehydration overwrites cache + serves network;
//    5. zero role mutation throughout (inputs frozen; cache written only from
//       authoritative role-bearing outcomes; resolver is pure).
//
//  Run:  node --test src/core/auth/__tests__/profileResolution.test.mjs
// ════════════════════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyProfileFetchError,
  isCacheableProfile,
  resolveProfile,
} from '../profileResolution.ts';
import {
  profileCacheKey,
  readProfileCache,
  writeProfileCache,
} from '../profileCache.ts';

function memStorage() {
  const map = new Map();
  return {
    map,
    getItem: async (k) => (map.has(k) ? map.get(k) : null),
    setItem: async (k, v) => void map.set(k, v),
  };
}

const INSPECTOR = Object.freeze({
  organizationId: 'org-1',
  role: 'inspector',
  termsAccepted: true,
});

describe('D38 — profile resolution', () => {
  it('1. offline cold start WITH cached stance serves the cached role unchanged', () => {
    const out = resolveProfile({ status: 'unavailable', reason: 'fetch failed' }, INSPECTOR);
    assert.equal(out.source, 'cache');
    assert.deepEqual(out.profile, INSPECTOR);
  });

  it('2. offline cold start WITHOUT cache resolves to none — never a role-less profile', () => {
    const out = resolveProfile({ status: 'unavailable', reason: 'timeout' }, null);
    assert.deepEqual(out, { source: 'none' });
    // a cached snapshot without a role is equally non-routable:
    const stale = { organizationId: null, role: null, termsAccepted: false };
    assert.deepEqual(resolveProfile({ status: 'unavailable', reason: 't' }, stale), { source: 'none' });
  });

  it('3. genuine ONLINE no-stance is an authoritative network answer (chooser legitimate)', () => {
    // (a) row exists with role null
    const roleless = { organizationId: null, role: null, termsAccepted: false };
    const out = resolveProfile({ status: 'ok', profile: roleless }, INSPECTOR);
    assert.equal(out.source, 'network');
    assert.equal(out.profile.role, null);
    // (b) row absent: PGRST116 is classified authoritative-missing, everything
    // network-ish is 'unavailable'
    assert.equal(classifyProfileFetchError({ code: 'PGRST116' }), 'authoritative-missing');
    for (const err of [
      { message: 'TypeError: Network request failed' },
      { code: 'PGRST000' },
      { status: 503, message: 'upstream unavailable' },
      null,
      undefined,
      {},
    ]) {
      assert.equal(classifyProfileFetchError(err), 'unavailable', JSON.stringify(err));
    }
  });

  it('4. reconnect rehydration: network overwrites cache and wins resolution', async () => {
    const storage = memStorage();
    const userId = 'user-1';

    // offline era: cache holds the last validated snapshot
    await writeProfileCache(storage, userId, INSPECTOR);
    let cached = await readProfileCache(storage, userId);
    assert.deepEqual(cached, INSPECTOR);
    assert.equal(resolveProfile({ status: 'unavailable', reason: 'x' }, cached).source, 'cache');

    // reconnect: fresh authoritative answer (role changed server-side)
    const fresh = { organizationId: 'org-2', role: 'senior', termsAccepted: true };
    const outcome = { status: 'ok', profile: fresh };
    assert.equal(resolveProfile(outcome, cached).source, 'network');
    assert.deepEqual(resolveProfile(outcome, cached).profile, fresh);
    // AuthContext writes the cache exactly when isCacheableProfile says so:
    assert.equal(isCacheableProfile(outcome), true);
    await writeProfileCache(storage, userId, fresh);
    cached = await readProfileCache(storage, userId);
    assert.deepEqual(cached, fresh);
  });

  it('5. zero role mutation: resolver is pure, cache only stores authoritative role-bearing answers', async () => {
    const storage = memStorage();
    // frozen inputs → any mutation attempt would throw in strict mode
    const frozenOutcome = Object.freeze({ status: 'unavailable', reason: 'net' });
    const out = resolveProfile(frozenOutcome, INSPECTOR);
    assert.equal(out.profile.role, 'inspector');

    // unavailable and role-less outcomes are NOT cacheable — the cache can
    // never launder a network failure or a null role into a stance
    assert.equal(isCacheableProfile({ status: 'unavailable', reason: 'x' }), false);
    assert.equal(
      isCacheableProfile({ status: 'ok', profile: { organizationId: null, role: null, termsAccepted: false } }),
      false,
    );

    // malformed cache reads degrade to null (same as no cache), never throw
    storage.map.set(profileCacheKey('u2'), '{not json');
    assert.equal(await readProfileCache(storage, 'u2'), null);
    storage.map.set(profileCacheKey('u3'), JSON.stringify({ role: 42 }));
    const weird = await readProfileCache(storage, 'u3');
    assert.equal(weird.role, null);
  });
});
