import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateFolderDto } from './dto/create-folder.dto';

@Injectable()
export class FoldersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateFolderDto) {
    if (dto.parentFolderId) {
      const parent = await this.prisma.documentFolder.findUnique({
        where: { id: dto.parentFolderId },
      });
      if (!parent) throw new NotFoundException('Parent folder not found.');
      if (parent.ownerId !== userId)
        throw new ForbiddenException('You do not own the parent folder.');
      if (parent.parentFolderId)
        throw new ConflictException(
          'Folders can only be nested one level deep.',
        );
    }

    return this.prisma.documentFolder.create({
      data: {
        ownerId: userId,
        name: dto.name,
        parentFolderId: dto.parentFolderId,
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.documentFolder.findMany({
      where: { ownerId: userId },
      orderBy: { name: 'asc' },
      include: { subFolders: { orderBy: { name: 'asc' } } },
    });
  }

  async rename(userId: string, folderId: string, name: string) {
    const folder = await this.prisma.documentFolder.findUnique({
      where: { id: folderId },
    });
    if (!folder) throw new NotFoundException('Folder not found.');
    if (folder.ownerId !== userId)
      throw new ForbiddenException('You do not own this folder.');

    return this.prisma.documentFolder.update({
      where: { id: folderId },
      data: { name },
    });
  }

  async delete(userId: string, folderId: string) {
    const folder = await this.prisma.documentFolder.findUnique({
      where: { id: folderId },
    });
    if (!folder) throw new NotFoundException('Folder not found.');
    if (folder.ownerId !== userId)
      throw new ForbiddenException('You do not own this folder.');

    // Move documents in this folder to no folder (null)
    await this.prisma.document.updateMany({
      where: { folderId, ownerId: userId },
      data: { folderId: null },
    });

    await this.prisma.documentFolder.delete({ where: { id: folderId } });
    return { deleted: true, folderId };
  }
}
