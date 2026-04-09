import * as crypto from 'crypto';

/**
 * Computes a deterministic SHA-256 hash of any JSON-serialisable value.
 * The value is JSON.stringify'd with sorted keys to ensure consistency
 * regardless of property insertion order.
 * This is the hash stored in document.contentHash at finalisation time
 * and used as the documentHash when calling api/signature/.
 */
export function hashDocumentContent(content: unknown): string {
  const canonical = JSON.stringify(content, Object.keys(content as object).sort());
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Generates a unique S3 key for a document's content.
 * Format: documents/{documentId}/content.json
 */
export function documentContentKey(documentId: string): string {
  return `documents/${documentId}/content.json`;
}

/**
 * Generates a unique S3 key for a document version snapshot.
 * Format: documents/{documentId}/versions/{versionNumber}.json
 */
export function documentVersionKey(documentId: string, versionNumber: number): string {
  return `documents/${documentId}/versions/${versionNumber}.json`;
}

/**
 * Generates a unique S3 key for a document's exported PDF.
 * Format: documents/{documentId}/signed.pdf
 */
export function documentPdfKey(documentId: string): string {
  return `documents/${documentId}/signed.pdf`;
}

/**
 * Generates a unique S3 key for an imported file.
 * Format: documents/imports/{userId}/{uuid}.{ext}
 */
export function importedFileKey(userId: string, uuid: string, ext: string): string {
  return `documents/imports/${userId}/${uuid}.${ext}`;
}
