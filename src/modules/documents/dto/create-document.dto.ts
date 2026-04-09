import {
  IsString,
  IsIn,
  IsOptional,
  IsUUID,
  MaxLength,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDocumentDto {
  @ApiPropertyOptional({
    description: 'Document title. Defaults to "Untitled Document".',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiProperty({
    enum: ['RICH_TEXT', 'SPREADSHEET'],
    description: 'Editor type.',
  })
  @IsIn(['RICH_TEXT', 'SPREADSHEET'])
  type: 'RICH_TEXT' | 'SPREADSHEET';

  @ApiPropertyOptional({ description: 'Folder ID to place the document in.' })
  @IsOptional()
  @IsUUID()
  folderId?: string;

  @ApiPropertyOptional({
    description: 'Template ID to initialise content from.',
  })
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @ApiPropertyOptional({ description: 'Initial tags.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
