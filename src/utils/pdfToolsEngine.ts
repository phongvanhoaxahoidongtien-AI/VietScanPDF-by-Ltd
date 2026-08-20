import * as pdfjsLib from "pdfjs-dist";
import { jsPDF } from "jspdf";
import { PDFDocument, degrees as pdfLibDegrees } from "pdf-lib";
import { QuadPoints } from "../types";
import { CVEngine } from "./cvEngine";

// Configure PDF.js worker
if (typeof window !== "undefined") {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  } catch (e) {
    console.warn("PDF worker initialization note:", e);
  }
}

export interface HighlightStroke {
  id: string;
  type: "box" | "path";
  color: string;
  opacity: number;
  width?: number; // for path (in px or percentage)
  // For box
  x?: number; // percentage 0..1
  y?: number; // percentage 0..1
  w?: number; // percentage 0..1
  h?: number; // percentage 0..1
  // For freehand path: normalized points (0..1)
  points?: { x: number; y: number }[];
  size?: number; // stroke width relative to page height
}

export interface PDFPageItem {
  id: string;
  sourceFileName: string;
  sourceFileId: string;
  pageIndex: number; // 0-based index in original file
  pageNumber: number; // 1-based display
  originalImage: string; // Base64 data URL
  renderedImage: string; // Base64 data URL (after rotation/crop)
  rotation: number; // 0, 90, 180, 270
  width: number;
  height: number;
  highlights?: HighlightStroke[];
  isCropped?: boolean;
}

export class PDFToolsEngine {
  /**
   * Renders all pages of a PDF ArrayBuffer to high-resolution image Data URLs
   */
  static async renderPDFToPages(
    buffer: ArrayBuffer,
    sourceFileName: string,
    scale: number = 2.0
  ): Promise<PDFPageItem[]> {
    const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const pages: PDFPageItem[] = [];

    try {
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buffer),
        cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
        cMapPacked: true,
      });

      const pdf = await loadingTask.promise;
      const total = pdf.numPages;

      for (let i = 1; i <= total; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");

        if (ctx) {
          // pdfjs-dist v6 requires both canvas and canvasContext or RenderParameters
          await (page.render as any)({
            canvasContext: ctx,
            canvas,
            viewport,
          }).promise;
          const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

          pages.push({
            id: `page_${fileId}_${i}`,
            sourceFileName,
            sourceFileId: fileId,
            pageIndex: i - 1,
            pageNumber: i,
            originalImage: dataUrl,
            renderedImage: dataUrl,
            rotation: 0,
            width: viewport.width,
            height: viewport.height,
            highlights: [],
          });
        }
      }
    } catch (err) {
      console.error("PDF.js render error:", err);
      // Fallback: create placeholder if pdfjs fails
      throw new Error(
        "Không thể hiển thị nội dung tệp PDF. Tệp có thể có định dạng đặc biệt hoặc bị mã hóa."
      );
    }

    return pages;
  }

  /**
   * Rotates an image dataUrl by specified angle (90, 180, 270)
   */
  static async rotateImageDataUrl(
    dataUrl: string,
    angleDelta: number
  ): Promise<{ dataUrl: string; width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const rad = (angleDelta * Math.PI) / 180;
        const isOrthogonal = Math.abs(angleDelta) % 180 !== 0;

        const newW = isOrthogonal ? img.naturalHeight : img.naturalWidth;
        const newH = isOrthogonal ? img.naturalWidth : img.naturalHeight;

        const canvas = document.createElement("canvas");
        canvas.width = newW;
        canvas.height = newH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight });
          return;
        }

        ctx.translate(newW / 2, newH / 2);
        ctx.rotate(rad);
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

        const rotatedUrl = canvas.toDataURL("image/jpeg", 0.92);
        resolve({ dataUrl: rotatedUrl, width: newW, height: newH });
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  /**
   * Crops/Warps an image dataUrl using Quad points
   */
  static async cropImageDataUrl(
    dataUrl: string,
    quad: QuadPoints
  ): Promise<{ dataUrl: string; width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const warpedCanvas = CVEngine.warpPerspective(img, quad);
        const croppedUrl = warpedCanvas.toDataURL("image/jpeg", 0.92);
        resolve({
          dataUrl: croppedUrl,
          width: warpedCanvas.width,
          height: warpedCanvas.height,
        });
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  /**
   * Merges multiple page items into a single PDF Blob
   */
  static async generatePDFFromPages(
    pages: { renderedImage: string; width?: number; height?: number }[]
  ): Promise<Blob> {
    if (pages.length === 0) {
      throw new Error("Không có trang nào để tạo file PDF.");
    }

    // Use jsPDF to generate crisp pages matching each page's aspect ratio
    const firstPage = pages[0];
    const firstImg = await CVEngine.loadImage(firstPage.renderedImage);
    const isFirstLandscape = firstImg.naturalWidth > firstImg.naturalHeight;

    const pdf = new jsPDF({
      orientation: isFirstLandscape ? "landscape" : "portrait",
      unit: "mm",
      format: "a4",
      compress: true,
    });

    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const img = await CVEngine.loadImage(p.renderedImage);
      const isLandscape = img.naturalWidth > img.naturalHeight;

      if (i > 0) {
        pdf.addPage("a4", isLandscape ? "landscape" : "portrait");
      }

      const pageWidth = isLandscape ? 297 : 210;
      const pageHeight = isLandscape ? 210 : 297;

      const imgAspect = img.naturalWidth / img.naturalHeight;
      const pageAspect = pageWidth / pageHeight;

      let drawW = pageWidth;
      let drawH = pageHeight;
      let offX = 0;
      let offY = 0;

      if (imgAspect > pageAspect) {
        drawW = pageWidth;
        drawH = pageWidth / imgAspect;
        offY = (pageHeight - drawH) / 2;
      } else {
        drawH = pageHeight;
        drawW = pageHeight * imgAspect;
        offX = (pageWidth - drawW) / 2;
      }

      pdf.addImage(p.renderedImage, "JPEG", offX, offY, drawW, drawH, undefined, "FAST");
    }

    return pdf.output("blob");
  }

  /**
   * Merges raw PDF buffers (standard fast merge)
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
   * Parses page range strings like "1, 3-5, 8" into 0-indexed array
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
            pages.add(p - 1);
          }
        }
      } else {
        const p = parseInt(part, 10);
        if (!isNaN(p) && p >= 1 && p <= maxPages) {
          pages.add(p - 1);
        }
      }
    }

    return Array.from(pages).sort((a, b) => a - b);
  }

  /**
   * Burns highlight strokes (both boxes and freehand drawings) onto an image
   */
  static async burnHighlightsToImage(
    baseImageSrc: string,
    highlights: HighlightStroke[]
  ): Promise<string> {
    if (!highlights || highlights.length === 0) return baseImageSrc;

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(baseImageSrc);
          return;
        }

        // Draw original page
        ctx.drawImage(img, 0, 0);

        // Draw highlights with multiply composite mode so text beneath stays crisp and readable
        ctx.save();
        ctx.globalCompositeOperation = "multiply";

        for (const hl of highlights) {
          ctx.fillStyle = hl.color || "#ffe600";
          ctx.strokeStyle = hl.color || "#ffe600";

          if (hl.type === "box" && hl.x !== undefined && hl.y !== undefined && hl.w !== undefined && hl.h !== undefined) {
            const rx = hl.x * canvas.width;
            const ry = hl.y * canvas.height;
            const rw = hl.w * canvas.width;
            const rh = hl.h * canvas.height;

            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(rx, ry, rw, rh, 3) : ctx.rect(rx, ry, rw, rh);
            ctx.fill();
          } else if (hl.type === "path" && hl.points && hl.points.length > 0) {
            const strokeW = (hl.size || 0.018) * canvas.height;
            ctx.lineWidth = Math.max(2, strokeW);
            ctx.lineCap = "round";
            ctx.lineJoin = "round";

            ctx.beginPath();
            const first = hl.points[0];
            ctx.moveTo(first.x * canvas.width, first.y * canvas.height);

            for (let k = 1; k < hl.points.length; k++) {
              const pt = hl.points[k];
              ctx.lineTo(pt.x * canvas.width, pt.y * canvas.height);
            }
            ctx.stroke();
          }
        }

        ctx.restore();
        resolve(canvas.toDataURL("image/jpeg", 0.94));
      };
      img.onerror = reject;
      img.src = baseImageSrc;
    });
  }
}
