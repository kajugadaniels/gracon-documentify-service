# Document Lifecycle Rules

Purpose: preserve Gracon document workflow semantics from draft editing through signed locked verification.

## Lifecycle States

- Draft documents are editable by owners and permitted collaborators.
- Finalised documents are prepared for signing and should not silently return to draft behavior.
- Signed documents preserve signing evidence and document hashes.
- Locked documents are immutable and should be treated as final records.

## Non-Negotiable Separation

- Finalise prepares the document.
- Sign records a signer action.
- Lock freezes the document.
- These actions must remain separate endpoints and separate audit events.

## Autosave And Versioning

- Autosave should update canonical S3 content and lightweight database metadata.
- Version restore must respect document status and lock restrictions.
- Version history should not load unbounded data.

## Layout Metadata

- Persisted `layout` metadata must stay compatible with editor paper, rulers, print preview, PDF export, and DOCX import/export consumers.
- Page size, margins, paragraph indents, hanging indents, and tab-stop data should be normalized before persistence.
- Changes that affect layout export/import require pure helper tests.

## Sharing And Collaboration

- Collaborator permissions must be explicit.
- Accepted collaborator state must be checked before granting access.
- Invitation requirements can include no extra verification, email verification, identity verification, or both depending on caller defaults.
- Document invitation gates must match platform settings where applicable.

## Comments And Review

- Comment threads must be cursor-paginated.
- Comment state changes should be auditable when they affect finalisation or approval readiness.
- Do not let comment history block editor initial load.

## Editor Images

- Image uploads must be private S3 objects.
- Render URLs must be stable and should support expiring token metadata.
- Legacy signed image URL compatibility must not be broken for existing signed documents.

## Public Verification

- Public verification should prove authenticity and tamper state without exposing private document content.
- Signed and locked document evidence must remain stable across future schema changes.
