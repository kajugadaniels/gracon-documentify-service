import {
  CollaboratorInvitationStatus,
  CollaboratorPermission,
  DocumentStatus,
  SignatureRequestStatus,
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

export type SigningReadinessStatus =
  | 'ready'
  | 'needs_login'
  | 'needs_identity_verification'
  | 'needs_certificate'
  | 'not_required_signer'
  | 'already_signed'
  | 'document_not_finalised'
  | 'document_locked'
  | 'document_hash_missing';

export type SigningReadinessDecision = {
  status: SigningReadinessStatus;
  canSign: boolean;
  message: string;
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

export function evaluateSigningReadiness(input: {
  hasSession: boolean;
  hasFullVerifiedSession: boolean;
  documentStatus: DocumentStatus;
  hasDocumentHash: boolean;
  hasSignatureRequest: boolean;
  signatureRequestStatus: SignatureRequestStatus | null;
  hasActiveCertificate: boolean;
}): SigningReadinessDecision {
  if (!input.hasSession) {
    return {
      status: 'needs_login',
      canSign: false,
      message: 'Sign in with the required account before signing this document.',
    };
  }

  if (!input.hasFullVerifiedSession) {
    return {
      status: 'needs_identity_verification',
      canSign: false,
      message: 'Complete identity verification before signing this document.',
    };
  }

  if (input.signatureRequestStatus === SignatureRequestStatus.SIGNED) {
    return {
      status: 'already_signed',
      canSign: false,
      message: 'Your signature is already recorded for this document.',
    };
  }

  if (input.documentStatus === DocumentStatus.LOCKED) {
    return {
      status: 'document_locked',
      canSign: false,
      message: 'This document is already locked and cannot accept more signatures.',
    };
  }

  if (!canDocumentAcceptNewSignature(input.documentStatus)) {
    return {
      status: 'document_not_finalised',
      canSign: false,
      message: 'The document must be finalised before it can be signed.',
    };
  }

  if (!input.hasDocumentHash) {
    return {
      status: 'document_hash_missing',
      canSign: false,
      message: 'The document is missing its finalised content hash.',
    };
  }

  if (!input.hasSignatureRequest) {
    return {
      status: 'not_required_signer',
      canSign: false,
      message: 'You are not currently listed as a required signer for this document.',
    };
  }

  if (!input.hasActiveCertificate) {
    return {
      status: 'needs_certificate',
      canSign: false,
      message: 'Apply for a digital signature before signing this document.',
    };
  }

  return {
    status: 'ready',
    canSign: true,
    message: 'Ready to sign this finalised document.',
  };
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
