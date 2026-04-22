/**
 * Pure HTTP authorisation header parsing helpers.
 *
 * Kept pure (no Nest dependencies) so the documents service can lean on this
 * for invitation-flow session bootstrapping without re-implementing token
 * scheme handling inline.
 */

/**
 * Extracts the raw bearer token from an `Authorization` header value.
 *
 * Returns `null` for absent, malformed, or non-Bearer headers — callers should
 * treat that as "no session attached" and surface their own auth error.
 *
 * @param authHeader - Raw `Authorization` header string from the inbound request.
 * @returns The trimmed token string, or `null` when not present/parsable.
 */
export function extractBearerToken(
  authHeader?: string | null,
): string | null {
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token.trim() || null;
}
