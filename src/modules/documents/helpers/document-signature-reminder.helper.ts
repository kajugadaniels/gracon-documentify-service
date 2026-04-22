/**
 * Pure helpers for the signature-reminder rate-limit audit events.
 *
 * The documents service pulls recent reminder events from the access audit
 * log; this module turns those rows into the request-id keyed cooldown map
 * used by the signing-progress UI, and extracts the `requestId` metadata
 * field we stamp onto every reminder event.
 */
import type { Prisma } from '@prisma/client';

/** Cooldown window between two reminder emails for the same signature request. */
export const SIGNATURE_REMINDER_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Pulls the stamped `requestId` out of an audit event's metadata JSON blob.
 *
 * @param metadata - `metadata` column value read from `DocumentAccessAuditLog`.
 * @returns The request id string, or `null` when missing / malformed.
 */
export function getSignatureReminderRequestId(
  metadata: Prisma.JsonValue | null,
): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const requestId = (metadata as Record<string, unknown>)['requestId'];
  return typeof requestId === 'string' ? requestId : null;
}

/** Minimal shape of an audit event used when computing cooldowns. */
export type ReminderAuditEvent = {
  createdAt: Date;
  metadata: Prisma.JsonValue | null;
};

/**
 * Builds a `requestId → next-allowed-reminder-time` map from an ordered list
 * of recent reminder audit events.
 *
 * Events must be sorted newest-first so the most recent event wins per
 * request id — this mirrors how the service queries them (desc by createdAt).
 *
 * @param events - Recent `SIGNATURE_REMINDER_*` audit events.
 * @param cooldownMs - Cooldown window in milliseconds (defaults to the 15m rule).
 * @returns Map of request id to the earliest allowed retry timestamp.
 */
export function buildSignatureReminderCooldownMap(
  events: ReminderAuditEvent[],
  cooldownMs: number = SIGNATURE_REMINDER_COOLDOWN_MS,
): Map<string, Date> {
  const cooldowns = new Map<string, Date>();

  for (const event of events) {
    const requestId = getSignatureReminderRequestId(event.metadata);
    if (!requestId || cooldowns.has(requestId)) {
      continue;
    }

    cooldowns.set(
      requestId,
      new Date(event.createdAt.getTime() + cooldownMs),
    );
  }

  return cooldowns;
}
