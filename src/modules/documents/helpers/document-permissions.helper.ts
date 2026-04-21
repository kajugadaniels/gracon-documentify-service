import {
  CollaboratorInvitationStatus,
  CollaboratorPermission,
  CollaboratorRole,
} from '@prisma/client';

export const DOCUMENT_PERMISSION_ORDER: CollaboratorPermission[] = [
  CollaboratorPermission.READ,
  CollaboratorPermission.COMMENT,
  CollaboratorPermission.SIGN,
  CollaboratorPermission.EDIT,
  CollaboratorPermission.MANAGE_ACCESS,
];

export type DocumentPermissionRecord = {
  role: CollaboratorRole;
  permissions: CollaboratorPermission[];
  invitationStatus: CollaboratorInvitationStatus;
  acceptedAt: Date | null;
  isActive: boolean;
};

export function normalizeDocumentPermissions(
  permissions: CollaboratorPermission[],
): CollaboratorPermission[] {
  const unique = new Set<CollaboratorPermission>(permissions);

  if (unique.size === 0) {
    return [];
  }

  unique.add(CollaboratorPermission.READ);

  return DOCUMENT_PERMISSION_ORDER.filter((permission) => unique.has(permission));
}

export function deriveCollaboratorRoleFromPermissions(
  permissions: CollaboratorPermission[],
): CollaboratorRole {
  if (permissions.includes(CollaboratorPermission.EDIT)) {
    return CollaboratorRole.EDITOR;
  }

  if (permissions.includes(CollaboratorPermission.SIGN)) {
    return CollaboratorRole.SIGNER;
  }

  return CollaboratorRole.VIEWER;
}

export function getLegacyPermissionsForRole(
  role: CollaboratorRole,
): CollaboratorPermission[] {
  if (role === CollaboratorRole.EDITOR) {
    return [
      CollaboratorPermission.READ,
      CollaboratorPermission.COMMENT,
      CollaboratorPermission.EDIT,
    ];
  }

  if (role === CollaboratorRole.SIGNER) {
    return [CollaboratorPermission.READ, CollaboratorPermission.SIGN];
  }

  return [CollaboratorPermission.READ, CollaboratorPermission.COMMENT];
}

export function getEffectiveDocumentPermissions(collaborator: {
  role: CollaboratorRole;
  permissions: CollaboratorPermission[];
}): CollaboratorPermission[] {
  if (collaborator.permissions.length > 0) {
    return collaborator.permissions;
  }

  return getLegacyPermissionsForRole(collaborator.role);
}

export function isAcceptedActiveCollaborator(
  collaborator: DocumentPermissionRecord | null,
): collaborator is DocumentPermissionRecord {
  return Boolean(
    collaborator &&
      collaborator.isActive &&
      collaborator.acceptedAt !== null &&
      collaborator.invitationStatus === CollaboratorInvitationStatus.ACCEPTED,
  );
}

export function hasDocumentPermission(
  collaborator: DocumentPermissionRecord | null,
  permission: CollaboratorPermission,
): boolean {
  if (!isAcceptedActiveCollaborator(collaborator)) {
    return false;
  }

  return getEffectiveDocumentPermissions(collaborator).includes(permission);
}

export function canUserAccessDocumentPermission(input: {
  userId: string;
  ownerId: string;
  collaborator: DocumentPermissionRecord | null;
  permission: CollaboratorPermission;
}): boolean {
  if (input.userId === input.ownerId) {
    return true;
  }

  return hasDocumentPermission(input.collaborator, input.permission);
}
