import { PDFDocument, rgb } from "pdf-lib";

export interface HighlightRect {
  x: number; // in percentage of page width (0 to 1)
  y: number; // in percentage of page height (0 to 1)
  width: number; // in percentage (0 to 1)
  height: number; // in percentage (0 to 1)
  color?: string; // hex or name (default yellow)
}

export class PDFToolsEngine {
  /**
   * Merges multiple PDF ArrayBuffers or Blobs into a single PDF
   */
  static async mergePDFs(pdfBuffers: ArrayBuffer[]): Promise<Uint8Array> {
    if (pdfBuffers.length === 0) {
      throw new Error("Không có tệp PDF nào để ghép.");
    }

    const mergedPdf = await PDFDocument.create();

    for (const buffer of pdfBuffers) {
      const srcPdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const copiedPages = await mergedPdf.copyPages(srcPdf, srcPdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }

    return await mergedPdf.save();
  }

  /**
   * Splits a PDF or extracts specific 0-based page indices
   */
  static async splitPDF(
    pdfBuffer: ArrayBuffer,
    pageIndices: number[]
  ): Promise<Uint8Array> {
    const srcPdf = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const newPdf = await PDFDocument.create();

    const validIndices = pageIndices.filter(
      (idx) => idx >= 0 && idx < srcPdf.getPageCount()
    );

    if (validIndices.length === 0) {
      throw new Error("Vui lòng chọn ít nhất một trang hợp lệ để tách.");
    }

    const copiedPages = await newPdf.copyPages(srcPdf, validIndices);
    copiedPages.forEach((page) => newPdf.addPage(page));

    return await newPdf.save();
  }

  /**
   * Applies semi-transparent vector highlight rectangles onto a PDF page
   */
  static async highlightPDF(
    pdfBuffer: ArrayBuffer,
    pageIndex: number,
    highlights: HighlightRect[]
  ): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();

    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new Error("Trang được chọn không tồn tại trong file PDF.");
    }

    const page = pages[pageIndex];
    const { width, height } = page.getSize();

    for (const hl of highlights) {
      // PDF coordinate system origin is at bottom-left
      // Convert from top-left percentage to PDF coordinates
      const rectX = hl.x * width;
      const rectWidth = hl.width * width;
      const rectHeight = hl.height * height;
      const rectY = height - (hl.y * height + rectHeight);

      // Standard yellow highlight: RGB(255, 226, 77) with 35% opacity
      page.drawRectangle({
        x: Math.max(0, rectX),
        y: Math.max(0, rectY),
        width: Math.min(width - rectX, rectWidth),
        height: Math.min(height, rectHeight),
        color: rgb(1, 0.88, 0.2), // Yellow
        opacity: 0.38,
      });
    }

    return await pdfDoc.save();
  }

  /**
   * Helper to parse page range strings like "1, 3-5, 8" into 0-indexed array
   */
  static parsePageRanges(rangeStr: string, maxPages: number): number[] {
    const pages = new Set<number>();
    const parts = rangeStr.split(",").map((s) => s.trim()).filter(Boolean);

    for (const part of parts) {
      if (part.includes("-")) {
        const [startStr, endStr] = part.split("-").map((s) => s.trim());
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (!isNaN(start) && !isNaN(end)) {
          const min = Math.max(1, Math.min(start, end));
          const max = Math.min(maxPages, Math.max(start, end));
          for (let p = min; p <= max; p++) {
            pages.add(p - 1); // 0-based
          }
        }
      } else {
        const p = parseInt(part, 10);
        if (!isNaN(p) && p >= 1 && p <= maxPages) {
          pages.add(p - 1); // 0-based
        }
      }
    }

    return Array.from(pages).sort((a, b) => a - b);
  }
}
