/**
 * invitation-token.pipe.ts
 *
 * Rejects malformed invitation tokens at the controller edge before service
 * code performs lookup, audit, or verification-session work.
 */
import {
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { isValidInvitationTokenFormat } from '../helpers/document-invitation.helper';

/**
 * Validates the 64-character hex invitation-token contract.
 */
@Injectable()
export class InvitationTokenPipe implements PipeTransform<string, string> {
  /**
   * Validates and normalizes a route invitation token.
   *
   * @param value Raw route parameter value.
   * @returns Lowercase token when valid.
   */
  transform(value: string): string {
    const token = value.trim();

    if (!isValidInvitationTokenFormat(token)) {
      throw new BadRequestException('Invalid invitation token.');
    }

    return token.toLowerCase();
  }
}
