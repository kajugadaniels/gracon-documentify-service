import {
  CollaboratorInvitationStatus,
  CollaboratorPermission,
  DocumentStatus,
  SignatureRequestStatus,
} from '@gracon/database';
import {
  buildRequiredSignerIds,
  canDocumentAcceptNewSignature,
  collaboratorRequiresSignature,
  evaluateSigningReadiness,
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

  describe('evaluateSigningReadiness', () => {
    const readyInput = {
      hasSession: true,
      hasFullVerifiedSession: true,
      documentStatus: DocumentStatus.FINALISED,
      hasDocumentHash: true,
      hasSignatureRequest: true,
      signatureRequestStatus: SignatureRequestStatus.PENDING,
      hasActiveCertificate: true,
    };

    it('allows signing when the session, request, hash, and certificate are ready', () => {
      expect(evaluateSigningReadiness(readyInput)).toEqual({
        status: 'ready',
        canSign: true,
        message: 'Ready to sign this finalised document.',
      });
    });

    it('requires login before revealing document-specific readiness', () => {
      expect(
        evaluateSigningReadiness({
          ...readyInput,
          hasSession: false,
        }).status,
      ).toBe('needs_login');
    });

    it('requires identity verification for limited or unverified sessions', () => {
      expect(
        evaluateSigningReadiness({
          ...readyInput,
          hasFullVerifiedSession: false,
        }).status,
      ).toBe('needs_identity_verification');
    });

    it('reports an already completed signer before certificate checks', () => {
      expect(
        evaluateSigningReadiness({
          ...readyInput,
          signatureRequestStatus: SignatureRequestStatus.SIGNED,
          hasActiveCertificate: false,
        }).status,
      ).toBe('already_signed');
    });

    it('requires an active certificate for pending required signers', () => {
      expect(
        evaluateSigningReadiness({
          ...readyInput,
          hasActiveCertificate: false,
        }).status,
      ).toBe('needs_certificate');
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
