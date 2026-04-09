import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  JwtPayload,
  RequestUser,
} from '../interfaces/jwt-payload.interface';

@Injectable()
export class UserJwtStrategy extends PassportStrategy(Strategy, 'user-jwt') {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<RequestUser> {
    if (payload.tokenType !== 'full') {
      throw new ForbiddenException(
        'Identity verification required before using document features.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, isActive: true, isIdVerified: true },
    });

    if (!user) throw new UnauthorizedException('Account not found.');
    if (!user.isActive)
      throw new UnauthorizedException('Account has been deactivated.');

    if (!user.isIdVerified) {
      throw new ForbiddenException(
        'You must complete identity verification before using document features.',
      );
    }

    return {
      userId: user.id,
      email: user.email,
      tokenType: payload.tokenType,
      isIdVerified: user.isIdVerified,
    };
  }
}
