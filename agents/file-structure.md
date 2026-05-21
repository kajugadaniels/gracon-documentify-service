# File Structure Rules

Purpose: keep files readable, typed, and safe for future document-workflow changes.

## Required File Shape

- Every file must start with a short top-level comment explaining its purpose.
- Every exported function, class, and public method must have JSDoc explaining what it does, parameters, and return value.
- Use `const` by default. Use `let` only when reassignment is necessary.
- Do not use `any`; create DTOs, interfaces, or narrow generics.
- Delete dead code instead of commenting it out.
- Prefer small helpers over large nested service methods.

## Naming

- Files: `kebab-case.ts`
- DTO files: `*.dto.ts`
- Pipe files: `*.pipe.ts`
- Guard files: `*.guard.ts`
- Helper files: `*.helper.ts`
- Unit tests: `*.spec.ts` beside the code under `src/**`
- E2E tests: `*.e2e-spec.ts` under `test/`

## Comments

- Explain why a security or workflow rule exists, not only what the code is doing.
- Document every token, hash, S3 key, and public route validation decision.
- Add short comments before complex state transitions such as finalise, sign, lock, invitation acceptance, and verification gating.

## Service Method Shape

- Validate ownership/collaborator access before reading sensitive document details.
- Select only the fields required by the caller.
- Return plain DTO-safe objects. Do not leak Prisma models containing internal metadata.
- Keep audit writes close to the state transition they describe.
- For multi-step changes, prefer database transactions with bounded work and clear failure behavior.
