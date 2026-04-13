import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, Matches } from 'class-validator';

export class RequestInvitationEmailOtpDto {
  @ApiProperty({
    description:
      'The invited account email. Must match both the signed-in account and the invitation recipient.',
    example: 'recipient@example.com',
  })
  @IsEmail()
  email: string;
}

export class VerifyInvitationEmailOtpDto {
  @ApiProperty({
    description: 'Six-digit invitation email verification code.',
    example: '482913',
  })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, {
    message: 'Verification code must be exactly 6 digits.',
  })
  code: string;
}
