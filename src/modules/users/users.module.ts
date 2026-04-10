/**
 * users.module.ts — api/documents
 *
 * Exposes user-lookup capabilities needed by document collaboration features.
 * Relies on the shared PrismaModule for database access.
 */

import { Module } from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, EncryptionService],
})
export class UsersModule {}
