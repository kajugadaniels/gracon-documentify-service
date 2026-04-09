import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { TemplatesService } from './templates.service';

@ApiTags('Templates')
@ApiBearerAuth()
@Controller('templates')
export class TemplatesController {
  constructor(private readonly service: TemplatesService) {}

  @Get()
  @ApiQuery({
    name: 'category',
    required: false,
    enum: [
      'CONTRACT',
      'LEGAL',
      'FINANCIAL',
      'CORRESPONDENCE',
      'RESOLUTION',
      'OTHER',
    ],
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['RICH_TEXT', 'SPREADSHEET'],
  })
  @ApiOperation({ summary: 'List all available document templates' })
  @ApiResponse({
    status: 200,
    description: 'Template list sorted by usage count',
  })
  findAll(@Query('category') category?: string, @Query('type') type?: string) {
    return this.service.findAll(category, type);
  }

  @Get(':templateId')
  @ApiParam({ name: 'templateId', type: String })
  @ApiOperation({
    summary: 'Get template details including full content JSON and preview URL',
  })
  findOne(@Param('templateId') templateId: string) {
    return this.service.findOne(templateId);
  }
}
