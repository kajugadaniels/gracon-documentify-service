// database-url.util.ts — normalizes Postgres TLS parameters for Prisma.
// pg-connection-string currently treats several legacy sslmode values as
// verify-full and warns that future versions will weaken them to libpq semantics.
// Rewriting those aliases keeps today's stricter behavior explicit.

const LEGACY_SSL_MODES = new Set(['prefer', 'require', 'verify-ca']);

/**
 * Preserves the current strict TLS behavior by rewriting legacy sslmode aliases
 * to sslmode=verify-full unless libpq compatibility was explicitly requested.
 */
export function normalizeDatabaseUrl(databaseUrl: string): string {
  try {
    const parsedUrl = new URL(databaseUrl);
    const sslMode = parsedUrl.searchParams.get('sslmode')?.toLowerCase();
    const useLibpqCompat =
      parsedUrl.searchParams.get('uselibpqcompat')?.toLowerCase() === 'true';

    if (!sslMode || useLibpqCompat || !LEGACY_SSL_MODES.has(sslMode)) {
      return databaseUrl;
    }

    parsedUrl.searchParams.set('sslmode', 'verify-full');
    return parsedUrl.toString();
  } catch {
    return databaseUrl;
  }
}
