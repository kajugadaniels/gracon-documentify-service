import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class FinaliseDocumentDto {
  @ApiPropertyOptional({
    description: 'Optional note to collaborators explaining this finalisation.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    description:
      'When true, the document owner is added to the required signer list during finalisation.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  requireOwnerSignature?: boolean;
}
