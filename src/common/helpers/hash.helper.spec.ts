import {
  documentContentKey,
  documentPdfKey,
  documentVersionKey,
  hashDocumentContent,
  importedFileKey,
} from './hash.helper';

describe('hash.helper', () => {
  it('hashes identical flat objects consistently regardless of key order', () => {
    const left = { title: 'Contract', version: 3, locked: false };
    const right = { version: 3, locked: false, title: 'Contract' };

    expect(hashDocumentContent(left)).toBe(hashDocumentContent(right));
  });

  it('changes the hash when the content changes', () => {
    const previous = { title: 'Contract', version: 3 };
    const next = { title: 'Contract', version: 4 };

    expect(hashDocumentContent(previous)).not.toBe(hashDocumentContent(next));
  });

  it('builds the canonical S3 key for current document content', () => {
    expect(documentContentKey('doc_123')).toBe('documents/doc_123/content.json');
  });

  it('builds the canonical S3 key for a document version snapshot', () => {
    expect(documentVersionKey('doc_123', 7)).toBe(
      'documents/doc_123/versions/7.json',
    );
  });

  it('builds the canonical S3 key for a signed pdf export', () => {
    expect(documentPdfKey('doc_123')).toBe('documents/doc_123/signed.pdf');
  });

  it('builds the canonical S3 key for an imported file', () => {
    expect(importedFileKey('user_42', 'uuid_99', 'docx')).toBe(
      'documents/imports/user_42/uuid_99.docx',
    );
  });
});
