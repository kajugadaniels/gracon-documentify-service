import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { validateEnv } from './common/config/env.validation';
import { CustomThrottlerGuard } from './common/guards/throttler.guard';
import { PrismaModule } from './common/prisma/prisma.module';
import { S3Module } from './common/s3/s3.module';
import { AppMailerModule } from './common/mailer/mailer.module';
import { AuthModule } from './modules/auth/auth.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { FoldersModule } from './modules/folders/folders.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([
      { name: 'general', ttl: 60_000, limit: 60 },
      { name: 'auth', ttl: 60_000, limit: 5 },
      { name: 'strict', ttl: 600_000, limit: 10 },
    ]),
    PrismaModule,
    S3Module,
    AppMailerModule,
    AuthModule,
    DocumentsModule,
    TemplatesModule,
    FoldersModule,
    UsersModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: CustomThrottlerGuard }],
})
export class AppModule {}
