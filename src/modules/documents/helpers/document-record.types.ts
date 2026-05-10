/**
 * Shared Prisma-shaped record types used by `documents.service.ts` and its
 * extracted helper modules.
 *
 * These mirror the partial Prisma payloads we hand around between the service
 * and its formatters/builders. They live here so the service can import them
 * alongside the helper functions that consume them, rather than having to
 * re-declare overlapping shapes near each helper file.
 */
import {
  CollaboratorInvitationStatus,
  CollaboratorPermission,
  CollaboratorRole,
  DocumentInvitationVerificationRequirement,
  Prisma,
} from '@prisma/client';

// ─── Selects ────────────────────────────────────────────────────────────────
//
// Centralising the Prisma `select` shapes here keeps the document service and
// its helpers aligned on the exact columns we read for signature requests.

/** Compact signature request shape for write paths and quick reads. */
export const SIGNATURE_REQUEST_SUMMARY_SELECT = {
  id: true,
  requestedById: true,
  requestedUserId: true,
  status: true,
  personalSignedDocumentId: true,
  signerDisplayNameSnapshot: true,
  signerEmailSnapshot: true,
  signatureImageS3KeySnapshot: true,
  signatureImageMimeTypeSnapshot: true,
  signatureImageSizeBytesSnapshot: true,
  signedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DocumentSignatureRequestSelect;

/** Same summary plus the requested user's profile — used for UI progress. */
export const SIGNATURE_REQUEST_PROGRESS_SELECT = {
  ...SIGNATURE_REQUEST_SUMMARY_SELECT,
  requestedUser: {
    select: {
      id: true,
      email: true,
      imageUrl: true,
      citizenIdentity: {
        select: { surName: true, postNames: true },
      },
    },
  },
} satisfies Prisma.DocumentSignatureRequestSelect;

/** Used when listing completed signatures alongside signer profile data. */
export const COMPLETED_SIGNATURE_SELECT =
  SIGNATURE_REQUEST_PROGRESS_SELECT satisfies Prisma.DocumentSignatureRequestSelect;

// ─── Record shapes ──────────────────────────────────────────────────────────

export type SignatureRequestBaseRecord =
  Prisma.DocumentSignatureRequestGetPayload<{
    select: typeof SIGNATURE_REQUEST_SUMMARY_SELECT;
  }>;

export type SignatureRequestProgressRecord =
  Prisma.DocumentSignatureRequestGetPayload<{
    select: typeof SIGNATURE_REQUEST_PROGRESS_SELECT;
  }>;

export type CompletedSignatureRecord =
  Prisma.DocumentSignatureRequestGetPayload<{
    select: typeof COMPLETED_SIGNATURE_SELECT;
  }>;

/** Public-facing shape for a single requested-signer summary. */
export type SignatureRequestUserSummary = {
  id: string;
  email: string;
  imageUrl: string | null;
  displayName: string;
  surName: string | null;
  postNames: string | null;
};

/** Service-level summary that includes the optional reminder cooldown hint. */
export type SignatureRequestSummary = SignatureRequestBaseRecord & {
  requestedUser?: SignatureRequestUserSummary | null;
  nextReminderAvailableAt?: Date | null;
};

/** A signed personal document attached to a signature request, used at lock time. */
export type SignedDocumentForLock = {
  id: string;
  userId: string;
  signedAt: Date;
  certificateId: string;
  signerDisplayNameSnapshot: string | null;
  signerEmailSnapshot: string | null;
  signatureImageS3KeySnapshot: string | null;
  signatureImageMimeTypeSnapshot: string | null;
  signatureImageSizeBytesSnapshot: number | null;
};

/** Public-facing completed-signature row used by API responses. */
export type CompletedSignatureSummary = {
  signatureId: string;
  certificateId: string | null;
  signerId: string;
  signerName: string;
  signerEmail: string;
  imageUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  signedAt: Date;
  isOwner: boolean;
};

// ─── Collaborator records ───────────────────────────────────────────────────

/** Bare collaborator row used when permission rules only need flags. */
export type CollaboratorAccessRecord = {
  id: string;
  userId: string;
  role: CollaboratorRole;
  permissions: CollaboratorPermission[];
  invitationStatus: CollaboratorInvitationStatus;
  requiredVerifications: DocumentInvitationVerificationRequirement[];
  invitationExpiresAt: Date | null;
  invitationEmailSentAt: Date | null;
  invitationOpenedAt: Date | null;
  invitedAt: Date;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  revokedAt: Date | null;
  note: string | null;
  isActive: boolean;
};

/** Same row plus the joined user/inviter identity needed by formatters. */
export type CollaboratorWithProfile = CollaboratorAccessRecord & {
  user: {
    email: string;
    imageUrl: string | null;
    citizenIdentity: {
      surName: string;
      postNames: string;
    } | null;
  };
  invitedBy: {
    id: string;
    email: string;
    citizenIdentity: {
      surName: string;
      postNames: string;
    } | null;
  } | null;
};

/** Collaborator slice used when building the per-user access summary on a document. */
export type DocumentAccessCollaboratorSummary = {
  id: string;
  userId: string;
  role: CollaboratorRole;
  permissions: CollaboratorPermission[];
  acceptedAt: Date | null;
  invitedBy: {
    id: string;
    email: string;
    citizenIdentity: {
      surName: string;
      postNames: string;
    } | null;
  } | null;
};

// ─── Invitation records ─────────────────────────────────────────────────────

/** Full invitation lookup — used by token-based invitation review flows. */
export type InvitationLookupRecord = {
  id: string;
  documentId: string;
  userId: string;
  permissions: CollaboratorPermission[];
  invitationStatus: CollaboratorInvitationStatus;
  invitationTokenHash: string | null;
  requiredVerifications: DocumentInvitationVerificationRequirement[];
  invitationExpiresAt: Date | null;
  invitationEmailSentAt: Date | null;
  invitationOpenedAt: Date | null;
  invitedAt: Date;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  revokedAt: Date | null;
  note: string | null;
  isActive: boolean;
  document: {
    id: string;
    title: string;
    isDeleted: boolean;
  };
  user: {
    email: string;
    imageUrl: string | null;
    citizenIdentity: {
      surName: string;
      postNames: string;
    } | null;
  };
  invitedBy: {
    id: string;
    email: string;
    citizenIdentity: {
      surName: string;
      postNames: string;
    } | null;
  } | null;
};

/** Verification-session row used while gating invitation acceptance. */
export type InvitationVerificationSessionRecord = {
  id: string;
  collaboratorId: string;
  documentId: string;
  userId: string;
  emailOtpCodeHash: string | null;
  emailOtpSentAt: Date | null;
  emailOtpExpiresAt: Date | null;
  emailOtpVerifiedAt: Date | null;
  emailOtpAttemptCount: number;
  emailOtpRequestCount: number;
  emailOtpWindowStartedAt: Date | null;
  identityChallengeStartedAt: Date | null;
  identityFailureAttemptId: string | null;
  identityVerificationAttemptId: string | null;
  identityVerifiedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

// ─── Comment records ────────────────────────────────────────────────────────

export type DocumentCommentAuthorRecord = {
  id: string;
  email: string;
  imageUrl: string | null;
  citizenIdentity: {
    surName: string;
    postNames: string;
  } | null;
};

export type DocumentCommentReplyRecord = {
  id: string;
  authorId: string;
  parentCommentId: string | null;
  anchorText: string | null;
  anchorFrom: number | null;
  anchorTo: number | null;
  content: string;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  author: DocumentCommentAuthorRecord;
};

export type DocumentCommentRecord = DocumentCommentReplyRecord & {
  replies: DocumentCommentReplyRecord[];
};

// ─── Audit context ──────────────────────────────────────────────────────────

/** Optional request metadata attached to access audit log writes. */
export type AccessAuditContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};
