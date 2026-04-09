import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { S3Service } from '../../common/s3/s3.service';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  async findAll(category?: string, type?: string) {
    const where = {
      isPublic: true,
      ...(category ? { category: category as never } : {}),
      ...(type ? { type: type as never } : {}),
    };

    return this.prisma.documentTemplate.findMany({
      where,
      orderBy: [{ usageCount: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        type: true,
        usageCount: true,
        createdAt: true,
      },
    });
  }

  async findOne(templateId: string) {
    const template = await this.prisma.documentTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template || !template.isPublic) {
      throw new NotFoundException('Template not found.');
    }

    // Fetch preview presigned URL if available
    let previewUrl: string | null = null;
    if (template.previewS3Key) {
      try {
        previewUrl = await this.s3.getPresignedUrl(template.previewS3Key, 3600);
      } catch {
        this.logger.warn(
          `Failed to get preview URL for template ${templateId}`,
        );
      }
    }

    return { ...template, previewUrl };
  }
}
