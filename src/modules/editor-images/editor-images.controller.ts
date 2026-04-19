import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
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
      'Upload a local editor image to Cloudinary and return a hosted image URL.',
  })
  @ApiResponse({
    status: 201,
    description: 'Cloudinary-hosted image metadata returned.',
  })
  upload(@UploadedFile() file?: Express.Multer.File) {
    return this.service.upload(file);
  }
}
