/**
 * users.module.ts — api/documents
 *
 * Exposes user-lookup capabilities needed by document collaboration features.
 * Relies on the shared PrismaModule for database access.
 */

import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
