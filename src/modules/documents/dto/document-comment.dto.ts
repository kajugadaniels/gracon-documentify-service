import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDocumentCommentDto {
  @ApiProperty({
    description: 'Comment body. Stored as plain text.',
    maxLength: 4000,
  })
  @IsString()
  @MaxLength(4000)
  content: string;

  @ApiPropertyOptional({
    description:
      'Optional selected text from the document that the comment refers to.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  anchorText?: string;

  @ApiPropertyOptional({
    description: 'TipTap selection start position for the anchor.',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  anchorFrom?: number;

  @ApiPropertyOptional({
    description: 'TipTap selection end position for the anchor.',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  anchorTo?: number;

  @ApiPropertyOptional({
    description: 'Top-level comment ID when creating a reply.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  parentCommentId?: string;
}
