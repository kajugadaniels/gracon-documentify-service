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
import { UsersService } from './users.service';

/** Minimum query length to prevent broad email enumeration. */
const MIN_QUERY_LEN = 5;

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
      'or whose platform ID / citizen ID exactly matches the query. ' +
      'A minimum of 5 characters is required to prevent broad enumeration. ' +
      'Only safe display fields are returned — no passwords, NIDs, or tokens.\n\n' +
      'Platform and citizen IDs are stored as SHA-256 hashes, so those two ' +
      'search modes require the full exact identifier, while email remains a partial match.\n\n' +
      '**Authentication:** Full JWT access token required (VerifiedUserGuard).',
  })
  @ApiQuery({
    name: 'q',
    description:
      'Partial email, or a full platform ID / citizen ID. Must be at least 5 characters.',
    example: 'john@',
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
  @ApiResponse({ status: 400, description: 'Query must be at least 5 characters.' })
  @ApiResponse({ status: 401, description: 'Unauthorized — token missing or expired.' })
  @ApiResponse({ status: 403, description: 'Forbidden — identity verification required.' })
  async searchUsers(@Query('q') q: string) {
    if (!q || q.trim().length < MIN_QUERY_LEN) {
      throw new BadRequestException(
        `Search query must be at least ${MIN_QUERY_LEN} characters.`,
      );
    }
    return this.usersService.searchUsers(q.trim());
  }
}
