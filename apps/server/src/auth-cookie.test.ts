import { describe, expect, it } from 'vitest';
import { authFlowCookieOptions } from './auth-cookie.js';
describe('OAuth flow cookies', () => {
  it.each([false, true])('protects GET callback cookies in production=%s', (production) => {
    expect(authFlowCookieOptions(production)).toEqual({
      path: '/auth',
      httpOnly: true,
      secure: production,
      sameSite: 'lax'
    });
  });
});
