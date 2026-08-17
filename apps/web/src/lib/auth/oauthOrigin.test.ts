// D27 regression: a PREVIEW must return OAuth users to its own host, never to
// the production domain, even when NEXT_PUBLIC_SITE_URL is set (it is, in all
// Vercel environments). Non-vacuous: the old NEXT_PUBLIC_SITE_URL-first order
// fails the first assertion.
import { describe, expect, it } from 'vitest';
import { resolveOAuthOrigin } from './oauthOrigin';

describe('resolveOAuthOrigin', () => {
  it('preview returns to its own deployment host, not the production domain', () => {
    expect(resolveOAuthOrigin({
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'nexpec-main-platform-abc123.vercel.app',
      NEXT_PUBLIC_SITE_URL: 'https://www.nexpecapp.com',
    })).toBe('https://nexpec-main-platform-abc123.vercel.app');
  });
  it('production returns to the canonical domain, not the raw deployment host', () => {
    expect(resolveOAuthOrigin({
      VERCEL_ENV: 'production',
      VERCEL_URL: 'nexpec-main-platform-xyz.vercel.app',
      NEXT_PUBLIC_SITE_URL: 'https://www.nexpecapp.com',
    })).toBe('https://www.nexpecapp.com');
  });
  it('preview without VERCEL_URL still has a fallback', () => {
    expect(resolveOAuthOrigin({ VERCEL_ENV: 'preview', NEXT_PUBLIC_SITE_URL: 'https://www.nexpecapp.com' }))
      .toBe('https://www.nexpecapp.com');
  });
  it('local dev falls back to localhost', () => {
    expect(resolveOAuthOrigin({})).toBe('http://localhost:3000');
  });
});
