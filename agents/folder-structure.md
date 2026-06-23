# Folder Structure Rules

Purpose: define where document backend files belong so the service stays navigable as document lifecycle, sharing, signing, and storage features grow.

## Current Layout

```text
api/documents/
  agents/              AI-agent project rules
  src/
    common/
      config/          environment parsing and runtime configuration
      crypto/          identifier hashing/decryption helpers
      decorators/      current-user helpers
      filters/         exception filters
      guards/          auth and route protection
      helpers/         hashing, version keys, and pure utilities
      mailer/          invitation and reminder mail delivery
      prisma/          Prisma service/module
      s3/              private S3 storage adapter
      security/        helmet, CORS, throttle helpers
    modules/
      auth/            JWT validation only
      users/           collaborator lookup and safe user projections
      folders/         document folder lifecycle
      templates/       template listing and usage
      editor-images/   S3-backed editor image upload/render support
      documents/       document lifecycle, sharing, signing, verification
    seeds/             optional seed data
    test-utils/        deterministic test builders/helpers
  test/                e2e and HTTP/bootstrap tests
```

## Placement Rules

- Put document lifecycle behavior under `src/modules/documents/`.
- Put query-only document reads in `src/modules/documents/document-query.service.ts` or a focused query service, not in the lifecycle service.
- Put pure permission, invitation, signing, layout, and validation logic under `src/modules/documents/helpers/`.
- Put public-token parsing in pipes or DTO validation at the controller edge.
- Put S3 operations behind `src/common/s3/s3.service.ts`; feature modules must not instantiate AWS clients directly.
- Put safe user lookup logic in `src/modules/users/`; do not leak user internals into document response DTOs.
- Put reusable test builders in `src/test-utils/`, not inside feature modules.

## New File Rules

- Create a new service only when it has one clear responsibility.
- Keep controllers thin: validate input, attach current user, call service, return DTO-safe data.
- Keep email formatting in `common/mailer`; document services should pass domain data, not assemble SMTP details.
- Keep public verification and invitation acceptance paths explicitly separated from authenticated document workspace paths.
