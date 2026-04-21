import {
  CollaboratorInvitationStatus,
  CollaboratorPermission,
  CollaboratorRole,
  DocumentStatus,
} from '@prisma/client';

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T[K] extends object | null
      ? DeepPartial<Exclude<T[K], null>> | null
      : T[K];
};

export type TestCollaboratorRecord = {
  id: string;
  userId: string;
  role: CollaboratorRole;
  permissions: CollaboratorPermission[];
  invitationStatus: CollaboratorInvitationStatus;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  revokedAt: Date | null;
  invitationExpiresAt: Date | null;
  note: string | null;
  isActive: boolean;
};

export type TestInvitationRecord = {
  id: string;
  documentId: string;
  userId: string;
  rawToken: string;
  permissions: CollaboratorPermission[];
  invitationStatus: CollaboratorInvitationStatus;
  invitationExpiresAt: Date | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  revokedAt: Date | null;
  emailOtpVerifiedAt: Date | null;
  identityVerifiedAt: Date | null;
};

export type TestDocumentWorkflowState = {
  id: string;
  ownerId: string;
  status: DocumentStatus;
  requireOwnerSignature: boolean;
  finalisedAt: Date | null;
  signedAt: Date | null;
  lockedAt: Date | null;
  collaborators: TestCollaboratorRecord[];
  requiredSignerIds: string[];
  completedSignerIds: string[];
};

const DEFAULT_CANONICAL_PERMISSION_ORDER: CollaboratorPermission[] = [
  CollaboratorPermission.READ,
  CollaboratorPermission.COMMENT,
  CollaboratorPermission.SIGN,
  CollaboratorPermission.EDIT,
  CollaboratorPermission.MANAGE_ACCESS,
];

let sequence = 0;

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function mergeObject<T>(base: T, overrides?: DeepPartial<T>): T {
  if (!overrides) {
    return base;
  }

  const result = { ...base } as Record<string, unknown>;

  for (const [key, value] of Object.entries(overrides)) {
    if (Array.isArray(value)) {
      result[key] = value;
      continue;
    }

    if (value && typeof value === 'object' && !(value instanceof Date)) {
      const baseValue = result[key];
      if (
        baseValue &&
        typeof baseValue === 'object' &&
        !Array.isArray(baseValue) &&
        !(baseValue instanceof Date)
      ) {
        result[key] = mergeObject(
          baseValue as Record<string, unknown>,
          value as DeepPartial<Record<string, unknown>>,
        );
        continue;
      }
    }

    result[key] = value;
  }

  return result as T;
}

export function canonicalizeTestPermissions(
  permissions: CollaboratorPermission[],
): CollaboratorPermission[] {
  const granted = new Set(permissions);
  if (granted.size === 0) {
    return [];
  }

  granted.add(CollaboratorPermission.READ);

  return DEFAULT_CANONICAL_PERMISSION_ORDER.filter((permission) =>
    granted.has(permission),
  );
}

export function createTestCollaborator(
  overrides?: DeepPartial<TestCollaboratorRecord>,
): TestCollaboratorRecord {
  const base: TestCollaboratorRecord = {
    id: nextId('collaborator'),
    userId: nextId('user'),
    role: CollaboratorRole.VIEWER,
    permissions: [CollaboratorPermission.READ],
    invitationStatus: CollaboratorInvitationStatus.ACCEPTED,
    acceptedAt: new Date('2026-01-01T09:00:00.000Z'),
    declinedAt: null,
    revokedAt: null,
    invitationExpiresAt: null,
    note: null,
    isActive: true,
  };

  const merged = mergeObject(base, overrides);
  merged.permissions = canonicalizeTestPermissions(merged.permissions);

  return merged;
}

export function createTestInvitation(
  overrides?: DeepPartial<TestInvitationRecord>,
): TestInvitationRecord {
  const base: TestInvitationRecord = {
    id: nextId('invitation'),
    documentId: nextId('document'),
    userId: nextId('user'),
    rawToken: `invite-token-${nextId('raw')}`,
    permissions: [CollaboratorPermission.READ],
    invitationStatus: CollaboratorInvitationStatus.PENDING,
    invitationExpiresAt: new Date('2026-01-08T09:00:00.000Z'),
    acceptedAt: null,
    declinedAt: null,
    revokedAt: null,
    emailOtpVerifiedAt: null,
    identityVerifiedAt: null,
  };

  const merged = mergeObject(base, overrides);
  merged.permissions = canonicalizeTestPermissions(merged.permissions);

  return merged;
}

export function createTestDocumentWorkflowState(
  overrides?: DeepPartial<TestDocumentWorkflowState>,
): TestDocumentWorkflowState {
  const base: TestDocumentWorkflowState = {
    id: nextId('document'),
    ownerId: nextId('owner'),
    status: DocumentStatus.DRAFT,
    requireOwnerSignature: false,
    finalisedAt: null,
    signedAt: null,
    lockedAt: null,
    collaborators: [],
    requiredSignerIds: [],
    completedSignerIds: [],
  };

  return mergeObject(base, overrides);
}
