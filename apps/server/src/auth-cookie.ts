// Apple uses a cross-site form POST, so its short-lived flow cookie must allow it.
// Session cookies continue to use Lax; state, nonce and PKCE remain mandatory.
export function authFlowCookieOptions(provider: string, production: boolean) {
  return {
    path: '/auth',
    httpOnly: true,
    secure: provider === 'apple' || production,
    sameSite: provider === 'apple' ? ('none' as const) : ('lax' as const)
  };
}
