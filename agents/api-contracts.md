# API Contract Rules

Purpose: keep document endpoints predictable, documented, validated, and safe for `app/documents`.

## Controller Rules

- Controllers must be thin. They validate input, attach current-user context, call services, and return DTO-safe responses.
- Every controller must use `@ApiTags`.
- Every endpoint must use `@ApiOperation`, `@ApiResponse`, and `@ApiBody` where a body exists.
- Authenticated endpoints must document authentication expectations.
- Public endpoints must document token shape, throttling expectations, and safe failure responses.

## DTO Rules

- Every DTO property must have `@ApiProperty` or `@ApiPropertyOptional`.
- Every incoming field must have class-validator decorators.
- Use enums for document status, collaborator role, permissions, invitation state, and verification requirement fields.
- Normalize user-provided strings at the edge before service logic.

## Response Rules

- Do not return raw Prisma records from controllers.
- Do not return internal S3 object keys, token hashes, encrypted identifiers, or audit internals.
- Public verification responses must be intentionally small and stable.
- Paginated endpoints must return `items`, `hasMore`, and a cursor/page token when more data is available.

## Route Ownership

- Workspace document routes require authenticated users.
- Invitation preview and acceptance routes may be public only when token-gated and throttled.
- Public authenticity verification routes must validate UUID or token shape before service lookup.
- Signature-readiness endpoints should aggregate state for UI gating but must not perform signing.

## Versioning

- Keep route behavior backward compatible for existing documents and signed payloads.
- When a response shape changes, update `app/documents` consumers and README documentation in the same change.
