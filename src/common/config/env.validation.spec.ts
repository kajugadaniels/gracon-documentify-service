import 'reflect-metadata';

import { validateEnv } from './env.validation';

function createValidConfig(overrides: Record<string, unknown> = {}) {
  return {
    APP_ENV: 'development',
    APP_PORT: '3005',
    DATABASE_URL: 'postgresql://user:pass@host:5432/db?sslmode=verify-full',
    JWT_SECRET: '12345678901234567890123456789012',
    ENCRYPTION_SECRET: 'abcdefghijklmnopqrstuvwxyz123456',
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'key',
    AWS_SECRET_ACCESS_KEY: 'secret',
    AWS_S3_BUCKET_NAME: 'documents-bucket',
    SIGNATURE_SERVICE_URL: 'http://localhost:3002',
    FRONTEND_URL: 'http://localhost:4002',
    DOCS_BASE_URL: 'http://localhost:4002',
    MAIL_HOST: 'smtp.example.com',
    MAIL_PORT: '587',
    MAIL_USER: 'mailer',
    MAIL_PASS: 'password',
    MAIL_FROM: 'noreply@example.com',
    ...overrides,
  };
}

describe('validateEnv', () => {
  it('accepts a valid documents service environment object', () => {
    expect(() => validateEnv(createValidConfig())).not.toThrow();
  });

  it('coerces numeric string fields into numbers', () => {
    const validated = validateEnv(
      createValidConfig({
        EDITOR_IMAGE_MAX_SIZE_BYTES: '8388608',
        MAX_CONTENT_SIZE_BYTES: '2097152',
        MAX_VERSIONS_PER_DOCUMENT: '25',
        VERSION_RETENTION_DAYS: '30',
      }),
    );

    expect(validated.APP_PORT).toBe(3005);
    expect(validated.MAIL_PORT).toBe(587);
    expect(validated.EDITOR_IMAGE_MAX_SIZE_BYTES).toBe(8388608);
    expect(validated.MAX_CONTENT_SIZE_BYTES).toBe(2097152);
    expect(validated.MAX_VERSIONS_PER_DOCUMENT).toBe(25);
    expect(validated.VERSION_RETENTION_DAYS).toBe(30);
  });

  it('throws a clear error when a required field is missing', () => {
    expect(() =>
      validateEnv(createValidConfig({ MAIL_FROM: undefined })),
    ).toThrow('[Documents Service] Environment validation failed:');
  });

  it('throws when the jwt secret is too short', () => {
    expect(() =>
      validateEnv(createValidConfig({ JWT_SECRET: 'short-secret' })),
    ).toThrow('JWT_SECRET must be at least 32 chars and match api/auth/');
  });
});
