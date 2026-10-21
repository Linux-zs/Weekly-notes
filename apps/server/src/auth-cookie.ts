export function authFlowCookieOptions(production: boolean) {
  return { path: '/auth', httpOnly: true, secure: production, sameSite: 'lax' as const };
}
