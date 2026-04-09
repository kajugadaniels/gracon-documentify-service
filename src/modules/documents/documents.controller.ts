import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import {
  UpdateDocumentDto,
  AutosaveDocumentDto,
} from './dto/update-document.dto';
import { FinaliseDocumentDto } from './dto/finalise-document.dto';
import { LockDocumentDto } from './dto/lock-document.dto';
import { QueryDocumentsDto } from './dto/query-documents.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequestUser } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('Documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  // ─── Create ────────────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ strict: { limit: 20, ttl: 600_000 } })
  @ApiOperation({ summary: 'Create a new document (RICH_TEXT or SPREADSHEET)' })
  @ApiResponse({
    status: 201,
    description: 'Document created with default or template content',
  })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateDocumentDto) {
    return this.service.create(user.userId, dto);
  }

  // ─── List ──────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'List all documents owned by the current user (paginated)',
  })
  @ApiResponse({ status: 200, description: 'Paginated document list' })
  findAll(@CurrentUser() user: RequestUser, @Query() query: QueryDocumentsDto) {
    return this.service.findAll(user.userId, query);
  }

  // ─── Get one ───────────────────────────────────────────────────────────────

  @Get(':documentId')
  @ApiParam({ name: 'documentId', type: String })
  @ApiQuery({
    name: 'includeContent',
    required: false,
    type: Boolean,
    description: 'Set to false to skip fetching the S3 content. Default: true.',
  })
  @ApiOperation({
    summary:
      'Get a document with metadata and optionally its full content from S3',
  })
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('documentId') documentId: string,
    @Query('includeContent') includeContent = 'true',
  ) {
    return this.service.findOne(
      user.userId,
      documentId,
      includeContent !== 'false',
    );
  }

  // ─── Autosave ──────────────────────────────────────────────────────────────

  @Patch(':documentId/autosave')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'documentId', type: String })
  @ApiOperation({
    summary:
      'Autosave document content to S3 and create a version snapshot. DRAFT only.',
  })
  @ApiResponse({ status: 200, description: 'Content saved, version created' })
  autosave(
    @CurrentUser() user: RequestUser,
    @Param('documentId') documentId: string,
    @Body() dto: AutosaveDocumentDto,
  ) {
    return this.service.autosave(user.userId, documentId, dto);
  }

  // ─── Update metadata ───────────────────────────────────────────────────────

  @Patch(':documentId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'documentId', type: String })
  @ApiOperation({ summary: 'Update document title or tags. DRAFT only.' })
  updateMetadata(
    @CurrentUser() user: RequestUser,
    @Param('documentId') documentId: string,
    @Body() dto: UpdateDocumentDto,
  ) {
    return this.service.updateMetadata(user.userId, documentId, dto);
  }

  // ─── Finalise ──────────────────────────────────────────────────────────────

  @Post(':documentId/finalise')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'documentId', type: String })
  @ApiOperation({
    summary:
      'Freeze document content and compute SHA-256 hash. ' +
      'After this, the user must sign the hash via api/signature/, then call /lock.',
  })
  @ApiResponse({
    status: 200,
    description: 'Content frozen, contentHash returned for signing',
  })
  finalise(
    @CurrentUser() user: RequestUser,
    @Param('documentId') documentId: string,
    @Body() dto: FinaliseDocumentDto,
  ) {
    return this.service.finalise(user.userId, documentId, dto);
  }

  // ─── Lock ──────────────────────────────────────────────────────────────────

  @Post(':documentId/lock')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'documentId', type: String })
  @ApiOperation({
    summary:
      'Lock the document after signing is complete. ' +
      'Provide the signatureId from api/signature/ and the documentHash that was signed. ' +
      'The service verifies both match before locking.',
  })
  @ApiResponse({
    status: 200,
    description: 'Document locked — permanently immutable',
  })
  lock(
    @CurrentUser() user: RequestUser,
    @Param('documentId') documentId: string,
    @Body() dto: LockDocumentDto,
  ) {
    return this.service.lock(user.userId, documentId, dto);
  }

  // ─── Versions ──────────────────────────────────────────────────────────────

  @Get(':documentId/versions')
  @ApiParam({ name: 'documentId', type: String })
  @ApiOperation({ summary: 'Get version history for a document' })
  getVersions(
    @CurrentUser() user: RequestUser,
    @Param('documentId') documentId: string,
  ) {
    return this.service.getVersions(user.userId, documentId);
  }

  @Post(':documentId/versions/:versionNumber/restore')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'documentId', type: String })
  @ApiParam({ name: 'versionNumber', type: Number })
  @ApiOperation({
    summary: 'Restore document to a previous version. DRAFT only.',
  })
  restoreVersion(
    @CurrentUser() user: RequestUser,
    @Param('documentId') documentId: string,
    @Param('versionNumber') versionNumber: string,
  ) {
    return this.service.restoreVersion(
      user.userId,
      documentId,
      parseInt(versionNumber, 10),
    );
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  @Delete(':documentId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'documentId', type: String })
  @ApiOperation({
    summary:
      'Soft-delete a document. DRAFT and FINALISED only. LOCKED cannot be deleted.',
  })
  softDelete(
    @CurrentUser() user: RequestUser,
    @Param('documentId') documentId: string,
  ) {
    return this.service.softDelete(user.userId, documentId);
  }

  // ─── Verify (public) ───────────────────────────────────────────────────────

  @Get(':documentId/verify')
  @Public()
  @ApiParam({ name: 'documentId', type: String })
  @ApiOperation({
    summary:
      'Public document verification endpoint. No auth required. ' +
      'Returns signing proof for any LOCKED document.',
  })
  verify(@Param('documentId') documentId: string) {
    return this.service.verify(documentId);
  }
}
