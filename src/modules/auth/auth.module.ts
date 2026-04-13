import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';
import { Reflector } from '@nestjs/core';
import { UserJwtStrategy } from './strategies/user-jwt.strategy';
import { VerifiedUserGuard } from './guards/verified-user.guard';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'user-jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  providers: [
    UserJwtStrategy,
    Reflector,
    { provide: APP_GUARD, useClass: VerifiedUserGuard },
  ],
  exports: [UserJwtStrategy, PassportModule, JwtModule],
})
export class AuthModule {}
