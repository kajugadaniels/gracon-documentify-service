/**
 * s3.service.ts
 *
 * Centralizes private S3 document storage operations behind a small SDK v3
 * adapter so feature services do not depend on AWS client details.
 */
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class S3Service {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly logger = new Logger(S3Service.name);

  constructor(private readonly config: ConfigService) {
    this.s3 = new S3Client({
      region: config.get<string>('AWS_REGION'),
      credentials: {
        accessKeyId: config.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('AWS_SECRET_ACCESS_KEY'),
      },
    });
    this.bucket = config.getOrThrow<string>('AWS_S3_BUCKET_NAME');
  }

  /**
   * Stores JSON document content in private S3 with server-side encryption.
   *
   * @param key - Canonical private object key.
   * @param data - JSON-serializable document payload.
   */
  async putJson(key: string, data: unknown): Promise<void> {
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: JSON.stringify(data),
          ContentType: 'application/json',
          ServerSideEncryption: 'AES256',
        }),
      );
    } catch (err) {
      this.logger.error(`S3 putJson failed for key ${key}`, err);
      throw new InternalServerErrorException(
        'Failed to save document content.',
      );
    }
  }

  /**
   * Reads and parses JSON document content from private S3.
   *
   * @param key - Canonical private object key.
   * @returns Parsed JSON payload typed by the caller.
   */
  async getJson<T = unknown>(key: string): Promise<T> {
    try {
      const result = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      const buffer = await this.bodyToBuffer(result.Body);

      return JSON.parse(buffer.toString('utf8')) as T;
    } catch (err) {
      this.logger.error(`S3 getJson failed for key ${key}`, err);
      throw new InternalServerErrorException(
        'Failed to retrieve document content.',
      );
    }
  }

  /**
   * Stores a binary file in private S3 with server-side encryption.
   *
   * @param key - Canonical private object key.
   * @param buffer - Binary payload.
   * @param contentType - MIME type persisted on the object.
   */
  async putBuffer(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          ServerSideEncryption: 'AES256',
        }),
      );
    } catch (err) {
      this.logger.error(`S3 putBuffer failed for key ${key}`, err);
      throw new InternalServerErrorException('Failed to upload file.');
    }
  }

  /**
   * Fetches a raw binary object from S3 as a Buffer.
   *
   * @param key - Canonical private object key.
   * @returns Object bytes for export/render callers.
   */
  async getBuffer(key: string): Promise<Buffer> {
    try {
      const result = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      return this.bodyToBuffer(result.Body);
    } catch (err) {
      this.logger.error(`S3 getBuffer failed for key ${key}`, err);
      throw new InternalServerErrorException(
        'Failed to retrieve file from storage.',
      );
    }
  }

  /**
   * Creates a short-lived private object URL for trusted render/export surfaces.
   *
   * @param key - Canonical private object key.
   * @param expiresInSeconds - URL validity window in seconds.
   * @returns Presigned GET URL.
   */
  async getPresignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  /**
   * Deletes a private S3 object and logs failures without blocking cleanup.
   *
   * @param key - Canonical private object key.
   */
  async delete(key: string): Promise<void> {
    try {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (err) {
      this.logger.error(`S3 delete failed for key ${key}`, err);
    }
  }

  /**
   * Checks whether a private S3 object exists.
   *
   * @param key - Canonical private object key.
   * @returns True when S3 confirms the object exists.
   */
  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }

  private async bodyToBuffer(
    body: GetObjectCommandOutput['Body'],
  ): Promise<Buffer> {
    if (!body) {
      throw new InternalServerErrorException(
        'S3 returned an empty object body.',
      );
    }

    const bytes = await body.transformToByteArray();

    return Buffer.from(bytes);
  }
}
