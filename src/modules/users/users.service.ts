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
   * Searches active, verified users by email or exact hashed identifier lookup.
   *
   * @param query Partial email or full numeric ID.
   * @param mode Explicit search mode from the caller.
   * @param limit Desired result count, capped at 20.
   * @returns Safe user summaries for sharing/autocomplete UI.
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
   * Returns verified users whose PID/NID hash exactly matches the numeric query.
   */
  private async searchByNumericIdentifier(
    query: string,
    mode: Exclude<UserSearchMode, 'email'>,
    limit: number,
  ): Promise<UserSearchResult[]> {
    const requiredLength =
      mode === 'platformId' ? PLATFORM_ID_LENGTH : CITIZEN_ID_LENGTH;

    if (!/^\d+$/.test(query) || query.length !== requiredLength) {
      return [];
    }

    const identifierHash = this.encryption.hash(query);
    const matchedBy: UserSearchResult['matchedBy'] =
      mode === 'platformId' ? 'PLATFORM_ID' : 'CITIZEN_ID';
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        isVerified: true,
        ...(mode === 'platformId'
          ? { platformId: { is: { pidHash: identifierHash } } }
          : { citizenIdentity: { is: { nidHash: identifierHash } } }),
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

    if (users.length === 0) {
      this.logger.debug(`No verified user matched ${mode} hash lookup.`);
    }

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      surName: u.citizenIdentity?.surName ?? null,
      postNames: u.citizenIdentity?.postNames ?? null,
      imageUrl: u.imageUrl ?? null,
      matchedBy,
    }));
  }
}
