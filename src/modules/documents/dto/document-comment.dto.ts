import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
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
    description: 'Top-level comment ID when creating a reply.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  parentCommentId?: string;
}
