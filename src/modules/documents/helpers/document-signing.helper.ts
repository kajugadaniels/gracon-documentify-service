import {
  CollaboratorInvitationStatus,
  CollaboratorPermission,
  DocumentStatus,
} from '@prisma/client';

export type CollaboratorSigningEligibility = {
  permissions: CollaboratorPermission[];
  invitationStatus: CollaboratorInvitationStatus;
  acceptedAt: Date | null;
  isActive: boolean;
};

export type LockDocumentDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | 'NOT_OWNER'
        | 'INVALID_STATUS'
        | 'PENDING_SIGNATURES'
        | 'MISSING_COMPLETED_SIGNATURE';
    };

export function buildRequiredSignerIds(input: {
  ownerId: string;
  collaboratorSignerIds: string[];
  requireOwnerSignature: boolean;
}): string[] {
  if (!input.requireOwnerSignature) {
    return Array.from(new Set(input.collaboratorSignerIds));
  }

  return Array.from(new Set([input.ownerId, ...input.collaboratorSignerIds]));
}

export function collaboratorRequiresSignature(
  input: CollaboratorSigningEligibility,
): boolean {
  return (
    input.isActive &&
    input.acceptedAt !== null &&
    input.invitationStatus === CollaboratorInvitationStatus.ACCEPTED &&
    input.permissions.includes(CollaboratorPermission.SIGN)
  );
}

export function canDocumentAcceptNewSignature(
  status: DocumentStatus,
): boolean {
  return (
    status === DocumentStatus.FINALISED || status === DocumentStatus.SIGNED
  );
}

export function resolveSigningStatusUpdate(input: {
  pendingSignatureCount: number;
  latestCompletedSignedAt: Date | null;
}): {
  status: DocumentStatus;
  signedAt: Date | null;
} {
  if (input.pendingSignatureCount === 0 && input.latestCompletedSignedAt) {
    return {
      status: DocumentStatus.SIGNED,
      signedAt: input.latestCompletedSignedAt,
    };
  }

  return {
    status: DocumentStatus.FINALISED,
    signedAt: null,
  };
}

export function evaluateLockDocument(input: {
  isOwner: boolean;
  status: DocumentStatus;
  pendingSignatureCount: number;
  hasCompletedSignature: boolean;
}): LockDocumentDecision {
  if (!input.isOwner) {
    return { allowed: false, reason: 'NOT_OWNER' };
  }

  if (input.status !== DocumentStatus.SIGNED) {
    return { allowed: false, reason: 'INVALID_STATUS' };
  }

  if (input.pendingSignatureCount > 0) {
    return { allowed: false, reason: 'PENDING_SIGNATURES' };
  }

  if (!input.hasCompletedSignature) {
    return { allowed: false, reason: 'MISSING_COMPLETED_SIGNATURE' };
  }

  return { allowed: true };
}
