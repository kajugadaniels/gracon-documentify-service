# Testing Rules

Purpose: make document security and workflow behavior hard to regress.

## Command Shape

```bash
npm run test
npm run test:unit
npm run test:e2e
npm run test:all
npm run build
```

Use the smallest command that proves the change. For docs-only changes, no build is required.

## Unit Test Placement

- Put unit tests beside source files as `*.spec.ts`.
- Put e2e/bootstrap tests under `test/`.
- Put reusable builders under `src/test-utils/`.
- Mock Prisma, S3, SMTP, and JWT dependencies in unit tests.

## Priority Areas

1. Permission rules: owner vs collaborator, accepted collaborator gating, edit/view/sign rights.
2. Signing workflow: finalise eligibility, signer resolution, signed state, owner lock preconditions.
3. Invitation rules: token format, expiration, OTP resend limits, OTP verification, identity gate state.
4. Layout helpers: page geometry, margins, indents, hanging indents, tab stops, import/export conversions.
5. S3/editor image helpers: token expiry, legacy compatibility, prefix validation.
6. Public verification: safe payload construction and tamper-state mapping.

## Test Design

- Extract pure helpers before forcing large service tests with too many mocks.
- Prefer deterministic fixtures with fixed dates and IDs.
- Do not hit real S3, SMTP, Prisma, or auth services in unit tests.
- For endpoint behavior involving guards, pipes, and exception filters, use e2e/integration tests.
