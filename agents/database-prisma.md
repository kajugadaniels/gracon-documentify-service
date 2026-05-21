# Database And Prisma Rules

Purpose: keep shared-schema use safe and prevent document queries from becoming slow or leaky.

## Shared Schema Rule

- Meeting and document tables are owned by `api/auth` migrations when the shared database schema changes.
- `api/documents/prisma/schema.prisma` mirrors the shared schema for Prisma client generation.
- Do not run shared-schema migrations from `api/documents`.
- If a model/index/enum change is required, make the migration in `api/auth` first, then mirror the schema here.

## Query Rules

- Always filter document records by owner or accepted collaborator.
- Use `select` to fetch only required fields.
- Avoid unbounded `findMany` calls.
- Use cursor pagination for comments, activity, collaborator lists, and large document histories.
- Avoid N+1 queries by batching collaborator/user lookups or using deliberate relation selects.

## Transactions

- Use transactions for state transitions that update document state and write audit events.
- Keep transactions short. Do not perform SMTP or S3 network work inside a database transaction unless there is a documented reason.
- Hash public tokens before persistence and before lookup.

## S3 Relationship

- Database rows contain metadata and pointers; S3 stores canonical document bodies and editor assets.
- Do not duplicate large document JSON payloads in database rows.
- Keep S3 key construction centralized and test prefix validation.

## Index And Migration Notes

- Add indexes for new access patterns before shipping list/search endpoints.
- Search by email, hashed PID/NID, document status, collaborator status, and invitation state should stay index-friendly.
- Update `api/auth` and `api/documents` Prisma schemas together when shared models change.
