/**
 * users.service.spec.ts — api/documents
 *
 * Verifies safe user search behavior without touching the database.
 */

import { UsersService } from './users.service';

describe('UsersService', () => {
  const findMany = jest.fn();
  const hash = jest.fn((value: string) => `hash:${value}`);
  const service = new UsersService(
    {
      user: {
        findMany,
      },
    } as unknown as ConstructorParameters<typeof UsersService>[0],
    {
      hash,
    } as unknown as ConstructorParameters<typeof UsersService>[1],
  );

  beforeEach(() => {
    findMany.mockReset();
    hash.mockClear();
  });

  it('searches platform IDs by stored hash without selecting encrypted PID values', async () => {
    findMany.mockResolvedValue([
      {
        id: 'user-1',
        email: 'habimanadaniel@gmail.com',
        imageUrl: null,
        citizenIdentity: { surName: 'HABIMANA', postNames: 'Daniel' },
      },
    ]);

    const result = await service.searchUsers('19934829161', 'platformId', 10);

    expect(hash).toHaveBeenCalledWith('19934829161');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          platformId: { is: { pidHash: 'hash:19934829161' } },
        }),
        select: expect.not.objectContaining({
          platformId: expect.anything(),
        }),
      }),
    );
    expect(result).toEqual([
      {
        id: 'user-1',
        email: 'habimanadaniel@gmail.com',
        imageUrl: null,
        surName: 'HABIMANA',
        postNames: 'Daniel',
        matchedBy: 'PLATFORM_ID',
      },
    ]);
  });

  it('searches citizen IDs by stored hash without selecting encrypted NID values', async () => {
    findMany.mockResolvedValue([]);

    await service.searchUsers('1199301019000001', 'citizenId', 10);

    expect(hash).toHaveBeenCalledWith('1199301019000001');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          citizenIdentity: { is: { nidHash: 'hash:1199301019000001' } },
        }),
        select: expect.objectContaining({
          citizenIdentity: {
            select: { surName: true, postNames: true },
          },
        }),
      }),
    );
  });

  it('rejects malformed numeric identifier queries before database lookup', async () => {
    await expect(
      service.searchUsers('not-a-platform-id', 'platformId', 10),
    ).resolves.toEqual([]);

    expect(findMany).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
  });
});
