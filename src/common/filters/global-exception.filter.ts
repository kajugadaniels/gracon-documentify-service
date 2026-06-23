import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@gracon/database';
import { Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      return res
        .status(status)
        .json(
          typeof body === 'object'
            ? body
            : { statusCode: status, message: body },
        );
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const { statusCode, message } = this.handlePrisma(exception);
      return res.status(statusCode).json({ statusCode, message });
    }

    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : exception,
    );
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred.',
    });
  }

  private handlePrisma(e: Prisma.PrismaClientKnownRequestError) {
    switch (e.code) {
      case 'P2002':
        return {
          statusCode: HttpStatus.CONFLICT,
          message: 'A record with this value already exists.',
        };
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'The requested record was not found.',
        };
      case 'P2007':
        this.logger.error(
          `Prisma error ${e.code}`,
          e.meta ? JSON.stringify(e.meta) : undefined,
        );
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'A database validation error occurred.',
        };
      default:
        this.logger.error(
          `Prisma error ${e.code}`,
          e.meta ? JSON.stringify(e.meta) : undefined,
        );
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'A database error occurred.',
        };
    }
  }
}
