/**
 * document-comment.dto.ts
 *
 * Defines validated request/query shapes for document review comments.
 */
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
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

export class QueryDocumentCommentsDto {
  @ApiPropertyOptional({
    description: 'Maximum number of top-level comment threads to return.',
    default: 50,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @ApiPropertyOptional({
    description:
      'Top-level comment ID to continue loading older comment threads after.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}
