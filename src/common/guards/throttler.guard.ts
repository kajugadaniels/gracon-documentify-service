import { Injectable, Inject, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  @Inject(ConfigService)
  private readonly config: ConfigService;

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.config.get<string>('APP_ENV', 'development') === 'development') {
      return true;
    }

    return super.canActivate(context);
  }
}
