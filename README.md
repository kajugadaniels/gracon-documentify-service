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
