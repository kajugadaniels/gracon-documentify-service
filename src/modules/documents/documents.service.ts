import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import {
  CollaboratorInvitationStatus,
  CollaboratorPermission,
  CollaboratorRole,
  DocumentAccessAuditEvent,
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
import { LockDocumentDto } from './dto/lock-document.dto';
import {
  QueryDocumentsDto,
  type DocumentListScope,
} from './dto/query-documents.dto';
import {
  ShareDocumentAccessDto,
  UpdateDocumentAccessDto,
  type CollaboratorPermissionValue,
} from './dto/manage-access.dto';
import { CreateDocumentCommentDto } from './dto/document-comment.dto';

// Default empty Tiptap document structure
const EMPTY_RICH_TEXT_CONTENT = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

// Default empty spreadsheet structure
const EMPTY_SPREADSHEET_CONTENT = {
  type: 'spreadsheet',
  sheets: [
    {
      id: 'sheet-1',
      name: 'Sheet 1',
      rows: 50,
      cols: 26,
      cells: {},
    },
  ],
};

// Default position — bottom-right area of the A4 page (normalized 0–1)
const DEFAULT_SIGNATURE_X = 0.57;
const DEFAULT_SIGNATURE_Y = 0.78;
const DEFAULT_INVITATION_EXPIRY_DAYS = 7;
const SIGNATURE_REMINDER_COOLDOWN_MS = 15 * 60 * 1000;
const CANONICAL_PERMISSION_ORDER: CollaboratorPermission[] = [
  CollaboratorPermission.READ,
  CollaboratorPermission.COMMENT,
  CollaboratorPermission.SIGN,
  CollaboratorPermission.EDIT,
  CollaboratorPermission.MANAGE_ACCESS,
];

type AccessAuditContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type CollaboratorAccessRecord = {
  id: string;
  userId: string;
  role: CollaboratorRole;
  permissions: CollaboratorPermission[];
  invitationStatus: CollaboratorInvitationStatus;
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

type CollaboratorWithProfile = CollaboratorAccessRecord & {
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

type InvitationLookupRecord = {
  id: string;
  documentId: string;
  userId: string;
  permissions: CollaboratorPermission[];
  invitationStatus: CollaboratorInvitationStatus;
  invitationTokenHash: string | null;
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

type DocumentAccessCollaboratorSummary = {
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

type DocumentCommentAuthorRecord = {
  id: string;
  email: string;
  imageUrl: string | null;
  citizenIdentity: {
    surName: string;
    postNames: string;
  } | null;
};

type DocumentCommentReplyRecord = {
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

type DocumentCommentRecord = DocumentCommentReplyRecord & {
  replies: DocumentCommentReplyRecord[];
};

const SIGNATURE_REQUEST_SUMMARY_SELECT = {
  id: true,
  requestedById: true,
  requestedUserId: true,
  status: true,
  personalSignedDocumentId: true,
  signedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DocumentSignatureRequestSelect;

const SIGNATURE_REQUEST_PROGRESS_SELECT = {
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

type SignatureRequestBaseRecord = Prisma.DocumentSignatureRequestGetPayload<{
  select: typeof SIGNATURE_REQUEST_SUMMARY_SELECT;
}>;

type SignatureRequestProgressRecord =
  Prisma.DocumentSignatureRequestGetPayload<{
    select: typeof SIGNATURE_REQUEST_PROGRESS_SELECT;
  }>;

type SignatureRequestUserSummary = {
  id: string;
  email: string;
  imageUrl: string | null;
  displayName: string;
  surName: string | null;
  postNames: string | null;
};

type SignatureRequestSummary = SignatureRequestBaseRecord & {
  requestedUser?: SignatureRequestUserSummary | null;
  nextReminderAvailableAt?: Date | null;
};

type SignedDocumentForLock = {
  id: string;
  userId: string;
  signedAt: Date;
  certificateId: string;
};

// Backward-compat: derive x/y from old alignment enum for documents
// that were locked before free placement was introduced.
function alignmentToPosition(
  alignment: string | null | undefined,
): { x: number; y: number } {
  if (alignment === 'LEFT') return { x: 0.02, y: DEFAULT_SIGNATURE_Y };
  if (alignment === 'CENTER') return { x: 0.29, y: DEFAULT_SIGNATURE_Y };
  return { x: DEFAULT_SIGNATURE_X, y: DEFAULT_SIGNATURE_Y };
}

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

      initialContent = this.resolveTemplateVariables(
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

    return this.formatDocument(updated);
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

    const baseTitle = this.stripCopySuffix(source.title);
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
      },
    });

    const contentKey = documentContentKey(copy.id);
    await this.s3.putJson(contentKey, content);

    const updated = await this.prisma.document.update({
      where: { id: copy.id },
      data: { s3ContentKey: contentKey },
    });

    await this.createVersionSnapshot(copy.id, userId, content, 1);

    return this.formatDocument(updated);
  }

  // ─── List ────────────────────────────────────────────────────────────────────

  async findAll(userId: string, dto: QueryDocumentsDto) {
    const skip = ((dto.page ?? 1) - 1) * (dto.limit ?? 20);
    const scope = dto.scope ?? 'ALL_ACCESSIBLE';
    const baseWhere: Prisma.DocumentWhereInput = {
      isDeleted: false,
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.type ? { type: dto.type } : {}),
      ...(dto.folderId ? { folderId: dto.folderId } : {}),
      ...(dto.search
        ? {
            title: {
              contains: dto.search,
              mode: Prisma.QueryMode.insensitive,
            },
          }
        : {}),
    };

    const acceptedSharedAccess: Prisma.DocumentCollaboratorWhereInput = {
      userId,
      isActive: true,
      acceptedAt: { not: null },
      invitationStatus: CollaboratorInvitationStatus.ACCEPTED,
      permissions: { has: CollaboratorPermission.READ },
    };
    const where = this.buildDocumentListWhere(
      userId,
      scope,
      baseWhere,
      acceptedSharedAccess,
    );

    const [total, items] = await Promise.all([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: dto.limit ?? 20,
        select: {
          id: true,
          ownerId: true,
          title: true,
          type: true,
          status: true,
          tags: true,
          wordCount: true,
          folderId: true,
          createdAt: true,
          updatedAt: true,
          signedAt: true,
          lockedAt: true,
          collaborators: {
            where: { userId },
            select: {
              id: true,
              userId: true,
              role: true,
              permissions: true,
              acceptedAt: true,
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
      }),
    ]);

    return {
      total,
      page: dto.page ?? 1,
      limit: dto.limit ?? 20,
      items: items.map((item) => ({
        ...this.formatDocument(item),
        access: this.buildDocumentAccessSummary(userId, item),
      })),
    };
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
    const result: Record<string, unknown> = this.formatDocument(document);
    result['access'] = this.buildDocumentAccessSummary(userId, document);
    result['signatureRequests'] = canManageAccess
      ? await this.getSignatureRequestSummaries(documentId, true)
      : document.signatureRequests;
    result['collaborators'] = canManageAccess
      ? document.collaborators.map((collaborator) =>
          this.formatCollaboratorAccess(collaborator),
        )
      : [];

    // Fetch content from S3 if requested and key exists
    if (includeContent && document.s3ContentKey) {
      try {
        result['content'] = await this.s3.getJson(document.s3ContentKey);
      } catch {
        // If S3 fetch fails, return without content but don't throw
        result['content'] = null;
        this.logger.warn(`Failed to fetch content for document ${documentId}`);
      }
    }

    result['signatureSnapshot'] = await this.buildSignatureSnapshot(document);

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
        this.formatCollaboratorAccess(collaborator),
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

    const limit = this.resolveAuditLimit(rawLimit);
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
        actor: event.actorUser
          ? this.formatAuditUser(event.actorUser)
          : null,
        target: event.targetUser
          ? this.formatAuditUser(event.targetUser)
          : null,
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
          if (leftResolved !== rightResolved) return leftResolved - rightResolved;
          return right.createdAt.getTime() - left.createdAt.getTime();
        })
        .map((comment) => this.formatDocumentComment(comment)),
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
        throw new ConflictException('Resolved comments cannot receive replies.');
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
        anchored: Boolean(anchorText && anchorFrom !== null && anchorTo !== null),
      },
    });

    return this.formatDocumentComment(comment);
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

    return this.formatDocumentComment(comment);
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
    if (!actorIsOwner && permissions.includes(CollaboratorPermission.MANAGE_ACCESS)) {
      throw new ForbiddenException(
        'Only the document owner can grant manage-access permission.',
      );
    }

    const role = this.deriveLegacyRole(permissions);
    const invitationExpiresAt = this.buildInvitationExpiry(dto.expiresInDays);

    const existing = await this.prisma.documentCollaborator.findUnique({
      where: { documentId_userId: { documentId, userId: dto.userId } },
      select: {
        id: true,
        userId: true,
        permissions: true,
        invitationStatus: true,
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
          acceptUrl: this.buildInvitationUrl(rawInvitationToken),
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
            sentAt: finalCollaborator.invitationEmailSentAt?.toISOString() ?? null,
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
              error instanceof Error ? error.message : 'Invitation email delivery failed.',
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
      ...this.formatCollaboratorAccess(finalCollaborator),
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
        collaborator.permissions.includes(CollaboratorPermission.MANAGE_ACCESS) ||
        permissions.includes(CollaboratorPermission.MANAGE_ACCESS);

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

    return this.formatCollaboratorAccess(updated);
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
      throw new ForbiddenException('You cannot resend an invitation to yourself.');
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
    const invitationExpiresAt = this.buildInvitationExpiry();
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
        acceptUrl: this.buildInvitationUrl(rawInvitationToken),
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
          sentAt: finalCollaborator.invitationEmailSentAt?.toISOString() ?? null,
        },
        ...context,
      });
    } catch (error) {
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
          message:
            error instanceof Error ? error.message : 'Invitation email delivery failed.',
        },
        ...context,
      });
    }

    return {
      ...this.formatCollaboratorAccess(finalCollaborator),
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
        signUrl: this.buildDocumentEditUrl(documentId),
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
    } catch (error) {
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
    await this.lockDocumentIfAllRequiredSignaturesComplete(
      documentId,
      document.ownerId,
    );

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

  async getInvitationReview(
    userId: string,
    rawToken: string,
    context: AccessAuditContext = {},
  ) {
    const invitation = await this.getInvitationForRecipient(userId, rawToken);
    await this.recordInvitationOpened(invitation, context);

    return {
      status: 'pending',
      document: {
        id: invitation.document.id,
        title: invitation.document.title,
      },
      invitation: {
        permissions: invitation.permissions,
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
    };
  }

  async acceptInvitation(
    userId: string,
    rawToken: string,
    context: AccessAuditContext = {},
  ) {
    const invitation = await this.getInvitationForRecipient(userId, rawToken);
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

    const updated = await this.prisma.document.update({
      where: { id: document.id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
      },
    });

    return this.formatDocument(updated);
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

    const signerIds = await this.getRequiredSignerIdsForDocument(
      documentId,
      document.ownerId,
    );

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
      ...this.formatDocument(updated),
      contentHash,
      signatureRequests,
      pendingSignatureCount:
        this.countUnsignedSignatureRequestSummaries(signatureRequests),
      message:
        'Document finalised. The content is now frozen. Proceed to sign at api/signature/.',
    };
  }

  // ─── Lock (called after signing is complete) ──────────────────────────────────

  async lock(userId: string, documentId: string, dto: LockDocumentDto) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document || document.isDeleted)
      throw new NotFoundException('Document not found.');
    await this.assertCanSign(userId, documentId, document.ownerId);

    if (document.status !== 'FINALISED' && document.status !== 'SIGNED') {
      throw new ConflictException(
        `Document must be in FINALISED or SIGNED status to lock. Current status: ${document.status}.`,
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

    const signatureRequest = await this.ensureSignatureRequestForUser(
      documentId,
      document.ownerId,
      userId,
    );

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
        },
      });

    if (recordedSignature.count === 0) {
      throw new ConflictException('You have already signed this document.');
    }

    const pendingSignatureCount =
      await this.countUnsignedSignatureRequests(documentId);

    if (pendingSignatureCount > 0) {
      return {
        ...this.formatDocument(document),
        signatureRequests: await this.getSignatureRequestSummaries(
          documentId,
          includeSignerProfiles,
        ),
        signatureSnapshot: await this.buildSignatureSnapshot(document),
        signatureId: dto.signatureId,
        pendingSignatureCount,
        message:
          'Signature recorded. The document will lock after all required signers complete signing.',
      };
    }

    const updated = await this.lockDocumentIfAllRequiredSignaturesComplete(
      documentId,
      document.ownerId,
      signedDoc.id,
    );

    if (!updated) {
      throw new ConflictException(
        'No completed signature is available to lock this document.',
      );
    }

    return {
      ...this.formatDocument(updated),
      signatureSnapshot: await this.buildSignatureSnapshot(updated),
      signatureId: dto.signatureId,
      signatureRequests: await this.getSignatureRequestSummaries(
        documentId,
        includeSignerProfiles,
      ),
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
        signatureBlockX: dto.x ?? document.signatureBlockX ?? DEFAULT_SIGNATURE_X,
        signatureBlockY: dto.y ?? document.signatureBlockY ?? DEFAULT_SIGNATURE_Y,
      },
    });

    return {
      ...this.formatDocument(updated),
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
    ownerId: string,
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

    return Array.from(
      new Set([ownerId, ...collaborators.map((entry) => entry.userId)]),
    );
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
      ...this.formatSignatureRequestSummary(request),
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
      return;
    }

    await this.removeUnsignedSignatureRequest(input.documentId, input.userId);
    await this.lockDocumentIfAllRequiredSignaturesComplete(
      input.documentId,
      document.ownerId,
    );
  }

  private collaboratorRequiresSignature(input: {
    permissions: CollaboratorPermission[];
    invitationStatus: CollaboratorInvitationStatus;
    acceptedAt: Date | null;
    isActive: boolean;
  }): boolean {
    return (
      input.isActive &&
      input.acceptedAt !== null &&
      input.invitationStatus === CollaboratorInvitationStatus.ACCEPTED &&
      input.permissions.includes(CollaboratorPermission.SIGN)
    );
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
      (event) =>
        this.getSignatureReminderRequestId(event.metadata) === requestId,
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
      const requestId = this.getSignatureReminderRequestId(event.metadata);
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

  private getSignatureReminderRequestId(
    metadata: Prisma.JsonValue | null,
  ): string | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const requestId = (metadata as Record<string, unknown>)['requestId'];
    return typeof requestId === 'string' ? requestId : null;
  }

  private async lockDocumentIfAllRequiredSignaturesComplete(
    documentId: string,
    ownerId: string,
    fallbackSignedDocumentId?: string,
  ) {
    if ((await this.countUnsignedSignatureRequests(documentId)) > 0) {
      return null;
    }

    const primarySignature = await this.resolvePrimarySignedDocument(
      documentId,
      ownerId,
      fallbackSignedDocumentId,
    );
    if (!primarySignature) return null;

    const signatureSnapshot = await this.buildSignerSnapshot(
      primarySignature.userId,
    );
    await this.prisma.document.updateMany({
      where: {
        id: documentId,
        status: { in: [DocumentStatus.FINALISED, DocumentStatus.SIGNED] },
      },
      data: {
        status: DocumentStatus.LOCKED,
        personalSignedDocumentId: primarySignature.id,
        signedAt: primarySignature.signedAt,
        lockedAt: new Date(),
        signerDisplayName: signatureSnapshot.signerDisplayName,
        signatureImageS3Key: signatureSnapshot.signatureImageS3Key,
        signatureImageMimeType: signatureSnapshot.signatureImageMimeType,
        signatureImageSizeBytes: signatureSnapshot.signatureImageSizeBytes,
        signatureBlockX: DEFAULT_SIGNATURE_X,
        signatureBlockY: DEFAULT_SIGNATURE_Y,
      },
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
      select: { personalSignedDocumentId: true },
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
          select: { personalSignedDocumentId: true },
        });
    const signatureId =
      ownerRequest?.personalSignedDocumentId ??
      fallbackSignedDocumentId ??
      firstRequest?.personalSignedDocumentId ??
      null;

    if (!signatureId) return null;

    return this.prisma.personalSignedDocument.findUnique({
      where: { id: signatureId },
      select: { id: true, userId: true, signedAt: true, certificateId: true },
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
      signatureImageS3Key: activeSignatureImage?.s3Key ?? null,
      signatureImageMimeType: activeSignatureImage?.mimeType ?? null,
      signatureImageSizeBytes: activeSignatureImage?.sizeBytes ?? null,
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
    collaborator:
      | {
          role: CollaboratorRole;
          permissions: CollaboratorPermission[];
          invitationStatus: CollaboratorInvitationStatus;
          acceptedAt: Date | null;
          isActive: boolean;
        }
      | null,
    permission: CollaboratorPermission,
  ): boolean {
    if (!collaborator) {
      return false;
    }

    if (
      !collaborator.isActive ||
      collaborator.acceptedAt === null ||
      collaborator.invitationStatus !== CollaboratorInvitationStatus.ACCEPTED
    ) {
      return false;
    }

    return this.getEffectivePermissions(collaborator).includes(permission);
  }

  private getEffectivePermissions(collaborator: {
    role: CollaboratorRole;
    permissions: CollaboratorPermission[];
  }): CollaboratorPermission[] {
    if (collaborator.permissions.length > 0) {
      return collaborator.permissions;
    }

    return this.getLegacyPermissions(collaborator.role);
  }

  private getLegacyPermissions(
    role: CollaboratorRole,
  ): CollaboratorPermission[] {
    if (role === CollaboratorRole.EDITOR) {
      return [
        CollaboratorPermission.READ,
        CollaboratorPermission.COMMENT,
        CollaboratorPermission.EDIT,
      ];
    }

    if (role === CollaboratorRole.SIGNER) {
      return [CollaboratorPermission.READ, CollaboratorPermission.SIGN];
    }

    return [CollaboratorPermission.READ, CollaboratorPermission.COMMENT];
  }

  private buildDocumentListWhere(
    userId: string,
    scope: DocumentListScope,
    baseWhere: Prisma.DocumentWhereInput,
    acceptedSharedAccess: Prisma.DocumentCollaboratorWhereInput,
  ): Prisma.DocumentWhereInput {
    if (scope === 'OWNED') {
      return {
        ...baseWhere,
        ownerId: userId,
      };
    }

    if (scope === 'SHARED_WITH_ME') {
      return {
        ...baseWhere,
        ownerId: { not: userId },
        collaborators: { some: acceptedSharedAccess },
      };
    }

    return {
      ...baseWhere,
      OR: [
        { ownerId: userId },
        {
          ownerId: { not: userId },
          collaborators: { some: acceptedSharedAccess },
        },
      ],
    };
  }

  private buildDocumentAccessSummary(
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
      role: isOwner ? 'OWNER' : collaborator?.role ?? null,
      collaboratorId: collaborator?.id ?? null,
      permissions: isOwner
        ? CANONICAL_PERMISSION_ORDER
        : collaborator
          ? this.getEffectivePermissions(collaborator)
          : [],
      acceptedAt: collaborator?.acceptedAt ?? null,
      sharedBy:
        !isOwner && collaborator?.invitedBy
          ? {
              id: collaborator.invitedBy.id,
              email: collaborator.invitedBy.email,
              displayName: this.getInviterDisplayName(collaborator.invitedBy),
            }
          : null,
    };
  }

  private resolveAuditLimit(rawLimit?: string): number {
    const parsed = rawLimit ? Number.parseInt(rawLimit, 10) : 50;
    if (!Number.isInteger(parsed)) {
      return 50;
    }

    return Math.min(Math.max(parsed, 1), 100);
  }

  private sanitizeAccessAuditMetadata(
    metadata: Prisma.JsonValue | null,
  ): Record<string, unknown> | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const source = metadata as Record<string, unknown>;
    const allowedKeys = [
      'acceptedAt',
      'anchored',
      'commentId',
      'declinedAt',
      'expiresAt',
      'notePresent',
      'openedAt',
      'parentCommentId',
      'previousStatus',
      'resent',
      'resolvedAt',
      'sentAt',
    ];
    const sanitized: Record<string, unknown> = {};

    for (const key of allowedKeys) {
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

  private formatAuditUser(user: {
    id: string;
    email: string;
    citizenIdentity: {
      surName: string;
      postNames: string;
    } | null;
  }) {
    return {
      id: user.id,
      email: user.email,
      displayName: this.formatUserDisplayName(
        user.citizenIdentity?.postNames ?? null,
        user.citizenIdentity?.surName ?? null,
        user.email,
      ),
    };
  }

  private formatSignatureRequestSummary(
    request: SignatureRequestProgressRecord,
  ): SignatureRequestSummary {
    const requestedUser = request.requestedUser;

    return {
      id: request.id,
      requestedById: request.requestedById,
      requestedUserId: request.requestedUserId,
      status: request.status,
      personalSignedDocumentId: request.personalSignedDocumentId,
      signedAt: request.signedAt,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      requestedUser: {
        id: requestedUser.id,
        email: requestedUser.email,
        imageUrl: requestedUser.imageUrl,
        displayName: this.formatUserDisplayName(
          requestedUser.citizenIdentity?.postNames ?? null,
          requestedUser.citizenIdentity?.surName ?? null,
          requestedUser.email,
        ),
        surName: requestedUser.citizenIdentity?.surName ?? null,
        postNames: requestedUser.citizenIdentity?.postNames ?? null,
      },
    };
  }

  private formatDocumentComment(comment: DocumentCommentRecord) {
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
      author: this.formatCommentAuthor(comment.author),
      replies: comment.replies.map((reply) =>
        this.formatDocumentCommentReply(reply),
      ),
    };
  }

  private formatDocumentCommentReply(reply: DocumentCommentReplyRecord) {
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
      author: this.formatCommentAuthor(reply.author),
      replies: [],
    };
  }

  private formatCommentAuthor(user: DocumentCommentAuthorRecord) {
    return {
      id: user.id,
      email: user.email,
      imageUrl: user.imageUrl,
      displayName: this.formatUserDisplayName(
        user.citizenIdentity?.postNames ?? null,
        user.citizenIdentity?.surName ?? null,
        user.email,
      ),
    };
  }

  private normalizePermissions(
    permissions: CollaboratorPermissionValue[],
  ): CollaboratorPermission[] {
    const unique = new Set<CollaboratorPermission>();

    for (const permission of permissions) {
      unique.add(permission as CollaboratorPermission);
    }

    if (unique.size === 0) {
      throw new BadRequestException(
        'At least one permission must be granted to share this document.',
      );
    }

    if (unique.size > 0) {
      unique.add(CollaboratorPermission.READ);
    }

    return CANONICAL_PERMISSION_ORDER.filter((permission) =>
      unique.has(permission),
    );
  }

  private deriveLegacyRole(
    permissions: CollaboratorPermission[],
  ): CollaboratorRole {
    if (permissions.includes(CollaboratorPermission.EDIT)) {
      return CollaboratorRole.EDITOR;
    }

    if (permissions.includes(CollaboratorPermission.SIGN)) {
      return CollaboratorRole.SIGNER;
    }

    return CollaboratorRole.VIEWER;
  }

  private buildInvitationExpiry(expiresInDays?: number): Date {
    const days = expiresInDays ?? DEFAULT_INVITATION_EXPIRY_DAYS;
    const safeDays = Math.min(Math.max(days, 1), 30);
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + safeDays);
    return expiry;
  }

  private buildInvitationUrl(rawToken: string): string {
    const baseUrl = this.resolveDocumentsFrontendUrl();
    return `${baseUrl}/invitations/${encodeURIComponent(rawToken)}`;
  }

  private buildDocumentEditUrl(documentId: string): string {
    const baseUrl = this.resolveDocumentsFrontendUrl();
    return `${baseUrl}/documents/${encodeURIComponent(documentId)}/edit`;
  }

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

  private describePermissions(
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

  private describeInvitationExpiry(expiry: Date): string {
    const diffMs = expiry.getTime() - Date.now();
    const days = Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
    return days === 1 ? '1 day' : `${days} days`;
  }

  private formatUserDisplayName(
    postNames: string | null,
    surName: string | null,
    fallback: string,
  ): string {
    const fullName = `${postNames ?? ''} ${surName ?? ''}`.trim();
    return fullName || fallback;
  }

  private getInviterDisplayName(
    invitedBy: CollaboratorWithProfile['invitedBy'] | InvitationLookupRecord['invitedBy'],
  ): string {
    if (!invitedBy) {
      return 'A verified user';
    }

    return this.formatUserDisplayName(
      invitedBy.citizenIdentity?.postNames ?? null,
      invitedBy.citizenIdentity?.surName ?? null,
      invitedBy.email,
    );
  }

  private maskEmail(email: string): string {
    const [localPart, domain = ''] = email.split('@');
    if (!localPart) {
      return email;
    }

    const visiblePrefix = localPart.slice(0, 2);
    return `${visiblePrefix}${'*'.repeat(Math.max(localPart.length - 2, 2))}@${domain}`;
  }

  private assertInvitationTokenFormat(rawToken: string) {
    if (!/^[a-f0-9]{64}$/i.test(rawToken)) {
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

    if (!this.encryption.compareHash(rawToken, invitation.invitationTokenHash)) {
      throw new NotFoundException('Invitation not found or expired.');
    }

    if (invitation.document.isDeleted) {
      throw new NotFoundException('Invitation not found or expired.');
    }

    if (
      invitation.invitationStatus === CollaboratorInvitationStatus.PENDING &&
      invitation.invitationExpiresAt &&
      invitation.invitationExpiresAt.getTime() <= Date.now()
    ) {
      await this.prisma.documentCollaborator.update({
        where: { id: invitation.id },
        data: {
          invitationStatus: CollaboratorInvitationStatus.EXPIRED,
          isActive: false,
        },
      });

      throw new ConflictException('This invitation has expired.');
    }

    if (invitation.invitationStatus !== CollaboratorInvitationStatus.PENDING) {
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

  private formatCollaboratorAccess(collaborator: CollaboratorWithProfile) {
    const displayName = this.formatUserDisplayName(
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
            displayName: this.getInviterDisplayName(collaborator.invitedBy),
          }
        : null,
    };
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

  private resolveTemplateVariables(
    content: Record<string, unknown>,
    variables: Record<string, string>,
  ): Record<string, unknown> {
    const contentStr = JSON.stringify(content);
    const resolved = contentStr.replace(
      /\{\{([A-Z_]+)\}\}/g,
      (_, key: string) => variables[key] ?? `{{${key}}}`,
    );
    return JSON.parse(resolved) as Record<string, unknown>;
  }

  private stripCopySuffix(title: string) {
    const normalized = title.trim() || 'Untitled Document';
    return normalized.replace(/ Copy(?: \(\d+\))?$/, '');
  }

  private async buildNextCopyTitle(userId: string, baseTitle: string) {
    const copyStem = `${baseTitle} Copy`;
    const matches = await this.prisma.document.findMany({
      where: {
        ownerId: userId,
        isDeleted: false,
        title: { startsWith: copyStem },
      },
      select: { title: true },
    });

    const usedNumbers = new Set<number>();
    let hasPlainCopy = false;

    for (const match of matches) {
      if (match.title === copyStem) {
        hasPlainCopy = true;
        continue;
      }

      const suffix = match.title.slice(copyStem.length);
      const numberedMatch = suffix.match(/^ \((\d+)\)$/);
      if (!numberedMatch) continue;

      const value = Number.parseInt(numberedMatch[1], 10);
      if (Number.isInteger(value) && value >= 1) {
        usedNumbers.add(value);
      }
    }

    if (!hasPlainCopy) {
      return copyStem;
    }

    let nextNumber = 1;
    while (usedNumbers.has(nextNumber)) {
      nextNumber += 1;
    }

    return `${copyStem} (${nextNumber})`;
  }

  private formatDocument(doc: Record<string, unknown>) {
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
      signatureSnapshot: null,
    };
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
    const storedX = typeof doc['signatureBlockX'] === 'number' ? doc['signatureBlockX'] : null;
    const storedY = typeof doc['signatureBlockY'] === 'number' ? doc['signatureBlockY'] : null;
    const fallback = alignmentToPosition(
      typeof doc['signatureBlockAlignment'] === 'string'
        ? (doc['signatureBlockAlignment'] as string)
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
