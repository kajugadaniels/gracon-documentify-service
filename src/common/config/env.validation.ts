import { plainToInstance, Transform } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsIn,
  Min,
  Max,
  MinLength,
  IsOptional,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsIn(['development', 'production', 'test'])
  APP_ENV: string;

  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1024)
  @Max(65535)
  APP_PORT: number;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsString()
  @MinLength(32, {
    message: 'JWT_SECRET must be at least 32 chars and match api/auth/',
  })
  JWT_SECRET: string;

  @IsString() @IsNotEmpty() AWS_REGION: string;
  @IsString() @IsNotEmpty() AWS_ACCESS_KEY_ID: string;
  @IsString() @IsNotEmpty() AWS_SECRET_ACCESS_KEY: string;
  @IsString() @IsNotEmpty() AWS_S3_BUCKET_NAME: string;

  @IsString()
  @IsNotEmpty()
  SIGNATURE_SERVICE_URL: string;

  @IsString()
  @IsNotEmpty()
  FRONTEND_URL: string;

  @IsOptional()
  @IsString()
  FRONTEND_URLS?: string;

  @Transform(({ value }) => parseInt(value, 10))
  @IsOptional()
  @IsNumber()
  @Min(1024 * 1024)
  MAX_CONTENT_SIZE_BYTES?: number;

  @Transform(({ value }) => parseInt(value, 10))
  @IsOptional()
  @IsNumber()
  @Min(5)
  MAX_VERSIONS_PER_DOCUMENT?: number;

  @Transform(({ value }) => parseInt(value, 10))
  @IsOptional()
  @IsNumber()
  @Min(7)
  VERSION_RETENTION_DAYS?: number;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const messages = errors
      .map((e) => Object.values(e.constraints ?? {}).join(', '))
      .join('\n');
    throw new Error(
      `[Documents Service] Environment validation failed:\n${messages}`,
    );
  }
  return validated;
}
