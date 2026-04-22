import {
  ArgumentMetadata,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';

import { DocumentsController } from '../src/modules/documents/documents.controller';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { PdfExportService } from '../src/modules/documents/pdf-export.service';
import { CreateDocumentDto } from '../src/modules/documents/dto/create-document.dto';
import {
  QueryDocumentsDto,
  type DocumentListScope,
} from '../src/modules/documents/dto/query-documents.dto';
import {
  RequestInvitationEmailOtpDto,
  VerifyInvitationEmailOtpDto,
} from '../src/modules/documents/dto/invitation-email-otp.dto';
import { IS_PUBLIC_KEY } from '../src/modules/auth/guards/verified-user.guard';

class TestVerifiedUserGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authorization = request.get?.('authorization');

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Unauthorized');
    }

    request.user = {
      userId: authorization.slice('Bearer '.length).trim(),
      email: 'tester@example.com',
      tokenType: 'full',
      isIdVerified: true,
    };

    return true;
  }
}

function createHttpExecutionContext(
  controllerClass: typeof DocumentsController,
  handler: Function,
  request: Record<string, unknown>,
): ExecutionContext {
  return {
    getClass: () => controllerClass,
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => undefined,
      getNext: () => undefined,
    }),
    getType: () => 'http',
    getArgs: () => [request],
    getArgByIndex: (index: number) => [request][index],
    switchToRpc: () => ({ getData: () => undefined, getContext: () => undefined }),
    switchToWs: () => ({ getClient: () => undefined, getData: () => undefined }),
  } as ExecutionContext;
}

describe('DocumentsController integration (test boundary)', () => {
  let controller: DocumentsController;
  let reflector: Reflector;
  let guard: TestVerifiedUserGuard;
  let validationPipe: ValidationPipe;
  let documentsService: {
    create: jest.Mock;
    findAll: jest.Mock;
    getInvitationPreview: jest.Mock;
    getInvitationReview: jest.Mock;
    getInvitationGateStatus: jest.Mock;
    requestInvitationEmailOtp: jest.Mock;
    verifyInvitationEmailOtp: jest.Mock;
  };

  beforeEach(async () => {
    documentsService = {
      create: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      findAll: jest.fn().mockResolvedValue({ items: [], page: 2, limit: 10 }),
      getInvitationPreview: jest
        .fn()
        .mockResolvedValue({ status: 'preview', token: 'invite-token' }),
      getInvitationReview: jest
        .fn()
        .mockResolvedValue({ status: 'review', token: 'invite-token' }),
      getInvitationGateStatus: jest
        .fn()
        .mockResolvedValue({ status: 'pending', nextStep: 'EMAIL_OTP' }),
      requestInvitationEmailOtp: jest
        .fn()
        .mockResolvedValue({ status: 'sent' }),
      verifyInvitationEmailOtp: jest
        .fn()
        .mockResolvedValue({ status: 'verified' }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [
        Reflector,
        {
          provide: DocumentsService,
          useValue: documentsService,
        },
        {
          provide: PdfExportService,
          useValue: {},
        },
      ],
    }).compile();

    controller = moduleFixture.get(DocumentsController);
    reflector = moduleFixture.get(Reflector);
    guard = new TestVerifiedUserGuard(reflector);
    validationPipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
  });

  async function validateDto<T>(
    value: Record<string, unknown>,
    metatype: new () => T,
    type: ArgumentMetadata['type'],
  ): Promise<T> {
    return validationPipe.transform(value, {
      type,
      metatype,
      data: '',
    }) as Promise<T>;
  }

  it('marks invitation preview as public and forwards safe preview context', async () => {
    const request = {
      ip: '127.0.0.1',
      get: jest.fn().mockReturnValue('jest-integration'),
    };
    const handler = DocumentsController.prototype.previewInvitation;
    const context = createHttpExecutionContext(
      DocumentsController,
      handler,
      request,
    );

    expect(guard.canActivate(context)).toBe(true);

    await controller.previewInvitation('invite-token', request as never);

    expect(documentsService.getInvitationPreview).toHaveBeenCalledWith(
      'invite-token',
      {
        ipAddress: '127.0.0.1',
        userAgent: 'jest-integration',
      },
    );
  });

  it('rejects protected invitation review requests without authentication', () => {
    const request = {
      get: jest.fn().mockReturnValue(undefined),
    };
    const context = createHttpExecutionContext(
      DocumentsController,
      DocumentsController.prototype.reviewInvitation,
      request,
    );

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('injects the authenticated user into protected invitation review flow', async () => {
    const request = {
      ip: '127.0.0.1',
      get: jest.fn((header: string) =>
        header === 'authorization' ? 'Bearer user-123' : 'jest-integration',
      ),
    };
    const context = createHttpExecutionContext(
      DocumentsController,
      DocumentsController.prototype.reviewInvitation,
      request,
    );

    expect(guard.canActivate(context)).toBe(true);

    await controller.reviewInvitation(request.user, 'invite-token', request as never);

    expect(documentsService.getInvitationReview).toHaveBeenCalledWith(
      'user-123',
      'invite-token',
      {
        ipAddress: '127.0.0.1',
        userAgent: 'jest-integration',
      },
    );
  });

  it('forwards the raw authorization header on public invitation gate resolution', async () => {
    const request = {
      ip: '127.0.0.1',
      get: jest.fn((header: string) =>
        header === 'authorization' ? 'Bearer session-456' : 'jest-integration',
      ),
    };

    await controller.getInvitationGateStatus('invite-token', request as never);

    expect(documentsService.getInvitationGateStatus).toHaveBeenCalledWith(
      'invite-token',
      'Bearer session-456',
      {
        ipAddress: '127.0.0.1',
        userAgent: 'jest-integration',
      },
    );
  });

  it('rejects invalid email-otp request payloads before the service layer', async () => {
    await expect(
      validateDto(
        { email: 'not-an-email' },
        RequestInvitationEmailOtpDto,
        'body',
      ),
    ).rejects.toThrow();

    expect(documentsService.requestInvitationEmailOtp).not.toHaveBeenCalled();
  });

  it('rejects invalid email-otp verification payloads before the service layer', async () => {
    await expect(
      validateDto({ code: '12ab' }, VerifyInvitationEmailOtpDto, 'body'),
    ).rejects.toThrow();

    expect(documentsService.verifyInvitationEmailOtp).not.toHaveBeenCalled();
  });

  it('creates documents through the authenticated route with validated input', async () => {
    const request = {
      get: jest.fn((header: string) =>
        header === 'authorization' ? 'Bearer owner-1' : undefined,
      ),
    };
    const context = createHttpExecutionContext(
      DocumentsController,
      DocumentsController.prototype.create,
      request,
    );
    const dto = await validateDto(
      {
        title: 'Board Minutes',
        type: 'RICH_TEXT',
        tags: ['minutes', 'internal'],
      },
      CreateDocumentDto,
      'body',
    );

    expect(guard.canActivate(context)).toBe(true);

    await controller.create(request.user, dto);

    expect(documentsService.create).toHaveBeenCalledWith('owner-1', {
      title: 'Board Minutes',
      type: 'RICH_TEXT',
      tags: ['minutes', 'internal'],
    });
  });

  it('transforms document list query params before calling the service', async () => {
    const request = {
      get: jest.fn((header: string) =>
        header === 'authorization' ? 'Bearer owner-1' : undefined,
      ),
    };
    const context = createHttpExecutionContext(
      DocumentsController,
      DocumentsController.prototype.findAll,
      request,
    );
    const query = await validateDto(
      {
        page: '2',
        limit: '10',
        scope: 'OWNED' satisfies DocumentListScope,
      },
      QueryDocumentsDto,
      'query',
    );

    expect(guard.canActivate(context)).toBe(true);

    await controller.findAll(request.user, query);

    expect(documentsService.findAll).toHaveBeenCalledWith('owner-1', {
      page: 2,
      limit: 10,
      scope: 'OWNED',
    });
  });
});
