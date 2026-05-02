import {
  DEFAULT_DOCUMENT_LAYOUT,
  mergeDocumentLayout,
  normalizeDocumentLayout,
} from './document-layout.helper';

describe('document-layout.helper', () => {
  it('normalizes missing header and footer settings to defaults', () => {
    const layout = normalizeDocumentLayout({
      paperSize: 'A4',
      margins: { top: 96, right: 96, bottom: 96, left: 96 },
    });

    expect(layout.headerFooter).toEqual(DEFAULT_DOCUMENT_LAYOUT.headerFooter);
  });

  it('merges header and footer settings without losing margins', () => {
    const layout = mergeDocumentLayout(DEFAULT_DOCUMENT_LAYOUT, {
      headerFooter: {
        headerEnabled: false,
        footerText: 'Confidential',
      },
    });

    expect(layout.margins).toEqual(DEFAULT_DOCUMENT_LAYOUT.margins);
    expect(layout.headerFooter.headerEnabled).toBe(false);
    expect(layout.headerFooter.footerText).toBe('Confidential');
    expect(layout.headerFooter.pageNumbersEnabled).toBe(true);
  });
});
