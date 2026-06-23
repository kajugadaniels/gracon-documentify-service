/**
 * Pure Prisma query-shape helpers for the documents service.
 *
 * Holds the `where` builder used by the document listing endpoint. Kept here
 * because the scope-to-where mapping is pure and easy to unit test in
 * isolation from Prisma execution.
 */
import { Prisma } from '@gracon/database';
import type { DocumentListScope } from '../dto/query-documents.dto';

/**
 * Builds the `Prisma.DocumentWhereInput` for the document list endpoint based
 * on the requested scope (mine / shared / both) and a base filter.
 *
 * @param userId - Authenticated user requesting the list.
 * @param scope - Which slice of documents the caller wants.
 * @param baseWhere - Common filters (status / type / folder / search) already applied.
 * @param acceptedSharedAccess - Where-clause that matches an accepted, active collaborator row.
 * @returns The composed where clause ready to pass to `prisma.document.findMany`.
 */
export function buildDocumentListWhere(
  userId: string,
  scope: DocumentListScope,
  baseWhere: Prisma.DocumentWhereInput,
  acceptedSharedAccess: Prisma.DocumentCollaboratorWhereInput,
): Prisma.DocumentWhereInput {
  if (scope === 'OWNED') {
    return {
      ...baseWhere,
      ownerId: userId,
    };
  }

  if (scope === 'SHARED_WITH_ME') {
    return {
      ...baseWhere,
      ownerId: { not: userId },
      collaborators: { some: acceptedSharedAccess },
    };
  }

  // ALL_ACCESSIBLE — owned OR shared-with-me.
  return {
    ...baseWhere,
    OR: [
      { ownerId: userId },
      {
        ownerId: { not: userId },
        collaborators: { some: acceptedSharedAccess },
      },
    ],
  };
}
