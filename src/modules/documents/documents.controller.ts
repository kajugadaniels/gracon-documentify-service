import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  Header,
  HttpCode,
  HttpStatus,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
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
import { PdfExportService } from './pdf-export.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import {
  UpdateDocumentDto,
  AutosaveDocumentDto,
  UpdateSignatureLayoutDto,
} from './dto/update-document.dto';
import { FinaliseDocumentDto } from './dto/finalise-document.dto';
import { LockDocumentDto } from './dto/lock-document.dto';
import { QueryDocumentsDto } from './dto/query-documents.dto';
import {
  ShareDocumentAccessDto,
  UpdateDocumentAccessDto,
} from './dto/manage-access.dto';
import { CreateDocumentCommentDto } from './dto/document-comment.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { RequestUser } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('Documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly service: DocumentsService,
    private readonly pdfExport: PdfExportService,
  ) {}

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

  @Post(':documentId/copy')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'documentId', type: String })
  @ApiOperation({
    summary:
      'Create a draft copy of an existing document with collision-safe copy naming.',
  })
  @ApiResponse({
    status: 201,
    description: 'A new draft copy was created for the current user.',
  })
  makeCopy(
    @CurrentUser() user: RequestUser,
    @Param('documentId') documentId: string,
  ) {
    return this.service.makeCopy(user.userId, documentId);
  }

  // ─── List ──────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary:
      'List documents accessible to the current user, including accepted shared documents.',
  })
  @ApiResponse({ status: 200, description: 'Paginated document list' })
  findAll(@CurrentUser() user: RequestUser, @Query() query: QueryDocumentsDto) {
    return this.service.findAll(user.userId, query);
  }

  // ─── Get one ───────────────────────────────────────────────────────────────

  @Get('invitations/:token')
  @Public()
  @Throttle({ strict: { limit: 30, ttl: 600_000 } })
  @ApiParam({ name: 'token', type: String })
  @ApiOperation({
    summary:
      'Public invitation preview endpoint. Returns only safe metadata before authentication.',
  })
  previewInvitation(@Param('token') token: string, @Req() req: Request) {
    return this.service.getInvitationPreview(token, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? null,
    });
  }

  @Get('invitations/:token/review')
  @Throttle({ strict: { limit: 30, ttl: 600_000 } })
  @ApiParam({ name: 'token', type: String })
  @ApiOperation({
    summary:
      'Authenticated invitation review endpoint. Reveals document title only to the invited verified user.',
  })
  reviewInvitation(
    @CurrentUser() user: RequestUser,
    @Param('token') token: string,
    @Req() req: Request,
  ) {
    return this.service.getInvitationReview(user.userId, token, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? null,
    });
  }

  @Post('invitations/:token/accept')
  @HttpCode(HttpStatus.OK)
  @Throttle({ strict: { limit: 20, ttl: 600_000 } })
  @ApiParam({ name: 'token', type: String })
  @ApiOperation({
    summary:
      'Accept an active document invitation. Requires the invited verified user.',
  })
  acceptInvitation(
    @CurrentUser() user: RequestUser,
    @Param('token') token: string,
    @Req() req: Request,
  ) {
    return this.service.acceptInvitation(user.userId, token, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? null,
    });
  }

  @Post('invitations/:token/decline')
  @HttpCode(HttpStatus.OK)
  @Throttle({ strict: { limit: 20, ttl: 600_000 } })
  @ApiParam({ name: 'token', type: String })
  @ApiOperation({
    summary:
      'Decline an active document invitation. Requires the invited verified user.',
  })
  declineInvitation(
    @CurrentUser() user: RequestUser,
    @Param('token') token: string,
    @Req() req: Request,
  ) {
    return this.service.declineInvitation(user.userId, token, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? null,
    });
  }

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

  // ─── Comments ─────────────────────────────────────────────────────────────

  @Get(':documentId/comments')
  @ApiParam({ name: 'documentId', type: String })
  @ApiOperation({
    summary:
      'List comment threads for a document. Requires read access.',
  })
  listComments(
    @CurrentUser() user: RequestUser,
    @Param('documentId') documentId: string,
  ) {
    return this.service.listComments(user.userId, documentId);
  }

  @Post(':documentId/comments')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ strict: { limit: 60, ttl: 600_000 } })
  @ApiParam({ name: 'documentId', type: String })
  @ApiOperation({
    summary:
      'Create a document comment or reply. Requires explicit comment access.',
  })
  createComment(
    @CurrentUser() user: RequestUser,
    @Param('documentId') documentId: string,
    @Body() dto: CreateDocumentCommentDto,
  ) {
    return this.service.createComment(user.userId, documentId, dto);
  }

  @Patch(':documentId/comments/:commentId/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'documentId', type: String })
  @ApiParam({ name: 'commentId', type: String })
  @ApiOperation({
    summary:
      'Resolve a top-level document comment. Owner only.',
  })
  resolveComment(
    @CurrentUser() user: RequestUser,
    @Param('documentId') documentId: string,
    @Param('commentId') commentId: string,
  ) {
    return this.service.resolveComment(user.userId, documentId, commentId);
  }

  // ─── Access management ────────────────────────────────────────────────────

  @Get(':documentId/access')
  @ApiParam({ name: 'documentId', type: String })
  @ApiOperation({
    summary:
      'List current collaborators and pending invitations for a document.',
  })
  @ApiResponse({
    status: 200,
    description: 'Access list returned for an owner or manage-access collaborator.',
  })
  getAccessList(
    @CurrentUser() user: RequestUser,
    @Param('documentId') documentId: string,
  ) {
    return this.service.getAccessList(user.userId, documentId);
  }

  @Get(':documentId/access/audit')
  @ApiParam({ name: 'documentId', type: String })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of audit events to return. Default: 50, max: 100.',
  })
  @ApiOperation({
    summary:
      'List sanitized document access audit events. Owner only.',
  })
  getAccessAuditLog(
    @CurrentUser() user: RequestUser,
    @Param('documentId') documentId: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getAccessAuditLog(user.userId, documentId, limit);
  }

  @Post(':documentId/access')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'documentId', type: String })
  @ApiOperation({
    summary:
      'Create or refresh a document invitation with an explicit permission set.',
  })
  @ApiResponse({
    status: 201,
    description: 'Invitation created or existing access updated.',
  })
  shareAccess(
    @CurrentUser() user: RequestUser,
    @Param('documentId') documentId: string,
    @Body() dto: ShareDocumentAccessDto,
    @Req() req: Request,
  ) {
    return this.service.shareAccess(user.userId, documentId, dto, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? null,
    });
  }

  @Post(':documentId/access/:collaboratorId/resend')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'documentId', type: String })
  @ApiParam({ name: 'collaboratorId', type: String })
  @ApiOperation({
    summary:
      'Resend an invitation with a fresh single-use token. Accepted active collaborators cannot be resent.',
  })
  resendAccessInvitation(
    @CurrentUser() user: RequestUser,
    @Param('documentId') documentId: string,
    @Param('collaboratorId') collaboratorId: string,
    @Req() req: Request,
  ) {
    return this.service.resendAccessInvitation(
      user.userId,
      documentId,
      collaboratorId,
      {
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? null,
      },
    );
  }

  @Patch(':documentId/access/:collaboratorId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'documentId', type: String })
  @ApiParam({ name: 'collaboratorId', type: String })
  @ApiOperation({
    summary:
      'Update the permission set for an existing collaborator or pending invitation.',
  })
  updateAccess(
    @CurrentUser() user: RequestUser,
    @Param('documentId') documentId: string,
    @Param('collaboratorId') collaboratorId: string,
    @Body() dto: UpdateDocumentAccessDto,
    @Req() req: Request,
  ) {
    return this.service.updateAccess(
      user.userId,
      documentId,
      collaboratorId,
      dto,
      {
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? null,
      },
    );
  }

  @Delete(':documentId/access/:collaboratorId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'documentId', type: String })
  @ApiParam({ name: 'collaboratorId', type: String })
  @ApiOperation({
    summary: 'Revoke a collaborator or pending invitation from a document.',
  })
  revokeAccess(
    @CurrentUser() user: RequestUser,
    @Param('documentId') documentId: string,
    @Param('collaboratorId') collaboratorId: string,
    @Req() req: Request,
  ) {
    return this.service.revokeAccess(user.userId, documentId, collaboratorId, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? null,
    });
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

  @Patch(':documentId/signature-layout')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'documentId', type: String })
  @ApiOperation({
    summary:
      'Adjust the visual placement of the frozen signature strip on a locked document.',
  })
  updateSignatureLayout(
    @CurrentUser() user: RequestUser,
    @Param('documentId') documentId: string,
    @Body() dto: UpdateSignatureLayoutDto,
  ) {
    return this.service.updateSignatureLayout(user.userId, documentId, dto);
  }

  // ─── PDF export ────────────────────────────────────────────────────────────

  @Get(':documentId/export/pdf')
  @Header('Content-Type', 'application/pdf')
  @ApiParam({ name: 'documentId', type: String })
  @ApiOperation({
    summary: 'Export a locked document as a signed PDF.',
    description:
      'Generates an A4 PDF containing the document body and the signature strip ' +
      'at the exact same normalized x/y position stored in the database, ' +
      'giving identical placement to the HTML render.',
  })
  @ApiResponse({ status: 200, description: 'PDF buffer returned as attachment' })
  @ApiResponse({ status: 403, description: 'Document is not yet locked or caller is not the owner' })
  async exportPdf(
    @CurrentUser() user: RequestUser,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const buffer = await this.pdfExport.exportPdf(user.userId, documentId);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${documentId}-signed.pdf"`,
    );
    return new StreamableFile(buffer);
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
