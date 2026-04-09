import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * Expands one or more environment strings into a strict frontend origin allowlist.
 * Values may be a single origin or a comma-separated list.
 */
function parseAllowedOrigins(...values: Array<string | undefined>): string[] {
  return values
    .flatMap((value) => (value ?? '').split(','))
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Builds strict CORS config for the documents service.
 * Only explicitly configured frontend origins are allowed.
 */
export function buildCorsConfig(
  frontendUrl: string,
  frontendUrls?: string,
): CorsOptions {
  const allowedOrigins = parseAllowedOrigins(frontendUrl, frontendUrls);

  return {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(
        new Error(
          `Origin ${origin} is not allowed by documents service CORS policy.`,
        ),
        false,
      );
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Retry-After'],
    credentials: true,
    maxAge: 86_400,
  };
}
