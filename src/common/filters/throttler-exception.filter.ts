import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Response } from 'express';

@Catch(ThrottlerException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  catch(_exception: ThrottlerException, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(HttpStatus.TOO_MANY_REQUESTS)
      .header('Retry-After', '60')
      .json({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message:
          'You have made too many requests. Please wait before trying again.',
        retryAfter: 60,
      });
  }
}
