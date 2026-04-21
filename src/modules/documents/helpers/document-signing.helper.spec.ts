import {
  CollaboratorInvitationStatus,
  CollaboratorPermission,
  DocumentStatus,
} from '@prisma/client';
import {
  buildRequiredSignerIds,
  canDocumentAcceptNewSignature,
  collaboratorRequiresSignature,
  evaluateLockDocument,
  resolveSigningStatusUpdate,
} from './document-signing.helper';

describe('document-signing.helper', () => {
  describe('buildRequiredSignerIds', () => {
    it('keeps accepted collaborator signer ids when owner signature is not required', () => {
      expect(
        buildRequiredSignerIds({
          ownerId: 'owner-1',
          collaboratorSignerIds: ['user-2', 'user-3'],
          requireOwnerSignature: false,
        }),
      ).toEqual(['user-2', 'user-3']);
    });

    it('prepends the owner and de-duplicates signer ids when owner signature is required', () => {
      expect(
        buildRequiredSignerIds({
          ownerId: 'owner-1',
          collaboratorSignerIds: ['owner-1', 'user-2', 'user-2'],
          requireOwnerSignature: true,
        }),
      ).toEqual(['owner-1', 'user-2']);
    });
  });

  describe('collaboratorRequiresSignature', () => {
    it('requires signature only for accepted active signers', () => {
      expect(
        collaboratorRequiresSignature({
          permissions: [
            CollaboratorPermission.READ,
            CollaboratorPermission.SIGN,
          ],
          invitationStatus: CollaboratorInvitationStatus.ACCEPTED,
          acceptedAt: new Date('2026-01-01T09:00:00.000Z'),
          isActive: true,
        }),
      ).toBe(true);
    });

    it('rejects pending or inactive collaborators even if sign permission exists', () => {
      expect(
        collaboratorRequiresSignature({
          permissions: [
            CollaboratorPermission.READ,
            CollaboratorPermission.SIGN,
          ],
          invitationStatus: CollaboratorInvitationStatus.PENDING,
          acceptedAt: null,
          isActive: false,
        }),
      ).toBe(false);
    });
  });

  describe('canDocumentAcceptNewSignature', () => {
    it('allows signatures for finalised and already-signed documents', () => {
      expect(canDocumentAcceptNewSignature(DocumentStatus.FINALISED)).toBe(true);
      expect(canDocumentAcceptNewSignature(DocumentStatus.SIGNED)).toBe(true);
    });

    it('rejects signatures for draft and locked documents', () => {
      expect(canDocumentAcceptNewSignature(DocumentStatus.DRAFT)).toBe(false);
      expect(canDocumentAcceptNewSignature(DocumentStatus.LOCKED)).toBe(false);
    });
  });

  describe('resolveSigningStatusUpdate', () => {
    it('moves the document to signed once no pending signatures remain', () => {
      const signedAt = new Date('2026-01-03T10:00:00.000Z');

      expect(
        resolveSigningStatusUpdate({
          pendingSignatureCount: 0,
          latestCompletedSignedAt: signedAt,
        }),
      ).toEqual({
        status: DocumentStatus.SIGNED,
        signedAt,
      });
    });

    it('keeps the document finalised while pending signatures remain', () => {
      expect(
        resolveSigningStatusUpdate({
          pendingSignatureCount: 2,
          latestCompletedSignedAt: new Date('2026-01-03T10:00:00.000Z'),
        }),
      ).toEqual({
        status: DocumentStatus.FINALISED,
        signedAt: null,
      });
    });
  });

  describe('evaluateLockDocument', () => {
    it('allows locking only for the owner after all signatures are complete', () => {
      expect(
        evaluateLockDocument({
          isOwner: true,
          status: DocumentStatus.SIGNED,
          pendingSignatureCount: 0,
          hasCompletedSignature: true,
        }),
      ).toEqual({ allowed: true });
    });

    it('rejects non-owners from locking', () => {
      expect(
        evaluateLockDocument({
          isOwner: false,
          status: DocumentStatus.SIGNED,
          pendingSignatureCount: 0,
          hasCompletedSignature: true,
        }),
      ).toEqual({ allowed: false, reason: 'NOT_OWNER' });
    });

    it('rejects locking when the document is not yet in signed status', () => {
      expect(
        evaluateLockDocument({
          isOwner: true,
          status: DocumentStatus.FINALISED,
          pendingSignatureCount: 0,
          hasCompletedSignature: true,
        }),
      ).toEqual({ allowed: false, reason: 'INVALID_STATUS' });
    });

    it('rejects locking while signatures are still pending', () => {
      expect(
        evaluateLockDocument({
          isOwner: true,
          status: DocumentStatus.SIGNED,
          pendingSignatureCount: 1,
          hasCompletedSignature: true,
        }),
      ).toEqual({ allowed: false, reason: 'PENDING_SIGNATURES' });
    });

    it('rejects locking when there is no completed signature snapshot source', () => {
      expect(
        evaluateLockDocument({
          isOwner: true,
          status: DocumentStatus.SIGNED,
          pendingSignatureCount: 0,
          hasCompletedSignature: false,
        }),
      ).toEqual({ allowed: false, reason: 'MISSING_COMPLETED_SIGNATURE' });
    });
  });
});
