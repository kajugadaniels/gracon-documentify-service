# Documentation Rules

Purpose: keep document backend behavior understandable to future engineers and agents.

## Update Documentation When

- A route, DTO, or response shape changes.
- A document lifecycle state transition changes.
- Invitation verification gates or token behavior changes.
- S3 object-key, render-token, upload, or retention behavior changes.
- Layout metadata, export, or import behavior changes.
- Environment variables are added, renamed, or removed.
- Shared schema ownership or migration flow changes.

## Required Places

- `api/documents/README.md` for service-local architecture and commands.
- `api/documents/.env.example` for new configuration.
- Swagger decorators for endpoint and DTO contract changes.
- Root `AGENTS.md` only when the cross-project platform picture changes.
- `app/documents/README.md` when backend changes require frontend behavior changes.

## Documentation Quality

- Explain the security reason for restrictions.
- Mention compatibility expectations for existing signed documents.
- Document rollback or migration notes for schema/storage changes.
- Keep docs specific to this service; do not duplicate unrelated platform docs.
