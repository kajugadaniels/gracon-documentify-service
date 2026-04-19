import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import * as multer from 'multer';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { RequestUser } from '../auth/interfaces/jwt-payload.interface';
import { EditorImagesService } from './editor-images.service';

@ApiTags('Editor Images')
@ApiBearerAuth()
@Controller('editor-images')
export class EditorImagesController {
  constructor(private readonly service: EditorImagesService) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ strict: { limit: 20, ttl: 600_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'AVIF, GIF, JPEG, PNG, or WebP image up to 8 MB.',
        },
      },
    },
  })
  @ApiOperation({
    summary:
      'Upload a local editor image to private S3 and return a signed render URL.',
  })
  @ApiResponse({
    status: 201,
    description: 'Stable signed editor image URL returned.',
  })
  upload(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    return this.service.upload(user.userId, file, this.getApiBaseUrl(req));
  }

  @Get('render/:token')
  @Public()
  @ApiOperation({
    summary:
      'Render a private S3 editor image using a tamper-proof signed token.',
  })
  @ApiResponse({ status: 200, description: 'Image bytes returned.' })
  async render(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const image = await this.service.getImageByToken(token);

    res.setHeader('Content-Type', image.contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    return new StreamableFile(image.buffer);
  }

  private getApiBaseUrl(req: Request) {
    const configured = process.env.DOCUMENTS_API_PUBLIC_URL;
    if (configured) return configured.replace(/\/$/, '');

    const forwardedProto = req.get('x-forwarded-proto');
    const forwardedHost = req.get('x-forwarded-host');
    const protocol = forwardedProto ?? req.protocol;
    const host = forwardedHost ?? req.get('host');

    return `${protocol}://${host}/api/v1`;
  }
}
