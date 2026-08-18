export function isSqliteUniqueConstraint(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false;
  const code = String((error as Error & { code?: unknown }).code ?? '');
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
}
