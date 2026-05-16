/**
 * document-query.service.spec.ts
 *
 * Covers document list query orchestration after extraction from DocumentsService.
 */

import { DocumentQueryService } from './document-query.service';

describe('DocumentQueryService', () => {
  const count = jest.fn();
  const findMany = jest.fn();
  const service = new DocumentQueryService({
    document: {
      count,
      findMany,
    },
  } as unknown as ConstructorParameters<typeof DocumentQueryService>[0]);

  beforeEach(() => {
    count.mockReset();
    findMany.mockReset();
  });

  it('lists owned documents with pagination and access summaries', async () => {
    count.mockResolvedValue(1);
    findMany.mockResolvedValue([
      {
        id: 'document-1',
        ownerId: 'user-1',
        title: 'Agreement',
        type: 'RICH_TEXT',
        status: 'DRAFT',
        tags: [],
        wordCount: 12,
        folderId: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        signedAt: null,
        lockedAt: null,
        collaborators: [],
      },
    ]);

    const result = await service.findAll('user-1', {
      scope: 'OWNED',
      page: 2,
      limit: 10,
    });

    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        isDeleted: false,
        ownerId: 'user-1',
      }),
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
        orderBy: { updatedAt: 'desc' },
      }),
    );
    expect(result.total).toBe(1);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(10);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: 'document-1',
        title: 'Agreement',
        access: expect.objectContaining({ isOwner: true }),
      }),
    );
  });
});
