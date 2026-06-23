import {
  CollaboratorInvitationStatus,
  CollaboratorPermission,
  CollaboratorRole,
} from '@gracon/database';
import {
  canUserAccessDocumentPermission,
  deriveCollaboratorRoleFromPermissions,
  DOCUMENT_PERMISSION_ORDER,
  getEffectiveDocumentPermissions,
  getLegacyPermissionsForRole,
  hasDocumentPermission,
  isAcceptedActiveCollaborator,
  normalizeDocumentPermissions,
  type DocumentPermissionRecord,
} from './document-permissions.helper';

function createCollaborator(
  overrides: Partial<DocumentPermissionRecord> = {},
): DocumentPermissionRecord {
  return {
    role: CollaboratorRole.VIEWER,
    permissions: [CollaboratorPermission.READ],
    invitationStatus: CollaboratorInvitationStatus.ACCEPTED,
    acceptedAt: new Date('2026-01-01T09:00:00.000Z'),
    isActive: true,
    ...overrides,
  };
}

describe('document-permissions.helper', () => {
  it('normalizes permissions into canonical order and auto-adds read', () => {
    expect(
      normalizeDocumentPermissions([
        CollaboratorPermission.MANAGE_ACCESS,
        CollaboratorPermission.EDIT,
      ]),
    ).toEqual([
      CollaboratorPermission.READ,
      CollaboratorPermission.EDIT,
      CollaboratorPermission.MANAGE_ACCESS,
    ]);
  });

  it('returns an empty array when no permissions are granted', () => {
    expect(normalizeDocumentPermissions([])).toEqual([]);
  });

  it('keeps the platform permission order stable', () => {
    expect(DOCUMENT_PERMISSION_ORDER).toEqual([
      CollaboratorPermission.READ,
      CollaboratorPermission.COMMENT,
      CollaboratorPermission.SIGN,
      CollaboratorPermission.EDIT,
      CollaboratorPermission.MANAGE_ACCESS,
    ]);
  });

  it('maps edit permissions to editor', () => {
    expect(
      deriveCollaboratorRoleFromPermissions([
        CollaboratorPermission.READ,
        CollaboratorPermission.EDIT,
      ]),
    ).toBe(CollaboratorRole.EDITOR);
  });

  it('maps sign-only permissions to signer', () => {
    expect(
      deriveCollaboratorRoleFromPermissions([
        CollaboratorPermission.READ,
        CollaboratorPermission.SIGN,
      ]),
    ).toBe(CollaboratorRole.SIGNER);
  });

  it('falls back to legacy permissions for old collaborator records', () => {
    expect(
      getEffectiveDocumentPermissions(
        createCollaborator({
          role: CollaboratorRole.SIGNER,
          permissions: [],
        }),
      ),
    ).toEqual(getLegacyPermissionsForRole(CollaboratorRole.SIGNER));
  });

  it('recognizes an accepted active collaborator', () => {
    expect(isAcceptedActiveCollaborator(createCollaborator())).toBe(true);
  });

  it('rejects inactive or pending collaborators from active access', () => {
    expect(
      isAcceptedActiveCollaborator(
        createCollaborator({ isActive: false }),
      ),
    ).toBe(false);
    expect(
      isAcceptedActiveCollaborator(
        createCollaborator({
          invitationStatus: CollaboratorInvitationStatus.PENDING,
        }),
      ),
    ).toBe(false);
  });

  it('allows read for an accepted viewer and denies edit without edit access', () => {
    const collaborator = createCollaborator({
      role: CollaboratorRole.VIEWER,
      permissions: [CollaboratorPermission.READ],
    });

    expect(
      hasDocumentPermission(collaborator, CollaboratorPermission.READ),
    ).toBe(true);
    expect(
      hasDocumentPermission(collaborator, CollaboratorPermission.EDIT),
    ).toBe(false);
  });

  it('allows sign for an accepted signer', () => {
    expect(
      hasDocumentPermission(
        createCollaborator({
          role: CollaboratorRole.SIGNER,
          permissions: [
            CollaboratorPermission.READ,
            CollaboratorPermission.SIGN,
          ],
        }),
        CollaboratorPermission.SIGN,
      ),
    ).toBe(true);
  });

  it('always allows the owner regardless of collaborator state', () => {
    expect(
      canUserAccessDocumentPermission({
        userId: 'owner-1',
        ownerId: 'owner-1',
        collaborator: null,
        permission: CollaboratorPermission.MANAGE_ACCESS,
      }),
    ).toBe(true);
  });

  it('allows an accepted access manager to manage access', () => {
    expect(
      canUserAccessDocumentPermission({
        userId: 'user-2',
        ownerId: 'owner-1',
        collaborator: createCollaborator({
          role: CollaboratorRole.EDITOR,
          permissions: [
            CollaboratorPermission.READ,
            CollaboratorPermission.EDIT,
            CollaboratorPermission.MANAGE_ACCESS,
          ],
        }),
        permission: CollaboratorPermission.MANAGE_ACCESS,
      }),
    ).toBe(true);
  });

  it('denies signing when a collaborator only has comment access', () => {
    expect(
      canUserAccessDocumentPermission({
        userId: 'user-2',
        ownerId: 'owner-1',
        collaborator: createCollaborator({
          role: CollaboratorRole.VIEWER,
          permissions: [
            CollaboratorPermission.READ,
            CollaboratorPermission.COMMENT,
          ],
        }),
        permission: CollaboratorPermission.SIGN,
      }),
    ).toBe(false);
  });
});
