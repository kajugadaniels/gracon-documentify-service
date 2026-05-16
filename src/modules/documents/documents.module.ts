import { Module } from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { AuthModule } from '../auth/auth.module';
import { DocumentsController } from './documents.controller';
import { DocumentQueryService } from './document-query.service';
import { DocumentsService } from './documents.service';
import { PdfExportService } from './pdf-export.service';

@Module({
  imports: [AuthModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentQueryService,
    PdfExportService,
    EncryptionService,
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
