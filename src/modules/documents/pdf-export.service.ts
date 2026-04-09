/**
 * PdfExportService
 *
 * Generates a signed PDF for a locked document. The A4 page (595 × 842 pt)
 * renders the document title, plain-text body, and the signature strip with
 * its QR code placed at the exact same normalized (x, y) coordinates that
 * are stored in the database — giving pixel-level parity with the HTML render.
 *
 * Coordinate mapping:
 *   HTML paper: 794 × 1123 px (96 dpi)
 *   PDF A4:     595 × 842 pt  (72 pt/inch)
 *   norm x/y stored as 0.0–1.0 fractions → multiply by page dimension to get pt position
 */
import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import { toBuffer as qrToBuffer } from 'qrcode';
import { PrismaService } from '../../common/prisma/prisma.service';
import { S3Service } from '../../common/s3/s3.service';
import { ConfigService } from '@nestjs/config';

// A4 page dimensions in PDF points (72 pt/inch)
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 56; // ~0.78 inch margins

// Signature strip dimensions in PDF points.
// Derived from the HTML block:  320px / 794px * 595pt ≈ 240pt wide, ~176pt tall
const STRIP_W = 240;
const STRIP_H = 176;
const QR_SIZE = 72; // points

@Injectable()
export class PdfExportService {
  private readonly logger = new Logger(PdfExportService.name);
  private readonly docsUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly config: ConfigService,
  ) {
    this.docsUrl = config.get<string>('DOCS_BASE_URL') ?? 'https://docs.example.com';
  }

  /**
   * Builds and returns a PDF buffer for the requested locked document.
   * The signature strip is positioned using the stored normalized x/y coordinates.
   */
  async exportPdf(userId: string, documentId: string): Promise<Buffer> {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc || doc.isDeleted) throw new NotFoundException('Document not found.');
    if (doc.ownerId !== userId) throw new ForbiddenException('You do not own this document.');
    if (doc.status !== 'LOCKED') {
      throw new ForbiddenException('Only locked (signed) documents can be exported as PDF.');
    }

    // Resolve signature position — fall back to default bottom-right if unset
    const sigX = typeof doc.signatureBlockX === 'number' ? doc.signatureBlockX : 0.57;
    const sigY = typeof doc.signatureBlockY === 'number' ? doc.signatureBlockY : 0.78;

    // Fetch document content JSON from S3
    let contentText = '';
    if (doc.s3ContentKey) {
      try {
        const json = await this.s3.getJson<Record<string, unknown>>(doc.s3ContentKey);
        contentText = extractPlainText(json);
      } catch {
        this.logger.warn(`Could not load content for document ${documentId} — rendering title only`);
      }
    }

    // Optionally fetch signature image (PNG only — pdf-lib does not support SVG)
    let signatureImageBytes: Uint8Array | null = null;
    if (doc.signatureImageS3Key && doc.signatureImageMimeType === 'image/png') {
      try {
        signatureImageBytes = await this.s3.getBuffer(doc.signatureImageS3Key);
      } catch {
        this.logger.warn(`Could not load signature image for document ${documentId}`);
      }
    }

    // Generate QR code PNG pointing to the verification page
    const verifyUrl = `${this.docsUrl}/verify?documentId=${documentId}`;
    let qrBytes: Buffer;
    try {
      qrBytes = await qrToBuffer(verifyUrl, {
        width: 200,
        margin: 1,
        color: { dark: '#16103a', light: '#fcfbff' },
      });
    } catch {
      this.logger.warn(`QR generation failed for document ${documentId}`);
      qrBytes = Buffer.alloc(0);
    }

    return this.buildPdf({
      title: doc.title,
      contentText,
      signerName: doc.signerDisplayName ?? null,
      signedAt: doc.signedAt?.toISOString() ?? null,
      lockedAt: doc.lockedAt?.toISOString() ?? null,
      sigX,
      sigY,
      signatureImageBytes,
      qrBytes,
      verifyUrl,
    });
  }

  // ─── PDF builder ─────────────────────────────────────────────────────────────

  private async buildPdf(opts: {
    title: string;
    contentText: string;
    signerName: string | null;
    signedAt: string | null;
    lockedAt: string | null;
    sigX: number;
    sigY: number;
    signatureImageBytes: Uint8Array | null;
    qrBytes: Buffer;
    verifyUrl: string;
  }): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

    const contentWidth = PAGE_W - MARGIN * 2;
    let cursorY = PAGE_H - MARGIN; // PDF y-axis: 0 = bottom, PAGE_H = top

    // ── Title ──────────────────────────────────────────────────────────────────
    const titleSize = 20;
    page.drawText(opts.title, {
      x: MARGIN,
      y: cursorY - titleSize,
      size: titleSize,
      font: fontBold,
      color: rgb(0.086, 0.063, 0.227), // #16103a
    });
    cursorY -= titleSize + 8;

    // ── Divider ────────────────────────────────────────────────────────────────
    page.drawLine({
      start: { x: MARGIN, y: cursorY },
      end: { x: PAGE_W - MARGIN, y: cursorY },
      thickness: 0.5,
      color: rgb(0.855, 0.843, 0.957), // light purple-grey
    });
    cursorY -= 16;

    // ── Body text ──────────────────────────────────────────────────────────────
    const bodySize = 10;
    const lineHeight = 14;

    for (const rawLine of opts.contentText.split('\n')) {
      if (cursorY < MARGIN + STRIP_H + 24) break; // stop before signature zone

      const wrapped = wrapText(rawLine, contentWidth, bodySize, fontRegular);
      for (const line of wrapped) {
        if (cursorY < MARGIN + STRIP_H + 24) break;
        page.drawText(line, {
          x: MARGIN,
          y: cursorY - bodySize,
          size: bodySize,
          font: fontRegular,
          color: rgb(0.2, 0.18, 0.3),
        });
        cursorY -= lineHeight;
      }
    }

    // ─── Signature strip ───────────────────────────────────────────────────────
    // Convert normalized coords (origin: top-left, 0–1) to PDF coords (origin: bottom-left, pt).
    // The strip is placed so its top-left corner is at (sigX * PAGE_W, sigY * PAGE_H) from top-left.
    // In PDF (bottom-up): bottom = (1 - sigY) * PAGE_H - STRIP_H
    const stripLeft = opts.sigX * PAGE_W;
    const stripBottom = (1 - opts.sigY) * PAGE_H - STRIP_H;

    // Card background
    page.drawRectangle({
      x: stripLeft,
      y: stripBottom,
      width: STRIP_W,
      height: STRIP_H,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.086, 0.063, 0.227),
      borderWidth: 0.5,
      borderOpacity: 0.12,
    });

    let stripCursorY = stripBottom + STRIP_H - 14; // start near top of strip

    // Signature image (or "Digitally signed" fallback text)
    if (opts.signatureImageBytes && opts.signatureImageBytes.length > 0) {
      try {
        const img = await pdfDoc.embedPng(opts.signatureImageBytes);
        const imgDims = img.scaleToFit(STRIP_W - 20, 54);
        page.drawImage(img, {
          x: stripLeft + 10,
          y: stripCursorY - imgDims.height,
          width: imgDims.width,
          height: imgDims.height,
        });
        stripCursorY -= imgDims.height + 8;
      } catch {
        this.logger.warn('Failed to embed signature image into PDF');
        stripCursorY = drawFallbackSignatureText(page, fontBold, stripLeft, stripCursorY);
      }
    } else {
      stripCursorY = drawFallbackSignatureText(page, fontBold, stripLeft, stripCursorY);
    }

    // Divider
    page.drawLine({
      start: { x: stripLeft + 10, y: stripCursorY },
      end: { x: stripLeft + STRIP_W - 10, y: stripCursorY },
      thickness: 0.5,
      color: rgb(0.086, 0.063, 0.227),
      opacity: 0.08,
    });
    stripCursorY -= 10;

    // QR code + metadata row
    const qrY = stripBottom + 12;
    if (opts.qrBytes.length > 0) {
      try {
        const qrImg = await pdfDoc.embedPng(opts.qrBytes);
        page.drawImage(qrImg, {
          x: stripLeft + 10,
          y: qrY,
          width: QR_SIZE,
          height: QR_SIZE,
        });
      } catch {
        this.logger.warn('Failed to embed QR code into PDF');
      }
    }

    // Metadata labels
    const metaX = stripLeft + QR_SIZE + 18;
    const metaWidth = STRIP_W - QR_SIZE - 28;
    let metaY = qrY + QR_SIZE - 4;

    page.drawText('SCAN TO VERIFY', {
      x: metaX,
      y: metaY,
      size: 6,
      font: fontBold,
      color: rgb(0.55, 0.52, 0.67),
    });
    metaY -= 10;

    if (opts.signerName) {
      for (const line of wrapText(opts.signerName, metaWidth, 8, fontBold)) {
        page.drawText(line, { x: metaX, y: metaY, size: 8, font: fontBold, color: rgb(0.2, 0.18, 0.3) });
        metaY -= 10;
      }
    }

    if (opts.signedAt) {
      page.drawText(formatDate(opts.signedAt), {
        x: metaX,
        y: metaY,
        size: 7,
        font: fontMono,
        color: rgb(0.4, 0.38, 0.5),
      });
    }

    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Recursively extracts plain text from a Tiptap JSON document AST.
 * Block-level nodes get a newline appended so paragraphs are separated.
 */
function extractPlainText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as Record<string, unknown>;

  if (n['type'] === 'text' && typeof n['text'] === 'string') {
    return n['text'] as string;
  }

  const children = Array.isArray(n['content'])
    ? (n['content'] as unknown[]).map(extractPlainText).join('')
    : '';

  const blockTypes = ['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem'];
  if (blockTypes.includes(n['type'] as string)) {
    return children + '\n';
  }
  return children;
}

/**
 * Wraps a single line of text to fit within maxWidth at the given font size.
 * Returns an array of line strings (may be a single element if no wrapping needed).
 */
function wrapText(
  text: string,
  maxWidth: number,
  size: number,
  font: PDFFont,
): string[] {
  if (!text.trim()) return [''];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Draws "Digitally signed" as the fallback when no signature image is available.
 * Returns the updated y cursor position.
 */
function drawFallbackSignatureText(
  page: PDFPage,
  font: PDFFont,
  stripLeft: number,
  cursorY: number,
): number {
  page.drawText('Digitally signed', {
    x: stripLeft + 10,
    y: cursorY - 16,
    size: 14,
    font,
    color: rgb(0.086, 0.063, 0.227),
  });
  return cursorY - 24;
}

/** Formats an ISO timestamp as "DD MMM YYYY HH:mm UTC" */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toUTCString().replace(' GMT', ' UTC');
  } catch {
    return iso;
  }
}
