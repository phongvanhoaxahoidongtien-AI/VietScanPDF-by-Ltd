import * as XLSX from "xlsx";
import mammoth from "mammoth";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { PDFToolsEngine, HighlightStroke } from "./pdfToolsEngine";
import { generateDocumentFileName } from "./naming";

export interface TextOverlayItem {
  id: string;
  text: string;
  x: number; // percentage 0..1 (from left)
  y: number; // percentage 0..1 (from top)
  fontSize: number; // in px
  color: string;
  bgColor?: string; // transparent or hex
  isBold?: boolean;
}

export interface ImageOverlayItem {
  id: string;
  dataUrl: string;
  x: number; // percentage 0..1
  y: number; // percentage 0..1
  widthRatio: number; // 0.1 .. 0.8 of page width
  aspectRatio: number; // width / height
  rotation?: number; // 0, 90, 180, 270
  opacity?: number; // 0.1 .. 1.0
}

export interface EditableDocPage {
  id: string;
  pageNumber: number; // 1-based display
  originalImage: string; // Base64 data URL
  renderedImage: string; // Base64 data URL
  rotation: number; // 0, 90, 180, 270
  width: number;
  height: number;
  textOverlays: TextOverlayItem[];
  imageOverlays: ImageOverlayItem[];
  highlights: HighlightStroke[];
}

export class DocumentConverter {
  /**
   * Identifies file format: "pdf" | "word" | "excel" | "unknown"
   */
  static detectFileType(file: File): "pdf" | "word" | "excel" | "unknown" {
    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      return "pdf";
    }
    if (
      name.endsWith(".docx") ||
      name.endsWith(".doc") ||
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.type === "application/msword"
    ) {
      return "word";
    }
    if (
      name.endsWith(".xlsx") ||
      name.endsWith(".xls") ||
      name.endsWith(".csv") ||
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.type === "application/vnd.ms-excel"
    ) {
      return "excel";
    }
    return "unknown";
  }

  /**
   * Main entry point to load / convert any supported file to EditableDocPages
   */
  static async convertFileToPages(
    file: File,
    onProgress?: (status: string) => void
  ): Promise<{ pages: EditableDocPage[]; title: string }> {
    const fileType = this.detectFileType(file);
    const baseTitle = file.name.replace(/\.[^/.]+$/, "");

    if (fileType === "pdf") {
      onProgress?.("Đang giải mã và kết xuất các trang PDF...");
      const buffer = await file.arrayBuffer();
      const rawPages = await PDFToolsEngine.renderPDFToPages(buffer, file.name);

      const pages: EditableDocPage[] = rawPages.map((p, idx) => ({
        id: `page_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 5)}`,
        pageNumber: idx + 1,
        originalImage: p.renderedImage || p.originalImage,
        renderedImage: p.renderedImage || p.originalImage,
        rotation: 0,
        width: p.width,
        height: p.height,
        textOverlays: [],
        imageOverlays: [],
        highlights: [],
      }));

      return { pages, title: baseTitle };
    }

    if (fileType === "word") {
      onProgress?.("Đang phân tích định dạng Word (.docx)...");
      const buffer = await file.arrayBuffer();
      const pages = await this.convertWordBufferToPages(buffer, onProgress);
      return { pages, title: baseTitle };
    }

    if (fileType === "excel") {
      onProgress?.("Đang đọc bảng tính Excel (.xlsx / .xls)...");
      const buffer = await file.arrayBuffer();
      const pages = await this.convertExcelBufferToPages(buffer, onProgress);
      return { pages, title: baseTitle };
    }

    throw new Error("Định dạng tệp không được hỗ trợ. Vui lòng chọn tệp PDF (.pdf), Word (.docx), hoặc Excel (.xlsx, .xls).");
  }

  /**
   * Converts Word (.docx) to A4 pages
   */
  private static async convertWordBufferToPages(
    buffer: ArrayBuffer,
    onProgress?: (status: string) => void
  ): Promise<EditableDocPage[]> {
    onProgress?.("Đang chuyển đổi nội dung Word thành văn bản trực quan...");
    let resultHtml = "";
    try {
      const conversion = await mammoth.convertToHtml({ arrayBuffer: buffer });
      resultHtml = conversion.value;
    } catch (err: any) {
      console.error("Mammoth conversion error:", err);
      throw new Error("Không thể đọc tệp Word. Vui lòng đảm bảo tệp là định dạng .docx hợp lệ.");
    }

    if (!resultHtml.trim()) {
      throw new Error("Tệp Word không có nội dung văn bản để hiển thị.");
    }

    onProgress?.("Đang dàn trang khổ A4 vừa vặn...");

    // Create offscreen container
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-9999px";
    container.style.top = "0";
    container.style.width = "794px"; // Standard A4 width at 96 DPI
    container.style.minHeight = "1123px";
    container.style.backgroundColor = "#ffffff";
    container.style.color = "#1e293b";
    container.style.padding = "44px 50px";
    container.style.boxSizing = "border-box";
    container.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    container.style.fontSize = "13.5px";
    container.style.lineHeight = "1.65";
    container.style.wordBreak = "break-word";
    container.style.zIndex = "-1000";

    // Inject enhanced CSS rules for print A4 beauty
    container.innerHTML = `
      <style>
        .vietscan-word-content h1 { font-size: 22px; font-weight: bold; margin: 18px 0 10px; color: #0f172a; line-height: 1.3; }
        .vietscan-word-content h2 { font-size: 18px; font-weight: bold; margin: 14px 0 8px; color: #1e293b; line-height: 1.3; }
        .vietscan-word-content h3 { font-size: 15px; font-weight: 600; margin: 12px 0 6px; color: #334155; }
        .vietscan-word-content p { margin: 0 0 10px; }
        .vietscan-word-content ul, .vietscan-word-content ol { margin: 8px 0 12px; padding-left: 24px; }
        .vietscan-word-content li { margin-bottom: 4px; }
        .vietscan-word-content table { border-collapse: collapse; width: 100%; margin: 14px 0; font-size: 12px; }
        .vietscan-word-content th, .vietscan-word-content td { border: 1px solid #cbd5e1; padding: 6px 10px; text-align: left; vertical-align: top; }
        .vietscan-word-content th { background-color: #f1f5f9; font-weight: 600; color: #0f172a; }
        .vietscan-word-content tr:nth-child(even) td { background-color: #f8fafc; }
        .vietscan-word-content img { max-width: 100%; height: auto; display: block; margin: 12px auto; border-radius: 4px; }
        .vietscan-word-content strong, .vietscan-word-content b { font-weight: 600; color: #0f172a; }
        .vietscan-word-content blockquote { border-left: 3px solid #3b82f6; padding-left: 12px; margin: 10px 0; color: #475569; font-style: italic; }
      </style>
      <div class="vietscan-word-content">
        ${resultHtml}
      </div>
    `;

    document.body.appendChild(container);

    try {
      // Allow any inline base64 images to settle
      await new Promise((r) => setTimeout(r, 150));

      const canvas = await html2canvas(container, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
      });

      document.body.removeChild(container);

      // Slice vertically into A4 pages (Ratio 1 : 1.4142)
      const a4PageHeight = Math.round(canvas.width * 1.4142);
      const totalPages = Math.max(1, Math.ceil(canvas.height / a4PageHeight));
      const pages: EditableDocPage[] = [];

      for (let i = 0; i < totalPages; i++) {
        onProgress?.(`Đang tạo trang ${i + 1}/${totalPages}...`);
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = canvas.width;
        pageCanvas.height = a4PageHeight;
        const ctx = pageCanvas.getContext("2d");

        if (ctx) {
          // Fill background pure white
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

          const sourceY = i * a4PageHeight;
          const sliceHeight = Math.min(a4PageHeight, canvas.height - sourceY);

          ctx.drawImage(
            canvas,
            0,
            sourceY,
            canvas.width,
            sliceHeight,
            0,
            0,
            canvas.width,
            sliceHeight
          );

          const dataUrl = pageCanvas.toDataURL("image/jpeg", 0.92);
          pages.push({
            id: `page_word_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 5)}`,
            pageNumber: i + 1,
            originalImage: dataUrl,
            renderedImage: dataUrl,
            rotation: 0,
            width: pageCanvas.width,
            height: pageCanvas.height,
            textOverlays: [],
            imageOverlays: [],
            highlights: [],
          });
        }
      }

      return pages;
    } catch (err) {
      if (document.body.contains(container)) {
        document.body.removeChild(container);
      }
      throw err;
    }
  }

  /**
   * Converts Excel (.xlsx / .xls) to A4 pages
   */
  private static async convertExcelBufferToPages(
    buffer: ArrayBuffer,
    onProgress?: (status: string) => void
  ): Promise<EditableDocPage[]> {
    onProgress?.("Đang giải nén các bảng tính Excel...");
    const workbook = XLSX.read(buffer, { type: "array" });

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error("Tệp Excel không chứa bảng tính nào.");
    }

    const pages: EditableDocPage[] = [];
    let pageIndex = 1;

    for (let sIdx = 0; sIdx < workbook.SheetNames.length; sIdx++) {
      const sheetName = workbook.SheetNames[sIdx];
      const sheet = workbook.Sheets[sheetName];

      if (!sheet || !sheet["!ref"]) continue;

      onProgress?.(`Đang xử lý bảng tính: "${sheetName}" (${sIdx + 1}/${workbook.SheetNames.length})...`);

      // Determine range to see if it's wide (many columns)
      const range = XLSX.utils.decode_range(sheet["!ref"]);
      const colCount = range.e.c - range.s.c + 1;
      const isLandscape = colCount > 7;

      const sheetHtml = XLSX.utils.sheet_to_html(sheet, { header: "", footer: "" });

      // Create offscreen container
      const container = document.createElement("div");
      container.style.position = "fixed";
      container.style.left = "-9999px";
      container.style.top = "0";
      // A4 portrait = 794px, A4 landscape = 1123px
      container.style.width = isLandscape ? "1123px" : "794px";
      container.style.minHeight = isLandscape ? "794px" : "1123px";
      container.style.backgroundColor = "#ffffff";
      container.style.color = "#0f172a";
      container.style.padding = "36px 40px";
      container.style.boxSizing = "border-box";
      container.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
      container.style.zIndex = "-1000";

      container.innerHTML = `
        <style>
          .vietscan-excel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 14px;
            padding-bottom: 8px;
            border-bottom: 2px solid #2563eb;
          }
          .vietscan-excel-title {
            font-size: 16px;
            font-weight: 700;
            color: #1e3a8a;
          }
          .vietscan-excel-badge {
            font-size: 11px;
            font-weight: 600;
            background: #eff6ff;
            color: #2563eb;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #bfdbfe;
          }
          .vietscan-excel-wrap table {
            border-collapse: collapse;
            width: 100%;
            font-size: 11.5px;
            table-layout: auto;
          }
          .vietscan-excel-wrap th, .vietscan-excel-wrap td {
            border: 1px solid #cbd5e1;
            padding: 6px 8px;
            text-align: left;
            vertical-align: middle;
            word-break: break-word;
          }
          .vietscan-excel-wrap tr:first-child td, .vietscan-excel-wrap tr:first-child th {
            background-color: #f1f5f9;
            font-weight: 700;
            color: #0f172a;
          }
          .vietscan-excel-wrap tr:nth-child(even) td {
            background-color: #f8fafc;
          }
        </style>
        <div class="vietscan-excel-header">
          <div class="vietscan-excel-title">📊 ${sheetName}</div>
          <div class="vietscan-excel-badge">${colCount} cột • ${range.e.r - range.s.r + 1} hàng</div>
        </div>
        <div class="vietscan-excel-wrap">
          ${sheetHtml}
        </div>
      `;

      document.body.appendChild(container);

      try {
        await new Promise((r) => setTimeout(r, 100));

        const canvas = await html2canvas(container, {
          scale: 2,
          backgroundColor: "#ffffff",
          useCORS: true,
          logging: false,
        });

        document.body.removeChild(container);

        // Aspect ratio: landscape 1.4142 or portrait 1.4142
        const a4Height = isLandscape
          ? Math.round(canvas.width / 1.4142)
          : Math.round(canvas.width * 1.4142);

        const totalSlices = Math.max(1, Math.ceil(canvas.height / a4Height));

        for (let i = 0; i < totalSlices; i++) {
          const pageCanvas = document.createElement("canvas");
          pageCanvas.width = canvas.width;
          pageCanvas.height = a4Height;
          const ctx = pageCanvas.getContext("2d");

          if (ctx) {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

            const sourceY = i * a4Height;
            const sliceHeight = Math.min(a4Height, canvas.height - sourceY);

            ctx.drawImage(
              canvas,
              0,
              sourceY,
              canvas.width,
              sliceHeight,
              0,
              0,
              canvas.width,
              sliceHeight
            );

            const dataUrl = pageCanvas.toDataURL("image/jpeg", 0.92);
            pages.push({
              id: `page_excel_${Date.now()}_${pageIndex}_${Math.random().toString(36).substr(2, 5)}`,
              pageNumber: pageIndex++,
              originalImage: dataUrl,
              renderedImage: dataUrl,
              rotation: 0,
              width: pageCanvas.width,
              height: pageCanvas.height,
              textOverlays: [],
              imageOverlays: [],
              highlights: [],
            });
          }
        }
      } catch (err) {
        if (document.body.contains(container)) {
          document.body.removeChild(container);
        }
        throw err;
      }
    }

    if (pages.length === 0) {
      throw new Error("Không tìm thấy dữ liệu có thể hiển thị trong tệp Excel này.");
    }

    return pages;
  }

  /**
   * Generates a blank A4 white page
   */
  static createBlankPage(pageNumber: number): EditableDocPage {
    const width = 1588;
    const height = 2246; // A4 at ~200 DPI
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }
    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);

    return {
      id: `page_blank_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      pageNumber,
      originalImage: dataUrl,
      renderedImage: dataUrl,
      rotation: 0,
      width,
      height,
      textOverlays: [],
      imageOverlays: [],
      highlights: [],
    };
  }

  /**
   * Bakes all page layers (base image, rotation, highlights, text, images/signatures)
   * into a unified high-resolution image data URL
   */
  static async bakePageToImage(page: EditableDocPage): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const isRotated90or270 = page.rotation === 90 || page.rotation === 270;
        const targetW = isRotated90or270 ? img.naturalHeight : img.naturalWidth;
        const targetH = isRotated90or270 ? img.naturalWidth : img.naturalHeight;

        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(page.renderedImage);
          return;
        }

        // Fill white
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, targetW, targetH);

        // Apply rotation to base image
        ctx.save();
        ctx.translate(targetW / 2, targetH / 2);
        ctx.rotate((page.rotation * Math.PI) / 180);
        ctx.drawImage(
          img,
          -img.naturalWidth / 2,
          -img.naturalHeight / 2,
          img.naturalWidth,
          img.naturalHeight
        );
        ctx.restore();

        // Draw Highlights
        if (page.highlights && page.highlights.length > 0) {
          ctx.save();
          try {
            ctx.globalCompositeOperation = "multiply";
          } catch {
            // fallback
          }
          page.highlights.forEach((h) => {
            ctx.fillStyle = h.color;
            ctx.strokeStyle = h.color;
            ctx.globalAlpha = h.opacity || 0.55;

            if (h.type === "box" && h.x !== undefined && h.y !== undefined && h.w && h.h) {
              ctx.fillRect(h.x * targetW, h.y * targetH, h.w * targetW, h.h * targetH);
            } else if (h.type === "path" && h.points && h.points.length > 1) {
              const strokePx = (h.size || 0.025) * targetH;
              ctx.lineWidth = strokePx;
              ctx.lineCap = "round";
              ctx.lineJoin = "round";
              ctx.beginPath();
              ctx.moveTo(h.points[0].x * targetW, h.points[0].y * targetH);
              for (let pt = 1; pt < h.points.length; pt++) {
                ctx.lineTo(h.points[pt].x * targetW, h.points[pt].y * targetH);
              }
              ctx.stroke();
            }
          });
          ctx.restore();
        }

        // Draw Image Overlays (Signatures, Stamps, Logos)
        const renderImageOverlays = async () => {
          if (page.imageOverlays && page.imageOverlays.length > 0) {
            for (const item of page.imageOverlays) {
              await new Promise<void>((imgDone) => {
                const overlayImg = new Image();
                overlayImg.onload = () => {
                  ctx.save();
                  ctx.globalAlpha = item.opacity ?? 1.0;

                  const overlayW = item.widthRatio * targetW;
                  const overlayH = overlayW / (item.aspectRatio || 1);
                  const posX = item.x * targetW;
                  const posY = item.y * targetH;

                  if (item.rotation) {
                    ctx.translate(posX + overlayW / 2, posY + overlayH / 2);
                    ctx.rotate((item.rotation * Math.PI) / 180);
                    ctx.drawImage(overlayImg, -overlayW / 2, -overlayH / 2, overlayW, overlayH);
                  } else {
                    ctx.drawImage(overlayImg, posX, posY, overlayW, overlayH);
                  }
                  ctx.restore();
                  imgDone();
                };
                overlayImg.onerror = () => imgDone();
                overlayImg.src = item.dataUrl;
              });
            }
          }

          // Draw Text Overlays
          if (page.textOverlays && page.textOverlays.length > 0) {
            ctx.save();
            page.textOverlays.forEach((txt) => {
              const scaleFactor = targetW / 800; // Base reference scale
              const actualFontSize = Math.max(14, Math.round(txt.fontSize * scaleFactor));
              ctx.font = `${txt.isBold ? "bold " : ""}${actualFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

              const x = txt.x * targetW;
              const y = txt.y * targetH;

              // Text background if provided
              if (txt.bgColor && txt.bgColor !== "transparent") {
                const textMetrics = ctx.measureText(txt.text);
                const paddingX = 8 * scaleFactor;
                const paddingY = 4 * scaleFactor;
                const bgW = textMetrics.width + paddingX * 2;
                const bgH = actualFontSize * 1.3 + paddingY * 2;

                ctx.fillStyle = txt.bgColor;
                ctx.beginPath();
                ctx.roundRect(x - paddingX, y - actualFontSize * 1.05, bgW, bgH, 4 * scaleFactor);
                ctx.fill();
              }

              ctx.fillStyle = txt.color;
              ctx.textBaseline = "alphabetic";
              ctx.fillText(txt.text, x, y);
            });
            ctx.restore();
          }

          resolve(canvas.toDataURL("image/jpeg", 0.94));
        };

        renderImageOverlays();
      };
      img.onerror = () => resolve(page.renderedImage);
      img.src = page.renderedImage;
    });
  }

  /**
   * Generates the final multi-page PDF from edited pages
   */
  static async exportToPDF(
    pages: EditableDocPage[],
    title?: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<{ blob: Blob; url: string; fileName: string; file: File }> {
    if (pages.length === 0) {
      throw new Error("Không có trang nào để xuất.");
    }

    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
      compress: true,
    });

    const pageWidthMm = 210;
    const pageHeightMm = 297;

    for (let i = 0; i < pages.length; i++) {
      onProgress?.(i + 1, pages.length);
      const page = pages[i];

      if (i > 0) {
        pdf.addPage("a4", "portrait");
      }

      // Bake all layers
      const bakedImage = await this.bakePageToImage(page);

      // Fit to A4 page dimensions
      pdf.addImage(
        bakedImage,
        "JPEG",
        0,
        0,
        pageWidthMm,
        pageHeightMm,
        undefined,
        "FAST"
      );
    }

    // Strict standardized filename format: VietScan_by_Ltd_dd_mm_yy_hh_mm_ss.pdf
    let fileName = generateDocumentFileName({ extension: "pdf" });
    if (title && title.startsWith("VietScan_by_Ltd_")) {
      fileName = title.endsWith(".pdf") ? title : `${title}.pdf`;
    }

    const blob = pdf.output("blob");
    const url = URL.createObjectURL(blob);
    const file = new File([blob], fileName, { type: "application/pdf" });

    return { blob, url, fileName, file };
  }
}
