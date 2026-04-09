import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as AWS from 'aws-sdk';

@Injectable()
export class S3Service {
  private readonly s3: AWS.S3;
  private readonly bucket: string;
  private readonly logger = new Logger(S3Service.name);

  constructor(private readonly config: ConfigService) {
    this.s3 = new AWS.S3({
      region: config.get<string>('AWS_REGION'),
      accessKeyId: config.get<string>('AWS_ACCESS_KEY_ID'),
      secretAccessKey: config.get<string>('AWS_SECRET_ACCESS_KEY'),
    });
    this.bucket = config.getOrThrow<string>('AWS_S3_BUCKET_NAME');
  }

  async putJson(key: string, data: unknown): Promise<void> {
    try {
      await this.s3
        .putObject({
          Bucket: this.bucket,
          Key: key,
          Body: JSON.stringify(data),
          ContentType: 'application/json',
          ACL: 'private',
          ServerSideEncryption: 'AES256',
        })
        .promise();
    } catch (err) {
      this.logger.error(`S3 putJson failed for key ${key}`, err);
      throw new InternalServerErrorException(
        'Failed to save document content.',
      );
    }
  }

  async getJson<T = unknown>(key: string): Promise<T> {
    try {
      const result = await this.s3
        .getObject({
          Bucket: this.bucket,
          Key: key,
        })
        .promise();
      return JSON.parse(result.Body!.toString()) as T;
    } catch (err) {
      this.logger.error(`S3 getJson failed for key ${key}`, err);
      throw new InternalServerErrorException(
        'Failed to retrieve document content.',
      );
    }
  }

  async putBuffer(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    try {
      await this.s3
        .putObject({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          ACL: 'private',
          ServerSideEncryption: 'AES256',
        })
        .promise();
    } catch (err) {
      this.logger.error(`S3 putBuffer failed for key ${key}`, err);
      throw new InternalServerErrorException('Failed to upload file.');
    }
  }

  /** Fetches a raw binary object from S3 as a Buffer. Used by PDF export to embed images. */
  async getBuffer(key: string): Promise<Buffer> {
    try {
      const result = await this.s3
        .getObject({ Bucket: this.bucket, Key: key })
        .promise();
      return result.Body as Buffer;
    } catch (err) {
      this.logger.error(`S3 getBuffer failed for key ${key}`, err);
      throw new InternalServerErrorException('Failed to retrieve file from storage.');
    }
  }

  async getPresignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    return this.s3.getSignedUrlPromise('getObject', {
      Bucket: this.bucket,
      Key: key,
      Expires: expiresInSeconds,
    });
  }

  async delete(key: string): Promise<void> {
    try {
      await this.s3.deleteObject({ Bucket: this.bucket, Key: key }).promise();
    } catch (err) {
      this.logger.error(`S3 delete failed for key ${key}`, err);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.headObject({ Bucket: this.bucket, Key: key }).promise();
      return true;
    } catch {
      return false;
    }
  }
}
