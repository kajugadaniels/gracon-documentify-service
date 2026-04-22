# API Documents

Document lifecycle backend for the Gracon platform.

This service manages folders, templates, rich-text documents, autosave, version history, sharing, invitation review, signature request orchestration, finalisation, manual owner lock, verification payloads, and document audit activity.

## Overview

- Runtime: NestJS + TypeScript
- Default port: `3005`
- Database: shared Neon/Postgres via Prisma
- Storage: AWS S3 for document payloads and related assets
- Primary consumer: `app/documents`

## What This Service Owns

- Folder CRUD and listing
- Template listing and application
- Document creation, autosave, rename, copy, and version restore
- Persisted page layout metadata for paper size and margins
- Finalise/sign/lock workflow
- Sharing and collaborator permission model
- Invitation issuance, review, and acceptance
- Public authenticity verification payload
- Document activity and access audits
- Private S3-backed editor image uploads for rich-text documents

## Core Skills Needed

- NestJS service-layer access control
- Prisma modeling for collaboration workflows
- S3-backed document persistence
- Secure invitation-token handling
- Signature workflow state machines
- Auditability and immutable history design

## Techniques Used

- SHA-256 document hashing for tamper detection
- Invitation-token hashing instead of raw token storage
- Owner/collaborator permission enforcement at service layer
- Separation of finalise, sign, and lock actions
- Audit events for access, reminders, invitation proof chain, and signing flow
- Lightweight metadata refresh for collaborative UI clients
- Normalized page layout persistence so editor and export geometry stay aligned
- Shared JWT validation against the auth service secret without reissuing tokens
- Private S3 editor image storage with stable signed render URLs for rich-text content

## Main Modules

```text
src/
  common/
    crypto/         lookup/decryption helpers
    decorators/     current-user access helpers
    helpers/        hashing and version-key utilities
    mailer/         invitation and reminder emails
    prisma/         Prisma service/module
    s3/             document content storage
    security/       helmet and CORS
  modules/
    auth/           JWT validation only
    users/          user lookup for sharing
    folders/        folder lifecycle
    templates/      template listing and usage
    editor-images/  authenticated S3 image uploads for editor content
    documents/      document lifecycle, sharing, signing, verification
  seeds/            optional seed data
```

## Folder Structure

```text
api/documents/
  prisma/
  src/
    common/
    modules/
    seeds/
  test/
  package.json
  nest-cli.json
```

## Local Commands

```bash
npm install
npm run start:dev
npm run build
npm run test
npm run test:unit
npm run test:e2e
npm run test:all
npm run lint
npx prisma generate
```

## Environment Notes

Key variables:

```env
APP_PORT=3005
DATABASE_URL=
JWT_SECRET=
ENCRYPTION_SECRET=
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_S3_BUCKET_NAME=
DOCUMENTS_API_PUBLIC_URL=http://localhost:3005/api/v1
EDITOR_IMAGE_MAX_SIZE_BYTES=8388608
MAIL_HOST=
MAIL_PORT=
MAIL_USER=
MAIL_PASS=
MAIL_FROM=
APP_URL=http://localhost:4002
```

## Integration Boundaries

- Main browser consumer is `app/documents`
- Validates auth-service JWTs but does not issue user tokens
- Coordinates with signature/invitation flows through its own domain logic
- Public verify responses must remain safe and intentionally scoped

## Important Rules

- Always scope document access checks by owner or accepted collaborator
- Never trust document IDs without user context
- Keep invitation proof chain auditable
- Do not collapse finalise, sign, and lock into one action
- Treat S3 content as the canonical document body, not the database row
- Keep document `layout` metadata compatible with editor and export consumers
- Never run shared-schema migrations here

## Contribution Checklist

- Decide the permission boundary before writing the endpoint
- Record audit entries for state-changing collaboration actions
- Preserve current signing semantics: explicit signers, explicit owner lock
- Build and verify the public verification payload after data-model changes

## Testing Rule

- If code is pure logic or can be mocked cleanly, add a unit test.
- If code depends on Nest bootstrapping, DB wiring, or HTTP flow, prefer e2e or integration tests.

## Testing Layout

Use one testing shape consistently across this service.

- Put unit tests beside the code they cover under `src/**` using `*.spec.ts`.
- Put HTTP/bootstrap tests under `test/` and keep them behind `npm run test:e2e`.
- Put reusable builders and narrow shared fixtures in `src/test-utils/`.
- Keep unit tests deterministic: no real S3, SMTP, Prisma, or JWT network calls.
- If a service method needs too many mocks, extract the branching logic into a helper first and test that helper.

Current command split:

- `npm run test` or `npm run test:unit`: unit tests under `src/**`
- `npm run test:e2e`: Nest bootstrap and HTTP-flow tests under `test/`
- `npm run test:all`: both layers in sequence

## Unit Testing Priorities

Add unit tests in this order instead of trying to cover the whole service at once.

1. Permission rules
   owner vs collaborator access, edit/view/sign rights, lock/finalise restrictions, and invitation acceptance eligibility
2. Signing workflow rules
   who can sign, who can only lock, when a document becomes locked, and multi-signature completion logic
3. Invitation and token logic
   token expiration, invalid token rejection, already-used invitation rejection, and verification-gated acceptance rules
4. Export and import helpers
   PDF/DOCX layout transforms, page geometry mapping, margin/indent/tab-stop conversion, and image/export metadata formatting
5. Validation and normalization helpers
   URL sanitizers, filename builders, content-state validators, and status-transition validators
6. Small branching service methods
   document status transitions, share permission mapping, audit event payload creation, and certificate/signature eligibility checks

## Current Test Foundation

Step 1 is complete when these conventions exist and are used consistently:

- explicit unit and e2e commands
- a stable place for test helpers in `src/test-utils/`
- no mixing of HTTP-flow tests into unit suites
- no new business terminology invented only for tests

Step 2 starts the first real unit coverage with pure helper specs under:

- `src/common/helpers/*.spec.ts`
- `src/common/prisma/*.spec.ts`
- `src/common/security/*.spec.ts`
- `src/common/config/*.spec.ts`

Step 3 extracts document permission rules into a pure helper under:

- `src/modules/documents/helpers/document-permissions.helper.ts`
- `src/modules/documents/helpers/document-permissions.helper.spec.ts`

That helper is now the source of truth for:

- canonical permission ordering
- legacy role-to-permission fallback
- accepted-active collaborator gating
- owner vs collaborator permission checks

Step 4 extracts signing workflow rules into a pure helper under:

- `src/modules/documents/helpers/document-signing.helper.ts`
- `src/modules/documents/helpers/document-signing.helper.spec.ts`

That helper is now the source of truth for:

- required signer resolution during finalisation
- collaborator signature eligibility
- which document statuses can accept new signatures
- when signing state stays `FINALISED` vs becomes `SIGNED`
- owner-only lock preconditions

Step 5 extracts invitation and token rules into a pure helper under:

- `src/modules/documents/helpers/document-invitation.helper.ts`
- `src/modules/documents/helpers/document-invitation.helper.spec.ts`

That helper is now the source of truth for:

- invitation token format validation
- active vs expired vs inactive invitation state
- verification-session expiry resolution
- email OTP resend and hourly request throttling
- email OTP verification outcomes
- invitation gate next-step resolution
- completed-review eligibility after OTP and identity verification

Step 6 extracts small branching service methods into a pure helper under:

- `src/modules/documents/helpers/document-access-formatting.helper.ts`
- `src/modules/documents/helpers/document-access-formatting.helper.spec.ts`

That helper is now the source of truth for:

- audit log limit normalization
- audit metadata sanitization for persisted response payloads
- share-permission summary formatting
- invitation expiry copy
- user and inviter display-name fallback formatting
- invitation email masking

Step 7 keeps Nest bootstrapping, guards, DTO validation, and HTTP-flow behavior in e2e tests under:

- `test/app.e2e-spec.ts`

That suite now covers:

- public invitation preview without authentication
- protected invitation review authentication enforcement
- authenticated `@CurrentUser()` injection into protected routes
- raw authorization-header forwarding on public invitation gate resolution
- DTO validation for invitation email OTP request and verification
- authenticated document creation route wiring
- query-parameter transformation on document listing
