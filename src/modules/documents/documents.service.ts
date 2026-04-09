import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { S3Service } from '../../common/s3/s3.service';
import {
  hashDocumentContent,
  documentContentKey,
  documentVersionKey,
} from '../../common/helpers/hash.helper';
import { CreateDocumentDto } from './dto/create-document.dto';
import {
  UpdateDocumentDto,
  AutosaveDocumentDto,
} from './dto/update-document.dto';
import { FinaliseDocumentDto } from './dto/finalise-document.dto';
import { LockDocumentDto } from './dto/lock-document.dto';
import { QueryDocumentsDto } from './dto/query-documents.dto';

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

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly maxVersions: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly config: ConfigService,
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

  // ─── List ────────────────────────────────────────────────────────────────────

  async findAll(userId: string, dto: QueryDocumentsDto) {
    const skip = ((dto.page ?? 1) - 1) * (dto.limit ?? 20);

    const where = {
      ownerId: userId,
      isDeleted: false,
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.type ? { type: dto.type } : {}),
      ...(dto.folderId ? { folderId: dto.folderId } : {}),
      ...(dto.search
        ? { title: { contains: dto.search, mode: 'insensitive' as const } }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: dto.limit ?? 20,
        select: {
          id: true,
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
        },
      }),
    ]);

    return {
      total,
      page: dto.page ?? 1,
      limit: dto.limit ?? 20,
      items,
    };
  }

  // ─── Get one ─────────────────────────────────────────────────────────────────

  async findOne(userId: string, documentId: string, includeContent = true) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        collaborators: {
          where: { isActive: true },
          select: {
            userId: true,
            isActive: true,
            role: true,
            acceptedAt: true,
          },
        },
        signatureRequests: {
          select: { requestedUserId: true, status: true },
        },
      },
    });

    if (!document || document.isDeleted) {
      throw new NotFoundException('Document not found.');
    }

    // Access check — owner or active collaborator
    this.assertDocumentAccess(userId, document);

    const result: Record<string, unknown> = this.formatDocument(document);

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

    return result;
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

    // Update status and store hash
    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: 'FINALISED',
        contentHash,
        finalisedAt: new Date(),
      },
    });

    return {
      ...this.formatDocument(updated),
      contentHash,
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
    if (document.ownerId !== userId)
      throw new ForbiddenException('Only the document owner can lock it.');

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

    // Lock the document
    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: 'LOCKED',
        personalSignedDocumentId: dto.signatureId,
        signedAt: signedDoc.signedAt,
        lockedAt: new Date(),
      },
    });

    return {
      ...this.formatDocument(updated),
      signatureId: dto.signatureId,
      message: 'Document locked. It is now permanently immutable.',
    };
  }

  // ─── Version history ─────────────────────────────────────────────────────────

  async getVersions(userId: string, documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!document || document.isDeleted)
      throw new NotFoundException('Document not found.');
    this.assertDocumentAccess(userId, document);

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
        name: `${document.owner?.citizenIdentity?.postNames ?? ''} ${document.owner?.citizenIdentity?.surName ?? ''}`.trim(),
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

    // Must be owner or an EDITOR collaborator
    const isOwner = document.ownerId === userId;
    if (!isOwner) {
      const collab = await this.prisma.documentCollaborator.findUnique({
        where: { documentId_userId: { documentId, userId } },
      });
      if (!collab?.isActive || collab.role !== 'EDITOR') {
        throw new ForbiddenException(
          'You do not have edit access to this document.',
        );
      }
    }

    return document;
  }

  private assertDocumentAccess(
    userId: string,
    document: {
      ownerId: string;
      collaborators?: { userId: string; isActive: boolean }[];
    },
  ) {
    const isOwner = document.ownerId === userId;
    if (isOwner) return;

    const isCollaborator = document.collaborators?.some(
      (c) => c.userId === userId && c.isActive,
    );

    if (!isCollaborator) {
      throw new ForbiddenException('You do not have access to this document.');
    }
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
    };
  }
}
