import {
  IsString,
  IsOptional,
  MaxLength,
  IsArray,
  IsObject,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDocumentDto {
  @ApiPropertyOptional({ description: 'New document title.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ description: 'Updated tags.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class AutosaveDocumentDto {
  @ApiPropertyOptional({
    description: 'Tiptap JSON editor state or spreadsheet JSON.',
  })
  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Word/cell count at time of save.' })
  @IsOptional()
  wordCount?: number;
}
