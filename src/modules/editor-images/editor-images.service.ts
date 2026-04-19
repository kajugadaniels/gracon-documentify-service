import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';

const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

interface CloudinaryUploadResponse {
  secure_url?: string;
  public_id?: string;
  bytes?: number;
  width?: number;
  height?: number;
  format?: string;
  resource_type?: string;
  error?: { message?: string };
}

export interface UploadedEditorImage {
  url: string;
  publicId?: string;
  bytes?: number;
  width?: number;
  height?: number;
  format?: string;
  resourceType?: string;
}

@Injectable()
export class EditorImagesService {
  private readonly logger = new Logger(EditorImagesService.name);
  private readonly maxImageBytes: number;

  constructor(private readonly config: ConfigService) {
    this.maxImageBytes =
      this.config.get<number>('EDITOR_IMAGE_MAX_SIZE_BYTES') ??
      DEFAULT_MAX_IMAGE_BYTES;
  }

  /**
   * Uploads a validated editor image to Cloudinary and returns the hosted URL.
   *
   * @param file - Multer in-memory image file.
   * @returns Cloudinary-hosted image metadata.
   */
  async upload(file?: Express.Multer.File): Promise<UploadedEditorImage> {
    if (!file) {
      throw new BadRequestException('Upload an image file.');
    }

    this.validateFile(file);

    const cloudName = this.config.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.config.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.config.get<string>('CLOUDINARY_API_SECRET');
    const folder =
      this.config.get<string>('CLOUDINARY_EDITOR_IMAGES_FOLDER') ??
      'gracon/documents/editor-images';

    if (!cloudName || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException('Image upload is not configured.');
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const uploadParams = {
      folder,
      overwrite: 'false',
      timestamp,
      unique_filename: 'true',
    };
    const signature = this.signCloudinaryParams(uploadParams, apiSecret);
    const form = new FormData();

    form.set(
      'file',
      `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
    );
    form.set('api_key', apiKey);
    form.set('folder', uploadParams.folder);
    form.set('overwrite', uploadParams.overwrite);
    form.set('timestamp', uploadParams.timestamp);
    form.set('unique_filename', uploadParams.unique_filename);
    form.set('signature', signature);

    let response: Response;
    let payload: CloudinaryUploadResponse;

    try {
      response = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
        {
          method: 'POST',
          body: form,
        },
      );
      payload = (await response.json()) as CloudinaryUploadResponse;
    } catch (error) {
      this.logger.error('Cloudinary editor image upload failed.', error);
      throw new ServiceUnavailableException(
        'Image upload service is unavailable.',
      );
    }

    if (!response.ok || !payload.secure_url) {
      this.logger.warn(
        `Cloudinary editor image upload rejected: ${payload.error?.message ?? response.statusText}`,
      );
      throw new InternalServerErrorException('Failed to upload image.');
    }

    return {
      url: payload.secure_url,
      publicId: payload.public_id,
      bytes: payload.bytes,
      width: payload.width,
      height: payload.height,
      format: payload.format,
      resourceType: payload.resource_type,
    };
  }

  private validateFile(file: Express.Multer.File) {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      throw new UnsupportedMediaTypeException(
        'Only AVIF, GIF, JPEG, PNG, and WebP images are allowed.',
      );
    }

    if (!file.size || file.size > this.maxImageBytes) {
      throw new PayloadTooLargeException(
        `Image must be smaller than ${Math.round(this.maxImageBytes / 1024 / 1024)} MB.`,
      );
    }
  }

  private signCloudinaryParams(
    params: Record<string, string>,
    apiSecret: string,
  ) {
    const payload = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');

    return crypto
      .createHash('sha1')
      .update(`${payload}${apiSecret}`)
      .digest('hex');
  }
}
