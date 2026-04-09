import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';
import { Reflector } from '@nestjs/core';
import { UserJwtStrategy } from './strategies/user-jwt.strategy';
import { VerifiedUserGuard } from './guards/verified-user.guard';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'user-jwt' })],
  providers: [
    UserJwtStrategy,
    Reflector,
    { provide: APP_GUARD, useClass: VerifiedUserGuard },
  ],
  exports: [UserJwtStrategy, PassportModule],
})
export class AuthModule {}
