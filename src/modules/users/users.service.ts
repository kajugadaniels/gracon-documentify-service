/**
 * users.service.ts — api/documents
 *
 * Provides user-lookup helpers used by document features.
 * Only returns safe display fields — no passwords, encrypted NIDs, or tokens.
 */

import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface UserSearchResult {
  id: string;
  email: string;
  surName: string | null;
  postNames: string | null;
  imageUrl: string | null;
  matchedBy: 'EMAIL' | 'PLATFORM_ID' | 'CITIZEN_ID';
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Searches active, verified users by a partial email match or an exact
   * platform/citizen ID match.
   *
   * Results are capped at 20 regardless of the `limit` argument to prevent
   * accidental mass enumeration. Callers must enforce the 5-character minimum
   * before invoking this method — the controller layer already does so.
   *
   * Platform and citizen IDs are stored as SHA-256 hashes, so they are only
   * searchable by exact full-value input, not partial matching.
   *
   * @param query  Partial email or full platform/citizen ID.
   * @param limit  Desired result count (default 10, hard cap 20).
   * @returns      Array of safe user summaries.
   */
  async searchUsers(query: string, limit = 10): Promise<UserSearchResult[]> {
    const safeLimit = Math.min(limit, 20);
    const normalizedQuery = query.trim();
    const identityQuery = normalizedQuery.replace(/\s+/g, '');
    const queryHash = crypto
      .createHash('sha256')
      .update(identityQuery)
      .digest('hex');

    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        isVerified: true,
        OR: [
          { email: { contains: normalizedQuery, mode: 'insensitive' } },
          { platformId: { is: { pidHash: queryHash } } },
          { citizenIdentity: { is: { nidHash: queryHash } } },
        ],
      },
      select: {
        id: true,
        email: true,
        imageUrl: true,
        citizenIdentity: {
          select: { surName: true, postNames: true, nidHash: true },
        },
        platformId: {
          select: { pidHash: true },
        },
      },
      take: safeLimit,
      orderBy: { email: 'asc' },
    });

    return users
      .map((u) => {
        const matchedBy: UserSearchResult['matchedBy'] =
          u.platformId?.pidHash === queryHash
            ? 'PLATFORM_ID'
            : u.citizenIdentity?.nidHash === queryHash
              ? 'CITIZEN_ID'
              : 'EMAIL';

        return {
          id: u.id,
          email: u.email,
          surName: u.citizenIdentity?.surName ?? null,
          postNames: u.citizenIdentity?.postNames ?? null,
          imageUrl: u.imageUrl ?? null,
          matchedBy,
        };
      })
      .sort((a, b) => {
        if (a.matchedBy === b.matchedBy) {
          return a.email.localeCompare(b.email);
        }

        if (a.matchedBy === 'EMAIL') return 1;
        if (b.matchedBy === 'EMAIL') return -1;
        return a.email.localeCompare(b.email);
      });
  }
}
