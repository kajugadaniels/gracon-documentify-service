/**
 * Pure helpers for invitation expiry and frontend URL composition.
 *
 * The documents service holds the `ConfigService` reference required to
 * resolve the actual frontend base URL; this module only owns the pure
 * "given a base + token, produce a URL" and expiry-date math.
 */

// ─── Invitation expiry ──────────────────────────────────────────────────────

/** Default invitation lifetime when the inviter does not specify one. */
export const DEFAULT_INVITATION_EXPIRY_DAYS = 7;

/** Minimum invitation lifetime accepted from the API. */
const MIN_INVITATION_EXPIRY_DAYS = 1;

/** Maximum invitation lifetime accepted from the API. */
const MAX_INVITATION_EXPIRY_DAYS = 30;

/**
 * Builds a future expiry date for a freshly issued invitation, clamped to
 * the allowed range so a caller cannot create absurdly short or long links.
 *
 * @param expiresInDays - Optional desired lifetime in days.
 * @param now - Current time (injectable for tests; defaults to `new Date()`).
 * @returns The expiry timestamp to persist on the collaborator row.
 */
export function buildInvitationExpiry(
  expiresInDays?: number,
  now: Date = new Date(),
): Date {
  const days = expiresInDays ?? DEFAULT_INVITATION_EXPIRY_DAYS;
  const safeDays = Math.min(
    Math.max(days, MIN_INVITATION_EXPIRY_DAYS),
    MAX_INVITATION_EXPIRY_DAYS,
  );
  const expiry = new Date(now.getTime());
  expiry.setDate(expiry.getDate() + safeDays);
  return expiry;
}

// ─── Frontend URL composition ───────────────────────────────────────────────

/**
 * Composes the public invitation review URL from the documents-app base URL
 * and the raw invitation token (which is URL-encoded for safety).
 *
 * @param baseUrl - Documents-app frontend base URL (no trailing slash).
 * @param rawToken - Raw, unhashed invitation token to embed in the path.
 * @returns The full URL the recipient should click to start invitation review.
 */
export function buildInvitationUrl(baseUrl: string, rawToken: string): string {
  return `${baseUrl}/invitations/${encodeURIComponent(rawToken)}`;
}

/**
 * Composes the in-app document edit URL from the documents-app base URL and
 * the document ID.
 *
 * @param baseUrl - Documents-app frontend base URL (no trailing slash).
 * @param documentId - Document UUID to embed in the path.
 * @returns The full URL the user should land on when opening the document.
 */
export function buildDocumentEditUrl(
  baseUrl: string,
  documentId: string,
): string {
  return `${baseUrl}/documents/${encodeURIComponent(documentId)}/edit`;
}
