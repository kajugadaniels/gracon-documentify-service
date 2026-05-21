# API Documents Agent Guide

Purpose: this directory gives AI agents project-local rules for working on the Gracon documents backend without weakening document security, signing evidence, collaboration permissions, or S3-backed persistence.

Read this file first, then read the topic file that matches the change.

## Reading Order

1. `folder-structure.md` - where new code belongs.
2. `file-structure.md` - naming, comments, and exported API expectations.
3. `security.md` - document access, invitations, S3, public routes, and audit rules.
4. `api-contracts.md` - controller, DTO, validation, and Swagger requirements.
5. `database-prisma.md` - shared schema, query, migration, and S3 persistence rules.
6. `document-lifecycle.md` - document workflow, page layout, sharing, comments, signing, and locking rules.
7. `testing.md` - required test shape and priority areas.
8. `documentation.md` - when README, `.env.example`, Swagger, and architecture docs must change.
9. `git.md` - copy-paste commit format for this service.

## Service Boundary

`api/documents` owns document backend behavior for folders, templates, rich-text documents, autosave, version history, collaborators, invitations, finalisation, signing workflow coordination, owner lock, public authenticity verification, document activity, and S3-backed document/editor-image storage.

It validates auth-issued user JWTs. It must not issue user tokens, duplicate identity verification business logic, or bypass `api/signature` ownership of personal certificate/private-key operations.

## Conflict Rule

If a local rule here conflicts with root `AGENTS.md`, follow the stricter security rule and update documentation after the decision is made.
