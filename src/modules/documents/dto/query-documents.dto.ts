import {
  IsOptional,
  IsIn,
  IsString,
  IsUUID,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const DOCUMENT_LIST_SCOPES = [
  'ALL_ACCESSIBLE',
  'OWNED',
  'SHARED_WITH_ME',
] as const;

export type DocumentListScope = (typeof DOCUMENT_LIST_SCOPES)[number];

export class QueryDocumentsDto {
  @ApiPropertyOptional({
    enum: DOCUMENT_LIST_SCOPES,
    default: 'ALL_ACCESSIBLE',
    description:
      'Controls whether the list returns owned documents, accepted shared documents, or both.',
  })
  @IsOptional()
  @IsIn([...DOCUMENT_LIST_SCOPES])
  scope?: DocumentListScope = 'ALL_ACCESSIBLE';

  @ApiPropertyOptional({ enum: ['DRAFT', 'FINALISED', 'SIGNED', 'LOCKED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'FINALISED', 'SIGNED', 'LOCKED'])
  status?: 'DRAFT' | 'FINALISED' | 'SIGNED' | 'LOCKED';

  @ApiPropertyOptional({ enum: ['RICH_TEXT', 'SPREADSHEET'] })
  @IsOptional()
  @IsIn(['RICH_TEXT', 'SPREADSHEET'])
  type?: 'RICH_TEXT' | 'SPREADSHEET';

  @ApiPropertyOptional({ description: 'Filter by folder ID.' })
  @IsOptional()
  @IsUUID()
  folderId?: string;

  @ApiPropertyOptional({ description: 'Search in document titles.' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
