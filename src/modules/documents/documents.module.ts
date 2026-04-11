import { Module } from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { PdfExportService } from './pdf-export.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, PdfExportService, EncryptionService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
