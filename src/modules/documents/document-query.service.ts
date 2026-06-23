/**
 * document-query.service.ts
 *
 * Owns document-list reads for the documents module. Keeping list query
 * orchestration here reduces the size and risk of the lifecycle service.
 */
import { Injectable } from '@nestjs/common';
import {
  CollaboratorInvitationStatus,
  CollaboratorPermission,
  Prisma,
} from '@gracon/database';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueryDocumentsDto } from './dto/query-documents.dto';
import {
  buildDocumentAccessSummary,
  formatDocumentRecord,
} from './helpers/document-format.helper';
import { buildDocumentListWhere } from './helpers/document-query.helper';

/**
 * Handles read-only document list queries for owned and shared documents.
 */
@Injectable()
export class DocumentQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lists documents accessible to the current user with owner/share scope rules.
   *
   * @param userId Authenticated user requesting the list.
   * @param dto Query parameters and filters.
   * @returns Paginated document summaries with access metadata.
   */
  async findAll(userId: string, dto: QueryDocumentsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;
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
    const where = buildDocumentListWhere(
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
        take: limit,
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
      page,
      limit,
      items: items.map((item) => ({
        ...formatDocumentRecord(item),
        access: buildDocumentAccessSummary(userId, item),
      })),
    };
  }
}
