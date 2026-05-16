/**
 * DocumentsService
 *
 * Owns the full document lifecycle: creation, autosave, version history,
 * sharing, invitation gating, signing/locking workflow, and verification.
 *
 * Most pure logic lives in the sibling `helpers/` directory. This file
 * focuses on the orchestration: Prisma reads/writes, S3 access, audit
 * logging, mailer dispatch, and applying the rules from those helpers.
 */
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { JwtService } from '@nestjs/jwt';
import {
  CollaboratorInvitationStatus,
  CollaboratorPermission,
  CollaboratorRole,
  DocumentAccessAuditEvent,
  DocumentInvitationVerificationRequirement,
  DocumentStatus,
  Prisma,
  SignatureRequestStatus,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { S3Service } from '../../common/s3/s3.service';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { AppMailerService } from '../../common/mailer/mailer.service';
import {
  hashDocumentContent,
  documentContentKey,
  documentVersionKey,
} from '../../common/helpers/hash.helper';
import { CreateDocumentDto } from './dto/create-document.dto';
import {
  UpdateDocumentDto,
  AutosaveDocumentDto,
  UpdateSignatureLayoutDto,
} from './dto/update-document.dto';
import { FinaliseDocumentDto } from './dto/finalise-document.dto';
import { SignDocumentDto } from './dto/sign-document.dto';
import { QueryDocumentsDto } from './dto/query-documents.dto';
import {
  ShareDocumentAccessDto,
  UpdateDocumentAccessDto,
  type CollaboratorPermissionValue,
} from './dto/manage-access.dto';
import { CreateDocumentCommentDto } from './dto/document-comment.dto';
import {
  RequestInvitationEmailOtpDto,
  VerifyInvitationEmailOtpDto,
} from './dto/invitation-email-otp.dto';
import type { RequestUser } from '../auth/interfaces/jwt-payload.interface';
// ─── Helper modules ─────────────────────────────────────────────────────────
//
// Permission rules, signing rules, invitation/OTP rules, and access
// formatting all live in dedicated pure helpers under ./helpers. The service
// composes them; it does not reimplement them.
import {
  deriveCollaboratorRoleFromPermissions,
  getEffectiveDocumentPermissions,
  getLegacyPermissionsForRole,
  hasDocumentPermission,
  normalizeDocumentPermissions,
  type DocumentPermissionRecord,
} from './helpers/document-permissions.helper';
import {
  buildRequiredSignerIds,
  canDocumentAcceptNewSignature,
  collaboratorRequiresSignature as collaboratorRequiresSignatureRule,
  evaluateSigningReadiness,
  evaluateLockDocument,
  resolveSigningStatusUpdate,
  type SigningReadinessDecision,
} from './helpers/document-signing.helper';
import {
  evaluateInvitationEmailOtpRequest,
  evaluateInvitationEmailOtpVerification,
  evaluateInvitationLookupState,
  evaluateInvitationReviewAccess,
  isValidInvitationTokenFormat,
  normalizeInvitationVerificationRequirements,
  requiresInvitationEmailOtp,
  requiresInvitationIdentityVerification,
  resolveInvitationEmailOtpResendAvailableAt as resolveInvitationEmailOtpResendAvailableAtRule,
  resolveInvitationGateNextStep,
  resolveInvitationVerificationSessionExpiry as resolveInvitationVerificationSessionExpiryRule,
} from './helpers/document-invitation.helper';
import {
  describeDocumentPermissions,
  describeInvitationExpiryDuration,
  formatDocumentUserDisplayName,
  getDocumentInviterDisplayName,
  maskDocumentRecipientEmail,
  resolveDocumentAuditLimit,
  sanitizeDocumentAccessAuditMetadata,
} from './helpers/document-access-formatting.helper';
import { extractBearerToken } from './helpers/document-auth.helper';
import {
  alignmentToSignaturePosition,
  buildNextCopyTitleFromExistingTitles,
  DEFAULT_SIGNATURE_X,
  DEFAULT_SIGNATURE_Y,
  EMPTY_RICH_TEXT_CONTENT,
  EMPTY_SPREADSHEET_CONTENT,
  resolveTemplateVariables,
  stripCopySuffix,
} from './helpers/document-content.helper';
import {
  DEFAULT_DOCUMENT_LAYOUT,
  mergeDocumentLayout,
  normalizeDocumentLayout,
} from './helpers/document-layout.helper';
import {
  buildDocumentAccessSummary,
  formatAuditUser,
  formatCollaboratorAccess,
  formatDocumentComment,
  formatDocumentRecord,
  formatSignatureRequestSummary,
} from './helpers/document-format.helper';
import {
  buildDocumentEditUrl,
  buildInvitationExpiry,
  buildInvitationUrl,
} from './helpers/document-url.helper';
import {
  getSignatureReminderRequestId,
  SIGNATURE_REMINDER_COOLDOWN_MS,
} from './helpers/document-signature-reminder.helper';
import {
  COMPLETED_SIGNATURE_SELECT,
  SIGNATURE_REQUEST_PROGRESS_SELECT,
  SIGNATURE_REQUEST_SUMMARY_SELECT,
  type AccessAuditContext,
  type CollaboratorWithProfile,
  type CompletedSignatureRecord,
  type CompletedSignatureSummary,
  type InvitationLookupRecord,
  type InvitationVerificationSessionRecord,
  type SignatureRequestSummary,
  type SignedDocumentForLock,
} from './helpers/document-record.types';
import { DocumentQueryService } from './document-query.service';

// ─── Tunables specific to invitation OTP gating ─────────────────────────────
//
// These are kept here because they are passed into the invitation helper
// rules per-call. Promoting them to env vars later will only require touching
// this block.

const INVITATION_EMAIL_OTP_LENGTH = 6;
const INVITATION_EMAIL_OTP_EXPIRY_MS = 10 * 60 * 1000;
const INVITATION_EMAIL_OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const INVITATION_EMAIL_OTP_MAX_REQUESTS_PER_HOUR = 3;
const INVITATION_EMAIL_OTP_MAX_ATTEMPTS = 5;
const INVITATION_VERIFICATION_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly maxVersions: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
    private readonly mailer: AppMailerService,
    private readonly jwt: JwtService,
    private readonly documentQuery: DocumentQueryService,
  ) {
    this.maxVersions = this.config.get<number>('MAX_VERSIONS_PER_DOCUMENT', 50);
  }

  // ─── Create ──────────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateDocumentDto) {
    // Validate folder ownership if provided
    if (dto.folderId) {
      await this.assertFolderOwner(userId, dto.folderId);
    }

    // Determine initial content
    let initialContent: unknown =
      dto.type === 'RICH_TEXT'
        ? EMPTY_RICH_TEXT_CONTENT
        : EMPTY_SPREADSHEET_CONTENT;

    // If creating from a template, fetch and resolve it
    if (dto.templateId) {
      const template = await this.prisma.documentTemplate.findUnique({
        where: { id: dto.templateId },
      });
      if (!template) throw new NotFoundException('Template not found.');
      if (template.type !== dto.type) {
        throw new BadRequestException(
          `Template type (${template.type}) does not match requested document type (${dto.type}).`,
        );
      }

      // Resolve template variables
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { citizenIdentity: true, platformId: true },
      });

      initialContent = resolveTemplateVariables(
        template.contentJson as Record<string, unknown>,
        {
          USER_FULL_NAME:
            `${user?.citizenIdentity?.postNames ?? ''} ${user?.citizenIdentity?.surName ?? ''}`.trim(),
          USER_PLATFORM_ID: user?.platformId?.pidEncrypted ?? '',
          DATE: new Date().toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }),
        },
      );

      // Increment template usage count
      await this.prisma.documentTemplate.update({
        where: { id: dto.templateId },
        data: { usageCount: { increment: 1 } },
      });
    }

    // Create the document record
    const document = await this.prisma.document.create({
      data: {
        ownerId: userId,
        title: dto.title ?? 'Untitled Document',
        type: dto.type,
        status: 'DRAFT',
        folderId: dto.folderId,
        tags: dto.tags ?? [],
        layout: DEFAULT_DOCUMENT_LAYOUT as Prisma.InputJsonValue,
      },
    });

    // Write initial content to S3
    const contentKey = documentContentKey(document.id);
    await this.s3.putJson(contentKey, initialContent);

    // Update the document with the S3 key
    const updated = await this.prisma.document.update({
      where: { id: document.id },
      data: { s3ContentKey: contentKey },
    });

    // Create first version snapshot
    await this.createVersionSnapshot(document.id, userId, initialContent, 1);

    return formatDocumentRecord(updated);
  }

  async makeCopy(userId: string, documentId: string) {
    const source = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!source || source.isDeleted) {
      throw new NotFoundException('Document not found.');
    }

    await this.assertCanRead(userId, documentId, source.ownerId);

    const content = source.s3ContentKey
      ? await this.s3.getJson(source.s3ContentKey)
      : source.type === 'RICH_TEXT'
        ? EMPTY_RICH_TEXT_CONTENT
        : EMPTY_SPREADSHEET_CONTENT;

    const baseTitle = stripCopySuffix(source.title);
    const title = await this.buildNextCopyTitle(userId, baseTitle);
    const folderId = await this.resolveCopyFolderId(userId, source);

    const copy = await this.prisma.document.create({
      data: {
        ownerId: userId,
        title,
        type: source.type,
        status: 'DRAFT',
        folderId,
        tags: source.tags,
        wordCount: source.wordCount,
        layout: normalizeDocumentLayout(source.layout) as Prisma.InputJsonValue,
      },
    });

    const contentKey = documentContentKey(copy.id);
    await this.s3.putJson(contentKey, content);

    const updated = await this.prisma.document.update({
      where: { id: copy.id },
      data: { s3ContentKey: contentKey },
    });

    await this.createVersionSnapshot(copy.id, userId, content, 1);

    return formatDocumentRecord(updated);
  }

  // ─── List ────────────────────────────────────────────────────────────────────

  async findAll(userId: string, dto: QueryDocumentsDto) {
    return this.documentQuery.findAll(userId, dto);
  }

  // ─── Get one ─────────────────────────────────────────────────────────────────

  async findOne(userId: string, documentId: string, includeContent = true) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        collaborators: {
          select: {
            id: true,
            userId: true,
            role: true,
            permissions: true,
            invitationStatus: true,
            requiredVerifications: true,
            invitationExpiresAt: true,
            invitationEmailSentAt: true,
            invitationOpenedAt: true,
            invitedAt: true,
            isActive: true,
            acceptedAt: true,
            declinedAt: true,
            revokedAt: true,
            note: true,
            user: {
              select: {
                email: true,
                imageUrl: true,
                citizenIdentity: {
                  select: { surName: true, postNames: true },
                },
              },
            },
            invitedBy: {
              select: {
                id: true,
                email: true,
                citizenIdentity: {
                  select: { surName: true, postNames: true },
                },
              },
            },
          },
        },
        signatureRequests: {
          orderBy: { createdAt: 'asc' },
          select: SIGNATURE_REQUEST_SUMMARY_SELECT,
        },
      },
    });

    if (!document || document.isDeleted) {
      throw new NotFoundException('Document not found.');
    }

    await this.assertCanRead(userId, documentId, document.ownerId);

    const canManageAccess =
      document.ownerId === userId ||
      (await this.hasCollaboratorPermission(
        userId,
        documentId,
        CollaboratorPermission.MANAGE_ACCESS,
      ));
    const result: Record<string, unknown> = formatDocumentRecord(document);
    result['access'] = buildDocumentAccessSummary(userId, document);
    result['signatureRequests'] = canManageAccess
      ? await this.getSignatureRequestSummaries(documentId, true)
      : document.signatureRequests;
    result['collaborators'] = canManageAccess
      ? document.collaborators.map((collaborator) =>
          formatCollaboratorAccess(collaborator),
        )
      : [];

    // Fetch content from S3 if requested and key exists. This must fail
    // loudly: returning `content: null` makes the editor render a blank page
    // and can hide storage credential or object-loss incidents.
    if (includeContent && document.s3ContentKey) {
      try {
        result['content'] = await this.s3.getJson(document.s3ContentKey);
      } catch (error) {
        this.logger.error(
          `Failed to fetch content for document ${documentId} from ${document.s3ContentKey}`,
          error,
        );
        throw new ServiceUnavailableException(
          'Document content storage is temporarily unavailable. Please contact support if this continues.',
        );
      }
    }

    result['signatureSnapshot'] = await this.buildSignatureSnapshot(document);
    result['completedSignatures'] = await this.getCompletedSignatureSummaries(
      documentId,
      document.ownerId,
    );

    return result;
  }

  async getAccessList(userId: string, documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        ownerId: true,
        title: true,
        isDeleted: true,
        collaborators: {
          orderBy: { invitedAt: 'desc' },
          select: {
            id: true,
            userId: true,
            role: true,
            permissions: true,
            invitationStatus: true,
            requiredVerifications: true,
            invitationExpiresAt: true,
            invitationEmailSentAt: true,
            invitationOpenedAt: true,
            invitedAt: true,
            acceptedAt: true,
            declinedAt: true,
            revokedAt: true,
            note: true,
            isActive: true,
            user: {
              select: {
                email: true,
                imageUrl: true,
                citizenIdentity: {
                  select: { surName: true, postNames: true },
                },
              },
            },
            invitedBy: {
              select: {
                id: true,
                email: true,
                citizenIdentity: {
                  select: { surName: true, postNames: true },
                },
              },
            },
          },
        },
      },
    });

    if (!document || document.isDeleted) {
      throw new NotFoundException('Document not found.');
    }

    await this.assertCanManageAccess(userId, documentId, document.ownerId);

    return {
      documentId: document.id,
      title: document.title,
      collaborators: document.collaborators.map((collaborator) =>
        formatCollaboratorAccess(collaborator),
      ),
    };
  }

  async getAccessAuditLog(
    userId: string,
    documentId: string,
    rawLimit?: string,
  ) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, ownerId: true, title: true, isDeleted: true },
    });

    if (!document || document.isDeleted) {
      throw new NotFoundException('Document not found.');
    }

    if (document.ownerId !== userId) {
      throw new ForbiddenException(
        'Only the document owner can view the access audit trail.',
      );
    }

    const limit = resolveDocumentAuditLimit(rawLimit);
    const events = await this.prisma.documentAccessAuditLog.findMany({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        eventType: true,
        fromPermissions: true,
        toPermissions: true,
        invitationStatus: true,
        metadata: true,
        createdAt: true,
        actorUser: {
          select: {
            id: true,
            email: true,
            citizenIdentity: {
              select: { surName: true, postNames: true },
            },
          },
        },
        targetUser: {
          select: {
            id: true,
            email: true,
            citizenIdentity: {
              select: { surName: true, postNames: true },
            },
          },
        },
      },
    });

    return {
      documentId: document.id,
      title: document.title,
      events: events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        fromPermissions: event.fromPermissions,
        toPermissions: event.toPermissions,
        invitationStatus: event.invitationStatus,
        metadata: this.sanitizeAccessAuditMetadata(event.metadata),
        createdAt: event.createdAt,
        actor: event.actorUser ? formatAuditUser(event.actorUser) : null,
        target: event.targetUser ? formatAuditUser(event.targetUser) : null,
      })),
    };
  }

  async listComments(userId: string, documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, ownerId: true, isDeleted: true },
    });

    if (!document || document.isDeleted) {
      throw new NotFoundException('Document not found.');
    }

    await this.assertCanRead(userId, documentId, document.ownerId);

    const comments = await this.prisma.documentComment.findMany({
      where: { documentId, parentCommentId: null },
      orderBy: { createdAt: 'desc' },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            imageUrl: true,
            citizenIdentity: {
              select: { surName: true, postNames: true },
            },
          },
        },
        replies: {
          orderBy: { createdAt: 'asc' },
          include: {
            author: {
              select: {
                id: true,
                email: true,
                imageUrl: true,
                citizenIdentity: {
                  select: { surName: true, postNames: true },
                },
              },
            },
          },
        },
      },
    });

    return {
      documentId,
      comments: comments
        .sort((left, right) => {
          const leftResolved = left.resolvedAt ? 1 : 0;
          const rightResolved = right.resolvedAt ? 1 : 0;
          if (leftResolved !== rightResolved)
            return leftResolved - rightResolved;
          return right.createdAt.getTime() - left.createdAt.getTime();
        })
        .map((comment) => formatDocumentComment(comment)),
    };
  }

  async createComment(
    userId: string,
    documentId: string,
    dto: CreateDocumentCommentDto,
  ) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, ownerId: true, isDeleted: true },
    });

    if (!document || document.isDeleted) {
      throw new NotFoundException('Document not found.');
    }

    await this.assertCanComment(userId, documentId, document.ownerId);

    const content = dto.content.trim();
    if (!content) {
      throw new BadRequestException('Comment cannot be empty.');
    }

    const parentCommentId = dto.parentCommentId?.trim() || null;
    if (parentCommentId) {
      const parent = await this.prisma.documentComment.findFirst({
        where: { id: parentCommentId, documentId },
        select: {
          id: true,
          parentCommentId: true,
          resolvedAt: true,
        },
      });

      if (!parent) {
        throw new NotFoundException('Parent comment not found.');
      }

      if (parent.parentCommentId) {
        throw new BadRequestException(
          'Replies can only be added to top-level comments.',
        );
      }

      if (parent.resolvedAt) {
        throw new ConflictException(
          'Resolved comments cannot receive replies.',
        );
      }
    }

    const anchorText = dto.anchorText?.trim() || null;
    const hasAnchorPositions =
      Number.isInteger(dto.anchorFrom) && Number.isInteger(dto.anchorTo);
    const anchorFrom = hasAnchorPositions ? dto.anchorFrom! : null;
    const anchorTo = hasAnchorPositions ? dto.anchorTo! : null;
    if (
      hasAnchorPositions &&
      (anchorFrom === null || anchorTo === null || anchorFrom >= anchorTo)
    ) {
      throw new BadRequestException('Invalid comment anchor selection.');
    }

    const comment = await this.prisma.documentComment.create({
      data: {
        documentId,
        authorId: userId,
        parentCommentId,
        anchorText,
        anchorFrom,
        anchorTo,
        content,
      },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            imageUrl: true,
            citizenIdentity: {
              select: { surName: true, postNames: true },
            },
          },
        },
        replies: {
          include: {
            author: {
              select: {
                id: true,
                email: true,
                imageUrl: true,
                citizenIdentity: {
                  select: { surName: true, postNames: true },
                },
              },
            },
          },
        },
      },
    });

    await this.recordAccessAudit({
      documentId,
      collaboratorId: null,
      actorUserId: userId,
      targetUserId: userId,
      eventType: parentCommentId
        ? DocumentAccessAuditEvent.COMMENT_REPLIED
        : DocumentAccessAuditEvent.COMMENT_CREATED,
      fromPermissions: [],
      toPermissions: [],
      invitationStatus: null,
      metadata: {
        commentId: comment.id,
        parentCommentId,
        anchored: Boolean(
          anchorText && anchorFrom !== null && anchorTo !== null,
        ),
      },
    });

    return formatDocumentComment(comment);
  }

  async resolveComment(userId: string, documentId: string, commentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, ownerId: true, isDeleted: true },
    });

    if (!document || document.isDeleted) {
      throw new NotFoundException('Document not found.');
    }

    if (document.ownerId !== userId) {
      throw new ForbiddenException(
        'Only the document owner can resolve comments.',
      );
    }

    const existing = await this.prisma.documentComment.findFirst({
      where: { id: commentId, documentId, parentCommentId: null },
      select: { id: true, resolvedAt: true },
    });

    if (!existing) {
      throw new NotFoundException('Comment not found.');
    }

    const wasAlreadyResolved = Boolean(existing.resolvedAt);
    const comment = await this.prisma.documentComment.update({
      where: { id: existing.id },
      data: {
        resolvedAt: existing.resolvedAt ?? new Date(),
      },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            imageUrl: true,
            citizenIdentity: {
              select: { surName: true, postNames: true },
            },
          },
        },
        replies: {
          orderBy: { createdAt: 'asc' },
          include: {
            author: {
              select: {
                id: true,
                email: true,
                imageUrl: true,
                citizenIdentity: {
                  select: { surName: true, postNames: true },
                },
              },
            },
          },
        },
      },
    });

    if (!wasAlreadyResolved) {
      await this.recordAccessAudit({
        documentId,
        collaboratorId: null,
        actorUserId: userId,
        targetUserId: comment.authorId,
        eventType: DocumentAccessAuditEvent.COMMENT_RESOLVED,
        fromPermissions: [],
        toPermissions: [],
        invitationStatus: null,
        metadata: {
          commentId: comment.id,
          resolvedAt:
            comment.resolvedAt?.toISOString() ?? new Date().toISOString(),
        },
      });
    }

    return formatDocumentComment(comment);
  }

  async shareAccess(
    actorUserId: string,
    documentId: string,
    dto: ShareDocumentAccessDto,
    context: AccessAuditContext = {},
  ) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, ownerId: true, isDeleted: true },
    });

    if (!document || document.isDeleted) {
      throw new NotFoundException('Document not found.');
    }

    await this.assertCanManageAccess(actorUserId, documentId, document.ownerId);
    const actorIsOwner = actorUserId === document.ownerId;

    if (dto.userId === document.ownerId) {
      throw new BadRequestException(
        'The document owner already has full control and cannot be invited.',
      );
    }

    const recipient = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: {
        id: true,
        email: true,
        isActive: true,
        isVerified: true,
        imageUrl: true,
        citizenIdentity: {
          select: { surName: true, postNames: true },
        },
      },
    });

    if (!recipient || !recipient.isActive || !recipient.isVerified) {
      throw new NotFoundException(
        'Recipient not found or not eligible for collaboration.',
      );
    }

    const permissions = this.normalizePermissions(dto.permissions);
    if (
      !actorIsOwner &&
      permissions.includes(CollaboratorPermission.MANAGE_ACCESS)
    ) {
      throw new ForbiddenException(
        'Only the document owner can grant manage-access permission.',
      );
    }

    const role = this.deriveLegacyRole(permissions);
    const verificationRequirements =
      this.normalizeInvitationVerificationRequirements(
        dto.verificationRequirements,
      );
    const invitationExpiresAt = buildInvitationExpiry(dto.expiresInDays);

    const existing = await this.prisma.documentCollaborator.findUnique({
      where: { documentId_userId: { documentId, userId: dto.userId } },
      select: {
        id: true,
        userId: true,
        permissions: true,
        invitationStatus: true,
        requiredVerifications: true,
        acceptedAt: true,
        isActive: true,
      },
    });

    const requiresInviteEmail = !existing?.acceptedAt;
    const rawInvitationToken = requiresInviteEmail
      ? crypto.randomBytes(32).toString('hex')
      : null;
    const invitationTokenHash = rawInvitationToken
      ? this.encryption.hash(rawInvitationToken)
      : null;

    if (!actorIsOwner && dto.userId === actorUserId) {
      throw new ForbiddenException(
        'You cannot change your own document access level.',
      );
    }

    if (
      !actorIsOwner &&
      existing?.permissions.includes(CollaboratorPermission.MANAGE_ACCESS)
    ) {
      throw new ForbiddenException(
        'Only the document owner can modify another access manager.',
      );
    }

    const saved = existing
      ? await this.prisma.documentCollaborator.update({
          where: { id: existing.id },
          data: {
            role,
            permissions,
            requiredVerifications: verificationRequirements,
            invitedByUserId: actorUserId,
            invitationStatus: existing.acceptedAt
              ? CollaboratorInvitationStatus.ACCEPTED
              : CollaboratorInvitationStatus.PENDING,
            invitationExpiresAt,
            invitedAt: new Date(),
            note: dto.note?.trim() || null,
            declinedAt: null,
            revokedAt: null,
            invitationOpenedAt: null,
            invitationEmailSentAt: null,
            invitationTokenHash,
            acceptedAt: existing.acceptedAt,
            isActive: existing.acceptedAt ? true : false,
          },
          select: {
            id: true,
            userId: true,
            role: true,
            permissions: true,
            invitationStatus: true,
            requiredVerifications: true,
            invitationExpiresAt: true,
            invitationEmailSentAt: true,
            invitationOpenedAt: true,
            invitedAt: true,
            acceptedAt: true,
            declinedAt: true,
            revokedAt: true,
            note: true,
            isActive: true,
            user: {
              select: {
                email: true,
                imageUrl: true,
                citizenIdentity: {
                  select: { surName: true, postNames: true },
                },
              },
            },
            invitedBy: {
              select: {
                id: true,
                email: true,
                citizenIdentity: {
                  select: { surName: true, postNames: true },
                },
              },
            },
          },
        })
      : await this.prisma.documentCollaborator.create({
          data: {
            documentId,
            userId: dto.userId,
            role,
            permissions,
            requiredVerifications: verificationRequirements,
            invitedByUserId: actorUserId,
            invitationStatus: CollaboratorInvitationStatus.PENDING,
            invitationTokenHash,
            invitationExpiresAt,
            note: dto.note?.trim() || null,
          },
          select: {
            id: true,
            userId: true,
            role: true,
            permissions: true,
            invitationStatus: true,
            requiredVerifications: true,
            invitationExpiresAt: true,
            invitationEmailSentAt: true,
            invitationOpenedAt: true,
            invitedAt: true,
            acceptedAt: true,
            declinedAt: true,
            revokedAt: true,
            note: true,
            isActive: true,
            user: {
              select: {
                email: true,
                imageUrl: true,
                citizenIdentity: {
                  select: { surName: true, postNames: true },
                },
              },
            },
            invitedBy: {
              select: {
                id: true,
                email: true,
                citizenIdentity: {
                  select: { surName: true, postNames: true },
                },
              },
            },
          },
        });

    await this.recordAccessAudit({
      documentId,
      collaboratorId: saved.id,
      actorUserId,
      targetUserId: dto.userId,
      eventType: existing?.acceptedAt
        ? DocumentAccessAuditEvent.PERMISSIONS_UPDATED
        : DocumentAccessAuditEvent.INVITE_CREATED,
      fromPermissions: existing?.permissions ?? [],
      toPermissions: permissions,
      invitationStatus: saved.invitationStatus,
      metadata: {
        notePresent: Boolean(dto.note?.trim()),
        expiresAt: invitationExpiresAt.toISOString(),
        verificationRequirements,
      },
      ...context,
    });

    let finalCollaborator = saved;
    let emailStatus: 'sent' | 'failed' | 'not_required' = 'not_required';

    if (rawInvitationToken) {
      await this.recordAccessAudit({
        documentId,
        collaboratorId: saved.id,
        actorUserId,
        targetUserId: dto.userId,
        eventType: DocumentAccessAuditEvent.INVITE_EMAIL_QUEUED,
        fromPermissions: permissions,
        toPermissions: permissions,
        invitationStatus: saved.invitationStatus,
        metadata: null,
        ...context,
      });

      try {
        await this.mailer.sendDocumentInvitationEmail({
          to: recipient.email,
          recipientName: this.formatUserDisplayName(
            recipient.citizenIdentity?.postNames ?? null,
            recipient.citizenIdentity?.surName ?? null,
            recipient.email,
          ),
          senderName: this.getInviterDisplayName(saved.invitedBy),
          accessSummary: this.describePermissions(permissions),
          note: dto.note?.trim() || null,
          acceptUrl: buildInvitationUrl(
            this.resolveDocumentsFrontendUrl(),
            rawInvitationToken,
          ),
          expiresIn: this.describeInvitationExpiry(invitationExpiresAt),
        });

        finalCollaborator = await this.prisma.documentCollaborator.update({
          where: { id: saved.id },
          data: {
            invitationEmailSentAt: new Date(),
          },
          select: {
            id: true,
            userId: true,
            role: true,
            permissions: true,
            invitationStatus: true,
            requiredVerifications: true,
            invitationExpiresAt: true,
            invitationEmailSentAt: true,
            invitationOpenedAt: true,
            invitedAt: true,
            acceptedAt: true,
            declinedAt: true,
            revokedAt: true,
            note: true,
            isActive: true,
            user: {
              select: {
                email: true,
                imageUrl: true,
                citizenIdentity: {
                  select: { surName: true, postNames: true },
                },
              },
            },
            invitedBy: {
              select: {
                id: true,
                email: true,
                citizenIdentity: {
                  select: { surName: true, postNames: true },
                },
              },
            },
          },
        });

        emailStatus = 'sent';

        await this.recordAccessAudit({
          documentId,
          collaboratorId: saved.id,
          actorUserId,
          targetUserId: dto.userId,
          eventType: DocumentAccessAuditEvent.INVITE_EMAIL_SENT,
          fromPermissions: permissions,
          toPermissions: permissions,
          invitationStatus: finalCollaborator.invitationStatus,
          metadata: {
            sentAt:
              finalCollaborator.invitationEmailSentAt?.toISOString() ?? null,
          },
          ...context,
        });
      } catch (error) {
        emailStatus = 'failed';

        await this.recordAccessAudit({
          documentId,
          collaboratorId: saved.id,
          actorUserId,
          targetUserId: dto.userId,
          eventType: DocumentAccessAuditEvent.INVITE_EMAIL_FAILED,
          fromPermissions: permissions,
          toPermissions: permissions,
          invitationStatus: saved.invitationStatus,
          metadata: {
            message:
              error instanceof Error
                ? error.message
                : 'Invitation email delivery failed.',
          },
          ...context,
        });
      }
    }

    await this.reconcileSignatureRequestForCollaborator({
      documentId,
      userId: finalCollaborator.userId,
      permissions: finalCollaborator.permissions,
      invitationStatus: finalCollaborator.invitationStatus,
      acceptedAt: finalCollaborator.acceptedAt,
      isActive: finalCollaborator.isActive,
    });

    return {
      ...formatCollaboratorAccess(finalCollaborator),
      emailStatus,
    };
  }

  async updateAccess(
    actorUserId: string,
    documentId: string,
    collaboratorId: string,
    dto: UpdateDocumentAccessDto,
    context: AccessAuditContext = {},
  ) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, ownerId: true, isDeleted: true },
    });

    if (!document || document.isDeleted) {
      throw new NotFoundException('Document not found.');
    }

    await this.assertCanManageAccess(actorUserId, documentId, document.ownerId);
    const actorIsOwner = actorUserId === document.ownerId;

    const collaborator = await this.prisma.documentCollaborator.findFirst({
      where: { id: collaboratorId, documentId },
      select: {
        id: true,
        userId: true,
        permissions: true,
        acceptedAt: true,
        invitationStatus: true,
      },
    });

    if (!collaborator) {
      throw new NotFoundException('Collaborator not found.');
    }

    const permissions = this.normalizePermissions(dto.permissions);
    if (!actorIsOwner && collaborator.userId === actorUserId) {
      throw new ForbiddenException(
        'You cannot change your own document access level.',
      );
    }

    if (!actorIsOwner) {
      const touchesManageAccess =
        collaborator.permissions.includes(
          CollaboratorPermission.MANAGE_ACCESS,
        ) || permissions.includes(CollaboratorPermission.MANAGE_ACCESS);

      if (touchesManageAccess) {
        throw new ForbiddenException(
          'Only the document owner can grant or modify manage-access permission.',
        );
      }
    }

    const updated = await this.prisma.documentCollaborator.update({
      where: { id: collaborator.id },
      data: {
        role: this.deriveLegacyRole(permissions),
        permissions,
      },
      select: {
        id: true,
        userId: true,
        role: true,
        permissions: true,
        invitationStatus: true,
        requiredVerifications: true,
        invitationExpiresAt: true,
        invitationEmailSentAt: true,
        invitationOpenedAt: true,
        invitedAt: true,
        acceptedAt: true,
        declinedAt: true,
        revokedAt: true,
        note: true,
        isActive: true,
        user: {
          select: {
            email: true,
            imageUrl: true,
            citizenIdentity: {
              select: { surName: true, postNames: true },
            },
          },
        },
        invitedBy: {
          select: {
            id: true,
            email: true,
            citizenIdentity: {
              select: { surName: true, postNames: true },
            },
          },
        },
      },
    });

    await this.recordAccessAudit({
      documentId,
      collaboratorId: collaborator.id,
      actorUserId,
      targetUserId: collaborator.userId,
      eventType: DocumentAccessAuditEvent.PERMISSIONS_UPDATED,
      fromPermissions: collaborator.permissions,
      toPermissions: permissions,
      invitationStatus: collaborator.invitationStatus,
      metadata: {
        accepted: Boolean(collaborator.acceptedAt),
      },
      ...context,
    });

    await this.reconcileSignatureRequestForCollaborator({
      documentId,
      userId: updated.userId,
      permissions: updated.permissions,
      invitationStatus: updated.invitationStatus,
      acceptedAt: updated.acceptedAt,
      isActive: updated.isActive,
    });

    return formatCollaboratorAccess(updated);
  }

  async resendAccessInvitation(
    actorUserId: string,
    documentId: string,
    collaboratorId: string,
    context: AccessAuditContext = {},
  ) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, ownerId: true, isDeleted: true },
    });

    if (!document || document.isDeleted) {
      throw new NotFoundException('Document not found.');
    }

    await this.assertCanManageAccess(actorUserId, documentId, document.ownerId);
    const actorIsOwner = actorUserId === document.ownerId;

    const collaborator = await this.prisma.documentCollaborator.findFirst({
      where: { id: collaboratorId, documentId },
      select: {
        id: true,
        userId: true,
        permissions: true,
        invitationStatus: true,
        requiredVerifications: true,
        acceptedAt: true,
        isActive: true,
        note: true,
        user: {
          select: {
            email: true,
            imageUrl: true,
            citizenIdentity: {
              select: { surName: true, postNames: true },
            },
          },
        },
      },
    });

    if (!collaborator) {
      throw new NotFoundException('Collaborator not found.');
    }

    if (
      collaborator.isActive &&
      collaborator.acceptedAt &&
      collaborator.invitationStatus === CollaboratorInvitationStatus.ACCEPTED
    ) {
      throw new ConflictException(
        'This collaborator has already accepted access. Update permissions instead.',
      );
    }

    if (!actorIsOwner && collaborator.userId === actorUserId) {
      throw new ForbiddenException(
        'You cannot resend an invitation to yourself.',
      );
    }

    if (
      !actorIsOwner &&
      collaborator.permissions.includes(CollaboratorPermission.MANAGE_ACCESS)
    ) {
      throw new ForbiddenException(
        'Only the document owner can resend an invitation for another access manager.',
      );
    }

    const rawInvitationToken = crypto.randomBytes(32).toString('hex');
    const invitationTokenHash = this.encryption.hash(rawInvitationToken);
    const invitationExpiresAt = buildInvitationExpiry();
    const previousStatus = collaborator.invitationStatus;

    const saved = await this.prisma.documentCollaborator.update({
      where: { id: collaborator.id },
      data: {
        invitedByUserId: actorUserId,
        invitationStatus: CollaboratorInvitationStatus.PENDING,
        invitationTokenHash,
        invitationExpiresAt,
        invitationOpenedAt: null,
        invitationEmailSentAt: null,
        invitedAt: new Date(),
        acceptedAt: null,
        declinedAt: null,
        revokedAt: null,
        isActive: false,
      },
      select: {
        id: true,
        userId: true,
        role: true,
        permissions: true,
        invitationStatus: true,
        requiredVerifications: true,
        invitationExpiresAt: true,
        invitationEmailSentAt: true,
        invitationOpenedAt: true,
        invitedAt: true,
        acceptedAt: true,
        declinedAt: true,
        revokedAt: true,
        note: true,
        isActive: true,
        user: {
          select: {
            email: true,
            imageUrl: true,
            citizenIdentity: {
              select: { surName: true, postNames: true },
            },
          },
        },
        invitedBy: {
          select: {
            id: true,
            email: true,
            citizenIdentity: {
              select: { surName: true, postNames: true },
            },
          },
        },
      },
    });

    await this.recordAccessAudit({
      documentId,
      collaboratorId: saved.id,
      actorUserId,
      targetUserId: saved.userId,
      eventType: DocumentAccessAuditEvent.INVITE_CREATED,
      fromPermissions: collaborator.permissions,
      toPermissions: saved.permissions,
      invitationStatus: saved.invitationStatus,
      metadata: {
        resent: true,
        previousStatus,
        expiresAt: invitationExpiresAt.toISOString(),
        verificationRequirements: collaborator.requiredVerifications,
      },
      ...context,
    });

    await this.recordAccessAudit({
      documentId,
      collaboratorId: saved.id,
      actorUserId,
      targetUserId: saved.userId,
      eventType: DocumentAccessAuditEvent.INVITE_EMAIL_QUEUED,
      fromPermissions: saved.permissions,
      toPermissions: saved.permissions,
      invitationStatus: saved.invitationStatus,
      metadata: { resent: true },
      ...context,
    });

    let finalCollaborator = saved;
    let emailStatus: 'sent' | 'failed' = 'sent';

    try {
      await this.mailer.sendDocumentInvitationEmail({
        to: collaborator.user.email,
        recipientName: this.formatUserDisplayName(
          collaborator.user.citizenIdentity?.postNames ?? null,
          collaborator.user.citizenIdentity?.surName ?? null,
          collaborator.user.email,
        ),
        senderName: this.getInviterDisplayName(saved.invitedBy),
        accessSummary: this.describePermissions(saved.permissions),
        note: saved.note,
        acceptUrl: buildInvitationUrl(
          this.resolveDocumentsFrontendUrl(),
          rawInvitationToken,
        ),
        expiresIn: this.describeInvitationExpiry(invitationExpiresAt),
      });

      finalCollaborator = await this.prisma.documentCollaborator.update({
        where: { id: saved.id },
        data: { invitationEmailSentAt: new Date() },
        select: {
          id: true,
          userId: true,
          role: true,
          permissions: true,
          invitationStatus: true,
          requiredVerifications: true,
          invitationExpiresAt: true,
          invitationEmailSentAt: true,
          invitationOpenedAt: true,
          invitedAt: true,
          acceptedAt: true,
          declinedAt: true,
          revokedAt: true,
          note: true,
          isActive: true,
          user: {
            select: {
              email: true,
              imageUrl: true,
              citizenIdentity: {
                select: { surName: true, postNames: true },
              },
            },
          },
          invitedBy: {
            select: {
              id: true,
              email: true,
              citizenIdentity: {
                select: { surName: true, postNames: true },
              },
            },
          },
        },
      });

      await this.recordAccessAudit({
        documentId,
        collaboratorId: saved.id,
        actorUserId,
        targetUserId: saved.userId,
        eventType: DocumentAccessAuditEvent.INVITE_EMAIL_SENT,
        fromPermissions: saved.permissions,
        toPermissions: saved.permissions,
        invitationStatus: finalCollaborator.invitationStatus,
        metadata: {
          resent: true,
          sentAt:
            finalCollaborator.invitationEmailSentAt?.toISOString() ?? null,
        },
        ...context,
      });
    } catch {
      emailStatus = 'failed';

      await this.recordAccessAudit({
        documentId,
        collaboratorId: saved.id,
        actorUserId,
        targetUserId: saved.userId,
        eventType: DocumentAccessAuditEvent.INVITE_EMAIL_FAILED,
        fromPermissions: saved.permissions,
        toPermissions: saved.permissions,
        invitationStatus: saved.invitationStatus,
        metadata: {
          resent: true,
          message: 'Invitation email delivery failed.',
        },
        ...context,
      });
    }

    return {
      ...formatCollaboratorAccess(finalCollaborator),
      emailStatus,
    };
  }

  async sendSignatureReminder(
    actorUserId: string,
    documentId: string,
    requestId: string,
    context: AccessAuditContext = {},
  ) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        ownerId: true,
        title: true,
        status: true,
        isDeleted: true,
      },
    });

    if (!document || document.isDeleted) {
      throw new NotFoundException('Document not found.');
    }

    await this.assertCanManageAccess(actorUserId, documentId, document.ownerId);

    if (document.status !== DocumentStatus.FINALISED) {
      throw new ConflictException(
        'Signature reminders can only be sent while a finalised document is waiting for signatures.',
      );
    }

    const request = await this.prisma.documentSignatureRequest.findFirst({
      where: { id: requestId, documentId },
      select: {
        id: true,
        requestedUserId: true,
        status: true,
        requestedUser: {
          select: {
            email: true,
            citizenIdentity: {
              select: { surName: true, postNames: true },
            },
          },
        },
      },
    });

    if (!request) {
      throw new NotFoundException('Signature request not found.');
    }

    if (request.status === SignatureRequestStatus.SIGNED) {
      throw new ConflictException('This signer has already completed signing.');
    }

    await this.assertSignatureReminderTargetIsEligible(
      documentId,
      document.ownerId,
      request.requestedUserId,
    );
    await this.assertSignatureReminderCooldown(
      documentId,
      request.id,
      request.requestedUserId,
    );

    const actor = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: {
        email: true,
        citizenIdentity: {
          select: { surName: true, postNames: true },
        },
      },
    });
    const sentAt = new Date();

    try {
      await this.mailer.sendDocumentSignatureReminderEmail({
        to: request.requestedUser.email,
        recipientName: this.formatUserDisplayName(
          request.requestedUser.citizenIdentity?.postNames ?? null,
          request.requestedUser.citizenIdentity?.surName ?? null,
          request.requestedUser.email,
        ),
        senderName: this.formatUserDisplayName(
          actor?.citizenIdentity?.postNames ?? null,
          actor?.citizenIdentity?.surName ?? null,
          actor?.email ?? 'A document access manager',
        ),
        documentTitle: document.title,
        signUrl: buildDocumentEditUrl(
          this.resolveDocumentsFrontendUrl(),
          documentId,
        ),
      });

      await this.recordAccessAudit({
        documentId,
        collaboratorId: null,
        actorUserId,
        targetUserId: request.requestedUserId,
        eventType: DocumentAccessAuditEvent.SIGNATURE_REMINDER_SENT,
        fromPermissions: [],
        toPermissions: [CollaboratorPermission.SIGN],
        invitationStatus: null,
        metadata: {
          requestId: request.id,
          sentAt: sentAt.toISOString(),
        },
        ...context,
      });

      return {
        sent: true,
        requestId: request.id,
        sentAt,
        nextReminderAvailableAt: new Date(
          sentAt.getTime() + SIGNATURE_REMINDER_COOLDOWN_MS,
        ),
      };
    } catch (error: unknown) {
      await this.recordAccessAudit({
        documentId,
        collaboratorId: null,
        actorUserId,
        targetUserId: request.requestedUserId,
        eventType: DocumentAccessAuditEvent.SIGNATURE_REMINDER_FAILED,
        fromPermissions: [],
        toPermissions: [CollaboratorPermission.SIGN],
        invitationStatus: null,
        metadata: {
          requestId: request.id,
          message:
            error instanceof Error
              ? error.message
              : 'Signature reminder failed.',
        },
        ...context,
      });

      throw error;
    }
  }

  async revokeAccess(
    actorUserId: string,
    documentId: string,
    collaboratorId: string,
    context: AccessAuditContext = {},
  ) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, ownerId: true, isDeleted: true },
    });

    if (!document || document.isDeleted) {
      throw new NotFoundException('Document not found.');
    }

    await this.assertCanManageAccess(actorUserId, documentId, document.ownerId);
    const actorIsOwner = actorUserId === document.ownerId;

    const collaborator = await this.prisma.documentCollaborator.findFirst({
      where: { id: collaboratorId, documentId },
      select: {
        id: true,
        userId: true,
        permissions: true,
        invitationStatus: true,
      },
    });

    if (!collaborator) {
      throw new NotFoundException('Collaborator not found.');
    }

    if (!actorIsOwner && collaborator.userId === actorUserId) {
      throw new ForbiddenException('You cannot revoke your own access.');
    }

    if (
      !actorIsOwner &&
      collaborator.permissions.includes(CollaboratorPermission.MANAGE_ACCESS)
    ) {
      throw new ForbiddenException(
        'Only the document owner can revoke another access manager.',
      );
    }

    await this.prisma.documentCollaborator.update({
      where: { id: collaborator.id },
      data: {
        isActive: false,
        invitationStatus: CollaboratorInvitationStatus.REVOKED,
        revokedAt: new Date(),
      },
    });

    await this.recordAccessAudit({
      documentId,
      collaboratorId: collaborator.id,
      actorUserId,
      targetUserId: collaborator.userId,
      eventType: DocumentAccessAuditEvent.INVITE_REVOKED,
      fromPermissions: collaborator.permissions,
      toPermissions: collaborator.permissions,
      invitationStatus: CollaboratorInvitationStatus.REVOKED,
      metadata: null,
      ...context,
    });

    await this.removeUnsignedSignatureRequest(documentId, collaborator.userId);
    await this.syncDocumentSigningStatus(documentId);

    return { revoked: true, collaboratorId: collaborator.id };
  }

  async getInvitationPreview(
    rawToken: string,
    context: AccessAuditContext = {},
  ) {
    const invitation = await this.findInvitationByRawToken(rawToken);
    await this.recordInvitationOpened(invitation, context);

    return {
      status: 'pending',
      requiresAuthentication: true,
      invitation: {
        permissions: invitation.permissions,
        verificationRequirements: invitation.requiredVerifications,
        note: invitation.note,
        invitedAt: invitation.invitedAt,
        expiresAt: invitation.invitationExpiresAt,
      },
      sender: {
        email: invitation.invitedBy?.email ?? null,
        displayName: this.getInviterDisplayName(invitation.invitedBy),
      },
      recipient: {
        maskedEmail: this.maskEmail(invitation.user.email),
      },
    };
  }

  async getInvitationGateStatus(
    rawToken: string,
    authHeader?: string | null,
    context: AccessAuditContext = {},
  ) {
    const invitation = await this.findInvitationByRawToken(rawToken);
    await this.recordInvitationOpened(invitation, context);

    const sessionUser = await this.resolveInvitationSessionUser(authHeader);
    if (!sessionUser) {
      return {
        status: 'pending',
        nextStep: 'login',
        verificationRequirements: invitation.requiredVerifications,
        emailOtp: null,
        identityVerification: null,
      };
    }

    if (invitation.userId !== sessionUser.userId) {
      throw new ForbiddenException(
        'This invitation was issued to a different verified account.',
      );
    }

    const verificationSession = await this.ensureInvitationVerificationSession(
      invitation,
      sessionUser,
      context,
    );
    const preparedSession = await this.prepareInvitationGateSession(
      verificationSession,
      invitation,
      sessionUser.userId,
      context,
    );
    const syncedSession = await this.syncInvitationIdentityVerification(
      preparedSession,
      invitation,
      sessionUser.userId,
      context,
    );

    return this.formatInvitationGateStatus(
      invitation,
      syncedSession,
      sessionUser,
    );
  }

  async requestInvitationEmailOtp(
    rawToken: string,
    authHeader: string | null | undefined,
    dto: RequestInvitationEmailOtpDto,
    context: AccessAuditContext = {},
  ) {
    const sessionUser = await this.requireInvitationSessionUser(authHeader);
    const invitation = await this.getInvitationForRecipient(
      sessionUser.userId,
      rawToken,
    );
    const verificationSession = await this.ensureInvitationVerificationSession(
      invitation,
      sessionUser,
      context,
    );
    const requirements = normalizeInvitationVerificationRequirements(
      invitation.requiredVerifications,
    );

    if (!requiresInvitationEmailOtp(requirements)) {
      throw new BadRequestException(
        'Email verification is not required for this invitation.',
      );
    }

    const normalizedEmail = dto.email.trim().toLowerCase();
    const invitedEmail = invitation.user.email.trim().toLowerCase();
    const signedInEmail = sessionUser.email.trim().toLowerCase();

    if (normalizedEmail !== invitedEmail || normalizedEmail !== signedInEmail) {
      await this.recordAccessAudit({
        documentId: invitation.documentId,
        collaboratorId: invitation.id,
        actorUserId: sessionUser.userId,
        targetUserId: invitation.userId,
        eventType: DocumentAccessAuditEvent.INVITE_EMAIL_OTP_FAILED,
        fromPermissions: invitation.permissions,
        toPermissions: invitation.permissions,
        invitationStatus: invitation.invitationStatus,
        metadata: {
          reason: 'email_mismatch',
        },
        ...context,
      });

      throw new ForbiddenException(
        'Enter the invited account email before requesting a verification code.',
      );
    }

    if (verificationSession.emailOtpVerifiedAt) {
      const challengedSession = requiresInvitationIdentityVerification(
        requirements,
      )
        ? await this.beginInvitationIdentityChallenge(
            verificationSession,
            invitation,
            sessionUser.userId,
            context,
          )
        : verificationSession;
      const syncedSession = await this.syncInvitationIdentityVerification(
        challengedSession,
        invitation,
        sessionUser.userId,
        context,
      );

      return this.formatInvitationGateStatus(
        invitation,
        syncedSession,
        sessionUser,
      );
    }

    this.assertInvitationEmailOtpRequestAllowed(verificationSession);

    const rawCode = this.generateInvitationEmailOtp();
    const issuedAt = new Date();
    const expiresAt = new Date(
      issuedAt.getTime() + INVITATION_EMAIL_OTP_EXPIRY_MS,
    );
    const requestWindowStartedAt =
      verificationSession.emailOtpWindowStartedAt &&
      issuedAt.getTime() -
        verificationSession.emailOtpWindowStartedAt.getTime() <
        60 * 60 * 1000
        ? verificationSession.emailOtpWindowStartedAt
        : issuedAt;
    const requestCount =
      verificationSession.emailOtpWindowStartedAt &&
      requestWindowStartedAt.getTime() ===
        verificationSession.emailOtpWindowStartedAt.getTime()
        ? verificationSession.emailOtpRequestCount + 1
        : 1;

    const updatedSession =
      await this.prisma.documentInvitationVerificationSession.update({
        where: { collaboratorId: invitation.id },
        data: {
          emailOtpCodeHash: this.encryption.hash(rawCode),
          emailOtpSentAt: issuedAt,
          emailOtpExpiresAt: expiresAt,
          emailOtpAttemptCount: 0,
          emailOtpRequestCount: requestCount,
          emailOtpWindowStartedAt: requestWindowStartedAt,
        },
      });

    try {
      await this.mailer.sendInvitationEmailOtp({
        to: invitation.user.email,
        recipientName: this.formatUserDisplayName(
          invitation.user.citizenIdentity?.postNames ?? null,
          invitation.user.citizenIdentity?.surName ?? null,
          invitation.user.email,
        ),
        code: rawCode,
        expiresInMinutes: INVITATION_EMAIL_OTP_EXPIRY_MS / 60_000,
      });
    } catch {
      await this.prisma.documentInvitationVerificationSession.update({
        where: { collaboratorId: invitation.id },
        data: {
          emailOtpCodeHash: null,
          emailOtpSentAt: null,
          emailOtpExpiresAt: null,
        },
      });

      await this.recordAccessAudit({
        documentId: invitation.documentId,
        collaboratorId: invitation.id,
        actorUserId: sessionUser.userId,
        targetUserId: invitation.userId,
        eventType: DocumentAccessAuditEvent.INVITE_EMAIL_OTP_FAILED,
        fromPermissions: invitation.permissions,
        toPermissions: invitation.permissions,
        invitationStatus: invitation.invitationStatus,
        metadata: {
          reason: 'delivery_failed',
        },
        ...context,
      });

      throw new HttpException(
        'Unable to send the verification code right now.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    await this.recordAccessAudit({
      documentId: invitation.documentId,
      collaboratorId: invitation.id,
      actorUserId: sessionUser.userId,
      targetUserId: invitation.userId,
      eventType: DocumentAccessAuditEvent.INVITE_EMAIL_OTP_SENT,
      fromPermissions: invitation.permissions,
      toPermissions: invitation.permissions,
      invitationStatus: invitation.invitationStatus,
      metadata: {
        emailOtpSentAt: issuedAt.toISOString(),
        emailOtpExpiresAt: expiresAt.toISOString(),
      },
      ...context,
    });

    return this.formatInvitationGateStatus(
      invitation,
      updatedSession,
      sessionUser,
    );
  }

  async verifyInvitationEmailOtp(
    rawToken: string,
    authHeader: string | null | undefined,
    dto: VerifyInvitationEmailOtpDto,
    context: AccessAuditContext = {},
  ) {
    const sessionUser = await this.requireInvitationSessionUser(authHeader);
    const invitation = await this.getInvitationForRecipient(
      sessionUser.userId,
      rawToken,
    );
    const verificationSession = await this.ensureInvitationVerificationSession(
      invitation,
      sessionUser,
      context,
    );
    const requirements = normalizeInvitationVerificationRequirements(
      invitation.requiredVerifications,
    );

    if (!requiresInvitationEmailOtp(requirements)) {
      throw new BadRequestException(
        'Email verification is not required for this invitation.',
      );
    }

    const otpDecision = evaluateInvitationEmailOtpVerification({
      session: {
        emailOtpCodeHash: verificationSession.emailOtpCodeHash,
        emailOtpExpiresAt: verificationSession.emailOtpExpiresAt,
        emailOtpVerifiedAt: verificationSession.emailOtpVerifiedAt,
        emailOtpAttemptCount: verificationSession.emailOtpAttemptCount,
      },
      now: new Date(),
      isCodeMatch:
        verificationSession.emailOtpCodeHash !== null &&
        this.encryption.compareHash(
          dto.code,
          verificationSession.emailOtpCodeHash,
        ),
      maxAttempts: INVITATION_EMAIL_OTP_MAX_ATTEMPTS,
    });

    if (otpDecision.outcome === 'ALREADY_VERIFIED') {
      const syncedSession = await this.syncInvitationIdentityVerification(
        verificationSession,
        invitation,
        sessionUser.userId,
        context,
      );

      return this.formatInvitationGateStatus(
        invitation,
        syncedSession,
        sessionUser,
      );
    }

    if (otpDecision.outcome === 'REQUEST_REQUIRED') {
      throw new BadRequestException(
        'Request a verification code before continuing.',
      );
    }

    if (otpDecision.outcome === 'EXPIRED') {
      await this.prisma.documentInvitationVerificationSession.update({
        where: { collaboratorId: invitation.id },
        data: {
          emailOtpCodeHash: null,
          emailOtpExpiresAt: null,
          emailOtpAttemptCount: 0,
        },
      });

      await this.recordAccessAudit({
        documentId: invitation.documentId,
        collaboratorId: invitation.id,
        actorUserId: sessionUser.userId,
        targetUserId: invitation.userId,
        eventType: DocumentAccessAuditEvent.INVITE_EMAIL_OTP_FAILED,
        fromPermissions: invitation.permissions,
        toPermissions: invitation.permissions,
        invitationStatus: invitation.invitationStatus,
        metadata: {
          reason: 'expired',
        },
        ...context,
      });

      throw new BadRequestException(
        'The verification code has expired. Request a new code.',
      );
    }

    if (otpDecision.outcome === 'TOO_MANY_ATTEMPTS') {
      throw new HttpException(
        'Too many incorrect codes. Request a new verification code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (otpDecision.outcome === 'INVALID_CODE') {
      await this.prisma.documentInvitationVerificationSession.update({
        where: { collaboratorId: invitation.id },
        data: { emailOtpAttemptCount: otpDecision.nextAttemptCount },
      });

      await this.recordAccessAudit({
        documentId: invitation.documentId,
        collaboratorId: invitation.id,
        actorUserId: sessionUser.userId,
        targetUserId: invitation.userId,
        eventType: DocumentAccessAuditEvent.INVITE_EMAIL_OTP_FAILED,
        fromPermissions: invitation.permissions,
        toPermissions: invitation.permissions,
        invitationStatus: invitation.invitationStatus,
        metadata: {
          reason: 'invalid_code',
          remainingAttempts: otpDecision.remainingAttempts,
        },
        ...context,
      });

      throw new BadRequestException('Incorrect verification code.');
    }

    const verifiedAt = new Date();
    const identityRequired =
      requiresInvitationIdentityVerification(requirements);
    const emailVerifiedSession =
      await this.prisma.documentInvitationVerificationSession.update({
        where: { collaboratorId: invitation.id },
        data: {
          emailOtpCodeHash: null,
          emailOtpExpiresAt: null,
          emailOtpAttemptCount: 0,
          emailOtpVerifiedAt: verifiedAt,
          completedAt: identityRequired ? null : verifiedAt,
        },
      });

    await this.recordAccessAudit({
      documentId: invitation.documentId,
      collaboratorId: invitation.id,
      actorUserId: sessionUser.userId,
      targetUserId: invitation.userId,
      eventType: DocumentAccessAuditEvent.INVITE_EMAIL_OTP_PASSED,
      fromPermissions: invitation.permissions,
      toPermissions: invitation.permissions,
      invitationStatus: invitation.invitationStatus,
      metadata: {
        emailOtpVerifiedAt: verifiedAt.toISOString(),
      },
      ...context,
    });

    const challengedSession = identityRequired
      ? await this.beginInvitationIdentityChallenge(
          emailVerifiedSession,
          invitation,
          sessionUser.userId,
          context,
        )
      : emailVerifiedSession;

    const syncedSession = await this.syncInvitationIdentityVerification(
      challengedSession,
      invitation,
      sessionUser.userId,
      context,
    );

    return this.formatInvitationGateStatus(
      invitation,
      syncedSession,
      sessionUser,
    );
  }

  async getInvitationReview(
    userId: string,
    rawToken: string,
    context: AccessAuditContext = {},
  ) {
    const invitation = await this.getInvitationForCompletedReview(
      userId,
      rawToken,
    );
    const verificationSession =
      await this.prisma.documentInvitationVerificationSession.findUnique({
        where: { collaboratorId: invitation.id },
      });
    await this.recordInvitationOpened(invitation, context);

    return {
      status: 'pending',
      document: {
        id: invitation.document.id,
        title: invitation.document.title,
      },
      invitation: {
        permissions: invitation.permissions,
        verificationRequirements: invitation.requiredVerifications,
        note: invitation.note,
        invitedAt: invitation.invitedAt,
        expiresAt: invitation.invitationExpiresAt,
      },
      sender: {
        email: invitation.invitedBy?.email ?? null,
        displayName: this.getInviterDisplayName(invitation.invitedBy),
      },
      recipient: {
        email: invitation.user.email,
        displayName: this.formatUserDisplayName(
          invitation.user.citizenIdentity?.postNames ?? null,
          invitation.user.citizenIdentity?.surName ?? null,
          invitation.user.email,
        ),
      },
      verification: {
        emailOtpVerifiedAt: verificationSession?.emailOtpVerifiedAt ?? null,
        identityChallengeStartedAt:
          verificationSession?.identityChallengeStartedAt ?? null,
        identityVerificationAttemptId:
          verificationSession?.identityVerificationAttemptId ?? null,
        identityVerifiedAt: verificationSession?.identityVerifiedAt ?? null,
        completedAt: verificationSession?.completedAt ?? null,
      },
    };
  }

  async acceptInvitation(
    userId: string,
    rawToken: string,
    context: AccessAuditContext = {},
  ) {
    const invitation = await this.getInvitationForCompletedReview(
      userId,
      rawToken,
    );
    const acceptedAt = new Date();

    const accepted = await this.prisma.documentCollaborator.update({
      where: { id: invitation.id },
      data: {
        invitationStatus: CollaboratorInvitationStatus.ACCEPTED,
        acceptedAt,
        declinedAt: null,
        revokedAt: null,
        isActive: true,
        invitationTokenHash: null,
        invitationOpenedAt: invitation.invitationOpenedAt ?? acceptedAt,
      },
      select: {
        id: true,
        documentId: true,
        userId: true,
        permissions: true,
        invitationStatus: true,
        requiredVerifications: true,
        invitationExpiresAt: true,
        invitationEmailSentAt: true,
        invitationOpenedAt: true,
        invitedAt: true,
        acceptedAt: true,
        declinedAt: true,
        revokedAt: true,
        note: true,
        isActive: true,
        document: {
          select: {
            id: true,
            title: true,
            isDeleted: true,
          },
        },
        user: {
          select: {
            email: true,
            imageUrl: true,
            citizenIdentity: {
              select: { surName: true, postNames: true },
            },
          },
        },
        invitedBy: {
          select: {
            id: true,
            email: true,
            citizenIdentity: {
              select: { surName: true, postNames: true },
            },
          },
        },
      },
    });

    await this.recordAccessAudit({
      documentId: invitation.documentId,
      collaboratorId: invitation.id,
      actorUserId: userId,
      targetUserId: invitation.userId,
      eventType: DocumentAccessAuditEvent.INVITE_ACCEPTED,
      fromPermissions: invitation.permissions,
      toPermissions: invitation.permissions,
      invitationStatus: CollaboratorInvitationStatus.ACCEPTED,
      metadata: {
        acceptedAt: acceptedAt.toISOString(),
      },
      ...context,
    });

    await this.reconcileSignatureRequestForCollaborator({
      documentId: accepted.documentId,
      userId: accepted.userId,
      permissions: accepted.permissions,
      invitationStatus: accepted.invitationStatus,
      acceptedAt: accepted.acceptedAt,
      isActive: accepted.isActive,
    });

    return {
      accepted: true,
      document: {
        id: accepted.document.id,
        title: accepted.document.title,
      },
      permissions: accepted.permissions,
      acceptedAt: acceptedAt.toISOString(),
    };
  }

  async declineInvitation(
    userId: string,
    rawToken: string,
    context: AccessAuditContext = {},
  ) {
    const invitation = await this.getInvitationForRecipient(userId, rawToken);
    const declinedAt = new Date();

    await this.prisma.documentCollaborator.update({
      where: { id: invitation.id },
      data: {
        invitationStatus: CollaboratorInvitationStatus.DECLINED,
        declinedAt,
        acceptedAt: null,
        isActive: false,
        invitationTokenHash: null,
        invitationOpenedAt: invitation.invitationOpenedAt ?? declinedAt,
      },
    });

    await this.recordAccessAudit({
      documentId: invitation.documentId,
      collaboratorId: invitation.id,
      actorUserId: userId,
      targetUserId: invitation.userId,
      eventType: DocumentAccessAuditEvent.INVITE_DECLINED,
      fromPermissions: invitation.permissions,
      toPermissions: invitation.permissions,
      invitationStatus: CollaboratorInvitationStatus.DECLINED,
      metadata: {
        declinedAt: declinedAt.toISOString(),
      },
      ...context,
    });

    await this.removeUnsignedSignatureRequest(
      invitation.documentId,
      invitation.userId,
    );
    await this.syncDocumentSigningStatus(invitation.documentId);

    return {
      declined: true,
      document: {
        id: invitation.document.id,
        title: invitation.document.title,
      },
    };
  }

  // ─── Autosave ────────────────────────────────────────────────────────────────

  async autosave(userId: string, documentId: string, dto: AutosaveDocumentDto) {
    const document = await this.getEditableDocument(userId, documentId);

    if (!dto.content) {
      return { saved: false, message: 'No content provided.' };
    }

    // Write updated content to S3
    const contentKey = document.s3ContentKey ?? documentContentKey(documentId);
    await this.s3.putJson(contentKey, dto.content);

    // Get current version count
    const versionCount = await this.prisma.documentVersion.count({
      where: { documentId },
    });

    const nextVersionNumber = versionCount + 1;

    // Prune old versions if over limit
    if (versionCount >= this.maxVersions) {
      await this.pruneOldVersions(documentId);
    }

    // Create version snapshot
    await this.createVersionSnapshot(
      documentId,
      userId,
      dto.content,
      nextVersionNumber,
    );

    // Update document record
    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        s3ContentKey: contentKey,
        wordCount: dto.wordCount ?? document.wordCount,
        updatedAt: new Date(),
      },
    });

    return {
      saved: true,
      versionNumber: nextVersionNumber,
      savedAt: new Date().toISOString(),
    };
  }

  // ─── Update metadata ─────────────────────────────────────────────────────────

  async updateMetadata(
    userId: string,
    documentId: string,
    dto: UpdateDocumentDto,
  ) {
    const document = await this.getEditableDocument(userId, documentId);
    const layout = mergeDocumentLayout(document.layout, dto.layout);

    const updated = await this.prisma.document.update({
      where: { id: document.id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
        ...(dto.layout !== undefined
          ? { layout: layout as Prisma.InputJsonValue }
          : {}),
      },
    });

    return formatDocumentRecord(updated);
  }

  // ─── Finalise ────────────────────────────────────────────────────────────────

  async finalise(userId: string, documentId: string, dto: FinaliseDocumentDto) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document || document.isDeleted)
      throw new NotFoundException('Document not found.');
    if (document.ownerId !== userId)
      throw new ForbiddenException('Only the document owner can finalise it.');
    if (document.status !== 'DRAFT') {
      throw new ConflictException(
        `Document is already ${document.status.toLowerCase()}. Only DRAFT documents can be finalised.`,
      );
    }
    if (!document.s3ContentKey)
      throw new BadRequestException('Document has no content to finalise.');

    // Fetch current content and compute hash
    const content = await this.s3.getJson(document.s3ContentKey);
    const contentHash = hashDocumentContent(content);

    const collaboratorSignerIds =
      await this.getRequiredSignerIdsForDocument(documentId);
    const signerIds = buildRequiredSignerIds({
      ownerId: document.ownerId,
      collaboratorSignerIds,
      requireOwnerSignature: dto.requireOwnerSignature ?? false,
    });

    if (signerIds.length === 0) {
      throw new ConflictException(
        'Add at least one accepted signer or require your own signature before finalising.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.document.update({
        where: { id: documentId },
        data: {
          status: 'FINALISED',
          contentHash,
          finalisedAt: new Date(),
        },
      });

      await tx.documentSignatureRequest.createMany({
        data: signerIds.map((requestedUserId) => ({
          documentId,
          requestedById: document.ownerId,
          requestedUserId,
          message: dto.note?.trim() || null,
        })),
        skipDuplicates: true,
      });

      return saved;
    });
    const signatureRequests = await this.getSignatureRequestSummaries(
      documentId,
      true,
    );

    return {
      ...formatDocumentRecord(updated),
      contentHash,
      signatureRequests,
      pendingSignatureCount:
        this.countUnsignedSignatureRequestSummaries(signatureRequests),
      message:
        'Document finalised. The content is now frozen and explicit required signers can now sign.',
    };
  }

  async getSigningReadiness(documentId: string, authHeader?: string | null) {
    let sessionUser: RequestUser | null = null;

    try {
      sessionUser = await this.resolveInvitationSessionUser(authHeader);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        return this.buildSigningReadinessResponse(documentId, {
          status: 'needs_login',
          canSign: false,
          message:
            'Sign in with the required account before signing this document.',
        });
      }

      throw error;
    }

    if (!sessionUser) {
      return this.buildSigningReadinessResponse(documentId, {
        status: 'needs_login',
        canSign: false,
        message:
          'Sign in with the required account before signing this document.',
      });
    }

    if (sessionUser.tokenType !== 'full' || !sessionUser.isIdVerified) {
      return this.buildSigningReadinessResponse(documentId, {
        status: 'needs_identity_verification',
        canSign: false,
        message: 'Complete identity verification before signing this document.',
      });
    }

    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        ownerId: true,
        status: true,
        contentHash: true,
        isDeleted: true,
      },
    });

    if (!document || document.isDeleted) {
      throw new NotFoundException('Document not found.');
    }

    await this.assertCanRead(sessionUser.userId, documentId, document.ownerId);

    const now = new Date();
    const [signatureRequest, activeCertificate] = await Promise.all([
      this.prisma.documentSignatureRequest.findFirst({
        where: { documentId, requestedUserId: sessionUser.userId },
        select: {
          id: true,
          status: true,
          signedAt: true,
          personalSignedDocumentId: true,
        },
      }),
      this.prisma.personalCertificate.findFirst({
        where: {
          userId: sessionUser.userId,
          isRevoked: false,
          notBefore: { lte: now },
          notAfter: { gt: now },
          keyPair: { isActive: true },
        },
        orderBy: { notAfter: 'desc' },
        select: { id: true, notAfter: true },
      }),
    ]);

    const decision = evaluateSigningReadiness({
      hasSession: true,
      hasFullVerifiedSession: true,
      documentStatus: document.status,
      hasDocumentHash: Boolean(document.contentHash),
      hasSignatureRequest: Boolean(signatureRequest),
      signatureRequestStatus: signatureRequest?.status ?? null,
      hasActiveCertificate: Boolean(activeCertificate),
    });

    return this.buildSigningReadinessResponse(documentId, decision, {
      documentStatus: document.status,
      documentHash: document.contentHash,
      signatureRequestId: signatureRequest?.id ?? null,
      signedAt: signatureRequest?.signedAt ?? null,
      personalSignedDocumentId:
        signatureRequest?.personalSignedDocumentId ?? null,
      certificateId: activeCertificate?.id ?? null,
      certificateExpiresAt: activeCertificate?.notAfter ?? null,
    });
  }

  // ─── Sign ────────────────────────────────────────────────────────────────────

  async sign(userId: string, documentId: string, dto: SignDocumentDto) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document || document.isDeleted)
      throw new NotFoundException('Document not found.');
    await this.assertCanSign(userId, documentId, document.ownerId);

    if (!canDocumentAcceptNewSignature(document.status)) {
      throw new ConflictException(
        `Document must be in FINALISED or SIGNED status to record a signature. Current status: ${document.status}.`,
      );
    }

    // Verify the hash matches — critical security check
    // Ensures the content hasn't changed between finalisation and signing
    if (document.contentHash !== dto.documentHash) {
      throw new BadRequestException(
        'Document hash mismatch. The content hash recorded at finalisation does not match ' +
          'the hash provided. The document may have been tampered with.',
      );
    }

    // Verify the signatureId exists in personal_signed_documents and matches this user
    const signedDoc = await this.prisma.personalSignedDocument.findUnique({
      where: { id: dto.signatureId },
    });

    if (!signedDoc) {
      throw new NotFoundException(
        'Signature record not found. Sign the document first at api/signature/.',
      );
    }
    if (signedDoc.userId !== userId) {
      throw new ForbiddenException('This signature does not belong to you.');
    }
    if (signedDoc.documentHash !== dto.documentHash) {
      throw new BadRequestException(
        'Signature hash does not match document hash. The signature was created for different content.',
      );
    }
    const includeSignerProfiles =
      document.ownerId === userId ||
      (await this.hasCollaboratorPermission(
        userId,
        documentId,
        CollaboratorPermission.MANAGE_ACCESS,
      ));

    const signatureRequest =
      await this.prisma.documentSignatureRequest.findFirst({
        where: { documentId, requestedUserId: userId },
        select: SIGNATURE_REQUEST_SUMMARY_SELECT,
      });

    if (!signatureRequest) {
      throw new ForbiddenException(
        'You are not currently listed as a required signer for this document.',
      );
    }

    if (signatureRequest.status === SignatureRequestStatus.SIGNED) {
      throw new ConflictException('You have already signed this document.');
    }

    const recordedSignature =
      await this.prisma.documentSignatureRequest.updateMany({
        where: {
          id: signatureRequest.id,
          status: { not: SignatureRequestStatus.SIGNED },
        },
        data: {
          status: SignatureRequestStatus.SIGNED,
          personalSignedDocumentId: signedDoc.id,
          signedAt: signedDoc.signedAt,
          ...(await this.buildSignatureRequestSnapshotUpdate(userId)),
        },
      });

    if (recordedSignature.count === 0) {
      throw new ConflictException('You have already signed this document.');
    }

    const pendingSignatureCount =
      await this.countUnsignedSignatureRequests(documentId);
    const updated = await this.syncDocumentSigningStatus(documentId);
    const completedSignatures = await this.getCompletedSignatureSummaries(
      documentId,
      document.ownerId,
    );
    const signingOrder = completedSignatures.findIndex(
      (signature) => signature.signerId === userId,
    );

    await this.recordAccessAudit({
      documentId,
      collaboratorId: null,
      actorUserId: userId,
      targetUserId: userId,
      eventType: DocumentAccessAuditEvent.DOCUMENT_SIGNED,
      fromPermissions: [],
      toPermissions: [],
      invitationStatus: null,
      metadata: {
        signatureId: dto.signatureId,
        signingOrder: signingOrder >= 0 ? signingOrder + 1 : null,
        totalSigned: completedSignatures.length,
        totalRequired: completedSignatures.length + pendingSignatureCount,
        pendingSignatureCount,
      },
    });

    if (pendingSignatureCount > 0) {
      return {
        ...formatDocumentRecord(updated ?? document),
        signatureRequests: await this.getSignatureRequestSummaries(
          documentId,
          includeSignerProfiles,
        ),
        signatureSnapshot: await this.buildSignatureSnapshot(
          updated ?? document,
        ),
        completedSignatures,
        signatureId: dto.signatureId,
        pendingSignatureCount,
        message:
          'Signature recorded. The owner can lock the document after all required signers complete signing.',
      };
    }

    if (!updated) {
      throw new ConflictException(
        'The document signing state could not be updated.',
      );
    }

    return {
      ...formatDocumentRecord(updated),
      signatureSnapshot: await this.buildSignatureSnapshot(updated),
      signatureId: dto.signatureId,
      signatureRequests: await this.getSignatureRequestSummaries(
        documentId,
        includeSignerProfiles,
      ),
      completedSignatures,
      pendingSignatureCount: 0,
      message:
        'All required signatures are complete. The owner can now lock this document.',
    };
  }

  // ─── Lock ──────────────────────────────────────────────────────────────────

  async lock(userId: string, documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document || document.isDeleted)
      throw new NotFoundException('Document not found.');

    const pendingSignatureCount =
      await this.countUnsignedSignatureRequests(documentId);

    const primarySignature = await this.resolvePrimarySignedDocument(
      documentId,
      document.ownerId,
    );

    const lockDecision = evaluateLockDocument({
      isOwner: document.ownerId === userId,
      status: document.status,
      pendingSignatureCount,
      hasCompletedSignature: Boolean(primarySignature),
    });

    if (!lockDecision.allowed) {
      if (lockDecision.reason === 'NOT_OWNER') {
        throw new ForbiddenException(
          'Only the document owner can lock this document.',
        );
      }

      if (lockDecision.reason === 'INVALID_STATUS') {
        throw new ConflictException(
          `Document must be in SIGNED status before locking. Current status: ${document.status}.`,
        );
      }

      if (lockDecision.reason === 'PENDING_SIGNATURES') {
        throw new ConflictException(
          'All required signatures must be completed before locking this document.',
        );
      }

      throw new ConflictException(
        'At least one completed signature is required before locking this document.',
      );
    }

    if (!primarySignature) {
      throw new ConflictException(
        'At least one completed signature is required before locking this document.',
      );
    }

    const fallbackSnapshot = await this.buildSignerSnapshot(
      primarySignature.userId,
    );
    const signatureSnapshot = {
      signerDisplayName:
        primarySignature.signerDisplayNameSnapshot ??
        fallbackSnapshot.signerDisplayName,
      signatureImageS3Key:
        primarySignature.signatureImageS3KeySnapshot ??
        fallbackSnapshot.signatureImageS3Key,
      signatureImageMimeType:
        primarySignature.signatureImageMimeTypeSnapshot ??
        fallbackSnapshot.signatureImageMimeType,
      signatureImageSizeBytes:
        primarySignature.signatureImageSizeBytesSnapshot ??
        fallbackSnapshot.signatureImageSizeBytes,
    };

    await this.prisma.document.updateMany({
      where: {
        id: documentId,
        status: DocumentStatus.SIGNED,
      },
      data: {
        status: DocumentStatus.LOCKED,
        personalSignedDocumentId: primarySignature.id,
        signedAt: document.signedAt ?? primarySignature.signedAt,
        lockedAt: new Date(),
        signerDisplayName: signatureSnapshot.signerDisplayName,
        signatureImageS3Key: signatureSnapshot.signatureImageS3Key,
        signatureImageMimeType: signatureSnapshot.signatureImageMimeType,
        signatureImageSizeBytes: signatureSnapshot.signatureImageSizeBytes,
        signatureBlockX: DEFAULT_SIGNATURE_X,
        signatureBlockY: DEFAULT_SIGNATURE_Y,
      },
    });

    const updated = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!updated) {
      throw new NotFoundException('Document not found.');
    }

    const completedSignatures = await this.getCompletedSignatureSummaries(
      documentId,
      document.ownerId,
    );

    await this.recordAccessAudit({
      documentId,
      collaboratorId: null,
      actorUserId: userId,
      targetUserId: null,
      eventType: DocumentAccessAuditEvent.DOCUMENT_LOCKED,
      fromPermissions: [],
      toPermissions: [],
      invitationStatus: null,
      metadata: {
        completedSignatureCount: completedSignatures.length,
        lockedAt: updated.lockedAt?.toISOString() ?? null,
      },
    });

    return {
      ...formatDocumentRecord(updated),
      signatureSnapshot: await this.buildSignatureSnapshot(updated),
      signatureRequests: await this.getSignatureRequestSummaries(
        documentId,
        true,
      ),
      completedSignatures,
      pendingSignatureCount: 0,
      message: 'Document locked. It is now permanently immutable.',
    };
  }

  // ─── Version history ─────────────────────────────────────────────────────────

  async getVersions(userId: string, documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, ownerId: true, isDeleted: true },
    });
    if (!document || document.isDeleted)
      throw new NotFoundException('Document not found.');
    await this.assertCanRead(userId, documentId, document.ownerId);

    const versions = await this.prisma.documentVersion.findMany({
      where: { documentId },
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true,
        versionNumber: true,
        wordCount: true,
        createdAt: true,
        savedBy: { select: { id: true } },
      },
    });

    return versions;
  }

  async updateSignatureLayout(
    userId: string,
    documentId: string,
    dto: UpdateSignatureLayoutDto,
  ) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document || document.isDeleted) {
      throw new NotFoundException('Document not found.');
    }

    if (document.ownerId !== userId) {
      throw new ForbiddenException(
        'Only the document owner can update signature placement.',
      );
    }

    if (document.status !== 'LOCKED') {
      throw new ConflictException(
        'Signature placement can only be adjusted after the document is locked.',
      );
    }

    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        signatureBlockX:
          dto.x ?? document.signatureBlockX ?? DEFAULT_SIGNATURE_X,
        signatureBlockY:
          dto.y ?? document.signatureBlockY ?? DEFAULT_SIGNATURE_Y,
      },
    });

    return {
      ...formatDocumentRecord(updated),
      signatureSnapshot: await this.buildSignatureSnapshot(updated),
    };
  }

  async restoreVersion(
    userId: string,
    documentId: string,
    versionNumber: number,
  ) {
    const document = await this.getEditableDocument(userId, documentId);

    const version = await this.prisma.documentVersion.findUnique({
      where: { documentId_versionNumber: { documentId, versionNumber } },
    });
    if (!version)
      throw new NotFoundException(`Version ${versionNumber} not found.`);

    // Fetch version content from S3
    const content = await this.s3.getJson(version.s3Key);

    // Write it as the current content
    await this.s3.putJson(document.s3ContentKey!, content);

    await this.prisma.document.update({
      where: { id: documentId },
      data: { wordCount: version.wordCount, updatedAt: new Date() },
    });

    return {
      restored: true,
      versionNumber,
      restoredAt: new Date().toISOString(),
    };
  }

  // ─── Soft delete ─────────────────────────────────────────────────────────────

  async softDelete(userId: string, documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!document || document.isDeleted)
      throw new NotFoundException('Document not found.');
    if (document.ownerId !== userId)
      throw new ForbiddenException('Only the owner can delete this document.');
    if (document.status === 'LOCKED') {
      throw new ForbiddenException('Locked documents cannot be deleted.');
    }

    await this.prisma.document.update({
      where: { id: documentId },
      data: { isDeleted: true, deletedAt: new Date() },
    });

    return { deleted: true, documentId };
  }

  // ─── Verify (public) ─────────────────────────────────────────────────────────

  async verify(documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        ownerId: true,
        title: true,
        status: true,
        contentHash: true,
        personalSignedDocumentId: true,
        signerDisplayName: true,
        signatureImageS3Key: true,
        signatureImageMimeType: true,
        signatureImageSizeBytes: true,
        signedAt: true,
        lockedAt: true,
        owner: {
          select: {
            citizenIdentity: { select: { surName: true, postNames: true } },
          },
        },
      },
    });

    if (!document) throw new NotFoundException('Document not found.');

    if (document.status !== 'LOCKED') {
      return {
        verified: false,
        status: document.status,
        message: 'This document has not been signed and locked yet.',
      };
    }

    // Fetch the signature record
    const signedDoc = document.personalSignedDocumentId
      ? await this.prisma.personalSignedDocument.findUnique({
          where: { id: document.personalSignedDocumentId },
          select: { documentHash: true, signedAt: true, certificateId: true },
        })
      : null;

    return {
      verified: true,
      documentId: document.id,
      title: document.title,
      contentHash: document.contentHash,
      signedBy: {
        name:
          document.signerDisplayName ??
          `${document.owner?.citizenIdentity?.postNames ?? ''} ${document.owner?.citizenIdentity?.surName ?? ''}`.trim(),
      },
      signedAt: document.signedAt,
      lockedAt: document.lockedAt,
      signers: (
        await this.getCompletedSignatureSummaries(documentId, document.ownerId)
      ).map((signature, index) => ({
        name: signature.signerName,
        email: signature.signerEmail,
        signedAt: signature.signedAt,
        isOwner: signature.isOwner,
        signingOrder: index + 1,
      })),
      signature: signedDoc
        ? {
            documentHash: signedDoc.documentHash,
            certificateId: signedDoc.certificateId,
          }
        : null,
    };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async getEditableDocument(userId: string, documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document || document.isDeleted)
      throw new NotFoundException('Document not found.');

    if (document.status !== 'DRAFT') {
      throw new ForbiddenException(
        `This document is ${document.status.toLowerCase()} and cannot be edited.`,
      );
    }

    await this.assertCanEdit(userId, documentId, document.ownerId);

    return document;
  }

  private async assertCanRead(
    userId: string,
    documentId: string,
    ownerId: string,
  ) {
    if (ownerId === userId) {
      return;
    }

    await this.assertCollaboratorPermission(
      userId,
      documentId,
      CollaboratorPermission.READ,
      'You do not have access to this document.',
    );
  }

  private async assertCanEdit(
    userId: string,
    documentId: string,
    ownerId: string,
  ) {
    if (ownerId === userId) {
      return;
    }

    await this.assertCollaboratorPermission(
      userId,
      documentId,
      CollaboratorPermission.EDIT,
      'You do not have edit access to this document.',
    );
  }

  private async assertCanSign(
    userId: string,
    documentId: string,
    ownerId: string,
  ) {
    if (ownerId === userId) {
      return;
    }

    await this.assertCollaboratorPermission(
      userId,
      documentId,
      CollaboratorPermission.SIGN,
      'You do not have signing access to this document.',
    );
  }

  private async getRequiredSignerIdsForDocument(
    documentId: string,
  ): Promise<string[]> {
    const collaborators = await this.prisma.documentCollaborator.findMany({
      where: {
        documentId,
        isActive: true,
        acceptedAt: { not: null },
        invitationStatus: CollaboratorInvitationStatus.ACCEPTED,
        permissions: { has: CollaboratorPermission.SIGN },
      },
      select: { userId: true },
    });

    return Array.from(new Set(collaborators.map((entry) => entry.userId)));
  }

  private async ensureSignatureRequestForUser(
    documentId: string,
    ownerId: string,
    userId: string,
  ): Promise<SignatureRequestSummary> {
    const existing = await this.prisma.documentSignatureRequest.findFirst({
      where: { documentId, requestedUserId: userId },
      select: SIGNATURE_REQUEST_SUMMARY_SELECT,
    });

    if (existing) return existing;

    try {
      return await this.prisma.documentSignatureRequest.create({
        data: { documentId, requestedById: ownerId, requestedUserId: userId },
        select: SIGNATURE_REQUEST_SUMMARY_SELECT,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.prisma.documentSignatureRequest.findFirstOrThrow({
          where: { documentId, requestedUserId: userId },
          select: SIGNATURE_REQUEST_SUMMARY_SELECT,
        });
      }

      throw error;
    }
  }

  private async getSignatureRequestSummaries(
    documentId: string,
    includeProfiles = false,
  ): Promise<SignatureRequestSummary[]> {
    const orderBy = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];

    if (!includeProfiles) {
      return this.prisma.documentSignatureRequest.findMany({
        where: { documentId },
        orderBy,
        select: SIGNATURE_REQUEST_SUMMARY_SELECT,
      });
    }

    const requests = await this.prisma.documentSignatureRequest.findMany({
      where: { documentId },
      orderBy,
      select: SIGNATURE_REQUEST_PROGRESS_SELECT,
    });

    const reminderCooldowns =
      await this.getSignatureReminderCooldowns(documentId);

    return requests.map((request) => ({
      ...formatSignatureRequestSummary(request),
      nextReminderAvailableAt: reminderCooldowns.get(request.id) ?? null,
    }));
  }

  private countUnsignedSignatureRequestSummaries(
    requests: SignatureRequestSummary[],
  ): number {
    return requests.filter(
      (request) => request.status !== SignatureRequestStatus.SIGNED,
    ).length;
  }

  private async countUnsignedSignatureRequests(
    documentId: string,
  ): Promise<number> {
    return this.prisma.documentSignatureRequest.count({
      where: {
        documentId,
        status: { not: SignatureRequestStatus.SIGNED },
      },
    });
  }

  private async reconcileSignatureRequestForCollaborator(input: {
    documentId: string;
    userId: string;
    permissions: CollaboratorPermission[];
    invitationStatus: CollaboratorInvitationStatus;
    acceptedAt: Date | null;
    isActive: boolean;
  }): Promise<void> {
    const document = await this.prisma.document.findUnique({
      where: { id: input.documentId },
      select: { ownerId: true, status: true, isDeleted: true },
    });

    if (
      !document ||
      document.isDeleted ||
      (document.status !== DocumentStatus.FINALISED &&
        document.status !== DocumentStatus.SIGNED)
    ) {
      return;
    }

    if (this.collaboratorRequiresSignature(input)) {
      await this.ensureSignatureRequestForUser(
        input.documentId,
        document.ownerId,
        input.userId,
      );
      await this.syncDocumentSigningStatus(input.documentId);
      return;
    }

    await this.removeUnsignedSignatureRequest(input.documentId, input.userId);
    await this.syncDocumentSigningStatus(input.documentId);
  }

  private collaboratorRequiresSignature(input: {
    permissions: CollaboratorPermission[];
    invitationStatus: CollaboratorInvitationStatus;
    acceptedAt: Date | null;
    isActive: boolean;
  }): boolean {
    return collaboratorRequiresSignatureRule(input);
  }

  private async removeUnsignedSignatureRequest(
    documentId: string,
    userId: string,
  ): Promise<void> {
    await this.prisma.documentSignatureRequest.deleteMany({
      where: {
        documentId,
        requestedUserId: userId,
        status: { not: SignatureRequestStatus.SIGNED },
      },
    });
  }

  private async assertSignatureReminderTargetIsEligible(
    documentId: string,
    ownerId: string,
    requestedUserId: string,
  ): Promise<void> {
    if (requestedUserId === ownerId) {
      return;
    }

    const collaborator = await this.prisma.documentCollaborator.findUnique({
      where: { documentId_userId: { documentId, userId: requestedUserId } },
      select: {
        role: true,
        permissions: true,
        invitationStatus: true,
        acceptedAt: true,
        isActive: true,
      },
    });

    if (!this.hasPermission(collaborator, CollaboratorPermission.SIGN)) {
      throw new ConflictException(
        'This signer no longer has active signing access to the document.',
      );
    }
  }

  private async assertSignatureReminderCooldown(
    documentId: string,
    requestId: string,
    targetUserId: string,
  ): Promise<void> {
    const createdAfter = new Date(Date.now() - SIGNATURE_REMINDER_COOLDOWN_MS);
    const recentReminderEvents =
      await this.prisma.documentAccessAuditLog.findMany({
        where: {
          documentId,
          targetUserId,
          createdAt: { gte: createdAfter },
          eventType: {
            in: [
              DocumentAccessAuditEvent.SIGNATURE_REMINDER_SENT,
              DocumentAccessAuditEvent.SIGNATURE_REMINDER_FAILED,
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          createdAt: true,
          metadata: true,
        },
      });
    const recentForRequest = recentReminderEvents.find(
      (event) => getSignatureReminderRequestId(event.metadata) === requestId,
    );

    if (!recentForRequest) {
      return;
    }

    const retryAt = new Date(
      recentForRequest.createdAt.getTime() + SIGNATURE_REMINDER_COOLDOWN_MS,
    );
    const retryAfter = Math.max(
      1,
      Math.ceil((retryAt.getTime() - Date.now()) / 1000),
    );

    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        code: 'SIGNATURE_REMINDER_COOLDOWN',
        message: 'A reminder was already sent recently.',
        retryAt: retryAt.toISOString(),
        retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async getSignatureReminderCooldowns(
    documentId: string,
  ): Promise<Map<string, Date>> {
    const createdAfter = new Date(Date.now() - SIGNATURE_REMINDER_COOLDOWN_MS);
    const events = await this.prisma.documentAccessAuditLog.findMany({
      where: {
        documentId,
        createdAt: { gte: createdAfter },
        eventType: {
          in: [
            DocumentAccessAuditEvent.SIGNATURE_REMINDER_SENT,
            DocumentAccessAuditEvent.SIGNATURE_REMINDER_FAILED,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        metadata: true,
      },
    });
    const cooldowns = new Map<string, Date>();

    for (const event of events) {
      const requestId = getSignatureReminderRequestId(event.metadata);
      if (!requestId || cooldowns.has(requestId)) {
        continue;
      }

      cooldowns.set(
        requestId,
        new Date(event.createdAt.getTime() + SIGNATURE_REMINDER_COOLDOWN_MS),
      );
    }

    return cooldowns;
  }

  private async syncDocumentSigningStatus(documentId: string) {
    const pendingSignatureCount =
      await this.countUnsignedSignatureRequests(documentId);
    const latestCompletedSignature =
      pendingSignatureCount === 0
        ? await this.prisma.documentSignatureRequest.findFirst({
            where: {
              documentId,
              status: SignatureRequestStatus.SIGNED,
              signedAt: { not: null },
            },
            orderBy: { signedAt: 'desc' },
            select: { signedAt: true },
          })
        : null;

    const nextSigningState = resolveSigningStatusUpdate({
      pendingSignatureCount,
      latestCompletedSignedAt: latestCompletedSignature?.signedAt ?? null,
    });

    await this.prisma.document.updateMany({
      where: {
        id: documentId,
        status: { in: [DocumentStatus.FINALISED, DocumentStatus.SIGNED] },
      },
      data: nextSigningState,
    });

    return this.prisma.document.findUnique({ where: { id: documentId } });
  }

  private async resolvePrimarySignedDocument(
    documentId: string,
    ownerId: string,
    fallbackSignedDocumentId?: string,
  ): Promise<SignedDocumentForLock | null> {
    const ownerRequest = await this.prisma.documentSignatureRequest.findFirst({
      where: {
        documentId,
        requestedUserId: ownerId,
        status: SignatureRequestStatus.SIGNED,
        personalSignedDocumentId: { not: null },
      },
      select: SIGNATURE_REQUEST_SUMMARY_SELECT,
    });
    const firstRequest = ownerRequest
      ? null
      : await this.prisma.documentSignatureRequest.findFirst({
          where: {
            documentId,
            status: SignatureRequestStatus.SIGNED,
            personalSignedDocumentId: { not: null },
          },
          orderBy: { signedAt: 'asc' },
          select: SIGNATURE_REQUEST_SUMMARY_SELECT,
        });
    const signatureId =
      ownerRequest?.personalSignedDocumentId ??
      fallbackSignedDocumentId ??
      firstRequest?.personalSignedDocumentId ??
      null;

    if (!signatureId) return null;

    return this.prisma.personalSignedDocument
      .findUnique({
        where: { id: signatureId },
        select: { id: true, userId: true, signedAt: true, certificateId: true },
      })
      .then((signedDocument) => {
        if (!signedDocument) {
          return null;
        }

        const sourceRequest = ownerRequest ?? firstRequest ?? null;
        return {
          ...signedDocument,
          signerDisplayNameSnapshot:
            sourceRequest?.signerDisplayNameSnapshot ?? null,
          signerEmailSnapshot: sourceRequest?.signerEmailSnapshot ?? null,
          signatureImageS3KeySnapshot:
            sourceRequest?.signatureImageS3KeySnapshot ?? null,
          signatureImageMimeTypeSnapshot:
            sourceRequest?.signatureImageMimeTypeSnapshot ?? null,
          signatureImageSizeBytesSnapshot:
            sourceRequest?.signatureImageSizeBytesSnapshot ?? null,
        };
      });
  }

  private async buildSignerSnapshot(userId: string) {
    const [activeSignatureImage, signer] = await Promise.all([
      this.prisma.personalSignatureImage.findFirst({
        where: { userId, isActive: true },
        select: { s3Key: true, mimeType: true, sizeBytes: true },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          citizenIdentity: {
            select: { surName: true, postNames: true },
          },
        },
      }),
    ]);

    return {
      signerDisplayName:
        `${signer?.citizenIdentity?.postNames ?? ''} ${signer?.citizenIdentity?.surName ?? ''}`.trim() ||
        null,
      signerEmail: signer?.email ?? null,
      signatureImageS3Key: activeSignatureImage?.s3Key ?? null,
      signatureImageMimeType: activeSignatureImage?.mimeType ?? null,
      signatureImageSizeBytes: activeSignatureImage?.sizeBytes ?? null,
    };
  }

  private async getCompletedSignatureSummaries(
    documentId: string,
    ownerId: string,
  ): Promise<CompletedSignatureSummary[]> {
    const requests = await this.prisma.documentSignatureRequest.findMany({
      where: {
        documentId,
        status: SignatureRequestStatus.SIGNED,
        personalSignedDocumentId: { not: null },
        signedAt: { not: null },
      },
      orderBy: { signedAt: 'asc' },
      select: COMPLETED_SIGNATURE_SELECT,
    });

    return Promise.all(
      requests.map((request) =>
        this.formatCompletedSignatureSummary(request, ownerId),
      ),
    );
  }

  private async formatCompletedSignatureSummary(
    request: CompletedSignatureRecord,
    ownerId: string,
  ): Promise<CompletedSignatureSummary> {
    const shouldFallbackToLiveProfile =
      !request.signerDisplayNameSnapshot || !request.signerEmailSnapshot;
    const [signerSnapshot, signedDocument] = await Promise.all([
      shouldFallbackToLiveProfile
        ? this.buildSignerSnapshot(request.requestedUserId)
        : Promise.resolve(null),
      request.personalSignedDocumentId
        ? this.prisma.personalSignedDocument.findUnique({
            where: { id: request.personalSignedDocumentId },
            select: { certificateId: true },
          })
        : Promise.resolve(null),
    ]);
    let imageUrl: string | null = null;

    const signatureImageS3Key =
      request.signatureImageS3KeySnapshot ??
      signerSnapshot?.signatureImageS3Key ??
      null;

    if (signatureImageS3Key) {
      try {
        imageUrl = await this.s3.getPresignedUrl(signatureImageS3Key, 3600);
      } catch (error) {
        this.logger.warn(
          `Failed to create completed signature URL for request ${request.id}: ${String(error)}`,
        );
      }
    }

    return {
      signatureId: request.personalSignedDocumentId ?? request.id,
      certificateId: signedDocument?.certificateId ?? null,
      signerId: request.requestedUserId,
      signerName:
        request.signerDisplayNameSnapshot ??
        signerSnapshot?.signerDisplayName ??
        this.formatUserDisplayName(
          request.requestedUser.citizenIdentity?.postNames ?? null,
          request.requestedUser.citizenIdentity?.surName ?? null,
          request.requestedUser.email,
        ),
      signerEmail:
        request.signerEmailSnapshot ??
        signerSnapshot?.signerEmail ??
        request.requestedUser.email,
      imageUrl,
      mimeType:
        request.signatureImageMimeTypeSnapshot ??
        signerSnapshot?.signatureImageMimeType ??
        null,
      sizeBytes:
        request.signatureImageSizeBytesSnapshot ??
        signerSnapshot?.signatureImageSizeBytes ??
        null,
      signedAt: request.signedAt ?? request.updatedAt,
      isOwner: request.requestedUserId === ownerId,
    };
  }

  private async buildSignatureRequestSnapshotUpdate(userId: string) {
    const snapshot = await this.buildSignerSnapshot(userId);

    return {
      signerDisplayNameSnapshot: snapshot.signerDisplayName,
      signerEmailSnapshot: snapshot.signerEmail,
      signatureImageS3KeySnapshot: snapshot.signatureImageS3Key,
      signatureImageMimeTypeSnapshot: snapshot.signatureImageMimeType,
      signatureImageSizeBytesSnapshot: snapshot.signatureImageSizeBytes,
    };
  }

  private async assertCanManageAccess(
    userId: string,
    documentId: string,
    ownerId: string,
  ) {
    if (ownerId === userId) {
      return;
    }

    await this.assertCollaboratorPermission(
      userId,
      documentId,
      CollaboratorPermission.MANAGE_ACCESS,
      'You do not have permission to manage document access.',
    );
  }

  private async assertCanComment(
    userId: string,
    documentId: string,
    ownerId: string,
  ) {
    if (ownerId === userId) {
      return;
    }

    await this.assertCollaboratorPermission(
      userId,
      documentId,
      CollaboratorPermission.COMMENT,
      'You do not have comment access to this document.',
    );
  }

  private async assertCollaboratorPermission(
    userId: string,
    documentId: string,
    permission: CollaboratorPermission,
    message: string,
  ) {
    const hasPermission = await this.hasCollaboratorPermission(
      userId,
      documentId,
      permission,
    );

    if (!hasPermission) {
      throw new ForbiddenException(message);
    }
  }

  private async hasCollaboratorPermission(
    userId: string,
    documentId: string,
    permission: CollaboratorPermission,
  ): Promise<boolean> {
    const collaborator = await this.prisma.documentCollaborator.findUnique({
      where: { documentId_userId: { documentId, userId } },
      select: {
        role: true,
        permissions: true,
        invitationStatus: true,
        acceptedAt: true,
        isActive: true,
      },
    });

    return this.hasPermission(collaborator, permission);
  }

  private hasPermission(
    collaborator: {
      role: CollaboratorRole;
      permissions: CollaboratorPermission[];
      invitationStatus: CollaboratorInvitationStatus;
      acceptedAt: Date | null;
      isActive: boolean;
    } | null,
    permission: CollaboratorPermission,
  ): boolean {
    return hasDocumentPermission(
      collaborator as DocumentPermissionRecord | null,
      permission,
    );
  }

  private getEffectivePermissions(collaborator: {
    role: CollaboratorRole;
    permissions: CollaboratorPermission[];
  }): CollaboratorPermission[] {
    return getEffectiveDocumentPermissions(collaborator);
  }

  private getLegacyPermissions(
    role: CollaboratorRole,
  ): CollaboratorPermission[] {
    return getLegacyPermissionsForRole(role);
  }

  private buildSigningReadinessResponse(
    documentId: string,
    decision: SigningReadinessDecision,
    details: {
      documentStatus?: DocumentStatus | null;
      documentHash?: string | null;
      signatureRequestId?: string | null;
      signedAt?: Date | null;
      personalSignedDocumentId?: string | null;
      certificateId?: string | null;
      certificateExpiresAt?: Date | null;
    } = {},
  ) {
    return {
      documentId,
      status: decision.status,
      canSign: decision.canSign,
      message: decision.message,
      documentStatus: details.documentStatus ?? null,
      documentHash: details.documentHash ?? null,
      signatureRequestId: details.signatureRequestId ?? null,
      signedAt: details.signedAt ?? null,
      personalSignedDocumentId: details.personalSignedDocumentId ?? null,
      certificateId: details.certificateId ?? null,
      certificateExpiresAt: details.certificateExpiresAt ?? null,
    };
  }

  private async resolveInvitationSessionUser(
    authHeader?: string | null,
  ): Promise<RequestUser | null> {
    const token = extractBearerToken(authHeader);
    if (!token) {
      return null;
    }

    let payload: { sub: string; email: string; tokenType: 'full' | 'limited' };

    try {
      payload = await this.jwt.verifyAsync<{
        sub: string;
        email: string;
        tokenType: 'full' | 'limited';
      }>(token);
    } catch {
      throw new UnauthorizedException(
        'Your session is invalid. Please sign in again.',
      );
    }

    if (payload.tokenType !== 'full' && payload.tokenType !== 'limited') {
      throw new UnauthorizedException(
        'Your session is invalid. Please sign in again.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, isActive: true, isIdVerified: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Your account is not active.');
    }

    return {
      userId: user.id,
      email: user.email,
      tokenType: payload.tokenType,
      isIdVerified: user.isIdVerified,
    };
  }

  private async requireInvitationSessionUser(
    authHeader?: string | null,
  ): Promise<RequestUser> {
    const user = await this.resolveInvitationSessionUser(authHeader);
    if (!user) {
      throw new UnauthorizedException('Sign in to continue this invitation.');
    }

    return user;
  }

  private resolveInvitationVerificationSessionExpiry(
    invitation: InvitationLookupRecord,
  ) {
    return resolveInvitationVerificationSessionExpiryRule({
      invitationExpiresAt: invitation.invitationExpiresAt,
      now: new Date(),
      sessionTtlMs: INVITATION_VERIFICATION_SESSION_TTL_MS,
    });
  }

  private async ensureInvitationVerificationSession(
    invitation: InvitationLookupRecord,
    sessionUser: RequestUser,
    context: AccessAuditContext,
  ): Promise<InvitationVerificationSessionRecord> {
    const existing =
      await this.prisma.documentInvitationVerificationSession.findUnique({
        where: { collaboratorId: invitation.id },
      });

    if (existing && existing.expiresAt.getTime() > Date.now()) {
      return existing;
    }

    const expiresAt =
      this.resolveInvitationVerificationSessionExpiry(invitation);

    const session = existing
      ? await this.prisma.documentInvitationVerificationSession.update({
          where: { collaboratorId: invitation.id },
          data: {
            userId: invitation.userId,
            documentId: invitation.documentId,
            emailOtpCodeHash: null,
            emailOtpSentAt: null,
            emailOtpExpiresAt: null,
            emailOtpVerifiedAt: null,
            emailOtpAttemptCount: 0,
            emailOtpRequestCount: 0,
            emailOtpWindowStartedAt: null,
            identityChallengeStartedAt: null,
            identityFailureAttemptId: null,
            identityVerificationAttemptId: null,
            identityVerifiedAt: null,
            completedAt: null,
            expiresAt,
          },
        })
      : await this.prisma.documentInvitationVerificationSession.create({
          data: {
            collaboratorId: invitation.id,
            documentId: invitation.documentId,
            userId: invitation.userId,
            expiresAt,
          },
        });

    await this.recordAccessAudit({
      documentId: invitation.documentId,
      collaboratorId: invitation.id,
      actorUserId: sessionUser.userId,
      targetUserId: invitation.userId,
      eventType: DocumentAccessAuditEvent.LOGIN_COMPLETED,
      fromPermissions: invitation.permissions,
      toPermissions: invitation.permissions,
      invitationStatus: invitation.invitationStatus,
      metadata: {
        tokenType: sessionUser.tokenType,
      },
      ...context,
    });

    if (requiresInvitationEmailOtp(invitation.requiredVerifications)) {
      await this.recordAccessAudit({
        documentId: invitation.documentId,
        collaboratorId: invitation.id,
        actorUserId: sessionUser.userId,
        targetUserId: invitation.userId,
        eventType: DocumentAccessAuditEvent.INVITE_EMAIL_OTP_REQUIRED,
        fromPermissions: invitation.permissions,
        toPermissions: invitation.permissions,
        invitationStatus: invitation.invitationStatus,
        metadata: null,
        ...context,
      });
    }

    return session;
  }

  private async prepareInvitationGateSession(
    session: InvitationVerificationSessionRecord,
    invitation: InvitationLookupRecord,
    actorUserId: string,
    context: AccessAuditContext,
  ): Promise<InvitationVerificationSessionRecord> {
    const requirements = normalizeInvitationVerificationRequirements(
      invitation.requiredVerifications,
    );

    if (!requiresInvitationIdentityVerification(requirements)) {
      return session;
    }

    const emailRequired = requiresInvitationEmailOtp(requirements);
    if (emailRequired && !session.emailOtpVerifiedAt) {
      return session;
    }

    return this.beginInvitationIdentityChallenge(
      session,
      invitation,
      actorUserId,
      context,
    );
  }

  private resolveInvitationEmailOtpResendAvailableAt(
    session: InvitationVerificationSessionRecord,
  ): Date | null {
    return resolveInvitationEmailOtpResendAvailableAtRule(
      session.emailOtpSentAt,
      INVITATION_EMAIL_OTP_RESEND_COOLDOWN_MS,
    );
  }

  private assertInvitationEmailOtpRequestAllowed(
    session: InvitationVerificationSessionRecord,
  ) {
    const decision = evaluateInvitationEmailOtpRequest({
      session,
      now: new Date(),
      resendCooldownMs: INVITATION_EMAIL_OTP_RESEND_COOLDOWN_MS,
      maxRequestsPerHour: INVITATION_EMAIL_OTP_MAX_REQUESTS_PER_HOUR,
    });

    if (!decision.allowed && decision.reason === 'RESEND_COOLDOWN') {
      throw new HttpException(
        {
          message: 'Wait before requesting another verification code.',
          retryAt: decision.retryAt.toISOString(),
          retryAfterSeconds: decision.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!decision.allowed && decision.reason === 'RATE_LIMIT') {
      throw new HttpException(
        {
          message:
            'Too many verification codes have been requested. Try again later.',
          retryAt: decision.retryAt.toISOString(),
          retryAfterSeconds: decision.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private generateInvitationEmailOtp() {
    return crypto
      .randomInt(0, 10 ** INVITATION_EMAIL_OTP_LENGTH)
      .toString()
      .padStart(INVITATION_EMAIL_OTP_LENGTH, '0');
  }

  private async beginInvitationIdentityChallenge(
    session: InvitationVerificationSessionRecord,
    invitation: InvitationLookupRecord,
    actorUserId: string,
    context: AccessAuditContext,
  ): Promise<InvitationVerificationSessionRecord> {
    if (session.identityChallengeStartedAt) {
      return session;
    }

    const challengeStartedAt = new Date();
    const updated =
      await this.prisma.documentInvitationVerificationSession.update({
        where: { collaboratorId: invitation.id },
        data: {
          identityChallengeStartedAt: challengeStartedAt,
          identityFailureAttemptId: null,
          identityVerificationAttemptId: null,
          identityVerifiedAt: null,
          completedAt: null,
        },
      });

    await this.recordAccessAudit({
      documentId: invitation.documentId,
      collaboratorId: invitation.id,
      actorUserId,
      targetUserId: invitation.userId,
      eventType: DocumentAccessAuditEvent.IDENTITY_VERIFICATION_REQUIRED,
      fromPermissions: invitation.permissions,
      toPermissions: invitation.permissions,
      invitationStatus: invitation.invitationStatus,
      metadata: {
        identityChallengeStartedAt: challengeStartedAt.toISOString(),
      },
      ...context,
    });

    return updated;
  }

  private async syncInvitationIdentityVerification(
    session: InvitationVerificationSessionRecord,
    invitation: InvitationLookupRecord,
    actorUserId: string,
    context: AccessAuditContext,
  ): Promise<InvitationVerificationSessionRecord> {
    if (
      (requiresInvitationEmailOtp(invitation.requiredVerifications) &&
        !session.emailOtpVerifiedAt) ||
      !requiresInvitationIdentityVerification(
        invitation.requiredVerifications,
      ) ||
      !session.identityChallengeStartedAt ||
      session.completedAt
    ) {
      return session;
    }

    let nextSession = session;

    const failedAttempt = await this.prisma.idVerification.findFirst({
      where: {
        userId: invitation.userId,
        passed: false,
        createdAt: { gte: session.identityChallengeStartedAt },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, failReason: true },
    });

    if (
      failedAttempt &&
      failedAttempt.id !== session.identityFailureAttemptId
    ) {
      nextSession =
        await this.prisma.documentInvitationVerificationSession.update({
          where: { collaboratorId: invitation.id },
          data: {
            identityFailureAttemptId: failedAttempt.id,
          },
        });

      await this.recordAccessAudit({
        documentId: invitation.documentId,
        collaboratorId: invitation.id,
        actorUserId,
        targetUserId: invitation.userId,
        eventType: DocumentAccessAuditEvent.IDENTITY_VERIFICATION_FAILED,
        fromPermissions: invitation.permissions,
        toPermissions: invitation.permissions,
        invitationStatus: invitation.invitationStatus,
        metadata: {
          identityChallengeStartedAt:
            session.identityChallengeStartedAt.toISOString(),
          identityVerificationAttemptId: failedAttempt.id,
          identityVerificationFailedAt: failedAttempt.createdAt.toISOString(),
          failReason:
            failedAttempt.failReason?.trim() || 'Identity verification failed.',
        },
        ...context,
      });
    }

    const passedAttempt = await this.prisma.idVerification.findFirst({
      where: {
        userId: invitation.userId,
        passed: true,
        createdAt: { gte: session.identityChallengeStartedAt },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true },
    });

    if (!passedAttempt) {
      return nextSession;
    }

    const updated =
      await this.prisma.documentInvitationVerificationSession.update({
        where: { collaboratorId: invitation.id },
        data: {
          identityVerificationAttemptId: passedAttempt.id,
          identityVerifiedAt: passedAttempt.createdAt,
          completedAt: passedAttempt.createdAt,
        },
      });

    if (!nextSession.identityVerificationAttemptId) {
      await this.recordAccessAudit({
        documentId: invitation.documentId,
        collaboratorId: invitation.id,
        actorUserId,
        targetUserId: invitation.userId,
        eventType: DocumentAccessAuditEvent.IDENTITY_VERIFICATION_PASSED,
        fromPermissions: invitation.permissions,
        toPermissions: invitation.permissions,
        invitationStatus: invitation.invitationStatus,
        metadata: {
          identityChallengeStartedAt:
            session.identityChallengeStartedAt.toISOString(),
          identityVerificationAttemptId: passedAttempt.id,
          identityVerifiedAt: passedAttempt.createdAt.toISOString(),
        },
        ...context,
      });
    }

    return updated;
  }

  private formatInvitationGateStatus(
    invitation: InvitationLookupRecord,
    session: InvitationVerificationSessionRecord,
    sessionUser: RequestUser,
  ) {
    const requirements = normalizeInvitationVerificationRequirements(
      invitation.requiredVerifications,
    );
    const resendAvailableAt =
      this.resolveInvitationEmailOtpResendAvailableAt(session);
    const nextStep = resolveInvitationGateNextStep(session, requirements);
    const emailRequired = requiresInvitationEmailOtp(requirements);
    const identityRequired =
      requiresInvitationIdentityVerification(requirements);

    return {
      status: 'pending' as const,
      nextStep,
      verificationRequirements: requirements,
      recipient: {
        email: invitation.user.email,
        displayName: this.formatUserDisplayName(
          invitation.user.citizenIdentity?.postNames ?? null,
          invitation.user.citizenIdentity?.surName ?? null,
          invitation.user.email,
        ),
      },
      signedInUser: {
        email: sessionUser.email,
        tokenType: sessionUser.tokenType,
        isIdVerified: sessionUser.isIdVerified,
      },
      emailOtp: {
        required: emailRequired && !session.emailOtpVerifiedAt,
        sentAt: session.emailOtpSentAt,
        expiresAt: session.emailOtpExpiresAt,
        verifiedAt: session.emailOtpVerifiedAt,
        resendAvailableAt,
      },
      identityVerification: {
        required: identityRequired && !session.completedAt,
        challengeStartedAt: session.identityChallengeStartedAt,
        verificationAttemptId: session.identityVerificationAttemptId,
        verifiedAt: session.identityVerifiedAt,
      },
    };
  }

  private async getInvitationForCompletedReview(
    userId: string,
    rawToken: string,
  ): Promise<InvitationLookupRecord> {
    const invitation = await this.getInvitationForRecipient(userId, rawToken);
    const session =
      await this.prisma.documentInvitationVerificationSession.findUnique({
        where: { collaboratorId: invitation.id },
      });

    const reviewDecision = evaluateInvitationReviewAccess({
      session,
      requirements: invitation.requiredVerifications,
      now: new Date(),
    });

    if (
      !reviewDecision.allowed &&
      reviewDecision.reason === 'EMAIL_OTP_REQUIRED'
    ) {
      throw new ForbiddenException(
        'Complete the invitation email verification step before continuing.',
      );
    }

    if (
      !reviewDecision.allowed &&
      reviewDecision.reason === 'SESSION_EXPIRED'
    ) {
      throw new ForbiddenException(
        'This invitation verification session expired. Restart the verification steps.',
      );
    }

    if (
      !reviewDecision.allowed &&
      reviewDecision.reason === 'IDENTITY_VERIFICATION_REQUIRED'
    ) {
      if (!session) {
        throw new ForbiddenException(
          'Complete the invitation identity verification step before continuing.',
        );
      }

      const challengedSession = await this.beginInvitationIdentityChallenge(
        session,
        invitation,
        invitation.userId,
        {},
      );
      const syncedSession = await this.syncInvitationIdentityVerification(
        challengedSession,
        invitation,
        invitation.userId,
        {},
      );

      if (!syncedSession.completedAt) {
        throw new ForbiddenException(
          'Complete the invitation identity verification step before continuing.',
        );
      }
    }

    if (
      !reviewDecision.allowed &&
      reviewDecision.reason !== 'IDENTITY_VERIFICATION_REQUIRED'
    ) {
      throw new ForbiddenException(
        'Complete the invitation identity verification step before continuing.',
      );
    }

    return invitation;
  }

  private sanitizeAccessAuditMetadata(
    metadata: Prisma.JsonValue | null,
  ): Record<string, unknown> | null {
    return sanitizeDocumentAccessAuditMetadata(metadata);
  }

  private normalizePermissions(
    permissions: CollaboratorPermissionValue[],
  ): CollaboratorPermission[] {
    const normalized = normalizeDocumentPermissions(
      permissions as CollaboratorPermission[],
    );

    if (normalized.length === 0) {
      throw new BadRequestException(
        'At least one permission must be granted to share this document.',
      );
    }

    return normalized;
  }

  private normalizeInvitationVerificationRequirements(
    requirements: ShareDocumentAccessDto['verificationRequirements'],
  ): DocumentInvitationVerificationRequirement[] {
    return normalizeInvitationVerificationRequirements(
      requirements as DocumentInvitationVerificationRequirement[] | undefined,
    );
  }

  private deriveLegacyRole(
    permissions: CollaboratorPermission[],
  ): CollaboratorRole {
    return deriveCollaboratorRoleFromPermissions(permissions);
  }

  /**
   * Resolves the documents-app frontend base URL (no trailing slash) used to
   * compose invitation and edit URLs. Honours `DOCS_BASE_URL` first, then
   * falls back to the first entry in `FRONTEND_URLS`, then `FRONTEND_URL`.
   *
   * @returns The frontend base URL with any trailing slash trimmed.
   */
  private resolveDocumentsFrontendUrl(): string {
    const explicit = this.config.get<string>('DOCS_BASE_URL');
    if (explicit?.trim()) {
      return explicit.trim().replace(/\/$/, '');
    }

    const additionalOrigins = this.config.get<string>('FRONTEND_URLS');
    if (additionalOrigins) {
      const docsOrigin = additionalOrigins
        .split(',')
        .map((origin) => origin.trim())
        .find(Boolean);

      if (docsOrigin) {
        return docsOrigin.replace(/\/$/, '');
      }
    }

    return this.config.getOrThrow<string>('FRONTEND_URL').replace(/\/$/, '');
  }

  private describePermissions(permissions: CollaboratorPermission[]): string {
    return describeDocumentPermissions(permissions);
  }

  private describeInvitationExpiry(expiry: Date): string {
    return describeInvitationExpiryDuration(expiry);
  }

  private formatUserDisplayName(
    postNames: string | null,
    surName: string | null,
    fallback: string,
  ): string {
    return formatDocumentUserDisplayName(postNames, surName, fallback);
  }

  private getInviterDisplayName(
    invitedBy:
      | CollaboratorWithProfile['invitedBy']
      | InvitationLookupRecord['invitedBy'],
  ): string {
    return getDocumentInviterDisplayName(invitedBy);
  }

  private maskEmail(email: string): string {
    return maskDocumentRecipientEmail(email);
  }

  private assertInvitationTokenFormat(rawToken: string) {
    if (!isValidInvitationTokenFormat(rawToken)) {
      throw new NotFoundException('Invitation not found or expired.');
    }
  }

  private async findInvitationByRawToken(
    rawToken: string,
  ): Promise<InvitationLookupRecord> {
    this.assertInvitationTokenFormat(rawToken);
    const tokenHash = this.encryption.hash(rawToken);

    const invitation = await this.prisma.documentCollaborator.findFirst({
      where: { invitationTokenHash: tokenHash },
      select: {
        id: true,
        documentId: true,
        userId: true,
        permissions: true,
        invitationStatus: true,
        invitationTokenHash: true,
        requiredVerifications: true,
        invitationExpiresAt: true,
        invitationEmailSentAt: true,
        invitationOpenedAt: true,
        invitedAt: true,
        acceptedAt: true,
        declinedAt: true,
        revokedAt: true,
        note: true,
        isActive: true,
        document: {
          select: {
            id: true,
            title: true,
            isDeleted: true,
          },
        },
        user: {
          select: {
            email: true,
            imageUrl: true,
            citizenIdentity: {
              select: { surName: true, postNames: true },
            },
          },
        },
        invitedBy: {
          select: {
            id: true,
            email: true,
            citizenIdentity: {
              select: { surName: true, postNames: true },
            },
          },
        },
      },
    });

    if (!invitation || !invitation.invitationTokenHash) {
      throw new NotFoundException('Invitation not found or expired.');
    }

    if (
      !this.encryption.compareHash(rawToken, invitation.invitationTokenHash)
    ) {
      throw new NotFoundException('Invitation not found or expired.');
    }

    if (invitation.document.isDeleted) {
      throw new NotFoundException('Invitation not found or expired.');
    }

    const invitationState = evaluateInvitationLookupState(
      {
        invitationStatus: invitation.invitationStatus,
        invitationExpiresAt: invitation.invitationExpiresAt,
      },
      new Date(),
    );

    if (invitationState === 'EXPIRED') {
      await this.prisma.documentCollaborator.update({
        where: { id: invitation.id },
        data: {
          invitationStatus: CollaboratorInvitationStatus.EXPIRED,
          isActive: false,
        },
      });

      throw new ConflictException('This invitation has expired.');
    }

    if (invitationState === 'INACTIVE') {
      throw new ConflictException('This invitation is no longer active.');
    }

    return invitation;
  }

  private async getInvitationForRecipient(
    userId: string,
    rawToken: string,
  ): Promise<InvitationLookupRecord> {
    const invitation = await this.findInvitationByRawToken(rawToken);

    if (invitation.userId !== userId) {
      throw new ForbiddenException(
        'This invitation was issued to a different verified account.',
      );
    }

    return invitation;
  }

  private async recordInvitationOpened(
    invitation: InvitationLookupRecord,
    context: AccessAuditContext,
  ) {
    if (invitation.invitationOpenedAt) {
      return;
    }

    const openedAt = new Date();
    await this.prisma.documentCollaborator.update({
      where: { id: invitation.id },
      data: {
        invitationOpenedAt: openedAt,
      },
    });

    await this.recordAccessAudit({
      documentId: invitation.documentId,
      collaboratorId: invitation.id,
      actorUserId: null,
      targetUserId: invitation.userId,
      eventType: DocumentAccessAuditEvent.INVITE_OPENED,
      fromPermissions: invitation.permissions,
      toPermissions: invitation.permissions,
      invitationStatus: invitation.invitationStatus,
      metadata: {
        openedAt: openedAt.toISOString(),
      },
      ...context,
    });
  }

  private async recordAccessAudit(params: {
    documentId: string;
    collaboratorId: string | null;
    actorUserId: string | null;
    targetUserId: string | null;
    eventType: DocumentAccessAuditEvent;
    fromPermissions: CollaboratorPermission[];
    toPermissions: CollaboratorPermission[];
    invitationStatus: CollaboratorInvitationStatus | null;
    metadata: Prisma.InputJsonValue | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  }) {
    await this.prisma.documentAccessAuditLog.create({
      data: {
        documentId: params.documentId,
        collaboratorId: params.collaboratorId ?? undefined,
        actorUserId: params.actorUserId ?? undefined,
        targetUserId: params.targetUserId ?? undefined,
        eventType: params.eventType,
        fromPermissions: params.fromPermissions,
        toPermissions: params.toPermissions,
        invitationStatus: params.invitationStatus ?? undefined,
        metadata: params.metadata ?? undefined,
        ipAddress: params.ipAddress ?? undefined,
        userAgent: params.userAgent ?? undefined,
      },
    });
  }

  private async assertFolderOwner(userId: string, folderId: string) {
    const folder = await this.prisma.documentFolder.findUnique({
      where: { id: folderId },
    });
    if (!folder) throw new NotFoundException('Folder not found.');
    if (folder.ownerId !== userId) {
      throw new ForbiddenException('You do not own this folder.');
    }
  }

  private async resolveCopyFolderId(
    userId: string,
    document: { ownerId: string; folderId: string | null },
  ) {
    if (!document.folderId || document.ownerId !== userId) {
      return null;
    }

    const folder = await this.prisma.documentFolder.findUnique({
      where: { id: document.folderId },
      select: { ownerId: true },
    });

    return folder?.ownerId === userId ? document.folderId : null;
  }

  private async createVersionSnapshot(
    documentId: string,
    userId: string,
    content: unknown,
    versionNumber: number,
  ) {
    const versionKey = documentVersionKey(documentId, versionNumber);
    await this.s3.putJson(versionKey, content);

    await this.prisma.documentVersion.create({
      data: {
        documentId,
        versionNumber,
        s3Key: versionKey,
        savedById: userId,
      },
    });
  }

  private async pruneOldVersions(documentId: string) {
    const oldest = await this.prisma.documentVersion.findMany({
      where: { documentId },
      orderBy: { versionNumber: 'asc' },
      take: 10,
      select: { id: true, s3Key: true },
    });

    for (const v of oldest) {
      await this.s3.delete(v.s3Key);
      await this.prisma.documentVersion.delete({ where: { id: v.id } });
    }
  }

  /**
   * Computes the next available copy title for a user by combining their
   * existing matching titles with the pure naming rule from the content
   * helper.
   *
   * @param userId - Owner whose existing copies should be inspected.
   * @param baseTitle - Title with any prior copy suffix already stripped.
   * @returns The new title to assign to the freshly created copy.
   */
  private async buildNextCopyTitle(userId: string, baseTitle: string) {
    const copyStem = `${baseTitle} Copy`;

    // Pull only the titles we need so the pure helper can compute the next slot.
    const matches = await this.prisma.document.findMany({
      where: {
        ownerId: userId,
        isDeleted: false,
        title: { startsWith: copyStem },
      },
      select: { title: true },
    });

    return buildNextCopyTitleFromExistingTitles(
      baseTitle,
      matches.map((row) => row.title),
    );
  }

  private async buildSignatureSnapshot(
    doc: Record<string, unknown>,
    certificateId?: string | null,
  ) {
    const signatureId =
      typeof doc['personalSignedDocumentId'] === 'string'
        ? doc['personalSignedDocumentId']
        : null;
    const signerName =
      typeof doc['signerDisplayName'] === 'string' &&
      doc['signerDisplayName'].trim()
        ? doc['signerDisplayName']
        : null;
    const signatureImageS3Key =
      typeof doc['signatureImageS3Key'] === 'string'
        ? doc['signatureImageS3Key']
        : null;
    const mimeType =
      typeof doc['signatureImageMimeType'] === 'string'
        ? doc['signatureImageMimeType']
        : null;
    const sizeBytes =
      typeof doc['signatureImageSizeBytes'] === 'number'
        ? doc['signatureImageSizeBytes']
        : null;
    // Prefer stored x/y; fall back to position derived from legacy alignment enum.
    const storedX =
      typeof doc['signatureBlockX'] === 'number'
        ? doc['signatureBlockX']
        : null;
    const storedY =
      typeof doc['signatureBlockY'] === 'number'
        ? doc['signatureBlockY']
        : null;
    const fallback = alignmentToSignaturePosition(
      typeof doc['signatureBlockAlignment'] === 'string'
        ? doc['signatureBlockAlignment']
        : null,
    );
    const x = storedX ?? fallback.x;
    const y = storedY ?? fallback.y;

    if (!signatureId && !signerName && !signatureImageS3Key) {
      return null;
    }

    let resolvedCertificateId = certificateId ?? null;

    if (!resolvedCertificateId && signatureId) {
      const signedDoc = await this.prisma.personalSignedDocument.findUnique({
        where: { id: signatureId },
        select: { certificateId: true },
      });
      resolvedCertificateId = signedDoc?.certificateId ?? null;
    }

    let imageUrl: string | null = null;
    if (signatureImageS3Key) {
      try {
        imageUrl = await this.s3.getPresignedUrl(signatureImageS3Key, 3600);
      } catch (error) {
        this.logger.warn(
          `Failed to create signature snapshot URL for key ${signatureImageS3Key}: ${String(error)}`,
        );
      }
    }

    return {
      signatureId,
      certificateId: resolvedCertificateId,
      signerName,
      imageUrl,
      mimeType,
      sizeBytes,
      x,
      y,
      signedAt: doc['signedAt'] ?? null,
      lockedAt: doc['lockedAt'] ?? null,
    };
  }
}
