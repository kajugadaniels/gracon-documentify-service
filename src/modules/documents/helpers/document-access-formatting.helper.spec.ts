import { CollaboratorPermission } from '@prisma/client';

import {
  describeDocumentPermissions,
  describeInvitationExpiryDuration,
  formatDocumentUserDisplayName,
  getDocumentInviterDisplayName,
  maskDocumentRecipientEmail,
  resolveDocumentAuditLimit,
  sanitizeDocumentAccessAuditMetadata,
} from './document-access-formatting.helper';

describe('document-access-formatting.helper', () => {
  describe('resolveDocumentAuditLimit', () => {
    it('defaults to 50 when the input is missing or invalid', () => {
      expect(resolveDocumentAuditLimit()).toBe(50);
      expect(resolveDocumentAuditLimit('abc')).toBe(50);
    });

    it('clamps values into the supported range', () => {
      expect(resolveDocumentAuditLimit('0')).toBe(1);
      expect(resolveDocumentAuditLimit('12')).toBe(12);
      expect(resolveDocumentAuditLimit('999')).toBe(100);
    });
  });

  describe('sanitizeDocumentAccessAuditMetadata', () => {
    it('drops non-object metadata payloads', () => {
      expect(sanitizeDocumentAccessAuditMetadata(null)).toBeNull();
      expect(sanitizeDocumentAccessAuditMetadata('value')).toBeNull();
      expect(sanitizeDocumentAccessAuditMetadata(['value'])).toBeNull();
    });

    it('keeps only allowed scalar audit metadata keys', () => {
      expect(
        sanitizeDocumentAccessAuditMetadata({
          acceptedAt: '2026-04-22T10:00:00.000Z',
          anchored: true,
          retryAfterSeconds: 30,
          notePresent: null,
          unknownKey: 'hidden',
          nested: { rejected: true },
        }),
      ).toEqual({
        acceptedAt: '2026-04-22T10:00:00.000Z',
        anchored: true,
        retryAfterSeconds: 30,
        notePresent: null,
      });
    });

    it('returns null when no allowed scalar values remain', () => {
      expect(
        sanitizeDocumentAccessAuditMetadata({
          nested: { rejected: true },
          list: ['ignored'],
        }),
      ).toBeNull();
    });
  });

  describe('describeDocumentPermissions', () => {
    it('falls back to read access when only read is granted', () => {
      expect(describeDocumentPermissions([CollaboratorPermission.READ])).toBe(
        'read access',
      );
    });

    it('formats single and multiple access labels cleanly', () => {
      expect(describeDocumentPermissions([CollaboratorPermission.EDIT])).toBe(
        'edit access',
      );
      expect(
        describeDocumentPermissions([
          CollaboratorPermission.COMMENT,
          CollaboratorPermission.SIGN,
        ]),
      ).toBe('comment and sign access');
      expect(
        describeDocumentPermissions([
          CollaboratorPermission.EDIT,
          CollaboratorPermission.MANAGE_ACCESS,
        ]),
      ).toBe('edit and manage access access');
    });
  });

  describe('describeInvitationExpiryDuration', () => {
    const now = new Date('2026-04-22T10:00:00.000Z');

    it('returns 1 day for same-day and next-day windows', () => {
      expect(
        describeInvitationExpiryDuration(
          new Date('2026-04-22T16:00:00.000Z'),
          now,
        ),
      ).toBe('1 day');
      expect(
        describeInvitationExpiryDuration(
          new Date('2026-04-23T09:00:00.000Z'),
          now,
        ),
      ).toBe('1 day');
    });

    it('rounds up to whole days for longer windows', () => {
      expect(
        describeInvitationExpiryDuration(
          new Date('2026-04-24T10:00:01.000Z'),
          now,
        ),
      ).toBe('3 days');
    });
  });

  describe('formatDocumentUserDisplayName', () => {
    it('uses a full name when available and falls back otherwise', () => {
      expect(
        formatDocumentUserDisplayName('Jane', 'Doe', 'jane@example.com'),
      ).toBe('Jane Doe');
      expect(
        formatDocumentUserDisplayName(null, null, 'jane@example.com'),
      ).toBe('jane@example.com');
    });
  });

  describe('getDocumentInviterDisplayName', () => {
    it('returns a verified-user fallback when there is no inviter profile', () => {
      expect(getDocumentInviterDisplayName(null)).toBe('A verified user');
    });

    it('formats the inviter name from citizen identity data', () => {
      expect(
        getDocumentInviterDisplayName({
          email: 'owner@example.com',
          citizenIdentity: {
            postNames: 'Grace',
            surName: 'Nadine',
          },
        }),
      ).toBe('Grace Nadine');
    });
  });

  describe('maskDocumentRecipientEmail', () => {
    it('masks the local part while preserving the domain', () => {
      expect(maskDocumentRecipientEmail('john@example.com')).toBe(
        'jo**@example.com',
      );
      expect(maskDocumentRecipientEmail('abcdef@example.com')).toBe(
        'ab****@example.com',
      );
    });

    it('leaves malformed email strings unchanged', () => {
      expect(maskDocumentRecipientEmail('')).toBe('');
    });
  });
});
