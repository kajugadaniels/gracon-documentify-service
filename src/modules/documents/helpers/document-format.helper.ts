/**
 * Pure response-shape formatters for the documents service.
 *
 * Every function here turns Prisma-shaped data into the public API shape we
 * return from controllers. They are deliberately side-effect-free so they can
 * be composed inside `documents.service.ts` without dragging Prisma/S3 wiring
 * into the formatting concern.
 */
import {
  formatDocumentUserDisplayName,
  getDocumentInviterDisplayName,
} from './document-access-formatting.helper';
import {
  DOCUMENT_PERMISSION_ORDER,
  getEffectiveDocumentPermissions,
} from './document-permissions.helper';
import {
  normalizeDocumentLayout,
  type DocumentLayout,
} from './document-layout.helper';
import type {
  CollaboratorWithProfile,
  DocumentAccessCollaboratorSummary,
  DocumentCommentAuthorRecord,
  DocumentCommentRecord,
  DocumentCommentReplyRecord,
  SignatureRequestProgressRecord,
  SignatureRequestSummary,
} from './document-record.types';

// ─── Audit log user formatting ──────────────────────────────────────────────

/**
 * Formats a Prisma user row into the audit-log actor/target shape.
 *
 * @param user - Joined user row with optional citizen identity.
 * @returns A `{ id, email, displayName }` triple ready for the audit response.
 */
export function formatAuditUser(user: {
  id: string;
  email: string;
  citizenIdentity: {
    surName: string;
    postNames: string;
  } | null;
}): { id: string; email: string; displayName: string } {
  return {
    id: user.id,
    email: user.email,
    displayName: formatDocumentUserDisplayName(
      user.citizenIdentity?.postNames ?? null,
      user.citizenIdentity?.surName ?? null,
      user.email,
    ),
  };
}

// ─── Signature request formatting ───────────────────────────────────────────

/**
 * Formats a Prisma signature-request row into the public summary shape used
 * by the editor's signing-progress UI.
 *
 * @param request - Prisma row with the requested user joined in.
 * @returns The summary shape (without `nextReminderAvailableAt`, which the
 *          service layer adds after computing per-request cooldowns).
 */
export function formatSignatureRequestSummary(
  request: SignatureRequestProgressRecord,
): SignatureRequestSummary {
  const requestedUser = request.requestedUser;

  return {
    id: request.id,
    requestedById: request.requestedById,
    requestedUserId: request.requestedUserId,
    status: request.status,
    personalSignedDocumentId: request.personalSignedDocumentId,
    signerDisplayNameSnapshot: request.signerDisplayNameSnapshot,
    signerEmailSnapshot: request.signerEmailSnapshot,
    signatureImageS3KeySnapshot: request.signatureImageS3KeySnapshot,
    signatureImageMimeTypeSnapshot: request.signatureImageMimeTypeSnapshot,
    signatureImageSizeBytesSnapshot:
      request.signatureImageSizeBytesSnapshot,
    signedAt: request.signedAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    requestedUser: {
      id: requestedUser.id,
      email: requestedUser.email,
      imageUrl: requestedUser.imageUrl,
      displayName: formatDocumentUserDisplayName(
        requestedUser.citizenIdentity?.postNames ?? null,
        requestedUser.citizenIdentity?.surName ?? null,
        requestedUser.email,
      ),
      surName: requestedUser.citizenIdentity?.surName ?? null,
      postNames: requestedUser.citizenIdentity?.postNames ?? null,
    },
  };
}

// ─── Comment formatting ─────────────────────────────────────────────────────

/**
 * Formats the author profile attached to a comment / reply.
 *
 * @param user - Author user row with optional citizen identity.
 * @returns Public-facing author shape with derived `displayName`.
 */
export function formatCommentAuthor(user: DocumentCommentAuthorRecord): {
  id: string;
  email: string;
  imageUrl: string | null;
  displayName: string;
} {
  return {
    id: user.id,
    email: user.email,
    imageUrl: user.imageUrl,
    displayName: formatDocumentUserDisplayName(
      user.citizenIdentity?.postNames ?? null,
      user.citizenIdentity?.surName ?? null,
      user.email,
    ),
  };
}

/**
 * Formats a single comment reply row. Replies never have nested replies, so
 * the public `replies` field is always an empty array.
 *
 * @param reply - Prisma reply row with the author joined in.
 * @returns The public reply shape used by the comments panel.
 */
export function formatDocumentCommentReply(reply: DocumentCommentReplyRecord) {
  return {
    id: reply.id,
    authorId: reply.authorId,
    parentCommentId: reply.parentCommentId,
    anchorText: reply.anchorText,
    anchorFrom: reply.anchorFrom,
    anchorTo: reply.anchorTo,
    content: reply.content,
    resolvedAt: reply.resolvedAt,
    createdAt: reply.createdAt,
    updatedAt: reply.updatedAt,
    author: formatCommentAuthor(reply.author),
    replies: [] as ReturnType<typeof formatDocumentCommentReply>[],
  };
}

/**
 * Formats a top-level comment along with its replies into the public shape.
 *
 * @param comment - Prisma comment row with author and replies eager-loaded.
 * @returns The full comment thread ready to send to the client.
 */
export function formatDocumentComment(comment: DocumentCommentRecord) {
  return {
    id: comment.id,
    authorId: comment.authorId,
    parentCommentId: comment.parentCommentId,
    anchorText: comment.anchorText,
    anchorFrom: comment.anchorFrom,
    anchorTo: comment.anchorTo,
    content: comment.content,
    resolvedAt: comment.resolvedAt,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    author: formatCommentAuthor(comment.author),
    replies: comment.replies.map((reply) => formatDocumentCommentReply(reply)),
  };
}

// ─── Collaborator formatting ────────────────────────────────────────────────

/**
 * Formats a full collaborator row (user + inviter joined) into the public
 * collaborator shape returned by the share-management endpoints.
 *
 * @param collaborator - Joined collaborator row from Prisma.
 * @returns Public-facing collaborator with derived display names.
 */
export function formatCollaboratorAccess(collaborator: CollaboratorWithProfile) {
  const displayName = formatDocumentUserDisplayName(
    collaborator.user.citizenIdentity?.postNames ?? null,
    collaborator.user.citizenIdentity?.surName ?? null,
    collaborator.user.email,
  );

  return {
    id: collaborator.id,
    userId: collaborator.userId,
    role: collaborator.role,
    permissions: collaborator.permissions,
    invitationStatus: collaborator.invitationStatus,
    invitationExpiresAt: collaborator.invitationExpiresAt,
    invitationEmailSentAt: collaborator.invitationEmailSentAt,
    invitationOpenedAt: collaborator.invitationOpenedAt,
    invitedAt: collaborator.invitedAt,
    acceptedAt: collaborator.acceptedAt,
    declinedAt: collaborator.declinedAt,
    revokedAt: collaborator.revokedAt,
    note: collaborator.note,
    isActive: collaborator.isActive,
    user: {
      email: collaborator.user.email,
      imageUrl: collaborator.user.imageUrl,
      displayName,
      surName: collaborator.user.citizenIdentity?.surName ?? null,
      postNames: collaborator.user.citizenIdentity?.postNames ?? null,
    },
    invitedBy: collaborator.invitedBy
      ? {
          id: collaborator.invitedBy.id,
          email: collaborator.invitedBy.email,
          displayName: getDocumentInviterDisplayName(collaborator.invitedBy),
        }
      : null,
  };
}

// ─── Document formatting ────────────────────────────────────────────────────

/** Shape of the document core fields returned by `formatDocumentRecord`. */
export type FormattedDocumentRecord = {
  id: unknown;
  title: unknown;
  type: unknown;
  status: unknown;
  tags: unknown;
  wordCount: unknown;
  folderId: unknown;
  contentHash: unknown;
  createdAt: unknown;
  updatedAt: unknown;
  finalisedAt: unknown;
  signedAt: unknown;
  lockedAt: unknown;
  layout: DocumentLayout;
  signatureSnapshot: null;
};

/**
 * Maps a raw Prisma document row to the canonical document response shape.
 *
 * The signature snapshot is intentionally null here — callers that need the
 * snapshot must populate it after S3 lookups complete.
 *
 * @param doc - Raw document row read from Prisma.
 * @returns The base public document shape with normalised layout.
 */
export function formatDocumentRecord(
  doc: Record<string, unknown>,
): FormattedDocumentRecord {
  return {
    id: doc['id'],
    title: doc['title'],
    type: doc['type'],
    status: doc['status'],
    tags: doc['tags'],
    wordCount: doc['wordCount'],
    folderId: doc['folderId'],
    contentHash: doc['contentHash'],
    createdAt: doc['createdAt'],
    updatedAt: doc['updatedAt'],
    finalisedAt: doc['finalisedAt'],
    signedAt: doc['signedAt'],
    lockedAt: doc['lockedAt'],
    layout: normalizeDocumentLayout(doc['layout']),
    signatureSnapshot: null,
  };
}

// ─── Document access summary ────────────────────────────────────────────────

/**
 * Builds the `access` block returned alongside each document, describing how
 * the calling user can interact with it (owner vs collaborator, role,
 * permissions, who shared it).
 *
 * @param userId - Authenticated user the summary is being computed for.
 * @param document - Document row with optional collaborator slice already loaded.
 * @returns Access summary including resolved permissions and inviter identity.
 */
export function buildDocumentAccessSummary(
  userId: string,
  document: {
    ownerId: string;
    collaborators?: DocumentAccessCollaboratorSummary[];
  },
) {
  const isOwner = document.ownerId === userId;
  const collaborator =
    document.collaborators?.find((entry) => entry.userId === userId) ?? null;

  return {
    isOwner,
    role: isOwner ? 'OWNER' : (collaborator?.role ?? null),
    collaboratorId: collaborator?.id ?? null,
    permissions: isOwner
      ? DOCUMENT_PERMISSION_ORDER
      : collaborator
        ? getEffectiveDocumentPermissions(collaborator)
        : [],
    acceptedAt: collaborator?.acceptedAt ?? null,
    sharedBy:
      !isOwner && collaborator?.invitedBy
        ? {
            id: collaborator.invitedBy.id,
            email: collaborator.invitedBy.email,
            displayName: getDocumentInviterDisplayName(collaborator.invitedBy),
          }
        : null,
  };
}
