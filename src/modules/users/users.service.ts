/**
 * users.service.ts — api/documents
 *
 * Provides user-lookup helpers used by document features.
 * Only returns safe display fields — no passwords, encrypted NIDs, or tokens.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EncryptionService } from '../../common/crypto/encryption.service';

export type UserSearchMode = 'email' | 'platformId' | 'citizenId';

const PLATFORM_ID_LENGTH = 11;
const CITIZEN_ID_LENGTH = 16;

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
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * Searches active, verified users either by partial email match or by
   * decrypting stored identifiers and comparing the exact full numeric ID.
   *
   * Results are capped at 20 regardless of the `limit` argument to prevent
   * accidental mass enumeration. Callers must enforce the 5-character minimum
   * before invoking this method — the controller layer already does so.
   *
   * Platform IDs in this codebase are 11 digits. Citizen IDs are 16 digits.
   *
   * @param query  Partial email or full numeric ID.
   * @param mode   Explicit search mode from the caller.
   * @param limit  Desired result count (default 10, hard cap 20).
   * @returns      Array of safe user summaries.
   */
  async searchUsers(
    query: string,
    mode: UserSearchMode,
    limit = 10,
  ): Promise<UserSearchResult[]> {
    const safeLimit = Math.min(limit, 20);
    const normalizedQuery = query.trim();

    if (mode === 'email') {
      return this.searchByEmail(normalizedQuery, safeLimit);
    }

    return this.searchByNumericIdentifier(normalizedQuery, mode, safeLimit);
  }

  /**
   * Returns verified users whose email partially matches the given query.
   */
  private async searchByEmail(
    query: string,
    limit: number,
  ): Promise<UserSearchResult[]> {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        isVerified: true,
        email: { contains: query, mode: 'insensitive' },
      },
      select: {
        id: true,
        email: true,
        imageUrl: true,
        citizenIdentity: {
          select: { surName: true, postNames: true },
        },
      },
      take: limit,
      orderBy: { email: 'asc' },
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      surName: u.citizenIdentity?.surName ?? null,
      postNames: u.citizenIdentity?.postNames ?? null,
      imageUrl: u.imageUrl ?? null,
      matchedBy: 'EMAIL',
    }));
  }

  /**
   * Returns verified users whose decrypted platform ID or citizen ID exactly
   * matches the given numeric query for the selected mode.
   */
  private async searchByNumericIdentifier(
    query: string,
    mode: Exclude<UserSearchMode, 'email'>,
    limit: number,
  ): Promise<UserSearchResult[]> {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        isVerified: true,
        OR: [{ platformId: { isNot: null } }, { citizenIdentity: { isNot: null } }],
      },
      select: {
        id: true,
        email: true,
        imageUrl: true,
        citizenIdentity: {
          select: { surName: true, postNames: true, nidEncrypted: true },
        },
        platformId: {
          select: { pidEncrypted: true },
        },
      },
      orderBy: { email: 'asc' },
    });

    return users
      .map((u) => {
        const matchedBy = this.matchNumericIdentifier(query, mode, u);

        if (!matchedBy) {
          return null;
        }

        return {
          id: u.id,
          email: u.email,
          surName: u.citizenIdentity?.surName ?? null,
          postNames: u.citizenIdentity?.postNames ?? null,
          imageUrl: u.imageUrl ?? null,
          matchedBy,
        };
      })
      .filter((user): user is UserSearchResult => Boolean(user))
      .slice(0, limit)
      .sort((a, b) => {
        return a.email.localeCompare(b.email);
      });
  }

  private matchNumericIdentifier(
    query: string,
    mode: Exclude<UserSearchMode, 'email'>,
    user: {
      platformId: { pidEncrypted: string } | null;
      citizenIdentity:
        | { nidEncrypted: string; surName: string; postNames: string }
        | null;
    },
  ): UserSearchResult['matchedBy'] | null {
    if (
      mode === 'platformId' &&
      query.length === PLATFORM_ID_LENGTH &&
      user.platformId?.pidEncrypted
    ) {
      try {
        const pid = this.encryption.decrypt(user.platformId.pidEncrypted);
        if (pid === query) {
          return 'PLATFORM_ID';
        }
      } catch (error) {
        this.logger.warn(
          `Failed to decrypt platform ID while searching users: ${String(error)}`,
        );
      }
    }

    if (
      mode === 'citizenId' &&
      query.length === CITIZEN_ID_LENGTH &&
      user.citizenIdentity?.nidEncrypted
    ) {
      try {
        const nid = this.encryption.decrypt(user.citizenIdentity.nidEncrypted);
        if (nid === query) {
          return 'CITIZEN_ID';
        }
      } catch (error) {
        this.logger.warn(
          `Failed to decrypt citizen ID while searching users: ${String(error)}`,
        );
      }
    }

    return null;
  }
}
