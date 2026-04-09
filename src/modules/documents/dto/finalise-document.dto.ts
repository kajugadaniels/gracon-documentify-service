import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class FinaliseDocumentDto {
  @ApiPropertyOptional({
    description: 'Optional note to collaborators explaining this finalisation.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
