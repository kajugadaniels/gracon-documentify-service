import {
  IsString,
  IsOptional,
  MaxLength,
  IsArray,
  IsObject,
  IsNumber,
  Min,
  Max,
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

export class UpdateSignatureLayoutDto {
  @ApiPropertyOptional({
    description:
      'Normalized horizontal position of the signature strip (0.0 = left edge, 1.0 = right edge).',
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  x?: number;

  @ApiPropertyOptional({
    description:
      'Normalized vertical position of the signature strip (0.0 = top, 1.0 = bottom).',
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  y?: number;
}
