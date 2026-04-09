import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

export class LockDocumentDto {
  @ApiProperty({
    description:
      'The signatureId returned by api/signature/ after signing. ' +
      'The documents service fetches and verifies this before locking.',
  })
  @IsUUID()
  signatureId: string;

  @ApiProperty({
    description: 'The documentHash the user signed. Must match document.contentHash exactly.',
  })
  @IsString()
  documentHash: string;
}
