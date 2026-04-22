/**
 * Pure helpers for default document content, template variable interpolation,
 * legacy signature alignment fallbacks, and copy-title generation.
 *
 * Anything in this file must remain side-effect free so it can be unit tested
 * without Nest, Prisma, or S3 wiring.
 */

// ─── Default editor content ─────────────────────────────────────────────────
//
// Both shapes are read by the documents service when a brand-new document is
// created without a template, and again when a copy is made and the source
// document has no S3-backed content yet.

/** Empty Tiptap-compatible rich text document. */
export const EMPTY_RICH_TEXT_CONTENT = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

/** Empty spreadsheet document with one default sheet. */
export const EMPTY_SPREADSHEET_CONTENT = {
  type: 'spreadsheet',
  sheets: [
    {
      id: 'sheet-1',
      name: 'Sheet 1',
      rows: 50,
      cols: 26,
      cells: {},
    },
  ],
};

// ─── Signature placement defaults ───────────────────────────────────────────
//
// Documents locked before free placement was introduced only stored a coarse
// alignment enum. We map that to a concrete normalised x/y so the editor and
// PDF renderer can always read a single shape.

/** Default normalised X position (0–1) for a freshly placed signature strip. */
export const DEFAULT_SIGNATURE_X = 0.57;

/** Default normalised Y position (0–1) for a freshly placed signature strip. */
export const DEFAULT_SIGNATURE_Y = 0.78;

/**
 * Maps the legacy alignment enum onto a normalised (x, y) signature position.
 *
 * @param alignment - Stored alignment value (`LEFT` / `CENTER` / `RIGHT`-ish).
 * @returns Normalised x/y in the range 0–1 for the signature block.
 */
export function alignmentToSignaturePosition(
  alignment: string | null | undefined,
): { x: number; y: number } {
  if (alignment === 'LEFT') return { x: 0.02, y: DEFAULT_SIGNATURE_Y };
  if (alignment === 'CENTER') return { x: 0.29, y: DEFAULT_SIGNATURE_Y };
  return { x: DEFAULT_SIGNATURE_X, y: DEFAULT_SIGNATURE_Y };
}

// ─── Template variable interpolation ────────────────────────────────────────

/**
 * Substitutes `{{KEY}}` placeholders in a template's JSON content with values
 * from the supplied dictionary. Unknown keys are left intact so missing data
 * does not silently corrupt a document.
 *
 * @param content - Parsed template content JSON tree.
 * @param variables - Substitution map keyed by uppercase variable name.
 * @returns A new JSON tree with placeholders replaced.
 */
export function resolveTemplateVariables(
  content: Record<string, unknown>,
  variables: Record<string, string>,
): Record<string, unknown> {
  const contentStr = JSON.stringify(content);
  const resolved = contentStr.replace(
    /\{\{([A-Z_]+)\}\}/g,
    (_, key: string) => variables[key] ?? `{{${key}}}`,
  );
  return JSON.parse(resolved) as Record<string, unknown>;
}

// ─── Copy-title generation ──────────────────────────────────────────────────

/**
 * Strips a trailing " Copy" or " Copy (n)" suffix from a document title, so
 * a copy of "Report Copy (3)" becomes a copy of "Report".
 *
 * @param title - Original document title.
 * @returns The base title with any copy suffix removed.
 */
export function stripCopySuffix(title: string): string {
  const normalized = title.trim() || 'Untitled Document';
  return normalized.replace(/ Copy(?: \(\d+\))?$/, '');
}

/**
 * Computes the next available "Copy" title for a document, given the titles
 * already used by the same owner.
 *
 * Pure: takes the candidate base title and the existing titles to inspect,
 * returns the next title to use. Caller is responsible for fetching the
 * existing titles from the database.
 *
 * Behaviour:
 *  - If `<base> Copy` is unused, return that.
 *  - Otherwise return `<base> Copy (n)` where n is the smallest free integer.
 *
 * @param baseTitle - Title with any prior copy suffix already stripped.
 * @param existingTitles - Titles owned by the user that begin with the copy stem.
 * @returns The next title to assign to the new copy.
 */
export function buildNextCopyTitleFromExistingTitles(
  baseTitle: string,
  existingTitles: string[],
): string {
  const copyStem = `${baseTitle} Copy`;
  const usedNumbers = new Set<number>();
  let hasPlainCopy = false;

  for (const title of existingTitles) {
    if (title === copyStem) {
      hasPlainCopy = true;
      continue;
    }

    const suffix = title.slice(copyStem.length);
    const numberedMatch = suffix.match(/^ \((\d+)\)$/);
    if (!numberedMatch) continue;

    const value = Number.parseInt(numberedMatch[1], 10);
    if (Number.isInteger(value) && value >= 1) {
      usedNumbers.add(value);
    }
  }

  if (!hasPlainCopy) {
    return copyStem;
  }

  let nextNumber = 1;
  while (usedNumbers.has(nextNumber)) {
    nextNumber += 1;
  }

  return `${copyStem} (${nextNumber})`;
}
