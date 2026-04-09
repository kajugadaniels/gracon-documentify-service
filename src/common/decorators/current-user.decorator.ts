import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestUser } from '../../modules/auth/interfaces/jwt-payload.interface';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser =>
    ctx.switchToHttp().getRequest().user as RequestUser,
);
