/**
 * editor-images.service.spec.ts
 *
 * Covers the signed private editor-image render-token contract without
 * touching real S3 storage.
 */
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { S3Service } from '../../common/s3/s3.service';
import { EditorImagesService } from './editor-images.service';

const SECRET = 'abcdefghijklmnopqrstuvwxyz123456';
const API_BASE_URL = 'https://documents.gracon360.com/api/v1';

function createService(overrides: Record<string, unknown> = {}) {
  const configValues: Record<string, unknown> = {
    ENCRYPTION_SECRET: SECRET,
    EDITOR_IMAGE_MAX_SIZE_BYTES: 8 * 1024 * 1024,
    EDITOR_IMAGE_TOKEN_TTL_SECONDS: 60,
    ...overrides,
  };
  const config = {
    get: jest.fn((key: string) => configValues[key]),
    getOrThrow: jest.fn((key: string) => {
      const value = configValues[key];

      if (typeof value !== 'string') {
        throw new Error(`Missing config: ${key}`);
      }

      return value;
    }),
  } as unknown as ConfigService;
  const s3 = {
    putBuffer: jest.fn().mockResolvedValue(undefined),
    getBuffer: jest.fn().mockResolvedValue(Buffer.from('image-bytes')),
  } as unknown as Pick<S3Service, 'putBuffer' | 'getBuffer'>;

  return {
    service: new EditorImagesService(config, s3 as S3Service),
    s3,
  };
}

function createImageToken(payload: Record<string, unknown>) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(encodedPayload)
    .digest('base64url');

  return `${encodedPayload}.${signature}`;
}

function createUploadFile(overrides: Partial<Express.Multer.File> = {}) {
  return {
    fieldname: 'file',
    originalname: 'signature.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: 128,
    buffer: Buffer.from('png-bytes'),
    destination: '',
    filename: '',
    path: '',
    stream: undefined,
    ...overrides,
  } as Express.Multer.File;
}

describe('EditorImagesService', () => {
  it('uploads private image bytes and returns an expiring render token', async () => {
    const { service, s3 } = createService({
      EDITOR_IMAGE_TOKEN_TTL_SECONDS: 120,
    });

    const result = await service.upload(
      'user-123',
      createUploadFile(),
      API_BASE_URL,
    );

    expect(s3.putBuffer).toHaveBeenCalledWith(
      expect.stringMatching(/^document-editor-images\/user-123\/.+\.png$/),
      Buffer.from('png-bytes'),
      'image/png',
    );
    expect(result.url).toMatch(
      /^https:\/\/documents\.gracon360\.com\/api\/v1\/editor-images\/render\/.+\..+$/,
    );
    expect(result.mimeType).toBe('image/png');
  });

  it('resolves valid expiring tokens and caps cache time to remaining lifetime', async () => {
    const { service, s3 } = createService();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = createImageToken({
      v: 'v1',
      key: 'document-editor-images/user-123/image.webp',
      exp: nowSeconds + 90,
    });

    const image = await service.getImageByToken(token);

    expect(s3.getBuffer).toHaveBeenCalledWith(
      'document-editor-images/user-123/image.webp',
    );
    expect(image.contentType).toBe('image/webp');
    expect(image.cacheMaxAgeSeconds).toBeGreaterThan(0);
    expect(image.cacheMaxAgeSeconds).toBeLessThanOrEqual(90);
  });

  it('rejects expired image tokens before loading S3 bytes', async () => {
    const { service, s3 } = createService();
    const token = createImageToken({
      v: 'v1',
      key: 'document-editor-images/user-123/image.png',
      exp: Math.floor(Date.now() / 1000) - 1,
    });

    await expect(service.getImageByToken(token)).rejects.toThrow(
      BadRequestException,
    );
    expect(s3.getBuffer).not.toHaveBeenCalled();
  });

  it('keeps legacy non-expiring tokens readable for existing documents', async () => {
    const { service, s3 } = createService();
    const token = createImageToken({
      v: 'v1',
      key: 'document-editor-images/user-123/legacy.jpg',
    });

    const image = await service.getImageByToken(token);

    expect(s3.getBuffer).toHaveBeenCalledWith(
      'document-editor-images/user-123/legacy.jpg',
    );
    expect(image.contentType).toBe('image/jpeg');
    expect(image.cacheMaxAgeSeconds).toBe(30 * 24 * 60 * 60);
  });

  it('rejects tokens with object keys outside the editor-image prefix', async () => {
    const { service, s3 } = createService();
    const token = createImageToken({
      v: 'v1',
      key: '../documents/private.json',
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    await expect(service.getImageByToken(token)).rejects.toThrow(
      BadRequestException,
    );
    expect(s3.getBuffer).not.toHaveBeenCalled();
  });
});
