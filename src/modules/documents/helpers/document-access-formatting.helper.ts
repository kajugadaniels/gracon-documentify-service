import { CollaboratorPermission, Prisma } from '@prisma/client';

const ACCESS_AUDIT_METADATA_KEYS = [
  'acceptedAt',
  'anchored',
  'commentId',
  'completedSignatureCount',
  'declinedAt',
  'emailOtpExpiresAt',
  'emailOtpSentAt',
  'emailOtpVerifiedAt',
  'expiresAt',
  'failReason',
  'identityChallengeStartedAt',
  'identityVerificationFailedAt',
  'identityVerificationAttemptId',
  'identityVerifiedAt',
  'lockedAt',
  'notePresent',
  'openedAt',
  'pendingSignatureCount',
  'parentCommentId',
  'previousStatus',
  'reason',
  'remainingAttempts',
  'resent',
  'retryAfterSeconds',
  'retryAt',
  'resolvedAt',
  'sentAt',
  'signingOrder',
  'tokenType',
  'totalRequired',
  'totalSigned',
] as const;

export type DocumentInviterIdentity = {
  email: string;
  citizenIdentity?: {
    postNames: string | null;
    surName: string | null;
  } | null;
} | null;

export function resolveDocumentAuditLimit(rawLimit?: string): number {
  const parsed = rawLimit ? Number.parseInt(rawLimit, 10) : 50;
  if (!Number.isInteger(parsed)) {
    return 50;
  }

  return Math.min(Math.max(parsed, 1), 100);
}

export function sanitizeDocumentAccessAuditMetadata(
  metadata: Prisma.JsonValue | null,
): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const source = metadata as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const key of ACCESS_AUDIT_METADATA_KEYS) {
    const value = source[key];
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      sanitized[key] = value;
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

export function describeDocumentPermissions(
  permissions: CollaboratorPermission[],
): string {
  const labels = permissions
    .filter((permission) => permission !== CollaboratorPermission.READ)
    .map((permission) => {
      if (permission === CollaboratorPermission.MANAGE_ACCESS) {
        return 'manage access';
      }

      return permission.toLowerCase();
    });

  if (labels.length === 0) {
    return 'read access';
  }

  if (labels.length === 1) {
    return `${labels[0]} access`;
  }

  const head = labels.slice(0, -1).join(', ');
  const tail = labels.at(-1);
  return `${head} and ${tail} access`;
}

export function describeInvitationExpiryDuration(
  expiry: Date,
  now: Date = new Date(),
): string {
  const diffMs = expiry.getTime() - now.getTime();
  const days = Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
  return days === 1 ? '1 day' : `${days} days`;
}

export function formatDocumentUserDisplayName(
  postNames: string | null,
  surName: string | null,
  fallback: string,
): string {
  const fullName = `${postNames ?? ''} ${surName ?? ''}`.trim();
  return fullName || fallback;
}

export function getDocumentInviterDisplayName(
  invitedBy: DocumentInviterIdentity,
): string {
  if (!invitedBy) {
    return 'A verified user';
  }

  return formatDocumentUserDisplayName(
    invitedBy.citizenIdentity?.postNames ?? null,
    invitedBy.citizenIdentity?.surName ?? null,
    invitedBy.email,
  );
}

export function maskDocumentRecipientEmail(email: string): string {
  const [localPart, domain = ''] = email.split('@');
  if (!localPart) {
    return email;
  }

  const visiblePrefix = localPart.slice(0, 2);
  return `${visiblePrefix}${'*'.repeat(Math.max(localPart.length - 2, 2))}@${domain}`;
}
