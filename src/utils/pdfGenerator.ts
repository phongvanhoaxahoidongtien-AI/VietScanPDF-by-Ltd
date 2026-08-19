import { jsPDF } from "jspdf";
import { PDFExportOptions, ScannedDocument, ScannedPage } from "../types";
import { CVEngine } from "./cvEngine";
import { generateDocumentFileName } from "./naming";

export class PDFGenerator {
  /**
   * Generates a standard multi-page PDF from scanned pages
   */
  static async generateDocumentPDF(
    doc: ScannedDocument,
    options: PDFExportOptions = {
      paperSize: "a4",
      orientation: "portrait",
      marginMm: 8,
      quality: 0.92,
    }
  ): Promise<{ blob: Blob; url: string; fileName: string }> {
    const { paperSize, orientation, marginMm, quality } = options;

    // Determine dimensions in mm
    let pageWidthMm = 210; // A4
    let pageHeightMm = 297;

    if (paperSize === "a5") {
      pageWidthMm = 148;
      pageHeightMm = 210;
    } else if (paperSize === "letter") {
      pageWidthMm = 215.9;
      pageHeightMm = 279.4;
    }

    // Handle 2-sided Card Mode (CCCD / Bằng lái xe)
    if (
      (doc.category === "cccd" || doc.category === "driver_license" || options.twoSidedMode) &&
      doc.pages.length >= 2
    ) {
      return this.generateTwoSidedCardPDF(doc, options);
    }

    // Default Multi-page PDF
    const pdf = new jsPDF({
      orientation: orientation === "landscape" ? "landscape" : "portrait",
      unit: "mm",
      format: paperSize,
      compress: true,
    });

    for (let i = 0; i < doc.pages.length; i++) {
      const page = doc.pages[i];
      if (i > 0) {
        pdf.addPage(paperSize, orientation === "landscape" ? "landscape" : "portrait");
      }

      const img = await CVEngine.loadImage(page.processedImage);
      const imgAspect = img.naturalWidth / img.naturalHeight;

      const availWidth = pageWidthMm - marginMm * 2;
      const availHeight = pageHeightMm - marginMm * 2;

      let drawWidth = availWidth;
      let drawHeight = drawWidth / imgAspect;

      if (drawHeight > availHeight) {
        drawHeight = availHeight;
        drawWidth = drawHeight * imgAspect;
      }

      const posX = marginMm + (availWidth - drawWidth) / 2;
      const posY = marginMm + (availHeight - drawHeight) / 2;

      pdf.addImage(page.processedImage, "JPEG", posX, posY, drawWidth, drawHeight, undefined, "FAST");
    }

    let fileName = doc.title ? `${doc.title.trim().replace(/[\/\\:*?"<>|]/g, "_").replace(/\s+/g, "_")}.pdf` : generateDocumentFileName({ date: doc.createdAt });
    if (!fileName.endsWith(".pdf")) fileName += ".pdf";

    const blob = pdf.output("blob");
    const url = URL.createObjectURL(blob);

    return { blob, url, fileName };
  }

  /**
   * Generates a 2-sided ID Card / Driver's License PDF on a single A4 / A5 page
   */
  static async generateTwoSidedCardPDF(
    doc: ScannedDocument,
    options: PDFExportOptions = {
      paperSize: "a4",
      orientation: "portrait",
      marginMm: 10,
      quality: 0.95,
    }
  ): Promise<{ blob: Blob; url: string; fileName: string }> {
    const isA5 = options.paperSize === "a5";
    const isLandscape = options.orientation === "landscape";

    const pdf = new jsPDF({
      orientation: isLandscape ? "landscape" : "portrait",
      unit: "mm",
      format: options.paperSize,
      compress: true,
    });

    const pageWidth = isLandscape ? (isA5 ? 210 : 297) : (isA5 ? 148 : 210);
    const pageHeight = isLandscape ? (isA5 ? 148 : 210) : (isA5 ? 210 : 297);

    // Standard Vietnamese ID card / CCCD / GPLX print size is 85.6mm x 53.98mm
    const cardWidthMm = isA5 ? 90 : 105;
    const cardHeightMm = cardWidthMm / 1.586; // ~66mm on A4

    const frontPage = doc.pages[0];
    const backPage = doc.pages[1] || doc.pages[0];

    if (isLandscape) {
      // Side by side in Landscape
      const gapMm = 18;
      const totalWidth = cardWidthMm * 2 + gapMm;
      const startX = (pageWidth - totalWidth) / 2;
      const startY = (pageHeight - cardHeightMm) / 2;

      // Front
      pdf.addImage(frontPage.processedImage, "JPEG", startX, startY, cardWidthMm, cardHeightMm, undefined, "FAST");
      // Back
      pdf.addImage(
        backPage.processedImage,
        "JPEG",
        startX + cardWidthMm + gapMm,
        startY,
        cardWidthMm,
        cardHeightMm,
        undefined,
        "FAST"
      );
    } else {
      // Stacked vertically in Portrait (Standard administrative style in Vietnam)
      const gapMm = 24;
      const totalHeight = cardHeightMm * 2 + gapMm;
      const startX = (pageWidth - cardWidthMm) / 2;
      const startY = (pageHeight - totalHeight) / 2;

      // Front card (Top)
      pdf.addImage(frontPage.processedImage, "JPEG", startX, startY, cardWidthMm, cardHeightMm, undefined, "FAST");

      // Back card (Bottom)
      pdf.addImage(
        backPage.processedImage,
        "JPEG",
        startX,
        startY + cardHeightMm + gapMm,
        cardWidthMm,
        cardHeightMm,
        undefined,
        "FAST"
      );
    }

    let fileName = doc.title ? `${doc.title.trim().replace(/[\/\\:*?"<>|]/g, "_").replace(/\s+/g, "_")}.pdf` : generateDocumentFileName({ date: doc.createdAt });
    if (!fileName.endsWith(".pdf")) fileName += ".pdf";

    const blob = pdf.output("blob");
    const url = URL.createObjectURL(blob);

    return { blob, url, fileName };
  }

  /**
   * Helper to trigger download in browser
   */
  static downloadBlob(blob: Blob, fileName: string) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 3000);
  }

  /**
   * Share file using Web Share API or fallback to download
   */
  static async sharePDFOrImage(blob: Blob, fileName: string, title: string = "VietScanPDF"): Promise<boolean> {
    if (navigator.canShare && navigator.canShare({ files: [new File([blob], fileName, { type: blob.type })] })) {
      try {
        const file = new File([blob], fileName, { type: blob.type });
        await navigator.share({
          files: [file],
          title: title,
          text: `Tài liệu scan từ VietScanPDF: ${fileName}`,
        });
        return true;
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.warn("Web Share failed, falling back to download:", err);
          this.downloadBlob(blob, fileName);
        }
        return false;
      }
    } else {
      // Fallback download
      this.downloadBlob(blob, fileName);
      return false;
    }
  }
}
