/**
 * users.service.ts — api/documents
 *
 * Provides user-lookup helpers used by document features.
 * Only returns safe display fields — no passwords, encrypted NIDs, or tokens.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface UserSearchResult {
  id: string;
  email: string;
  surName: string | null;
  postNames: string | null;
  imageUrl: string | null;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Searches active, verified users by a partial case-insensitive email match.
   *
   * Results are capped at 20 regardless of the `limit` argument to prevent
   * accidental mass enumeration. Callers must enforce the 5-character minimum
   * before invoking this method — the controller layer already does so.
   *
   * @param query  Partial email string — at least 5 characters expected.
   * @param limit  Desired result count (default 10, hard cap 20).
   * @returns      Array of safe user summaries.
   */
  async searchUsers(query: string, limit = 10): Promise<UserSearchResult[]> {
    const safeLimit = Math.min(limit, 20);

    const users = await this.prisma.user.findMany({
      where: {
        email: { contains: query, mode: 'insensitive' },
        isActive: true,
        isVerified: true,
      },
      select: {
        id: true,
        email: true,
        imageUrl: true,
        citizenIdentity: {
          select: { surName: true, postNames: true },
        },
      },
      take: safeLimit,
      orderBy: { email: 'asc' },
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      surName: u.citizenIdentity?.surName ?? null,
      postNames: u.citizenIdentity?.postNames ?? null,
      imageUrl: u.imageUrl ?? null,
    }));
  }
}
