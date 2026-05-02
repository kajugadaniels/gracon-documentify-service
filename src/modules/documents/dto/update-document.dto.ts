import {
  IsString,
  IsOptional,
  MaxLength,
  IsArray,
  IsObject,
  IsNumber,
  IsBoolean,
  Min,
  Max,
  ValidateNested,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class DocumentLayoutMarginsDto {
  @ApiPropertyOptional({ minimum: 48, maximum: 192 })
  @IsOptional()
  @IsNumber()
  @Min(48)
  @Max(192)
  top?: number;

  @ApiPropertyOptional({ minimum: 48, maximum: 192 })
  @IsOptional()
  @IsNumber()
  @Min(48)
  @Max(192)
  right?: number;

  @ApiPropertyOptional({ minimum: 48, maximum: 192 })
  @IsOptional()
  @IsNumber()
  @Min(48)
  @Max(192)
  bottom?: number;

  @ApiPropertyOptional({ minimum: 48, maximum: 192 })
  @IsOptional()
  @IsNumber()
  @Min(48)
  @Max(192)
  left?: number;
}

export class DocumentHeaderFooterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  headerEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  footerEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  pageNumbersEnabled?: boolean;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  headerText?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  footerText?: string;
}

export class DocumentLayoutDto {
  @ApiPropertyOptional({ enum: ['A4'], description: 'Persisted paper size.' })
  @IsOptional()
  @IsIn(['A4'])
  paperSize?: 'A4';

  @ApiPropertyOptional({
    type: () => DocumentLayoutMarginsDto,
    description: 'Persisted page margins in CSS pixels.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DocumentLayoutMarginsDto)
  margins?: DocumentLayoutMarginsDto;

  @ApiPropertyOptional({
    type: () => DocumentHeaderFooterDto,
    description: 'Persisted header, footer, and page number settings.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DocumentHeaderFooterDto)
  headerFooter?: DocumentHeaderFooterDto;
}

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

  @ApiPropertyOptional({
    type: () => DocumentLayoutDto,
    description: 'Persisted page layout settings.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DocumentLayoutDto)
  layout?: DocumentLayoutDto;
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
