import { normalizeDatabaseUrl } from './database-url.util';

describe('normalizeDatabaseUrl', () => {
  it('rewrites legacy sslmode=require to verify-full', () => {
    expect(
      normalizeDatabaseUrl(
        'postgresql://user:pass@host:5432/db?sslmode=require',
      ),
    ).toContain('sslmode=verify-full');
  });

  it('rewrites legacy sslmode=prefer to verify-full', () => {
    expect(
      normalizeDatabaseUrl(
        'postgresql://user:pass@host:5432/db?sslmode=prefer',
      ),
    ).toContain('sslmode=verify-full');
  });

  it('preserves legacy sslmode when libpq compatibility is explicitly enabled', () => {
    const databaseUrl =
      'postgresql://user:pass@host:5432/db?sslmode=require&uselibpqcompat=true';

    expect(normalizeDatabaseUrl(databaseUrl)).toBe(databaseUrl);
  });

  it('preserves non-legacy sslmodes exactly as provided', () => {
    const databaseUrl =
      'postgresql://user:pass@host:5432/db?sslmode=verify-full';

    expect(normalizeDatabaseUrl(databaseUrl)).toBe(databaseUrl);
  });

  it('returns invalid urls unchanged instead of throwing', () => {
    expect(normalizeDatabaseUrl('not-a-url')).toBe('not-a-url');
  });
});
