import { describe, expect, it } from 'vitest';
import { authFlowCookieOptions } from './auth-cookie.js';

describe('OAuth flow cookies', () => {
  it('allows Apple cross-site POST callbacks only with a secure cookie', () => {
    for (const production of [false, true]) {
      expect(authFlowCookieOptions('apple', production)).toEqual({
        path: '/auth',
        httpOnly: true,
        secure: true,
        sameSite: 'none'
      });
    }
  });
  it('retains Lax for providers using top-level GET callbacks', () => {
    for (const provider of ['google', 'microsoft', 'github']) {
      expect(authFlowCookieOptions(provider, true)).toEqual({
        path: '/auth',
        httpOnly: true,
        secure: true,
        sameSite: 'lax'
      });
    }
  });
});
