/**
 * mailer.service.ts — api/documents
 *
 * Sends document invitation emails with secure accept links that point to the
 * documents workspace. The raw invitation token exists only in the email link;
 * the database stores a SHA-256 hash of that token.
 */

import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';

type SendDocumentInvitationEmailParams = {
  to: string;
  recipientName: string;
  senderName: string;
  accessSummary: string;
  note: string | null;
  acceptUrl: string;
  expiresIn: string;
};

@Injectable()
export class AppMailerService {
  private readonly logger = new Logger(AppMailerService.name);

  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Sends the invitation email used for secure document sharing.
   *
   * Security: the email does not reveal document body content, and the link
   * carries only the raw one-time token. The DB stores only its SHA-256 hash.
   */
  async sendDocumentInvitationEmail(
    params: SendDocumentInvitationEmailParams,
  ): Promise<void> {
    const {
      to,
      recipientName,
      senderName,
      accessSummary,
      note,
      acceptUrl,
      expiresIn,
    } = params;

    try {
      await this.mailerService.sendMail({
        to,
        subject: 'A document was shared with you',
        template: 'document-share-invitation',
        context: {
          recipientName,
          senderName,
          accessSummary,
          note,
          acceptUrl,
          expiresIn,
          currentYear: new Date().getFullYear(),
          supportEmail:
            this.configService.get<string>('MAIL_USER') ?? 'support@example.com',
        },
      });

      this.logger.log(`Document invitation email sent to ${to}`);
    } catch (error) {
      this.logger.error(
        `Failed to send document invitation email to ${to}`,
        error,
      );
      throw error;
    }
  }
}
