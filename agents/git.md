# Git Rules

Purpose: keep document-service commits reviewable and copy-paste safe.

Codex must never run git commands automatically. Present commands only.

## Required Format

Paths are relative to `api/documents/`, where this service `package.json` lives.

```bash
git add "src/modules/documents/documents.service.ts"
git commit -m "feat(documents): add explicit owner lock audit event"
```

## Rules

- One file per `git add`.
- Always quote paths.
- Never use `git add .` or `git add -A`.
- Never include `cd api/documents`.
- Never run `git push`.
- Use Conventional Commits.

## Common Scopes

- `documents` - document lifecycle, sharing, signing, comments, verification.
- `templates` - document templates.
- `folders` - folders.
- `editor` - editor-image backend behavior.
- `s3` - storage adapter behavior.
- `mailer` - invitation and reminder email.
- `prisma` - database-client integration and database-owned schema coordination.
- `guards` - auth and route guards.
- `security` - token, throttle, validation, or data-protection hardening.
- `docs` - README, agent docs, Swagger-only changes.
