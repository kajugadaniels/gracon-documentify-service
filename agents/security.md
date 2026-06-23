# Security Rules

Purpose: protect documents, signatures, invitation proofs, private S3 objects, and user identity data.

## Document Access

- Never trust a document ID without current-user context.
- Every document read/write must be scoped to the owner or an accepted active collaborator.
- Do not rely only on controller guards for document permission checks; enforce access in the service layer.
- Collaborator permissions must be explicit and auditable. Do not infer edit/sign rights from UI state.

## Invitations

- Store only hashed invitation tokens. Never persist raw invitation tokens.
- Public invitation routes must validate token shape before service lookup or audit work.
- OTP and identity-verification gates must be evaluated before invitation acceptance.
- Invitation acceptance must record enough audit detail to prove which gates were required and passed.
- Do not weaken token expiration, resend throttling, or verification requirements without an abuse review.

## Signing And Locking

- Finalise, sign, and lock are separate actions. Do not collapse them into one endpoint.
- Owner signing is explicit. Owner locking is explicit.
- Public verification payloads must be intentionally scoped and must not leak private collaborator or S3 metadata.
- Document hashes and signature evidence are production records. Treat them as immutable once signed or locked.

## S3 And Editor Assets

- Treat S3 document content as the canonical document body.
- Store editor images as private S3 objects behind stable render URLs. Do not store base64 uploads in document JSON.
- Keep all S3 reads and writes behind `S3Service`.
- Validate object-key prefixes before any S3 read.
- Never expose raw bucket names, object keys, presigned URLs, AWS credentials, or storage errors in client-facing messages.

## Identity Data

- Exact PID/NID lookup should use stored hashes. Do not decrypt every user for collaborator search.
- Never log NID, PID, invitation tokens, refresh tokens, signatures, private keys, or full public verification payload internals.
- Use constant-time comparison for secret/token comparisons where applicable.

## Public Routes

- Public invitation and verification routes must stay throttled.
- Public route errors should be safe and generic.
- Do not add unauthenticated routes without explicit token validation and throttling.

## Environment Rules

- Use only runtime `DATABASE_URL` credentials here; `DATABASE_MIGRATION_URL` belongs only in `api/database`.
