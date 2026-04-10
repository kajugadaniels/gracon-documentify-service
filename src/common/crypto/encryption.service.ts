/**
 * encryption.service.ts — api/documents
 *
 * Mirrors the auth-service AES decryption logic so documents-only features can
 * compare stored encrypted identifiers without exposing raw encrypted values to
 * callers or controllers.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-cbc';
  private readonly secretKey: Buffer;

  constructor(private readonly configService: ConfigService) {
    const secret = this.configService.get<string>('ENCRYPTION_SECRET');

    if (!secret) {
      throw new Error('ENCRYPTION_SECRET environment variable is not set');
    }

    this.secretKey = crypto.createHash('sha256').update(secret).digest();
  }

  decrypt(encryptedText: string): string {
    const [ivHex, encryptedHex] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');

    const decipher = crypto.createDecipheriv(
      this.algorithm,
      this.secretKey,
      iv,
    );

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }
}
