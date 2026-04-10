import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const COLLABORATOR_PERMISSIONS = [
  'READ',
  'COMMENT',
  'SIGN',
  'EDIT',
  'MANAGE_ACCESS',
] as const;

export type CollaboratorPermissionValue =
  (typeof COLLABORATOR_PERMISSIONS)[number];

export class ShareDocumentAccessDto {
  @ApiProperty({
    description: 'User who should receive document access.',
    format: 'uuid',
  })
  @IsUUID()
  userId: string;

  @ApiProperty({
    description:
      'One or more permissions to grant. The service automatically normalizes the set into a safe canonical order.',
    enum: COLLABORATOR_PERMISSIONS,
    isArray: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(COLLABORATOR_PERMISSIONS, { each: true })
  permissions: CollaboratorPermissionValue[];

  @ApiPropertyOptional({
    description:
      'Optional note shown to the recipient when they review the invitation.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({
    description:
      'Invitation expiry in days. Defaults to 7. The service caps it to 30 days.',
    minimum: 1,
    maximum: 30,
    default: 7,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays?: number;
}

export class UpdateDocumentAccessDto {
  @ApiProperty({
    description:
      'The new permission set for an existing collaborator or pending invitation.',
    enum: COLLABORATOR_PERMISSIONS,
    isArray: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(COLLABORATOR_PERMISSIONS, { each: true })
  permissions: CollaboratorPermissionValue[];
}
