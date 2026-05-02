/**
 * Pure helpers for the persisted document layout model.
 *
 * The documents service, the editor page, the PDF exporter, and the DOCX
 * exporter all need to agree on one canonical shape. This module is the
 * single source of truth for that shape and for the normalisation rules that
 * keep bad data out of the database.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Per-side margin values in pixels, measured against the A4 sheet. */
export type DocumentLayoutMargins = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/** Full persisted layout — paper size plus margins. */
export type DocumentLayout = {
  paperSize: 'A4';
  margins: DocumentLayoutMargins;
  headerFooter: DocumentHeaderFooter;
};

export type DocumentHeaderFooter = {
  headerEnabled: boolean;
  footerEnabled: boolean;
  pageNumbersEnabled: boolean;
  headerText: string;
  footerText: string;
};

// ─── Defaults and bounds ────────────────────────────────────────────────────
//
// Margin bounds mirror the editor's page-setup dialog so the backend cannot
// accept values the UI would not let a user pick.

/** Smallest acceptable margin value in pixels (≈ 0.5in at 96 DPI). */
const MIN_MARGIN_PX = 48;

/** Largest acceptable margin value in pixels (≈ 2in at 96 DPI). */
const MAX_MARGIN_PX = 192;
const MAX_HEADER_FOOTER_TEXT_LENGTH = 120;

/** Canonical fallback layout used when no layout is persisted yet. */
export const DEFAULT_DOCUMENT_LAYOUT: DocumentLayout = {
  paperSize: 'A4',
  margins: {
    top: 96,
    right: 96,
    bottom: 96,
    left: 96,
  },
  headerFooter: {
    headerEnabled: true,
    footerEnabled: true,
    pageNumbersEnabled: true,
    headerText: '',
    footerText: '',
  },
};

// ─── Normalisation ──────────────────────────────────────────────────────────

/**
 * Coerces a candidate margin value to the nearest safe integer pixel within
 * the allowed range, falling back when the input is not a finite number.
 *
 * @param value - Raw value read from DB / user input.
 * @param fallback - Default pixel value used if the input is invalid.
 * @returns A clamped, rounded margin value ready to persist.
 */
export function normalizeDocumentMarginValue(
  value: unknown,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(MAX_MARGIN_PX, Math.max(MIN_MARGIN_PX, Math.round(value)));
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeHeaderFooterText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, MAX_HEADER_FOOTER_TEXT_LENGTH);
}

function normalizeHeaderFooter(raw: unknown): DocumentHeaderFooter {
  const defaults = DEFAULT_DOCUMENT_LAYOUT.headerFooter;

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...defaults };
  }

  const source = raw as Record<string, unknown>;

  return {
    headerEnabled: normalizeBoolean(source['headerEnabled'], defaults.headerEnabled),
    footerEnabled: normalizeBoolean(source['footerEnabled'], defaults.footerEnabled),
    pageNumbersEnabled: normalizeBoolean(source['pageNumbersEnabled'], defaults.pageNumbersEnabled),
    headerText: normalizeHeaderFooterText(source['headerText']),
    footerText: normalizeHeaderFooterText(source['footerText']),
  };
}

/**
 * Normalises a raw `layout` JSON blob (as stored on the Document table) into
 * the canonical {@link DocumentLayout} shape.
 *
 * Missing or malformed input returns a copy of {@link DEFAULT_DOCUMENT_LAYOUT}
 * so callers never have to null-check the result.
 *
 * @param raw - Unknown JSON value loaded from Prisma.
 * @returns The normalised layout.
 */
export function normalizeDocumentLayout(raw: unknown): DocumentLayout {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      paperSize: DEFAULT_DOCUMENT_LAYOUT.paperSize,
      margins: { ...DEFAULT_DOCUMENT_LAYOUT.margins },
      headerFooter: { ...DEFAULT_DOCUMENT_LAYOUT.headerFooter },
    };
  }

  const source = raw as Record<string, unknown>;
  const rawMargins =
    source['margins'] && typeof source['margins'] === 'object' && !Array.isArray(source['margins'])
      ? (source['margins'] as Record<string, unknown>)
      : {};

  return {
    paperSize: 'A4',
    margins: {
      top: normalizeDocumentMarginValue(rawMargins['top'], DEFAULT_DOCUMENT_LAYOUT.margins.top),
      right: normalizeDocumentMarginValue(rawMargins['right'], DEFAULT_DOCUMENT_LAYOUT.margins.right),
      bottom: normalizeDocumentMarginValue(rawMargins['bottom'], DEFAULT_DOCUMENT_LAYOUT.margins.bottom),
      left: normalizeDocumentMarginValue(rawMargins['left'], DEFAULT_DOCUMENT_LAYOUT.margins.left),
    },
    headerFooter: normalizeHeaderFooter(source['headerFooter']),
  };
}

/**
 * Merges a partial layout patch onto the currently-stored layout, normalising
 * the result so partial updates can never produce an invalid persisted row.
 *
 * @param currentLayout - Raw layout currently stored for the document.
 * @param nextLayout - Optional partial patch from the update DTO.
 * @returns The merged + normalised layout ready to persist.
 */
export function mergeDocumentLayout(
  currentLayout: unknown,
  nextLayout?: {
    paperSize?: 'A4';
    margins?: Partial<DocumentLayoutMargins>;
    headerFooter?: Partial<DocumentHeaderFooter>;
  },
): DocumentLayout {
  const current = normalizeDocumentLayout(currentLayout);

  if (!nextLayout) {
    return current;
  }

  return normalizeDocumentLayout({
    paperSize: nextLayout.paperSize ?? current.paperSize,
    margins: {
      ...current.margins,
      ...(nextLayout.margins ?? {}),
    },
    headerFooter: {
      ...current.headerFooter,
      ...(nextLayout.headerFooter ?? {}),
    },
  });
}
