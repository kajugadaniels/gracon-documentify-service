/**
 * users.controller.ts — api/documents
 *
 * Exposes user-lookup endpoints used by document collaboration features.
 * All routes are protected by the global VerifiedUserGuard — only fully
 * verified, id-verified users can call them.
 */

import {
  Controller,
  Get,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UsersService, type UserSearchMode } from './users.service';

/** Minimum query length to prevent broad email enumeration. */
const MIN_QUERY_LEN = 5;
const PLATFORM_ID_LENGTH = 11;
const CITIZEN_ID_LENGTH = 16;

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * GET /api/v1/users/search?q=...
   * General limit — authenticated read, safe for frequent UI calls.
   */
  @Get('search')
  @HttpCode(HttpStatus.OK)
  @Throttle({ general: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Search users by email, platform ID, or citizen ID',
    description:
      'Returns active, verified users whose email contains the query string, ' +
      'or whose decrypted platform ID / citizen ID exactly matches the query. ' +
      'Email search requires at least 5 characters. Platform-ID search requires ' +
      `the full ${PLATFORM_ID_LENGTH}-digit identifier. Citizen-ID search requires ` +
      `the full ${CITIZEN_ID_LENGTH}-digit identifier. ` +
      'Only safe display fields are returned — no passwords, NIDs, or tokens.\n\n' +
      'The caller must explicitly choose the search mode so the API can apply ' +
      'the correct validation rules.\n\n' +
      '**Authentication:** Full JWT access token required (VerifiedUserGuard).',
  })
  @ApiQuery({
    name: 'q',
    description:
      'Partial email, full Platform ID, or full Citizen ID depending on mode.',
    example: 'john@',
  })
  @ApiQuery({
    name: 'mode',
    description:
      'Search mode: `email`, `platformId`, or `citizenId`.',
    example: 'email',
  })
  @ApiResponse({
    status: 200,
    description: 'Array of matching user summaries.',
    schema: {
      example: [
        {
          id: 'a3f2c1d4-8b7e-4f6a-9c2d-1e5b3a7f8d9c',
          email: 'john.doe@example.com',
          surName: 'DOE',
          postNames: 'John',
          imageUrl: null,
          matchedBy: 'EMAIL',
        },
      ],
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid search mode, too-short email query, or wrong identifier format/length.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized — token missing or expired.' })
  @ApiResponse({ status: 403, description: 'Forbidden — identity verification required.' })
  async searchUsers(
    @Query('q') q: string,
    @Query('mode') mode: string,
  ) {
    const normalizedQuery = q?.trim() ?? '';
    const normalizedMode = mode?.trim().toLowerCase();

    if (
      normalizedMode !== 'email' &&
      normalizedMode !== 'platformid' &&
      normalizedMode !== 'citizenid'
    ) {
      throw new BadRequestException(
        'Search mode must be "email", "platformId", or "citizenId".',
      );
    }

    if (normalizedMode === 'email') {
      if (normalizedQuery.length < MIN_QUERY_LEN) {
        throw new BadRequestException(
          `Email search must be at least ${MIN_QUERY_LEN} characters.`,
        );
      }

      return this.usersService.searchUsers(
        normalizedQuery,
        normalizedMode as UserSearchMode,
      );
    }

    if (!/^\d+$/.test(normalizedQuery)) {
      throw new BadRequestException(
        'Numeric ID search only accepts digits.',
      );
    }

    if (
      normalizedMode === 'platformid' &&
      normalizedQuery.length !== PLATFORM_ID_LENGTH
    ) {
      throw new BadRequestException(
        `Platform ID search requires the full ${PLATFORM_ID_LENGTH}-digit identifier.`,
      );
    }

    if (
      normalizedMode === 'citizenid' &&
      normalizedQuery.length !== CITIZEN_ID_LENGTH
    ) {
      throw new BadRequestException(
        `Citizen ID search requires the full ${CITIZEN_ID_LENGTH}-digit identifier.`,
      );
    }

    return this.usersService.searchUsers(
      normalizedQuery,
      (normalizedMode === 'platformid'
        ? 'platformId'
        : normalizedMode === 'citizenid'
          ? 'citizenId'
          : normalizedMode) as UserSearchMode,
    );
  }
}
