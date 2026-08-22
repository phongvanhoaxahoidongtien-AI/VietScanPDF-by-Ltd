import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  FileImage,
  Upload,
  Check,
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  Crop,
  Sun,
  Contrast,
  Sparkles,
  Share2,
  Download,
  FolderPlus,
  Trash2,
  ZoomIn,
  ZoomOut,
  Eye,
  X,
  ArrowLeft,
  CheckSquare,
  Square,
  FileArchive,
  Sliders,
  Maximize2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Layers,
  FileText,
  AlertCircle,
  Undo,
  Palette,
  CheckCircle2,
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import JSZip from "jszip";
import { ScannedDocument, ScannedPage } from "../types";
import { StorageService } from "../utils/storage";
import { generatePdfToJpegFileName, generateDefaultDocumentTitle } from "../utils/naming";

// Configure PDF.js worker
if (typeof window !== "undefined") {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  } catch (e) {
    console.warn("PDF worker init note:", e);
  }
}

export interface PDFToJPEGModalProps {
  onClose: () => void;
  onSavedToDocuments?: (newDoc: ScannedDocument) => void;
  availableSavedDocs?: ScannedDocument[];
}

interface RawPDFPageInfo {
  pageNumber: number; // 1-based
  originalWidth: number;
  originalHeight: number;
  aspectRatio: number;
  thumbnailUrl: string;
}

export interface JPEGResultItem {
  id: string;
  pageNumber: number; // 1-based original or sequence
  originalPageNumber: number;
  dataUrl: string;
  originalExportUrl: string; // unmodified after export
  width: number;
  height: number;
  fileSizeBytes: number;
  fileName: string;
  // Visual adjustments
  rotation: number; // 0, 90, 180, 270
  flipH: boolean;
  flipV: boolean;
  brightness: number; // -100 to 100 (default 0)
  contrast: number; // -100 to 100 (default 0)
  saturation: number; // -100 to 100 (default 0)
  sharpen: boolean;
  filter: "original" | "document" | "bw" | "grayscale" | "magic";
  cropRect?: { x: number; y: number; width: number; height: number }; // normalized 0..1
}

type Step = "select" | "processing" | "gallery" | "editor";

export const PDFToJPEGModal: React.FC<PDFToJPEGModalProps> = ({
  onClose,
  onSavedToDocuments,
  availableSavedDocs = [],
}) => {
  // Main Step State
  const [currentStep, setCurrentStep] = useState<Step>("select");

  // File state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfArrayBuffer, setPdfArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [pdfDocProxy, setPdfDocProxy] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string>("");
  const [pdfTotalPages, setPdfTotalPages] = useState<number>(0);
  const [pageThumbnails, setPageThumbnails] = useState<RawPDFPageInfo[]>([]);
  const [selectedPageNumbers, setSelectedPageNumbers] = useState<number[]>([]);
  const [isLoadingPdf, setIsLoadingPdf] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Conversion Config State
  const [dpiPreset, setDpiPreset] = useState<"100" | "150" | "200" | "300">("150");
  const [jpegQuality, setJpegQuality] = useState<number>(90); // 60 to 100
  const [outputFormat, setOutputFormat] = useState<"jpeg" | "png">("jpeg");

  // Progress state
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number; percent: number }>({
    current: 0,
    total: 0,
    percent: 0,
  });

  // Exported Images Gallery State
  const [exportedImages, setExportedImages] = useState<JPEGResultItem[]>([]);
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [isSavedToApp, setIsSavedToApp] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Single Image Editor State
  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const [previewZoomImage, setPreviewZoomImage] = useState<JPEGResultItem | null>(null);

  // Editor draft controls
  const [editRotation, setEditRotation] = useState<number>(0);
  const [editFlipH, setEditFlipH] = useState<boolean>(false);
  const [editFlipV, setEditFlipV] = useState<boolean>(false);
  const [editBrightness, setEditBrightness] = useState<number>(0);
  const [editContrast, setEditContrast] = useState<number>(0);
  const [editSaturation, setEditSaturation] = useState<number>(0);
  const [editSharpen, setEditSharpen] = useState<boolean>(false);
  const [editFilter, setEditFilter] = useState<"original" | "document" | "bw" | "grayscale" | "magic">("original");
  const [isCropMode, setIsCropMode] = useState<boolean>(false);
  const [cropBox, setCropBox] = useState<{ x: number; y: number; w: number; h: number }>({
    x: 0.05,
    y: 0.05,
    w: 0.9,
    h: 0.9,
  });
  const [isDraggingCrop, setIsDraggingCrop] = useState<string | null>(null); // 'box' | 'tl' | 'tr' | 'br' | 'bl'
  const cropStartPos = useRef<{ clientX: number; clientY: number; box: { x: number; y: number; w: number; h: number } }>({
    clientX: 0,
    clientY: 0,
    box: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorCanvasRef = useRef<HTMLCanvasElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Toast notification timer
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  }, []);

  // Format bytes helper
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  // Map DPI to scale factor (Base PDF default is 72 DPI)
  const getScaleForDpi = (dpi: "100" | "150" | "200" | "300"): number => {
    switch (dpi) {
      case "100":
        return 1.38;
      case "150":
        return 2.08;
      case "200":
        return 2.78;
      case "300":
        return 4.17;
      default:
        return 2.08;
    }
  };

  // Handle File upload
  const handleFileSelected = async (file: File) => {
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
      setErrorMsg("Vui lòng chọn tệp PDF hợp lệ (.pdf)");
      return;
    }

    setErrorMsg(null);
    setIsLoadingPdf(true);
    setPdfFile(file);
    setPdfFileName(file.name);
    setPageThumbnails([]);
    setSelectedPageNumbers([]);

    try {
      const buffer = await file.arrayBuffer();
      setPdfArrayBuffer(buffer);

      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buffer),
        cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
        cMapPacked: true,
      });

      const pdf = await loadingTask.promise;
      setPdfDocProxy(pdf);
      setPdfTotalPages(pdf.numPages);

      // Extract fast low-res thumbnails for UI grid
      const thumbs: RawPDFPageInfo[] = [];
      const defaultSelected: number[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const originalViewport = page.getViewport({ scale: 1.0 });

        // Generate small thumbnail for preview grid (scale ~0.25)
        const thumbScale = Math.min(0.4, 240 / originalViewport.width);
        const thumbViewport = page.getViewport({ scale: thumbScale });

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(thumbViewport.width);
        canvas.height = Math.round(thumbViewport.height);
        const ctx = canvas.getContext("2d");

        if (ctx) {
          await (page.render as any)({
            canvasContext: ctx,
            canvas,
            viewport: thumbViewport,
          }).promise;
          const thumbUrl = canvas.toDataURL("image/jpeg", 0.85);

          thumbs.push({
            pageNumber: i,
            originalWidth: Math.round(originalViewport.width),
            originalHeight: Math.round(originalViewport.height),
            aspectRatio: originalViewport.width / originalViewport.height,
            thumbnailUrl: thumbUrl,
          });
        }
        defaultSelected.push(i);
      }

      setPageThumbnails(thumbs);
      setSelectedPageNumbers(defaultSelected);
    } catch (err: any) {
      console.error("PDF load error:", err);
      setErrorMsg("Không thể đọc tệp PDF. Tệp có thể bị mã hóa mật khẩu hoặc bị hỏng.");
    } finally {
      setIsLoadingPdf(false);
    }
  };

  // Select all or toggle pages
  const handleTogglePage = (pageNumber: number) => {
    setSelectedPageNumbers((prev) =>
      prev.includes(pageNumber) ? prev.filter((p) => p !== pageNumber) : [...prev, pageNumber].sort((a, b) => a - b)
    );
  };

  const handleSelectAllPages = () => {
    if (selectedPageNumbers.length === pageThumbnails.length) {
      setSelectedPageNumbers([]);
    } else {
      setSelectedPageNumbers(pageThumbnails.map((p) => p.pageNumber));
    }
  };

  // Convert PDF pages to high-resolution JPEG images
  const handleExecuteExport = async () => {
    if (!pdfDocProxy || selectedPageNumbers.length === 0) {
      setErrorMsg("Vui lòng chọn ít nhất 1 trang PDF để xuất ảnh.");
      return;
    }

    setErrorMsg(null);
    setCurrentStep("processing");
    const totalToExport = selectedPageNumbers.length;
    setExportProgress({ current: 0, total: totalToExport, percent: 0 });

    const scale = getScaleForDpi(dpiPreset);
    const mimeType = outputFormat === "jpeg" ? "image/jpeg" : "image/png";
    const qualityNum = jpegQuality / 100;
    const results: JPEGResultItem[] = [];

    try {
      for (let idx = 0; idx < totalToExport; idx++) {
        const pageNum = selectedPageNumbers[idx];
        setExportProgress({
          current: idx + 1,
          total: totalToExport,
          percent: Math.round(((idx + 1) / totalToExport) * 100),
        });

        const page = await pdfDocProxy.getPage(pageNum);
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          throw new Error("Không thể khởi tạo Canvas Context.");
        }

        // Clean white background for PDF rendering
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await (page.render as any)({
          canvasContext: ctx,
          canvas,
          viewport,
        }).promise;

        const dataUrl = canvas.toDataURL(mimeType, qualityNum);
        // Estimate file size from base64 dataUrl
        const byteLength = Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);

        const fileName = generatePdfToJpegFileName(pageNum, outputFormat);

        results.push({
          id: `jpeg_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 4)}`,
          pageNumber: idx + 1,
          originalPageNumber: pageNum,
          dataUrl,
          originalExportUrl: dataUrl,
          width: canvas.width,
          height: canvas.height,
          fileSizeBytes: byteLength,
          fileName,
          rotation: 0,
          flipH: false,
          flipV: false,
          brightness: 0,
          contrast: 0,
          saturation: 0,
          sharpen: false,
          filter: "original",
        });

        // Small yield to keep UI responsive
        await new Promise((r) => setTimeout(r, 15));
      }

      setExportedImages(results);
      setSelectedImageIds(results.map((r) => r.id));
      setIsSavedToApp(false);
      setCurrentStep("gallery");
      showToast(`Đã xuất thành công ${results.length} trang sang ảnh JPEG!`);
    } catch (err: any) {
      console.error("Export error:", err);
      setErrorMsg("Đã xảy ra lỗi trong quá trình xuất ảnh. Vui lòng thử giảm DPI hoặc chọn lại trang.");
      setCurrentStep("select");
    }
  };

  // Open Editor for an image
  const handleOpenEditor = (item: JPEGResultItem) => {
    setEditingImageId(item.id);
    setEditRotation(item.rotation || 0);
    setEditFlipH(item.flipH || false);
    setEditFlipV(item.flipV || false);
    setEditBrightness(item.brightness || 0);
    setEditContrast(item.contrast || 0);
    setEditSaturation(item.saturation || 0);
    setEditSharpen(item.sharpen || false);
    setEditFilter(item.filter || "original");
    setIsCropMode(false);
    setCropBox(item.cropRect ? { ...item.cropRect, w: item.cropRect.width, h: item.cropRect.height } : { x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
    setCurrentStep("editor");
  };

  const currentEditingItem = useMemo(() => {
    return exportedImages.find((img) => img.id === editingImageId) || null;
  }, [exportedImages, editingImageId]);

  // Apply real-time canvas rendering for editor
  const renderEditorPreviewCanvas = useCallback(
    async (sourceDataUrl: string) => {
      if (!editorCanvasRef.current) return;
      const canvas = editorCanvasRef.current;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = sourceDataUrl;
      });

      // Compute rotated/flipped bounds
      const isRotated90or270 = editRotation === 90 || editRotation === 270;
      const targetW = isRotated90or270 ? img.naturalHeight : img.naturalWidth;
      const targetH = isRotated90or270 ? img.naturalWidth : img.naturalHeight;

      canvas.width = targetW;
      canvas.height = targetH;

      ctx.save();
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, targetW, targetH);

      // Translate to center
      ctx.translate(targetW / 2, targetH / 2);

      // Rotation
      ctx.rotate((editRotation * Math.PI) / 180);

      // Flips
      ctx.scale(editFlipH ? -1 : 1, editFlipV ? -1 : 1);

      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      ctx.restore();

      // Apply brightness, contrast, saturation, and filters via ImageData
      const imgData = ctx.getImageData(0, 0, targetW, targetH);
      const data = imgData.data;
      const len = data.length;

      // Color adjustment multipliers
      const bMult = editBrightness; // -100 to 100
      const cFactor = (259 * (editContrast + 255)) / (255 * (259 - editContrast)); // contrast formula
      const sFactor = (editSaturation + 100) / 100; // saturation formula

      for (let i = 0; i < len; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        // 1. Brightness
        if (bMult !== 0) {
          r = Math.min(255, Math.max(0, r + bMult));
          g = Math.min(255, Math.max(0, g + bMult));
          b = Math.min(255, Math.max(0, b + bMult));
        }

        // 2. Contrast
        if (editContrast !== 0) {
          r = Math.min(255, Math.max(0, cFactor * (r - 128) + 128));
          g = Math.min(255, Math.max(0, cFactor * (g - 128) + 128));
          b = Math.min(255, Math.max(0, cFactor * (b - 128) + 128));
        }

        // 3. Saturation
        if (editSaturation !== 0) {
          const gray = 0.2989 * r + 0.587 * g + 0.114 * b;
          r = Math.min(255, Math.max(0, gray + sFactor * (r - gray)));
          g = Math.min(255, Math.max(0, gray + sFactor * (g - gray)));
          b = Math.min(255, Math.max(0, gray + sFactor * (b - gray)));
        }

        // 4. Color Filters
        if (editFilter === "grayscale") {
          const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
          r = luma;
          g = luma;
          b = luma;
        } else if (editFilter === "bw") {
          const luma = (r * 77 + g * 150 + b * 29) >> 8;
          const v = luma > 140 ? 255 : 0;
          r = v;
          g = v;
          b = v;
        } else if (editFilter === "document" || editFilter === "magic") {
          // Document whitening + crisp text
          r = Math.min(255, Math.max(0, (r - 128) * 1.3 + 128 + 10));
          g = Math.min(255, Math.max(0, (g - 128) * 1.3 + 128 + 10));
          b = Math.min(255, Math.max(0, (b - 128) * 1.3 + 128 + 10));
          const luma = (r * 77 + g * 150 + b * 29) >> 8;
          if (luma > 180) {
            const boost = (luma - 180) * 0.9;
            r = Math.min(255, r + boost);
            g = Math.min(255, g + boost);
            b = Math.min(255, b + boost);
          }
        }

        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
      }

      // 5. Sharpen kernel (3x3 convolution) if enabled
      if (editSharpen) {
        const copy = new Uint8ClampedArray(data);
        const stride = targetW * 4;
        for (let y = 1; y < targetH - 1; y++) {
          for (let x = 1; x < targetW - 1; x++) {
            const idx = y * stride + x * 4;
            for (let c = 0; c < 3; c++) {
              const center = copy[idx + c];
              const top = copy[idx - stride + c];
              const bot = copy[idx + stride + c];
              const left = copy[idx - 4 + c];
              const right = copy[idx + 4 + c];
              const sharpVal = 5 * center - (top + bot + left + right);
              data[idx + c] = Math.min(255, Math.max(0, sharpVal));
            }
          }
        }
      }

      ctx.putImageData(imgData, 0, 0);
    },
    [editRotation, editFlipH, editFlipV, editBrightness, editContrast, editSaturation, editSharpen, editFilter]
  );

  // Trigger editor canvas update on changes
  useEffect(() => {
    if (currentStep === "editor" && currentEditingItem) {
      renderEditorPreviewCanvas(currentEditingItem.originalExportUrl);
    }
  }, [currentStep, currentEditingItem, renderEditorPreviewCanvas]);

  // Save changes from Editor
  const handleSaveEditorChanges = async (applyToAll: boolean = false) => {
    if (!currentEditingItem) return;

    try {
      const canvas = editorCanvasRef.current;
      if (!canvas) return;

      let finalCanvas = canvas;

      // Handle crop if active
      if (isCropMode && cropBox.w < 0.98 && cropBox.h < 0.98) {
        const cropW = Math.max(10, Math.round(canvas.width * cropBox.w));
        const cropH = Math.max(10, Math.round(canvas.height * cropBox.h));
        const cropX = Math.max(0, Math.round(canvas.width * cropBox.x));
        const cropY = Math.max(0, Math.round(canvas.height * cropBox.y));

        const cropped = document.createElement("canvas");
        cropped.width = cropW;
        cropped.height = cropH;
        const cCtx = cropped.getContext("2d");
        if (cCtx) {
          cCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
          finalCanvas = cropped;
        }
      }

      const mime = outputFormat === "jpeg" ? "image/jpeg" : "image/png";
      const qualityNum = jpegQuality / 100;
      const updatedDataUrl = finalCanvas.toDataURL(mime, qualityNum);
      const byteLength = Math.round((updatedDataUrl.length - updatedDataUrl.indexOf(",") - 1) * 0.75);

      if (applyToAll) {
        // Apply adjustments to all images in gallery
        const updatedList: JPEGResultItem[] = [];
        for (const item of exportedImages) {
          // Render item with these exact parameters
          const tempCanvas = document.createElement("canvas");
          const tempCtx = tempCanvas.getContext("2d");
          const img = new Image();
          await new Promise<void>((res) => {
            img.onload = () => res();
            img.src = item.originalExportUrl;
          });

          const isRot = editRotation === 90 || editRotation === 270;
          const tW = isRot ? img.naturalHeight : img.naturalWidth;
          const tH = isRot ? img.naturalWidth : img.naturalHeight;
          tempCanvas.width = tW;
          tempCanvas.height = tH;

          if (tempCtx) {
            tempCtx.fillStyle = "#ffffff";
            tempCtx.fillRect(0, 0, tW, tH);
            tempCtx.translate(tW / 2, tH / 2);
            tempCtx.rotate((editRotation * Math.PI) / 180);
            tempCtx.scale(editFlipH ? -1 : 1, editFlipV ? -1 : 1);
            tempCtx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

            // Apply filter logic
            const dataUrlBatch = tempCanvas.toDataURL(mime, qualityNum);
            const bSize = Math.round((dataUrlBatch.length - dataUrlBatch.indexOf(",") - 1) * 0.75);

            updatedList.push({
              ...item,
              dataUrl: dataUrlBatch,
              width: tW,
              height: tH,
              fileSizeBytes: bSize,
              rotation: editRotation,
              flipH: editFlipH,
              flipV: editFlipV,
              brightness: editBrightness,
              contrast: editContrast,
              saturation: editSaturation,
              sharpen: editSharpen,
              filter: editFilter,
            });
          } else {
            updatedList.push(item);
          }
        }
        setExportedImages(updatedList);
        showToast("Đã áp dụng các hiệu ứng cho tất cả các trang ảnh!");
      } else {
        // Single update
        setExportedImages((prev) =>
          prev.map((item) =>
            item.id === currentEditingItem.id
              ? {
                  ...item,
                  dataUrl: updatedDataUrl,
                  width: finalCanvas.width,
                  height: finalCanvas.height,
                  fileSizeBytes: byteLength,
                  rotation: editRotation,
                  flipH: editFlipH,
                  flipV: editFlipV,
                  brightness: editBrightness,
                  contrast: editContrast,
                  saturation: editSaturation,
                  sharpen: editSharpen,
                  filter: editFilter,
                }
              : item
          )
        );
        showToast(`Đã lưu thay đổi cho trang ${currentEditingItem.originalPageNumber}!`);
      }

      setCurrentStep("gallery");
    } catch (e) {
      console.error("Save editor error:", e);
      showToast("Lỗi khi áp dụng chỉnh sửa.");
    }
  };

  // Delete an image from gallery
  const handleDeleteImage = (id: string) => {
    setExportedImages((prev) => prev.filter((img) => img.id !== id));
    setSelectedImageIds((prev) => prev.filter((i) => i !== id));
    showToast("Đã xóa ảnh.");
  };

  // Reorder images (move up/down)
  const handleMoveImage = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= exportedImages.length) return;

    setExportedImages((prev) => {
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy;
    });
  };

  // Single file download
  const handleDownloadSingle = (item: JPEGResultItem) => {
    const link = document.createElement("a");
    link.href = item.dataUrl;
    link.download = item.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Đang tải xuống: ${item.fileName}`);
  };

  // Download all as ZIP
  const handleDownloadAllZip = async () => {
    if (exportedImages.length === 0) return;

    try {
      showToast("Đang đóng gói file ZIP...");
      const zip = new JSZip();
      const folderName = pdfFileName ? pdfFileName.replace(/\.pdf$/i, "") : "VietScan_PDF_to_JPEG";

      for (let i = 0; i < exportedImages.length; i++) {
        const item = exportedImages[i];
        const base64Data = item.dataUrl.split(",")[1];
        zip.file(item.fileName, base64Data, { base64: true });
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const now = new Date();
      const day = String(now.getDate()).padStart(2, "0");
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const year = String(now.getFullYear()).slice(-2);
      const hours = String(now.getHours()).padStart(2, "0");
      const mins = String(now.getMinutes()).padStart(2, "0");
      const secs = String(now.getSeconds()).padStart(2, "0");

      const zipName = `${folderName}_JPEG_${day}_${month}_${year}_${hours}_${mins}_${secs}.zip`;

      const link = document.createElement("a");
      link.href = URL.createObjectURL(zipBlob);
      link.download = zipName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      showToast(`Đã tải xuống file ZIP: ${zipName}`);
    } catch (e) {
      console.error("ZIP download error:", e);
      showToast("Không thể tạo file ZIP. Vui lòng thử tải từng ảnh.");
    }
  };

  // Share via Web Share API
  const handleShareImages = async () => {
    if (exportedImages.length === 0) return;

    try {
      const filesToShare: File[] = [];
      for (const item of exportedImages) {
        const res = await fetch(item.dataUrl);
        const blob = await res.blob();
        const file = new File([blob], item.fileName, { type: outputFormat === "jpeg" ? "image/jpeg" : "image/png" });
        filesToShare.push(file);
      }

      if (navigator.canShare && navigator.canShare({ files: filesToShare })) {
        await navigator.share({
          title: "VietScan - PDF to JPEG",
          text: `Chia sẻ ${filesToShare.length} ảnh JPEG trích xuất từ ${pdfFileName}`,
          files: filesToShare,
        });
      } else if (navigator.share) {
        await navigator.share({
          title: "VietScan - PDF to JPEG",
          text: `Đã xuất ${exportedImages.length} ảnh từ ${pdfFileName}`,
        });
      } else {
        handleDownloadAllZip();
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        console.warn("Share error, falling back to ZIP:", e);
        handleDownloadAllZip();
      }
    }
  };

  // Save to App Documents Library
  const handleSaveToDocuments = async () => {
    if (exportedImages.length === 0) return;

    try {
      const docTitle = generateDefaultDocumentTitle("document");
      const scannedPages: ScannedPage[] = exportedImages.map((item, idx) => ({
        id: `page_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 4)}`,
        originalImage: item.originalExportUrl,
        processedImage: item.dataUrl,
        quad: {
          topLeft: { x: 0, y: 0 },
          topRight: { x: item.width, y: 0 },
          bottomRight: { x: item.width, y: item.height },
          bottomLeft: { x: 0, y: item.height },
        },
        filter: (item.filter as any) || "document",
        rotation: item.rotation || 0,
        createdAt: Date.now(),
        width: item.width,
        height: item.height,
      }));

      const newDoc: ScannedDocument = {
        id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        title: docTitle,
        category: "document",
        pages: scannedPages,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        thumbnail: scannedPages[0].processedImage,
        notes: `Trích xuất từ file PDF: ${pdfFileName} (${scannedPages.length} ảnh)`,
      };

      await StorageService.saveDocument(newDoc);
      setIsSavedToApp(true);
      if (onSavedToDocuments) {
        onSavedToDocuments(newDoc);
      }
      showToast("Đã lưu thành công vào Thư viện Tài liệu của ứng dụng!");
    } catch (e) {
      console.error("Save to storage error:", e);
      showToast("Lỗi khi lưu vào Thư viện tài liệu.");
    }
  };

  // Quick select from existing app documents if they contain pages
  const handlePickFromAppDocs = async (doc: ScannedDocument) => {
    if (!doc.pages || doc.pages.length === 0) {
      showToast("Tài liệu không có trang nào.");
      return;
    }

    try {
      setIsLoadingPdf(true);
      setErrorMsg(null);
      // Construct images directly into gallery
      const results: JPEGResultItem[] = doc.pages.map((p, idx) => {
        const byteLength = Math.round((p.processedImage.length - p.processedImage.indexOf(",") - 1) * 0.75);
        return {
          id: `app_doc_${Date.now()}_${idx}`,
          pageNumber: idx + 1,
          originalPageNumber: idx + 1,
          dataUrl: p.processedImage,
          originalExportUrl: p.originalImage || p.processedImage,
          width: p.width || 1200,
          height: p.height || 1600,
          fileSizeBytes: byteLength,
          fileName: generatePdfToJpegFileName(idx + 1, "jpg"),
          rotation: p.rotation || 0,
          flipH: false,
          flipV: false,
          brightness: 0,
          contrast: 0,
          saturation: 0,
          sharpen: false,
          filter: (p.filter as any) || "original",
        };
      });

      setPdfFileName(`${doc.title}.pdf`);
      setExportedImages(results);
      setSelectedImageIds(results.map((r) => r.id));
      setIsSavedToApp(true);
      setCurrentStep("gallery");
      showToast(`Đã tải ${results.length} trang từ "${doc.title}"!`);
    } catch (e) {
      console.error("Pick app doc error:", e);
      showToast("Không thể tải tài liệu này.");
    } finally {
      setIsLoadingPdf(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-slate-100 overflow-hidden select-none animate-in fade-in duration-200">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-2xl bg-blue-600/95 backdrop-blur-md text-white text-xs font-semibold shadow-2xl border border-blue-400/30 flex items-center gap-2 animate-in slide-in-from-top duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Hidden PDF File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileSelected(file);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }}
        className="hidden"
      />

      {/* ========================================================
          STEP 1: SELECT PDF & CONFIGURE EXPORT OPTIONS
      ======================================================== */}
      {currentStep === "select" && (
        <div className="flex flex-col h-full overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md shrink-0">
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 text-white shadow-sm">
                  <FileImage className="w-5 h-5" />
                </div>
                <div>
                  <h1 className="text-base font-bold text-white flex items-center gap-2">
                    PDF to JPEG
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                      Chất lượng cao
                    </span>
                  </h1>
                  <p className="text-[11px] text-slate-400">Chuyển từng trang PDF thành ảnh JPEG sắc nét</p>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto px-4 py-4 max-w-4xl mx-auto w-full space-y-5">
            {/* Upload Drag & Drop Area */}
            {!pdfFile && (
              <div className="space-y-4">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="group relative flex flex-col items-center justify-center p-8 rounded-3xl border-2 border-dashed border-slate-700 hover:border-cyan-500 bg-slate-900/60 hover:bg-slate-900/90 transition duration-300 cursor-pointer text-center"
                >
                  <div className="p-4 rounded-2xl bg-cyan-500/10 text-cyan-400 group-hover:scale-110 group-hover:bg-cyan-500 group-hover:text-white transition duration-300 mb-4 shadow-lg shadow-cyan-500/10">
                    <Upload className="w-8 h-8" />
                  </div>
                  <h3 className="text-base font-bold text-white mb-1">Chọn file PDF từ thiết bị</h3>
                  <p className="text-xs text-slate-400 max-w-sm mb-4">
                    Nhấp vào đây hoặc kéo thả file PDF vào để trích xuất toàn bộ các trang thành ảnh JPEG chất lượng cao
                  </p>
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-md shadow-cyan-600/30 transition">
                    <FileImage className="w-4 h-4" />
                    <span>Duyệt tệp PDF</span>
                  </div>
                </div>

                {/* Pick from saved documents if available */}
                {availableSavedDocs.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                      <FolderPlus className="w-3.5 h-3.5 text-blue-400" />
                      Hoặc chọn từ Tài liệu đã lưu trong app:
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {availableSavedDocs.slice(0, 6).map((doc) => (
                        <button
                          key={doc.id}
                          onClick={() => handlePickFromAppDocs(doc)}
                          className="flex items-center gap-3 p-3 rounded-2xl bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-cyan-500/40 text-left transition group"
                        >
                          <div className="w-10 h-12 rounded-lg bg-slate-800 overflow-hidden shrink-0 border border-slate-700">
                            {doc.thumbnail ? (
                              <img src={doc.thumbnail} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-500">
                                <FileText className="w-4 h-4" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-white truncate group-hover:text-cyan-400 transition">
                              {doc.title}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5">{doc.pages.length} trang</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Error Message */}
            {errorMsg && (
              <div className="flex items-center gap-2.5 p-3 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Loading Indicator */}
            {isLoadingPdf && (
              <div className="flex flex-col items-center justify-center p-12 space-y-3">
                <div className="w-8 h-8 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin" />
                <p className="text-xs text-slate-300 font-medium">Đang đọc cấu trúc và kết xuất trang PDF...</p>
              </div>
            )}

            {/* Loaded PDF & Options */}
            {pdfFile && !isLoadingPdf && pageThumbnails.length > 0 && (
              <div className="space-y-5 animate-in fade-in duration-200">
                {/* File Info Bar */}
                <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2.5 rounded-xl bg-red-500/10 text-red-400 shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-white truncate">{pdfFileName}</h3>
                      <p className="text-xs text-slate-400">
                        {pdfTotalPages} trang • {formatBytes(pdfFile.size)}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setPdfFile(null);
                      setPageThumbnails([]);
                      setSelectedPageNumbers([]);
                    }}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition"
                  >
                    Đổi file
                  </button>
                </div>

                {/* Export Quality & DPI Settings */}
                <div className="p-4 rounded-3xl bg-slate-900 border border-slate-800 space-y-4">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                    Tùy chọn xuất ảnh
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* DPI Resolution Preset */}
                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1.5">Độ phân giải (DPI):</label>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          onClick={() => setDpiPreset("100")}
                          className={`px-2.5 py-2 rounded-xl text-xs font-semibold transition ${
                            dpiPreset === "100"
                              ? "bg-cyan-600 text-white shadow-sm"
                              : "bg-slate-800 hover:bg-slate-750 text-slate-300"
                          }`}
                        >
                          100 DPI (Màn hình)
                        </button>
                        <button
                          onClick={() => setDpiPreset("150")}
                          className={`px-2.5 py-2 rounded-xl text-xs font-semibold transition ${
                            dpiPreset === "150"
                              ? "bg-cyan-600 text-white shadow-sm"
                              : "bg-slate-800 hover:bg-slate-750 text-slate-300"
                          }`}
                        >
                          150 DPI (Khuyên dùng)
                        </button>
                        <button
                          onClick={() => setDpiPreset("200")}
                          className={`px-2.5 py-2 rounded-xl text-xs font-semibold transition ${
                            dpiPreset === "200"
                              ? "bg-cyan-600 text-white shadow-sm"
                              : "bg-slate-800 hover:bg-slate-750 text-slate-300"
                          }`}
                        >
                          200 DPI (Nét cao)
                        </button>
                        <button
                          onClick={() => setDpiPreset("300")}
                          className={`px-2.5 py-2 rounded-xl text-xs font-semibold transition ${
                            dpiPreset === "300"
                              ? "bg-cyan-600 text-white shadow-sm"
                              : "bg-slate-800 hover:bg-slate-750 text-slate-300"
                          }`}
                        >
                          300 DPI (Chuẩn in ấn)
                        </button>
                      </div>
                    </div>

                    {/* JPEG Quality Slider */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-semibold text-slate-300">Chất lượng nén:</label>
                        <span className="text-xs font-bold text-cyan-400">{jpegQuality}%</span>
                      </div>
                      <input
                        type="range"
                        min="60"
                        max="100"
                        step="5"
                        value={jpegQuality}
                        onChange={(e) => setJpegQuality(parseInt(e.target.value, 10))}
                        className="w-full accent-cyan-500 cursor-pointer h-2 bg-slate-800 rounded-lg appearance-none"
                      />
                      <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                        <span>Nhẹ (60%)</span>
                        <span>Chuẩn (85%)</span>
                        <span>Gốc (100%)</span>
                      </div>
                    </div>

                    {/* Output format */}
                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1.5">Định dạng tệp:</label>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          onClick={() => setOutputFormat("jpeg")}
                          className={`px-3 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                            outputFormat === "jpeg"
                              ? "bg-cyan-600 text-white shadow-sm"
                              : "bg-slate-800 hover:bg-slate-750 text-slate-300"
                          }`}
                        >
                          <FileImage className="w-3.5 h-3.5" />
                          <span>JPEG (.jpg)</span>
                        </button>
                        <button
                          onClick={() => setOutputFormat("png")}
                          className={`px-3 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                            outputFormat === "png"
                              ? "bg-cyan-600 text-white shadow-sm"
                              : "bg-slate-800 hover:bg-slate-750 text-slate-300"
                          }`}
                        >
                          <FileImage className="w-3.5 h-3.5" />
                          <span>PNG (.png)</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Page Selection Grid */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                        Chọn trang cần xuất ({selectedPageNumbers.length}/{pageThumbnails.length})
                      </h3>
                    </div>
                    <button
                      onClick={handleSelectAllPages}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-400 text-xs font-semibold transition"
                    >
                      {selectedPageNumbers.length === pageThumbnails.length ? (
                        <>
                          <Square className="w-3.5 h-3.5" />
                          <span>Bỏ chọn tất cả</span>
                        </>
                      ) : (
                        <>
                          <CheckSquare className="w-3.5 h-3.5" />
                          <span>Chọn tất cả trang</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {pageThumbnails.map((p) => {
                      const isSelected = selectedPageNumbers.includes(p.pageNumber);
                      return (
                        <div
                          key={p.pageNumber}
                          onClick={() => handleTogglePage(p.pageNumber)}
                          className={`group relative flex flex-col p-2.5 rounded-2xl border transition cursor-pointer select-none ${
                            isSelected
                              ? "bg-slate-900 border-cyan-500 shadow-md shadow-cyan-500/10"
                              : "bg-slate-900/60 border-slate-800 opacity-60 hover:opacity-100"
                          }`}
                        >
                          {/* Selection Checkmark */}
                          <div
                            className={`absolute top-4 right-4 z-10 w-6 h-6 rounded-full flex items-center justify-center shadow-md transition ${
                              isSelected
                                ? "bg-cyan-500 text-white ring-2 ring-slate-950"
                                : "bg-slate-800 text-slate-400 border border-slate-700"
                            }`}
                          >
                            {isSelected ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : null}
                          </div>

                          {/* Thumbnail preview */}
                          <div className="relative w-full aspect-[1/1.414] rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center mb-2">
                            <img
                              src={p.thumbnailUrl}
                              alt={`Trang ${p.pageNumber}`}
                              className="w-full h-full object-contain"
                              loading="lazy"
                            />
                          </div>

                          {/* Page Info */}
                          <div className="flex items-center justify-between text-xs px-1">
                            <span className="font-bold text-white">Trang {p.pageNumber}</span>
                            <span className="text-[10px] text-slate-400">
                              {p.originalWidth}×{p.originalHeight}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Action Footer */}
          {pdfFile && !isLoadingPdf && (
            <div className="p-4 border-t border-slate-800 bg-slate-900/90 backdrop-blur-md shrink-0 flex items-center justify-between gap-3 max-w-4xl mx-auto w-full">
              <div className="text-xs text-slate-400">
                Đã chọn: <span className="font-bold text-white">{selectedPageNumbers.length}</span> trang • Định dạng:{" "}
                <span className="font-bold text-cyan-400 uppercase">{outputFormat}</span>
              </div>

              <button
                id="btn-execute-pdf-to-jpeg"
                onClick={handleExecuteExport}
                disabled={selectedPageNumbers.length === 0}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-40 disabled:pointer-events-none text-white text-sm font-bold shadow-lg shadow-cyan-600/25 active:scale-95 transition"
              >
                <Sparkles className="w-4 h-4 text-cyan-200" />
                <span>XUẤT {selectedPageNumbers.length} ẢNH {outputFormat.toUpperCase()}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ========================================================
          STEP 2: PROCESSING CONVERSION MODAL
      ======================================================== */}
      {currentStep === "processing" && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto">
          <div className="relative w-20 h-20 mb-6 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-4 border-cyan-500/20" />
            <div
              className="absolute inset-0 rounded-full border-4 border-cyan-500 border-t-transparent animate-spin"
            />
            <FileImage className="w-8 h-8 text-cyan-400" />
          </div>

          <h2 className="text-xl font-bold text-white mb-2">Đang xuất ảnh {outputFormat.toUpperCase()}</h2>
          <p className="text-xs text-slate-400 mb-6">
            Đang kết xuất trang {exportProgress.current} trên tổng số {exportProgress.total} trang ({exportProgress.percent}%)
          </p>

          {/* Progress Bar */}
          <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden mb-3 border border-slate-700">
            <div
              className="bg-gradient-to-r from-cyan-500 to-blue-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${exportProgress.percent}%` }}
            />
          </div>

          <p className="text-[11px] text-slate-500">
            Xử lý 100% Offline trên thiết bị của bạn với độ nét cao ({dpiPreset} DPI)
          </p>
        </div>
      )}

      {/* ========================================================
          STEP 3: EXPORTED IMAGES GALLERY & ACTIONS
      ======================================================== */}
      {currentStep === "gallery" && (
        <div className="flex flex-col h-full overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md shrink-0">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCurrentStep("select")}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-base font-bold text-white flex items-center gap-2">
                  Danh sách ảnh {outputFormat.toUpperCase()}
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    {exportedImages.length} ảnh
                  </span>
                </h1>
                <p className="text-[11px] text-slate-400">Xem, chỉnh sửa từng ảnh, lưu vào app hoặc tải file ZIP</p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Quick Actions Top Bar */}
          <div className="px-4 py-2.5 bg-slate-900/60 border-b border-slate-800/80 flex items-center justify-between flex-wrap gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <button
                id="btn-save-to-app-docs"
                onClick={handleSaveToDocuments}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition shadow-sm ${
                  isSavedToApp
                    ? "bg-emerald-600 text-white"
                    : "bg-blue-600 hover:bg-blue-500 text-white"
                }`}
              >
                {isSavedToApp ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Đã lưu vào Tài liệu</span>
                  </>
                ) : (
                  <>
                    <FolderPlus className="w-3.5 h-3.5" />
                    <span>Lưu vào Tài liệu</span>
                  </>
                )}
              </button>

              <button
                id="btn-download-all-zip"
                onClick={handleDownloadAllZip}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-white text-xs font-bold border border-slate-700 transition"
              >
                <FileArchive className="w-3.5 h-3.5 text-amber-400" />
                <span>Tải toàn bộ (.ZIP)</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                id="btn-share-all-images"
                onClick={handleShareImages}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition shadow-sm"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Chia sẻ</span>
              </button>
            </div>
          </div>

          {/* Image Grid */}
          <div className="flex-1 overflow-y-auto p-4 max-w-5xl mx-auto w-full">
            {exportedImages.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-center text-slate-400">
                <FileImage className="w-12 h-12 text-slate-600 mb-3" />
                <p className="text-sm font-semibold">Chưa có ảnh nào trong danh sách</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {exportedImages.map((img, index) => (
                  <div
                    key={img.id}
                    className="group relative flex flex-col rounded-3xl bg-slate-900 border border-slate-800 overflow-hidden shadow-lg hover:border-slate-700 transition"
                  >
                    {/* Header bar with page label and index */}
                    <div className="flex items-center justify-between px-3 py-2 bg-slate-950/60 border-b border-slate-800 text-xs">
                      <span className="font-bold text-white">Trang {img.originalPageNumber}</span>
                      <span className="text-[10px] text-slate-400">
                        {img.width}×{img.height} • {formatBytes(img.fileSizeBytes)}
                      </span>
                    </div>

                    {/* Image Preview Canvas / Image Box */}
                    <div
                      onClick={() => setPreviewZoomImage(img)}
                      className="relative w-full aspect-[1/1.414] bg-slate-950 p-2 flex items-center justify-center cursor-pointer group-hover:bg-slate-900 transition overflow-hidden"
                    >
                      <img
                        src={img.dataUrl}
                        alt={`Trang ${img.originalPageNumber}`}
                        className="w-full h-full object-contain drop-shadow-md group-hover:scale-[1.02] transition duration-200"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition gap-2">
                        <span className="p-2 rounded-full bg-slate-900/90 text-white">
                          <Maximize2 className="w-4 h-4" />
                        </span>
                      </div>
                    </div>

                    {/* Action Bar below Image */}
                    <div className="p-2.5 bg-slate-900 border-t border-slate-800/80 flex items-center justify-between gap-1">
                      {/* Left: Reorder buttons */}
                      <div className="flex items-center gap-0.5">
                        <button
                          disabled={index === 0}
                          onClick={() => handleMoveImage(index, "up")}
                          title="Chuyển lên trước"
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none text-slate-300 hover:text-white transition"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          disabled={index === exportedImages.length - 1}
                          onClick={() => handleMoveImage(index, "down")}
                          title="Chuyển xuống sau"
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none text-slate-300 hover:text-white transition"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Right: Edit, Download, Delete */}
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleOpenEditor(img)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-cyan-600/20 hover:bg-cyan-600 text-cyan-400 hover:text-white text-xs font-semibold transition"
                        >
                          <Sliders className="w-3.5 h-3.5" />
                          <span>Sửa</span>
                        </button>

                        <button
                          onClick={() => handleDownloadSingle(img)}
                          title="Tải ảnh này về máy"
                          className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => handleDeleteImage(img.id)}
                          title="Xóa ảnh này"
                          className="p-1.5 rounded-xl bg-slate-800 hover:bg-rose-600 text-slate-400 hover:text-white transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================
          STEP 4: FULL-SCREEN INTERACTIVE IMAGE EDITOR
      ======================================================== */}
      {currentStep === "editor" && currentEditingItem && (
        <div className="flex flex-col h-full bg-slate-950 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md shrink-0">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCurrentStep("gallery")}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-sm font-bold text-white flex items-center gap-2">
                  Chỉnh sửa ảnh Trang {currentEditingItem.originalPageNumber}
                </h1>
                <p className="text-[10px] text-slate-400">Xoay, lật, cắt, điều chỉnh độ sáng, tương phản & bộ lọc</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setEditRotation(0);
                  setEditFlipH(false);
                  setEditFlipV(false);
                  setEditBrightness(0);
                  setEditContrast(0);
                  setEditSaturation(0);
                  setEditSharpen(false);
                  setEditFilter("original");
                  setIsCropMode(false);
                }}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition"
              >
                <Undo className="w-3.5 h-3.5" />
                <span>Đặt lại</span>
              </button>

              <button
                id="btn-save-single-image"
                onClick={() => handleSaveEditorChanges(false)}
                className="px-4 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-md shadow-cyan-600/30 flex items-center gap-1.5 transition"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Lưu ảnh này</span>
              </button>
            </div>
          </div>

          {/* Editor Body: Canvas & Controls */}
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            {/* Center Canvas Area */}
            <div
              ref={editorContainerRef}
              className="flex-1 relative flex items-center justify-center p-4 bg-slate-950 overflow-hidden select-none"
            >
              <div className="relative max-w-full max-h-full flex items-center justify-center">
                <canvas
                  ref={editorCanvasRef}
                  className="max-w-full max-h-[65vh] object-contain rounded-xl shadow-2xl border border-slate-800"
                />

                {/* Interactive Crop Box Overlay */}
                {isCropMode && (
                  <div
                    className="absolute inset-0 pointer-events-auto border-2 border-cyan-400 bg-cyan-500/10 shadow-2xl"
                    style={{
                      left: `${cropBox.x * 100}%`,
                      top: `${cropBox.y * 100}%`,
                      width: `${cropBox.w * 100}%`,
                      height: `${cropBox.h * 100}%`,
                    }}
                  >
                    {/* Corner Grips */}
                    <div className="absolute -top-2 -left-2 w-4 h-4 rounded-full bg-cyan-400 border-2 border-white shadow" />
                    <div className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-cyan-400 border-2 border-white shadow" />
                    <div className="absolute -bottom-2 -left-2 w-4 h-4 rounded-full bg-cyan-400 border-2 border-white shadow" />
                    <div className="absolute -bottom-2 -right-2 w-4 h-4 rounded-full bg-cyan-400 border-2 border-white shadow" />
                  </div>
                )}
              </div>
            </div>

            {/* Right/Bottom Controls Panel */}
            <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-slate-800 bg-slate-900/90 overflow-y-auto p-4 space-y-5 shrink-0">
              {/* Rotation & Flip Controls */}
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">
                  Xoay & Lật ảnh
                </h3>
                <div className="grid grid-cols-4 gap-2">
                  <button
                    onClick={() => setEditRotation((prev) => (prev - 90 + 360) % 360)}
                    className="p-2.5 rounded-2xl bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition"
                  >
                    <RotateCcw className="w-4 h-4 text-cyan-400" />
                    <span>Xoay trái</span>
                  </button>

                  <button
                    onClick={() => setEditRotation((prev) => (prev + 90) % 360)}
                    className="p-2.5 rounded-2xl bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition"
                  >
                    <RotateCw className="w-4 h-4 text-cyan-400" />
                    <span>Xoay phải</span>
                  </button>

                  <button
                    onClick={() => setEditFlipH((prev) => !prev)}
                    className={`p-2.5 rounded-2xl flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition ${
                      editFlipH ? "bg-cyan-600 text-white" : "bg-slate-800 hover:bg-slate-750 text-slate-300"
                    }`}
                  >
                    <FlipHorizontal className="w-4 h-4" />
                    <span>Lật ngang</span>
                  </button>

                  <button
                    onClick={() => setEditFlipV((prev) => !prev)}
                    className={`p-2.5 rounded-2xl flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition ${
                      editFlipV ? "bg-cyan-600 text-white" : "bg-slate-800 hover:bg-slate-750 text-slate-300"
                    }`}
                  >
                    <FlipVertical className="w-4 h-4" />
                    <span>Lật dọc</span>
                  </button>
                </div>
              </div>

              {/* Crop Tool Toggle */}
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">
                  Cắt khung ảnh (Crop)
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsCropMode((prev) => !prev)}
                    className={`flex-1 py-2 px-3 rounded-2xl flex items-center justify-center gap-2 text-xs font-bold transition ${
                      isCropMode
                        ? "bg-cyan-600 text-white shadow-md shadow-cyan-600/30"
                        : "bg-slate-800 hover:bg-slate-750 text-slate-300"
                    }`}
                  >
                    <Crop className="w-4 h-4" />
                    <span>{isCropMode ? "Đang bật chế độ Cắt" : "Bật cắt ảnh"}</span>
                  </button>

                  {isCropMode && (
                    <button
                      onClick={() => setCropBox({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 })}
                      className="px-3 py-2 rounded-2xl bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-semibold"
                    >
                      Toàn cảnh
                    </button>
                  )}
                </div>
              </div>

              {/* Brightness, Contrast, Saturation Sliders */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Điều chỉnh ánh sáng & màu
                </h3>

                {/* Brightness */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-300 flex items-center gap-1.5">
                      <Sun className="w-3.5 h-3.5 text-amber-400" />
                      Độ sáng
                    </span>
                    <span className="font-mono text-cyan-400">{editBrightness > 0 ? `+${editBrightness}` : editBrightness}</span>
                  </div>
                  <input
                    type="range"
                    min="-80"
                    max="80"
                    value={editBrightness}
                    onChange={(e) => setEditBrightness(parseInt(e.target.value, 10))}
                    className="w-full accent-cyan-500 cursor-pointer h-2 bg-slate-800 rounded-lg appearance-none"
                  />
                </div>

                {/* Contrast */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-300 flex items-center gap-1.5">
                      <Contrast className="w-3.5 h-3.5 text-indigo-400" />
                      Độ tương phản
                    </span>
                    <span className="font-mono text-cyan-400">{editContrast > 0 ? `+${editContrast}` : editContrast}</span>
                  </div>
                  <input
                    type="range"
                    min="-80"
                    max="80"
                    value={editContrast}
                    onChange={(e) => setEditContrast(parseInt(e.target.value, 10))}
                    className="w-full accent-cyan-500 cursor-pointer h-2 bg-slate-800 rounded-lg appearance-none"
                  />
                </div>

                {/* Saturation */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-300 flex items-center gap-1.5">
                      <Palette className="w-3.5 h-3.5 text-pink-400" />
                      Độ bão hòa màu
                    </span>
                    <span className="font-mono text-cyan-400">{editSaturation > 0 ? `+${editSaturation}` : editSaturation}</span>
                  </div>
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    value={editSaturation}
                    onChange={(e) => setEditSaturation(parseInt(e.target.value, 10))}
                    className="w-full accent-cyan-500 cursor-pointer h-2 bg-slate-800 rounded-lg appearance-none"
                  />
                </div>

                {/* Sharpen Toggle */}
                <div className="pt-1">
                  <button
                    onClick={() => setEditSharpen((prev) => !prev)}
                    className={`w-full py-2 px-3 rounded-2xl flex items-center justify-between text-xs font-semibold transition ${
                      editSharpen
                        ? "bg-cyan-600/30 text-cyan-300 border border-cyan-500/40"
                        : "bg-slate-800 hover:bg-slate-750 text-slate-300"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      Làm sắc nét chữ (Sharpen)
                    </span>
                    <span className="text-[10px] font-bold uppercase">{editSharpen ? "BẬT" : "TẮT"}</span>
                  </button>
                </div>
              </div>

              {/* Filter Presets */}
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">
                  Bộ lọc màu
                </h3>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { id: "original", label: "Ảnh gốc" },
                    { id: "document", label: "Văn bản nét" },
                    { id: "bw", label: "Trắng đen" },
                    { id: "grayscale", label: "Xám mượt" },
                    { id: "magic", label: "Tăng cường" },
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setEditFilter(f.id as any)}
                      className={`px-2 py-2 rounded-xl text-xs font-semibold transition ${
                        editFilter === f.id
                          ? "bg-cyan-600 text-white shadow-sm"
                          : "bg-slate-800 hover:bg-slate-750 text-slate-300"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bulk Apply to all button */}
              <div className="pt-2 border-t border-slate-800">
                <button
                  onClick={() => handleSaveEditorChanges(true)}
                  className="w-full py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-750 text-cyan-400 text-xs font-bold border border-cyan-500/30 transition flex items-center justify-center gap-2"
                >
                  <Layers className="w-4 h-4" />
                  <span>Áp dụng cho tất cả các trang</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          ZOOM PREVIEW MODAL
      ======================================================== */}
      {previewZoomImage && (
        <div
          onClick={() => setPreviewZoomImage(null)}
          className="fixed inset-0 z-[80] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
            <button
              onClick={() => handleDownloadSingle(previewZoomImage)}
              className="p-2.5 rounded-full bg-slate-800 hover:bg-slate-700 text-white transition shadow-lg"
              title="Tải ảnh này"
            >
              <Download className="w-5 h-5" />
            </button>
            <button
              onClick={() => setPreviewZoomImage(null)}
              className="p-2.5 rounded-full bg-slate-800 hover:bg-slate-700 text-white transition shadow-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-4xl max-h-[85vh] flex flex-col items-center"
          >
            <img
              src={previewZoomImage.dataUrl}
              alt=""
              className="max-w-full max-h-[80vh] object-contain rounded-2xl shadow-2xl"
            />
            <p className="text-xs text-slate-300 font-semibold mt-3">
              Trang {previewZoomImage.originalPageNumber} • {previewZoomImage.width}×{previewZoomImage.height} px •{" "}
              {formatBytes(previewZoomImage.fileSizeBytes)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
