import React, { useState, useRef, useEffect } from "react";
import {
  FileSignature,
  Upload,
  Download,
  Printer,
  X,
  Trash2,
  Square,
  Eye,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Highlighter,
  FileImage,
  Eraser,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  RotateCw,
  Move,
  CheckCircle2,
  ShieldAlert,
  Info,
  Target,
  Crosshair,
  Layers,
  ExternalLink,
} from "lucide-react";
import {
  PDFSignatureEngine,
  DetectedSignature,
  RedactBox,
  SignatureDetectionResult,
} from "../utils/pdfSignatureEngine";
import { generateDocumentFileName } from "../utils/naming";
import { StorageService } from "../utils/storage";
import { ScannedDocument } from "../types";

interface PDFSignatureModalProps {
  onClose: () => void;
  onOpenHighlightWithFile?: (file: File) => void;
  onOpenToJPEGWithFile?: (file: File) => void;
  onSaveToDocuments?: (doc: ScannedDocument) => void;
}

interface HistoryItem {
  signatures: DetectedSignature[];
  redactBoxes: RedactBox[];
  description: string;
}

export const PDFSignatureModal: React.FC<PDFSignatureModalProps> = ({
  onClose,
  onOpenHighlightWithFile,
  onOpenToJPEGWithFile,
  onSaveToDocuments,
}) => {
  // File & Detection State
  const [file, setFile] = useState<File | null>(null);
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingText, setLoadingText] = useState<string>("");
  const [detectionResult, setDetectionResult] = useState<SignatureDetectionResult | null>(null);
  const [detectedSignatures, setDetectedSignatures] = useState<DetectedSignature[]>([]);

  // History & Undo / Redo State
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  // Active view & tools
  const [activePageIndex, setActivePageIndex] = useState<number>(0);
  const [pageInputVal, setPageInputVal] = useState<string>("1");
  const [activeTool, setActiveTool] = useState<"view" | "eraser" | "redact">("eraser");
  const [redactColor, setRedactColor] = useState<"white" | "black" | "gray">("white");
  const [stripSignatures, setStripSignatures] = useState<boolean>(true);

  // Zoom & View state
  const [zoom, setZoom] = useState<number>(1.0);

  // Redaction / Erase boxes: Record<pageIndex, RedactBox[]>
  const [redactBoxes, setRedactBoxes] = useState<RedactBox[]>([]);

  // Selected box for repositioning / resizing
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    pageIndex: number;
    initialBox: RedactBox;
  } | null>(null);

  // Drawing state for eraser / redact
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [drawingPageIndex, setDrawingPageIndex] = useState<number | null>(null);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [currentBox, setCurrentBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Smart Corner Signature Eraser State
  const [smartCornerSnapped, setSmartCornerSnapped] = useState<{
    sigId: string;
    cornerName: string;
    pageIndex: number;
  } | null>(null);
  const [smartHoverCorner, setSmartHoverCorner] = useState<{
    sigId: string;
    cornerId: string;
  } | null>(null);

  // Processing & Export Result
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isDirectPrinting, setIsDirectPrinting] = useState<boolean>(false);
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [processedFileName, setProcessedFileName] = useState<string>("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState<boolean>(false);

  // Direct Print & Print Dialog State
  const [printPages, setPrintPages] = useState<string[]>([]);
  const [showPrintDialog, setShowPrintDialog] = useState<boolean>(false);
  const [directPrintBlob, setDirectPrintBlob] = useState<Blob | null>(null);
  const [directPrintUrl, setDirectPrintUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Clean up Object URLs
  useEffect(() => {
    return () => {
      if (processedUrl) {
        URL.revokeObjectURL(processedUrl);
      }
      if (directPrintUrl) {
        URL.revokeObjectURL(directPrintUrl);
      }
    };
  }, [processedUrl, directPrintUrl]);

  // Push new state snapshot to History
  const pushHistory = (
    newSignatures: DetectedSignature[],
    newBoxes: RedactBox[],
    description: string
  ) => {
    setDetectedSignatures(newSignatures);
    setRedactBoxes(newBoxes);

    setHistory((prev) => {
      const trimmed = historyIndex >= 0 ? prev.slice(0, historyIndex + 1) : [];
      const next = [
        ...trimmed,
        {
          signatures: JSON.parse(JSON.stringify(newSignatures)),
          redactBoxes: JSON.parse(JSON.stringify(newBoxes)),
          description,
        },
      ];
      setHistoryIndex(next.length - 1);
      return next;
    });
  };

  // Guaranteed resilient buffer resolver: never detached, always pristine
  const getSafeFileBuffer = async (): Promise<ArrayBuffer | null> => {
    if (fileBuffer) {
      try {
        new Uint8Array(fileBuffer, 0, 0);
        if (fileBuffer.byteLength > 0) {
          return fileBuffer.slice(0);
        }
      } catch {
        // Buffer was detached, recover from file below
      }
    }
    if (file) {
      try {
        const fresh = await file.arrayBuffer();
        setFileBuffer(fresh.slice(0));
        return fresh.slice(0);
      } catch (err) {
        console.error("Lỗi nạp lại ArrayBuffer từ file:", err);
      }
    }
    return null;
  };

  // Helper to re-render page previews based on currently erased/detached signatures
  // without any white boxes, preserving underlying text and adjacent/nested signatures!
  const refreshPagePreviewsForSigs = async (
    targetSigs: DetectedSignature[],
    pageIndicesToUpdate?: number[]
  ) => {
    if (!detectionResult) return;
    const activeBuffer = await getSafeFileBuffer();
    if (!activeBuffer) return;

    const pagesToRefresh =
      pageIndicesToUpdate && pageIndicesToUpdate.length > 0
        ? pageIndicesToUpdate
        : Array.from(new Set(targetSigs.map((s) => s.pageIndex)));

    const erasedIds = targetSigs.filter((s) => s.isErased).map((s) => s.id);

    try {
      const updatedPreviews = [...detectionResult.pagePreviews];

      for (const pIdx of pagesToRefresh) {
        if (pIdx >= 0 && pIdx < updatedPreviews.length) {
          const newUrl = await PDFSignatureEngine.renderCleanPagePreview({
            originalBuffer: activeBuffer,
            allSignatures: targetSigs,
            erasedSignatureIds: erasedIds,
            pageIndex: pIdx,
            scale: 1.8,
          });

          if (newUrl) {
            updatedPreviews[pIdx] = {
              ...updatedPreviews[pIdx],
              dataUrl: newUrl,
            };
          }
        }
      }

      setDetectionResult((prev) => (prev ? { ...prev, pagePreviews: updatedPreviews } : prev));
    } catch (err) {
      console.warn("Could not re-render clean preview:", err);
    }
  };

  // Undo (Back)
  const handleUndo = async () => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      const item = history[prevIndex];
      const nextSigs = JSON.parse(JSON.stringify(item.signatures));
      const nextBoxes = JSON.parse(JSON.stringify(item.redactBoxes));
      setDetectedSignatures(nextSigs);
      setRedactBoxes(nextBoxes);
      setHistoryIndex(prevIndex);
      setSelectedBoxId(null);
      showToast(`Đã hoàn tác (Back): ${history[historyIndex]?.description || ""}`);
      await refreshPagePreviewsForSigs(nextSigs);
    }
  };

  // Redo
  const handleRedo = async () => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      const item = history[nextIndex];
      const nextSigs = JSON.parse(JSON.stringify(item.signatures));
      const nextBoxes = JSON.parse(JSON.stringify(item.redactBoxes));
      setDetectedSignatures(nextSigs);
      setRedactBoxes(nextBoxes);
      setHistoryIndex(nextIndex);
      setSelectedBoxId(null);
      showToast(`Đã làm lại (Redo): ${item.description}`);
      await refreshPagePreviewsForSigs(nextSigs);
    }
  };

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex >= 0 && historyIndex < history.length - 1;

  // Keyboard shortcut listener (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z, Delete)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) return;

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        handleUndo();
      } else if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z")
      ) {
        e.preventDefault();
        handleRedo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedBoxId) {
        e.preventDefault();
        handleDeleteBox(selectedBoxId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [historyIndex, history, selectedBoxId]);

  // Load and analyze PDF file
  const handleSelectFile = async (selectedFile: File) => {
    if (!selectedFile.name.toLowerCase().endsWith(".pdf") && selectedFile.type !== "application/pdf") {
      showToast("Vui lòng chọn tệp định dạng PDF.");
      return;
    }

    setIsLoading(true);
    setLoadingText("Đang nạp tài liệu và quét Signature Field...");
    setFile(selectedFile);
    setProcessedBlob(null);
    setProcessedUrl(null);
    setRedactBoxes([]);
    setSelectedBoxId(null);
    setZoom(1.0);

    try {
      const buffer = await selectedFile.arrayBuffer();
      setFileBuffer(buffer.slice(0));

      const result = await PDFSignatureEngine.detectSignaturesAndRender(buffer.slice(0), 1.8);
      setDetectionResult(result);
      setDetectedSignatures(result.signatures);
      setActivePageIndex(0);

      // Initialize History Stack
      setHistory([
        {
          signatures: JSON.parse(JSON.stringify(result.signatures)),
          redactBoxes: [],
          description: "Trạng thái ban đầu",
        },
      ]);
      setHistoryIndex(0);

      // Default strip signatures to true
      setStripSignatures(true);

      if (result.hasSignatures) {
        showToast(`Tìm thấy ${result.signatures.length} chữ ký số (Signature Field)!`);
      } else {
        showToast("Không phát hiện chữ ký số dạng field. Dùng Cục tẩy (Eraser) để xóa dấu/chữ ký.");
      }
    } catch (err: any) {
      console.error("Lỗi phân tích PDF:", err);
      showToast("Không thể đọc tệp PDF. Tệp có thể bị mã hóa hoặc đặt mật khẩu.");
      setFile(null);
      setFileBuffer(null);
    } finally {
      setIsLoading(false);
      setLoadingText("");
    }
  };

  // Helper to check box intersection
  const checkIntersection = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number }
  ) => {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  };

  // Check if a point is within any of the 4 corners of a signature frame
  const checkCornerHit = (
    pos: { x: number; y: number },
    rect: { x: number; y: number; w: number; h: number }
  ) => {
    // Corner sensitivity zone: proportional to box size (min 0.035, max 0.08)
    const zw = Math.max(0.035, Math.min(rect.w * 0.38, 0.08));
    const zh = Math.max(0.035, Math.min(rect.h * 0.38, 0.08));

    // Top-left corner
    if (
      pos.x >= rect.x - 0.02 &&
      pos.x <= rect.x + zw &&
      pos.y >= rect.y - 0.02 &&
      pos.y <= rect.y + zh
    ) {
      return { cornerId: "tl", cornerName: "Góc Trên - Trái", x: rect.x, y: rect.y };
    }
    // Top-right corner
    if (
      pos.x >= rect.x + rect.w - zw &&
      pos.x <= rect.x + rect.w + 0.02 &&
      pos.y >= rect.y - 0.02 &&
      pos.y <= rect.y + zh
    ) {
      return { cornerId: "tr", cornerName: "Góc Trên - Phải", x: rect.x + rect.w, y: rect.y };
    }
    // Bottom-left corner
    if (
      pos.x >= rect.x - 0.02 &&
      pos.x <= rect.x + zw &&
      pos.y >= rect.y + rect.h - zh &&
      pos.y <= rect.y + rect.h + 0.02
    ) {
      return { cornerId: "bl", cornerName: "Góc Dưới - Trái", x: rect.x, y: rect.y + rect.h };
    }
    // Bottom-right corner
    if (
      pos.x >= rect.x + rect.w - zw &&
      pos.x <= rect.x + rect.w + 0.02 &&
      pos.y >= rect.y + rect.h - zh &&
      pos.y <= rect.y + rect.h + 0.02
    ) {
      return { cornerId: "br", cornerName: "Góc Dưới - Phải", x: rect.x + rect.w, y: rect.y + rect.h };
    }

    return null;
  };

  // Check if a swept rectangle intersects any of the 4 corners or body of a signature
  const checkSweepIntersectsCorners = (
    sweepBox: { x: number; y: number; w: number; h: number },
    rect: { x: number; y: number; w: number; h: number }
  ) => {
    const corners = [
      { cornerId: "tl", cornerName: "Góc Trên - Trái", x: rect.x, y: rect.y },
      { cornerId: "tr", cornerName: "Góc Trên - Phải", x: rect.x + rect.w, y: rect.y },
      { cornerId: "bl", cornerName: "Góc Dưới - Trái", x: rect.x, y: rect.y + rect.h },
      { cornerId: "br", cornerName: "Góc Dưới - Phải", x: rect.x + rect.w, y: rect.y + rect.h },
    ];

    // 1. Check if any of the 4 corners is touched by the swept rectangle (Highest Priority)
    for (const c of corners) {
      if (
        c.x >= sweepBox.x - 0.015 &&
        c.x <= sweepBox.x + sweepBox.w + 0.015 &&
        c.y >= sweepBox.y - 0.015 &&
        c.y <= sweepBox.y + sweepBox.h + 0.015
      ) {
        return c;
      }
    }

    // 2. Check if the swept box intersects with the signature frame
    const overlaps =
      sweepBox.x <= rect.x + rect.w + 0.01 &&
      sweepBox.x + sweepBox.w >= rect.x - 0.01 &&
      sweepBox.y <= rect.y + rect.h + 0.01 &&
      sweepBox.y + sweepBox.h >= rect.y - 0.01;

    if (overlaps) {
      return {
        cornerId: "body",
        cornerName: "Vùng chữ ký",
        x: rect.x + rect.w / 2,
        y: rect.y + rect.h / 2,
      };
    }

    return null;
  };

  // Smart Signature Erasure: Selectively detaches the chosen digital signature from the PDF structure
  // and immediately refreshes the page preview. DOES NOT create white cover boxes, ensuring zero
  // damage to underlying text, tables, or adjacent/nested signatures!
  const handleSmartEraseSignature = async (sigId: string, cornerLabel?: string) => {
    const targetSig = detectedSignatures.find((s) => s.id === sigId);
    if (!targetSig || targetSig.isErased) return;

    const nextSigs = detectedSignatures.map((s) =>
      s.id === sigId ? { ...s, isErased: true } : s
    );

    // Keep user's manual redactBoxes, but DO NOT add any white box overlay for digital signatures!
    pushHistory(
      nextSigs,
      redactBoxes,
      cornerLabel
        ? `Quét ${cornerLabel} tách riêng chữ ký: ${targetSig.name}`
        : `Tách riêng chữ ký: ${targetSig.name}`
    );
    showToast(
      cornerLabel
        ? `Đã quét vào ${cornerLabel} -> Tách riêng chữ ký "${targetSig.name}" thành công!`
        : `Đã tách riêng chữ ký "${targetSig.name}" thành công!`
    );
    setSmartCornerSnapped(null);

    // Re-render the page preview without this signature
    await refreshPagePreviewsForSigs(nextSigs, [targetSig.pageIndex]);
  };

  // Standard erase wrapper for backwards compatibility
  const handleEraseSignature = (sigId: string) => {
    handleSmartEraseSignature(sigId);
  };

  // Restore a temporarily detached digital signature
  const handleRestoreSignature = async (sigId: string) => {
    const targetSig = detectedSignatures.find((s) => s.id === sigId);
    if (!targetSig || !targetSig.isErased) return;

    const nextSigs = detectedSignatures.map((s) =>
      s.id === sigId ? { ...s, isErased: false } : s
    );

    pushHistory(nextSigs, redactBoxes, `Khôi phục chữ ký: ${targetSig.name}`);
    showToast(`Đã khôi phục chữ ký số "${targetSig.name}".`);

    // Re-render the page preview with this signature restored
    await refreshPagePreviewsForSigs(nextSigs, [targetSig.pageIndex]);
  };

  // 1-Click: Selectively detach ALL detected signature fields cleanly without white boxes
  const handleEraseAllSignatures = async () => {
    const nextSigs = detectedSignatures.map((s) => ({ ...s, isErased: true }));
    pushHistory(nextSigs, redactBoxes, "Tách toàn bộ chữ ký số");
    showToast(`Đã tách toàn bộ ${detectedSignatures.length} chữ ký số (Giữ nguyên văn bản & nét vẽ)!`);
    await refreshPagePreviewsForSigs(nextSigs);
  };

  // 1-Click: Restore ALL detached signatures
  const handleRestoreAllSignatures = async () => {
    const nextSigs = detectedSignatures.map((s) => ({ ...s, isErased: false }));
    pushHistory(nextSigs, redactBoxes, "Khôi phục toàn bộ chữ ký số");
    showToast("Đã khôi phục toàn bộ chữ ký số.");
    await refreshPagePreviewsForSigs(nextSigs);
  };

  // Smooth scroll to a target page and sync inputs
  const scrollToPage = (targetIdx: number) => {
    if (!detectionResult) return;
    const clamped = Math.max(0, Math.min(detectionResult.totalPages - 1, targetIdx));
    setActivePageIndex(clamped);
    setPageInputVal(String(clamped + 1));
    const el = document.getElementById(`pdf-page-container-${clamped}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Continuous vertical scroll tracking: update active page based on scroll position
  const handleScroll = () => {
    if (!scrollContainerRef.current || !detectionResult) return;
    const container = scrollContainerRef.current;
    const containerRect = container.getBoundingClientRect();
    const probeY = containerRect.top + 160;

    let closestPage = activePageIndex;
    let minDistance = Infinity;

    for (let i = 0; i < detectionResult.totalPages; i++) {
      const el = document.getElementById(`pdf-page-container-${i}`);
      if (el) {
        const r = el.getBoundingClientRect();
        const dist = Math.abs(r.top - probeY);
        if (dist < minDistance) {
          minDistance = dist;
          closestPage = i;
        }
      }
    }

    if (closestPage !== activePageIndex) {
      setActivePageIndex(closestPage);
      setPageInputVal(String(closestPage + 1));
    }
  };

  // Convert pointer event to normalized 0..1 coordinates for a specific page
  const getNormalizedPosForPage = (
    e: React.PointerEvent<HTMLDivElement>,
    pageIdx: number
  ) => {
    const pageCanvas = document.getElementById(`pdf-page-canvas-${pageIdx}`);
    if (!pageCanvas) return { x: 0, y: 0 };
    const rect = pageCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x, y };
  };

  // Pointer event handlers for drawing eraser / redact rectangles on a specific page
  const handlePagePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    pageIdx: number
  ) => {
    if ((e.target as HTMLElement).closest(".prevent-draw")) return;

    const pos = getNormalizedPosForPage(e, pageIdx);

    // If using ERASER tool, check if user clicked on any corner or inside a signature frame
    if (activeTool === "eraser") {
      const pageSigs = detectedSignatures.filter(
        (s) => s.pageIndex === pageIdx && !s.isErased && s.normalizedRect
      );

      // 1. Check direct corner hit first (find closest corner so overlapping/adjacent signatures don't conflict)
      let bestDirectHit: { sigId: string; cornerName: string; dist: number } | null = null;
      for (const sig of pageSigs) {
        const cornerHit = checkCornerHit(pos, sig.normalizedRect!);
        if (cornerHit) {
          const corners = [
            { x: sig.normalizedRect!.x, y: sig.normalizedRect!.y },
            { x: sig.normalizedRect!.x + sig.normalizedRect!.w, y: sig.normalizedRect!.y },
            { x: sig.normalizedRect!.x, y: sig.normalizedRect!.y + sig.normalizedRect!.h },
            { x: sig.normalizedRect!.x + sig.normalizedRect!.w, y: sig.normalizedRect!.y + sig.normalizedRect!.h },
          ];
          for (const c of corners) {
            const d = Math.hypot(pos.x - c.x, pos.y - c.y);
            if (!bestDirectHit || d < bestDirectHit.dist) {
              bestDirectHit = { sigId: sig.id, cornerName: cornerHit.cornerName, dist: d };
            }
          }
        }
      }

      if (bestDirectHit) {
        handleSmartEraseSignature(bestDirectHit.sigId, bestDirectHit.cornerName);
        return;
      }

      // 2. Check direct signature frame hit with Nested-Priority Logic
      // If signatures overlap or are nested inside one another, prioritize the inner/nested signature (smallest area)
      const enclosingSigs = pageSigs.filter((s) => {
        const r = s.normalizedRect!;
        return pos.x >= r.x && pos.x <= r.x + r.w && pos.y >= r.y && pos.y <= r.y + r.h;
      });

      if (enclosingSigs.length > 0) {
        enclosingSigs.sort((a, b) => {
          const areaA = a.normalizedRect!.w * a.normalizedRect!.h;
          const areaB = b.normalizedRect!.w * b.normalizedRect!.h;
          if (Math.abs(areaA - areaB) > 0.005) {
            return areaA - areaB; // Inner nested signature first!
          }
          const centerA = {
            x: a.normalizedRect!.x + a.normalizedRect!.w / 2,
            y: a.normalizedRect!.y + a.normalizedRect!.h / 2,
          };
          const centerB = {
            x: b.normalizedRect!.x + b.normalizedRect!.w / 2,
            y: b.normalizedRect!.y + b.normalizedRect!.h / 2,
          };
          return (
            Math.hypot(pos.x - centerA.x, pos.y - centerA.y) -
            Math.hypot(pos.x - centerB.x, pos.y - centerB.y)
          );
        });

        handleSmartEraseSignature(enclosingSigs[0].id, "Khung chữ ký");
        return;
      }
    }

    // If clicking on empty canvas, deselect current selected box
    if (!(e.target as HTMLElement).closest(".selectable-box")) {
      setSelectedBoxId(null);
    }

    if (activeTool === "view") return;

    setIsDrawing(true);
    setDrawingPageIndex(pageIdx);
    setStartPoint(pos);
    setCurrentBox({ x: pos.x, y: pos.y, w: 0.001, h: 0.001 });
  };

  const handlePagePointerMove = (
    e: React.PointerEvent<HTMLDivElement>,
    pageIdx: number
  ) => {
    // Always track corner hover for visual target cursor when eraser is active
    if (activeTool === "eraser" && !isDrawing) {
      const pos = getNormalizedPosForPage(e, pageIdx);
      const pageSigs = detectedSignatures.filter(
        (s) => s.pageIndex === pageIdx && !s.isErased && s.normalizedRect
      );
      let foundHover: { sigId: string; cornerId: string; dist: number; area: number } | null = null;
      for (const sig of pageSigs) {
        const hit = checkCornerHit(pos, sig.normalizedRect!);
        if (hit) {
          const area = sig.normalizedRect!.w * sig.normalizedRect!.h;
          const corners = [
            { x: sig.normalizedRect!.x, y: sig.normalizedRect!.y },
            { x: sig.normalizedRect!.x + sig.normalizedRect!.w, y: sig.normalizedRect!.y },
            { x: sig.normalizedRect!.x, y: sig.normalizedRect!.y + sig.normalizedRect!.h },
            { x: sig.normalizedRect!.x + sig.normalizedRect!.w, y: sig.normalizedRect!.y + sig.normalizedRect!.h },
          ];
          for (const c of corners) {
            const d = Math.hypot(pos.x - c.x, pos.y - c.y);
            if (!foundHover || d < foundHover.dist || (Math.abs(d - foundHover.dist) < 0.02 && area < foundHover.area)) {
              foundHover = { sigId: sig.id, cornerId: hit.cornerId, dist: d, area };
            }
          }
        }
      }
      setSmartHoverCorner(foundHover ? { sigId: foundHover.sigId, cornerId: foundHover.cornerId } : null);
    }

    if (!isDrawing || !startPoint || drawingPageIndex !== pageIdx || activeTool === "view") return;
    const pos = getNormalizedPosForPage(e, pageIdx);

    const x = Math.min(startPoint.x, pos.x);
    const y = Math.min(startPoint.y, pos.y);
    const w = Math.abs(pos.x - startPoint.x);
    const h = Math.abs(pos.y - startPoint.y);

    const updatedBox = { x, y, w, h };
    setCurrentBox(updatedBox);

    // If using ERASER: detect if sweeping through any corner of a signature!
    // Nested-Aware Matching: true corner hit beats body hit; nested/smaller signature beats outer wrapper
    if (activeTool === "eraser") {
      const pageSigs = detectedSignatures.filter(
        (s) => s.pageIndex === pageIdx && !s.isErased && s.normalizedRect
      );

      let bestSweepMatch: {
        sigId: string;
        cornerName: string;
        dist: number;
        isTrueCorner: boolean;
        area: number;
      } | null = null;

      for (const sig of pageSigs) {
        const cornerMatch =
          checkSweepIntersectsCorners(updatedBox, sig.normalizedRect!) ||
          checkCornerHit(pos, sig.normalizedRect!);
        if (cornerMatch) {
          const isTrueCorner = cornerMatch.cornerId !== "body";
          const dist = Math.hypot(pos.x - cornerMatch.x, pos.y - cornerMatch.y);
          const area = sig.normalizedRect!.w * sig.normalizedRect!.h;

          if (!bestSweepMatch) {
            bestSweepMatch = {
              sigId: sig.id,
              cornerName: cornerMatch.cornerName,
              dist,
              isTrueCorner,
              area,
            };
          } else {
            // Rule 1: True corner reticle beats generic body overlap
            if (isTrueCorner && !bestSweepMatch.isTrueCorner) {
              bestSweepMatch = {
                sigId: sig.id,
                cornerName: cornerMatch.cornerName,
                dist,
                isTrueCorner,
                area,
              };
            } else if (isTrueCorner === bestSweepMatch.isTrueCorner) {
              // Rule 2: If both are corners or both are bodies, prefer nested inner signature
              if (Math.abs(area - bestSweepMatch.area) > 0.01) {
                if (area < bestSweepMatch.area) {
                  bestSweepMatch = {
                    sigId: sig.id,
                    cornerName: cornerMatch.cornerName,
                    dist,
                    isTrueCorner,
                    area,
                  };
                }
              } else if (dist < bestSweepMatch.dist) {
                bestSweepMatch = {
                  sigId: sig.id,
                  cornerName: cornerMatch.cornerName,
                  dist,
                  isTrueCorner,
                  area,
                };
              }
            }
          }
        }
      }

      if (bestSweepMatch) {
        setSmartCornerSnapped({
          sigId: bestSweepMatch.sigId,
          cornerName: bestSweepMatch.cornerName,
          pageIndex: pageIdx,
        });
      }
    }
  };

  const handlePagePointerUp = (pageIdx: number) => {
    if (isDrawing && drawingPageIndex === pageIdx) {
      let snapTarget = smartCornerSnapped;

      // Fallback check on pointer release: if mouse/touch just flicked a corner
      if (!snapTarget && activeTool === "eraser" && startPoint) {
        const pageSigs = detectedSignatures.filter(
          (s) => s.pageIndex === pageIdx && !s.isErased && s.normalizedRect
        );
        let bestEndMatch: {
          sigId: string;
          cornerName: string;
          dist: number;
          isTrueCorner: boolean;
          area: number;
        } | null = null;

        for (const sig of pageSigs) {
          const match =
            (currentBox ? checkSweepIntersectsCorners(currentBox, sig.normalizedRect!) : null) ||
            checkCornerHit(startPoint, sig.normalizedRect!);
          if (match) {
            const isTrueCorner = match.cornerId !== "body";
            const dist = Math.hypot(startPoint.x - match.x, startPoint.y - match.y);
            const area = sig.normalizedRect!.w * sig.normalizedRect!.h;

            if (!bestEndMatch) {
              bestEndMatch = {
                sigId: sig.id,
                cornerName: match.cornerName,
                dist,
                isTrueCorner,
                area,
              };
            } else if (isTrueCorner && !bestEndMatch.isTrueCorner) {
              bestEndMatch = {
                sigId: sig.id,
                cornerName: match.cornerName,
                dist,
                isTrueCorner,
                area,
              };
            } else if (isTrueCorner === bestEndMatch.isTrueCorner) {
              if (Math.abs(area - bestEndMatch.area) > 0.01 ? area < bestEndMatch.area : dist < bestEndMatch.dist) {
                bestEndMatch = {
                  sigId: sig.id,
                  cornerName: match.cornerName,
                  dist,
                  isTrueCorner,
                  area,
                };
              }
            }
          }
        }
        if (bestEndMatch) {
          snapTarget = {
            sigId: bestEndMatch.sigId,
            cornerName: bestEndMatch.cornerName,
            pageIndex: pageIdx,
          };
        }
      }

      // If using ERASER tool:
      if (activeTool === "eraser") {
        let chosenSigId: string | null = snapTarget?.sigId || null;
        let chosenLabel: string | undefined = snapTarget?.cornerName;

        // If no corner was specifically snapped, check if the drawn sweep box intersects any signature on this page
        if (!chosenSigId && currentBox) {
          const pageSigs = detectedSignatures.filter(
            (s) => s.pageIndex === pageIdx && !s.isErased && s.normalizedRect
          );

          const intersectingSigs = pageSigs.filter((s) =>
            checkIntersection(currentBox, s.normalizedRect!)
          );

          if (intersectingSigs.length > 0) {
            // Nested-Priority: Prioritize inner/nested signature (smaller area) and closest center
            intersectingSigs.sort((a, b) => {
              const areaA = a.normalizedRect!.w * a.normalizedRect!.h;
              const areaB = b.normalizedRect!.w * b.normalizedRect!.h;
              if (Math.abs(areaA - areaB) > 0.004) {
                return areaA - areaB; // Inner nested signature first!
              }
              const centerA = {
                x: a.normalizedRect!.x + a.normalizedRect!.w / 2,
                y: a.normalizedRect!.y + a.normalizedRect!.h / 2,
              };
              const centerB = {
                x: b.normalizedRect!.x + b.normalizedRect!.w / 2,
                y: b.normalizedRect!.y + b.normalizedRect!.h / 2,
              };
              const boxCenter = {
                x: currentBox.x + currentBox.w / 2,
                y: currentBox.y + currentBox.h / 2,
              };
              return (
                Math.hypot(boxCenter.x - centerA.x, boxCenter.y - centerA.y) -
                Math.hypot(boxCenter.x - centerB.x, boxCenter.y - centerB.y)
              );
            });

            chosenSigId = intersectingSigs[0].id;
            chosenLabel = "Khung chữ ký";
          }
        }

        if (chosenSigId) {
          handleSmartEraseSignature(chosenSigId, chosenLabel);
        } else if (currentBox && currentBox.w > 0.008 && currentBox.h > 0.006) {
          // Only create a manual white box if NO signature was targeted (e.g. for cleaning scanned paper marks)
          const newBox: RedactBox = {
            id: `erase_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            pageIndex: pageIdx,
            x: currentBox.x,
            y: currentBox.y,
            w: currentBox.w,
            h: currentBox.h,
            color: "white",
            label: `Vùng tẩy #${redactBoxes.filter((b) => b.pageIndex === pageIdx).length + 1}`,
            type: "eraser",
          };
          const nextBoxes = [...redactBoxes, newBox];
          pushHistory(detectedSignatures, nextBoxes, `Thêm ${newBox.label}`);
          setSelectedBoxId(newBox.id);
        }
      } else if (currentBox && currentBox.w > 0.008 && currentBox.h > 0.006) {
        // Redact tool (manual color box)
        const newBox: RedactBox = {
          id: `redact_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          pageIndex: pageIdx,
          x: currentBox.x,
          y: currentBox.y,
          w: currentBox.w,
          h: currentBox.h,
          color: redactColor,
          label: `Vùng che #${redactBoxes.filter((b) => b.pageIndex === pageIdx).length + 1}`,
          type: "manual",
        };
        const nextBoxes = [...redactBoxes, newBox];
        pushHistory(detectedSignatures, nextBoxes, `Thêm ${newBox.label}`);
        setSelectedBoxId(newBox.id);
      }
    }
    setIsDrawing(false);
    setDrawingPageIndex(null);
    setStartPoint(null);
    setCurrentBox(null);
    setSmartCornerSnapped(null);
  };

  // Handle Box dragging (Move or Resize) to change position
  const handleBoxPointerDown = (
    e: React.PointerEvent,
    box: RedactBox,
    mode: "move" | "resize"
  ) => {
    e.stopPropagation();
    try {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {}
    setSelectedBoxId(box.id);
    const pos = getNormalizedPosForPage(e as any, box.pageIndex);
    setDragState({
      mode,
      startX: pos.x,
      startY: pos.y,
      pageIndex: box.pageIndex,
      initialBox: { ...box },
    });
  };

  const handleBoxPointerMove = (e: React.PointerEvent) => {
    if (!dragState) return;
    const pos = getNormalizedPosForPage(e as any, dragState.pageIndex);
    const dx = pos.x - dragState.startX;
    const dy = pos.y - dragState.startY;

    setRedactBoxes((prev) =>
      prev.map((b) => {
        if (b.id !== dragState.initialBox.id) return b;
        if (dragState.mode === "move") {
          const newX = Math.max(0, Math.min(1 - b.w, +(dragState.initialBox.x + dx).toFixed(4)));
          const newY = Math.max(0, Math.min(1 - b.h, +(dragState.initialBox.y + dy).toFixed(4)));
          return { ...b, x: newX, y: newY };
        } else {
          // resize
          const newW = Math.max(0.015, Math.min(1 - b.x, +(dragState.initialBox.w + dx).toFixed(4)));
          const newH = Math.max(0.01, Math.min(1 - b.y, +(dragState.initialBox.h + dy).toFixed(4)));
          return { ...b, w: newW, h: newH };
        }
      })
    );
  };

  const handleBoxPointerUp = (e: React.PointerEvent) => {
    if (!dragState) return;
    try {
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {}

    const currentUpdatedBox = redactBoxes.find((b) => b.id === dragState.initialBox.id);
    if (currentUpdatedBox) {
      const isMoved =
        Math.abs(currentUpdatedBox.x - dragState.initialBox.x) > 0.002 ||
        Math.abs(currentUpdatedBox.y - dragState.initialBox.y) > 0.002 ||
        Math.abs(currentUpdatedBox.w - dragState.initialBox.w) > 0.002 ||
        Math.abs(currentUpdatedBox.h - dragState.initialBox.h) > 0.002;

      if (isMoved) {
        pushHistory(
          detectedSignatures,
          redactBoxes,
          dragState.mode === "move" ? "Thay đổi vị trí vùng tẩy" : "Thay đổi kích thước vùng tẩy"
        );
        showToast(dragState.mode === "move" ? "Đã thay đổi vị trí vùng tẩy." : "Đã thay đổi kích thước vùng tẩy.");
      }
    }
    setDragState(null);
  };

  // Remove a specific manual erase or redact box
  const handleDeleteBox = (boxId: string) => {
    const boxToDelete = redactBoxes.find((b) => b.id === boxId);
    const nextBoxes = redactBoxes.filter((b) => b.id !== boxId);
    let nextSigs = detectedSignatures;
    if (boxId.startsWith("erase_sig_")) {
      const sigId = boxId.replace("erase_sig_", "");
      nextSigs = detectedSignatures.map((s) => (s.id === sigId ? { ...s, isErased: false } : s));
    }
    pushHistory(nextSigs, nextBoxes, `Xóa ${boxToDelete?.label || "vùng tẩy"}`);
    if (selectedBoxId === boxId) setSelectedBoxId(null);
    showToast("Đã xóa vùng tẩy (Khôi phục chữ ký).");
  };

  // Clear all redact/erase boxes on current page
  const handleClearPageBoxes = () => {
    const pageErasedBoxes = redactBoxes.filter((b) => b.pageIndex === activePageIndex);
    const erasedSigIds = pageErasedBoxes
      .filter((b) => b.id.startsWith("erase_sig_"))
      .map((b) => b.id.replace("erase_sig_", ""));

    const nextSigs = detectedSignatures.map((s) =>
      erasedSigIds.includes(s.id) ? { ...s, isErased: false } : s
    );
    const nextBoxes = redactBoxes.filter((b) => b.pageIndex !== activePageIndex);

    pushHistory(nextSigs, nextBoxes, `Dọn dẹp vùng tẩy Trang ${activePageIndex + 1}`);
    setSelectedBoxId(null);
    showToast(`Đã dọn dẹp các vùng tẩy trên Trang ${activePageIndex + 1}.`);
  };

  // Zoom handlers
  const handleZoomIn = () => setZoom((prev) => Math.min(2.5, +(prev + 0.25).toFixed(2)));
  const handleZoomOut = () => setZoom((prev) => Math.max(0.5, +(prev - 0.25).toFixed(2)));
  const handleZoomReset = () => setZoom(1.0);

  // Core processor: generates processed PDF blob in memory
  // Structurally detaches erased signatures without drawing white boxes,
  // keeping text, tables, and adjacent/nested signatures 100% original.
  const generateProcessedPDF = async () => {
    const activeBuffer = await getSafeFileBuffer();
    if (!activeBuffer) return null;

    const erasedIds = detectedSignatures.filter((s) => s.isErased).map((s) => s.id);

    return await PDFSignatureEngine.processAndRedactPDF({
      originalBuffer: activeBuffer,
      allSignatures: detectedSignatures,
      erasedSignatureIds: erasedIds,
      redactBoxes,
      stripSignatures: stripSignatures && (detectedSignatures.length === 0 || erasedIds.length === detectedSignatures.length),
    });
  };

  // IN NGAY (Direct Print):
  // 100% reliable direct printing: creates clean PDF blob, renders crisp pages,
  // immediately triggers direct print and opens the Print Assistant Dialog with instant print actions!
  const handleDirectPrint = async () => {
    if (!file && !fileBuffer) return;
    setIsDirectPrinting(true);
    showToast("Đang chuẩn bị trang in chất lượng cao...");

    try {
      const result = await generateProcessedPDF();
      if (!result?.bytes || !result.blob) throw new Error("Không tạo được dữ liệu PDF");

      const blobUrl = URL.createObjectURL(result.blob);
      setDirectPrintBlob(result.blob);
      setDirectPrintUrl(blobUrl);

      // Render crisp pages at scale 2.2
      const images = await PDFSignatureEngine.renderPagesToImages(result.bytes, 2.2);
      setPrintPages(images);

      // Open Print Assistant Dialog immediately for user confirmation and multiple print paths
      setShowPrintDialog(true);

      // Attempt native document print
      await PDFSignatureEngine.printDocument({
        pageImages: images,
        title: file?.name ? `In_${file.name}` : "VietScan_PDF_Print",
      });

      showToast("Đã chuẩn bị bản in. Bạn có thể bấm 'Mở máy in ngay' hoặc 'Mở tab PDF để in'!");
    } catch (err: any) {
      console.error("Lỗi in trực tiếp:", err);
      // Fallback: If renderPagesToImages failed, use existing preview pages
      if (detectionResult?.pagePreviews?.length) {
        const fallbackImages = detectionResult.pagePreviews.map((p) => p.dataUrl);
        setPrintPages(fallbackImages);
        setShowPrintDialog(true);
        showToast("Mở hộp thoại in hỗ trợ...");
      } else {
        showToast("Không thể khởi tạo lệnh in. Vui lòng thử lại.");
      }
    } finally {
      setIsDirectPrinting(false);
    }
  };

  // XUẤT PDF: Generates file with strict naming convention VietScan_by_Ltd_dd_mm_yy_hh_mm_ss.pdf
  const handleExportPDF = async () => {
    if (!file && !fileBuffer) return;
    setIsProcessing(true);

    try {
      const result = await generateProcessedPDF();
      if (!result?.blob) throw new Error("Không tạo được dữ liệu PDF");

      const url = URL.createObjectURL(result.blob);
      const filename = generateDocumentFileName({ extension: "pdf" });

      setProcessedBlob(result.blob);
      setProcessedUrl(url);
      setProcessedFileName(filename);

      // Auto trigger download
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      showToast(`Đã xuất và tải về: ${filename}`);

      // Save to document history
      if (onSaveToDocuments && detectionResult?.pagePreviews && detectionResult.pagePreviews[0]?.dataUrl) {
        const previews = detectionResult.pagePreviews;
        const docRecord: ScannedDocument = {
          id: `doc_sig_${Date.now()}`,
          title: filename.replace(".pdf", ""),
          category: "document",
          pages: previews.map((p, idx) => ({
            id: `p_${idx}`,
            originalImage: p.dataUrl,
            processedImage: p.dataUrl,
            filter: "color",
            rotation: 0,
          })),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          thumbnail: previews[0].dataUrl,
        };
        try {
          await StorageService.saveDocument(docRecord);
          onSaveToDocuments(docRecord);
        } catch {}
      }
    } catch (err: any) {
      console.error("Lỗi xuất PDF:", err);
      showToast("Lỗi khi xử lý và xuất tệp PDF.");
    } finally {
      setIsProcessing(false);
    }
  };

  const activePagePreview = detectionResult?.pagePreviews?.[activePageIndex];
  const pageSignatures = detectedSignatures.filter((s) => s.pageIndex === activePageIndex);
  const activePageBoxes = redactBoxes.filter((b) => b.pageIndex === activePageIndex);
  const unerasedCount = detectedSignatures.filter((s) => !s.isErased).length;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col overflow-hidden text-slate-100 animate-in fade-in duration-200">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[80] px-4 py-2.5 rounded-full bg-slate-900/95 text-white text-xs font-medium border border-blue-500/40 shadow-2xl backdrop-blur-md flex items-center gap-2 animate-in slide-in-from-top duration-200">
          <Info className="w-4 h-4 text-blue-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) {
            handleSelectFile(e.target.files[0]);
          }
        }}
      />

      {/* TOP HEADER */}
      <header className="h-14 border-b border-slate-800/80 bg-slate-900/95 backdrop-blur px-3 sm:px-4 flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 active:scale-95 transition"
            title="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-bold text-white truncate">
                Nhận diện chữ ký số
              </h1>
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300 text-[10px] font-bold border border-blue-500/20">
                <Sparkles className="w-3 h-3 text-blue-400" />
                Tự động & Chuẩn xác
              </span>
            </div>
            {file && (
              <p className="text-[11px] text-slate-400 truncate max-w-[200px] sm:max-w-[340px]">
                {file.name}
              </p>
            )}
          </div>
        </div>

        {/* Top Action Buttons */}
        <div className="flex items-center gap-2">
          {file && (
            <>
              {/* UNDO & REDO CONTROLS */}
              <div className="flex items-center bg-slate-800/90 p-0.5 rounded-xl border border-slate-700/70">
                <button
                  id="btn-undo"
                  onClick={handleUndo}
                  disabled={!canUndo}
                  className="px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 active:scale-95 disabled:opacity-25 disabled:hover:bg-transparent transition flex items-center gap-1 text-xs font-semibold"
                  title="Hoàn tác / Quay lại (Ctrl+Z)"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden md:inline">Hoàn tác</span>
                </button>
                <div className="h-4 w-px bg-slate-700/60 my-auto" />
                <button
                  id="btn-redo"
                  onClick={handleRedo}
                  disabled={!canRedo}
                  className="px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 active:scale-95 disabled:opacity-25 disabled:hover:bg-transparent transition flex items-center gap-1 text-xs font-semibold"
                  title="Làm lại (Ctrl+Y)"
                >
                  <RotateCw className="w-3.5 h-3.5 text-blue-400" />
                  <span className="hidden md:inline">Làm lại</span>
                </button>
              </div>

              {/* IN NGAY: Directly prints without needing to save */}
              <button
                id="btn-print-direct"
                onClick={handleDirectPrint}
                disabled={isDirectPrinting || isProcessing}
                className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs sm:text-sm font-bold shadow-lg shadow-emerald-950/40 transition disabled:opacity-50"
                title="In ngay tài liệu sạch chữ ký số (không cần lưu/xuất file)"
              >
                <Printer className="w-4 h-4" />
                <span>{isDirectPrinting ? "Đang in..." : "In ngay"}</span>
              </button>

              {/* XUẤT PDF: Strict filename format */}
              <button
                id="btn-export-pdf"
                onClick={handleExportPDF}
                disabled={isProcessing || isDirectPrinting}
                className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs sm:text-sm font-bold shadow-lg shadow-blue-950/40 transition disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">{isProcessing ? "Đang xử lý..." : "Xuất PDF"}</span>
                <span className="sm:hidden">{isProcessing ? "..." : "Xuất"}</span>
              </button>
            </>
          )}

          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition"
            title="Đổi tệp PDF khác"
          >
            <Upload className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* COMPACT HORIZONTAL SIGNATURE DETECTION RIBBON */}
      {file && detectionResult && (
        <div className="bg-slate-900/90 border-b border-slate-800/80 px-3 py-2 flex items-center justify-between gap-3 text-xs overflow-x-auto shrink-0 z-20">
          <div className="flex items-center gap-2 shrink-0">
            {detectedSignatures.length > 0 ? (
              <>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 font-medium">
                  <FileSignature className="w-3.5 h-3.5 text-amber-400" />
                  <span>
                    {unerasedCount > 0 ? `Phát hiện ${detectedSignatures.length} chữ ký (${unerasedCount} chưa xóa)` : "Đã xóa tất cả chữ ký số"}
                  </span>
                </div>

                {unerasedCount > 0 && (
                  <button
                    onClick={handleEraseAllSignatures}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-600/30 hover:bg-amber-600 active:scale-95 text-amber-200 hover:text-white border border-amber-500/40 font-bold transition"
                    title="Xóa toàn bộ chữ ký số đã phát hiện"
                  >
                    <Eraser className="w-3.5 h-3.5" />
                    <span>Xóa tất cả chữ ký</span>
                  </button>
                )}
              </>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 text-slate-400">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Không có Signature Field. Dùng Cục tẩy để xóa dấu hoặc chữ ký vẽ tay.</span>
              </div>
            )}
          </div>

          {/* Horizontal Chips for each signature */}
          {detectedSignatures.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar">
              {detectedSignatures.map((sig) => (
                <div
                  key={sig.id}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] whitespace-nowrap transition ${
                    sig.pageIndex === activePageIndex
                      ? "bg-slate-800 border-blue-500/50 text-white"
                      : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <button
                    onClick={() => scrollToPage(sig.pageIndex)}
                    className="flex items-center gap-1 hover:underline"
                    title={`Cuộn tới Trang ${sig.pageNumber}`}
                  >
                    <span className="font-semibold text-blue-400">P.{sig.pageNumber}</span>
                    <span className="truncate max-w-[90px] sm:max-w-[130px]">{sig.name}</span>
                  </button>

                  {sig.isErased ? (
                    <button
                      onClick={() => handleRestoreSignature(sig.id)}
                      className="text-emerald-400 hover:text-white flex items-center gap-0.5 ml-1"
                      title="Hoàn tác khôi phục chữ ký"
                    >
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <RotateCcw className="w-2.5 h-2.5 text-slate-400 hover:text-white" />
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        scrollToPage(sig.pageIndex);
                        handleSmartEraseSignature(sig.id, "Thanh chữ ký");
                      }}
                      className="p-0.5 rounded text-amber-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
                      title="Xóa chữ ký này"
                    >
                      <Eraser className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Disclaimer toggle */}
          <button
            onClick={() => setShowDisclaimer(!showDisclaimer)}
            className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 shrink-0 ml-auto"
            title="Lưu ý pháp lý"
          >
            <Info className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden md:inline">Lưu ý xóa chữ ký</span>
          </button>
        </div>
      )}

      {/* DISCLAIMER BANNER (Collapsible) */}
      {showDisclaimer && (
        <div className="bg-amber-950/40 border-b border-amber-500/30 px-4 py-2 flex items-center justify-between text-amber-200 text-xs shrink-0 z-20">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>Cơ chế xóa chuyên sâu:</strong> Xóa Signature Field cấu trúc và làm sạch vùng hiển thị trên trang. Chữ ký số mật mã sẽ không còn hiệu lực xác thực để giúp tài liệu sạch sẽ khi xem và in.
            </span>
          </div>
          <button
            onClick={() => setShowDisclaimer(false)}
            className="p-1 text-amber-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* MAIN WORKSPACE AREA */}
      <div className="flex-1 relative flex flex-col overflow-hidden bg-slate-950">
        {!file ? (
          /* EMPTY STATE / UPLOAD */
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-amber-500/20 to-blue-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-5 shadow-2xl">
              <FileSignature className="w-10 h-10" />
            </div>

            <h2 className="text-xl font-bold text-white mb-2">Nhận diện & Xóa chữ ký số</h2>
            <p className="text-slate-400 text-xs sm:text-sm max-w-md mb-6 leading-relaxed">
              Tự động phát hiện Signature Field, xóa chữ ký số thông minh, hỗ trợ Cục tẩy (Eraser) quét góc xóa gọn và in trực tiếp ngay lập tức.
            </p>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-amber-600 to-blue-600 hover:from-amber-500 hover:to-blue-500 text-white font-bold text-sm shadow-xl active:scale-95 transition"
            >
              <Upload className="w-4 h-4" />
              <span>Chọn file PDF từ thiết bị</span>
            </button>

            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-xl text-left">
              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300">
                <span className="font-bold text-amber-400 block mb-1">1. Quét Signature Field</span>
                Tự động tìm kiếm các trường chữ ký số AcroForm trong tài liệu.
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300">
                <span className="font-bold text-blue-400 block mb-1">2. Cục tẩy (Eraser)</span>
                Quét vào khung chữ ký hoặc con dấu để xóa sạch khỏi trang.
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300">
                <span className="font-bold text-emerald-400 block mb-1">3. In ngay lập tức</span>
                In thẳng ra máy in mà không cần tải về hay lưu file trung gian.
              </div>
            </div>
          </div>
        ) : !detectionResult || isLoading ? (
          /* LOADING / SCANNING STATE */
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-blue-500/20 to-amber-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 mb-4 shadow-xl">
              <div className="w-8 h-8 border-3 border-blue-500/30 border-t-blue-400 rounded-full animate-spin" />
            </div>
            <h3 className="text-base font-bold text-white mb-1.5">
              {loadingText || "Đang nạp và phân tích tài liệu PDF..."}
            </h3>
            <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
              Đang phân tích cấu trúc chữ ký số và kết xuất bản xem trước các trang. Vui lòng chờ trong giây lát...
            </p>
          </div>
        ) : (
          /* DOCUMENT VIEWER & EDITOR WORKSPACE (MULTI-PAGE CONTINUOUS SCROLL) */
          <div className="flex-1 relative flex flex-col overflow-hidden">
            {/* CONTINUOUS VERTICAL SCROLL WORKSPACE (CUỘN CHUỘT XEM CÁC TRANG TIẾP THEO) */}
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-6 bg-slate-950 select-none relative flex flex-col items-center gap-6 scroll-smooth"
              style={{
                cursor:
                  activeTool === "eraser"
                    ? "crosshair"
                    : activeTool === "redact"
                    ? "crosshair"
                    : "default",
              }}
            >
              {detectionResult?.pagePreviews && detectionResult.pagePreviews.length > 0 ? (
                detectionResult.pagePreviews.map((preview, pIdx) => {
                  const pageSigs = detectedSignatures.filter((s) => s.pageIndex === pIdx);
                  const pageBoxes = redactBoxes.filter((b) => b.pageIndex === pIdx);
                  const isDrawingThisPage = isDrawing && drawingPageIndex === pIdx;
                  const isCurrentActivePage = activePageIndex === pIdx;

                  return (
                    <div
                      key={`pdf_page_card_${pIdx}`}
                      id={`pdf-page-container-${pIdx}`}
                      className={`flex flex-col items-center transition-all duration-200 ${
                        isCurrentActivePage ? "opacity-100" : "opacity-95 hover:opacity-100"
                      }`}
                    >
                      {/* PAGE HEADER LABEL & INFO */}
                      <div className="w-full flex items-center justify-between text-xs text-slate-400 mb-1.5 px-1 max-w-[min(94vw,740px)]">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2.5 py-0.5 rounded-full font-bold text-[11px] transition ${
                              isCurrentActivePage
                                ? "bg-blue-600/30 text-blue-300 border border-blue-500/40 shadow-sm"
                                : "bg-slate-800/80 text-slate-400 border border-slate-700/40"
                            }`}
                          >
                            Trang {pIdx + 1} / {detectionResult?.totalPages || detectionResult?.pagePreviews?.length || 1}
                          </span>
                          {pageSigs.length > 0 && (
                            <span className="text-[11px] text-amber-400/90 font-medium flex items-center gap-1">
                              <FileSignature className="w-3 h-3" />
                              {pageSigs.filter((s) => !s.isErased).length > 0
                                ? `${pageSigs.filter((s) => !s.isErased).length} chữ ký`
                                : "Đã gỡ chữ ký"}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-[11px] text-slate-400">
                          <span>{Math.round(preview.width)} × {Math.round(preview.height)} px</span>
                          {pageBoxes.length > 0 && (
                            <button
                              onClick={() => {
                                const nextBoxes = redactBoxes.filter((b) => b.pageIndex !== pIdx);
                                pushHistory(detectedSignatures, nextBoxes, `Dọn dẹp vùng tẩy Trang ${pIdx + 1}`);
                                showToast(`Đã dọn dẹp vùng tẩy Trang ${pIdx + 1}`);
                              }}
                              className="p-1 hover:text-rose-400 text-slate-400 transition flex items-center gap-0.5 ml-1"
                              title="Xóa tất cả vùng tẩy/che trên trang này"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Dọn trang</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* PAGE CANVAS CONTAINER */}
                      <div
                        id={`pdf-page-canvas-${pIdx}`}
                        onPointerDown={(e) => handlePagePointerDown(e, pIdx)}
                        onPointerMove={(e) => handlePagePointerMove(e, pIdx)}
                        onPointerUp={() => handlePagePointerUp(pIdx)}
                        className="relative bg-white shadow-2xl rounded-sm overflow-hidden border border-slate-700/60 touch-none select-none transition-all duration-100 ease-out"
                        style={{
                          width: `min(94vw, ${Math.round(720 * zoom)}px)`,
                          aspectRatio: `${preview.width} / ${preview.height}`,
                        }}
                      >
                        {/* Rendered PDF Page Background */}
                        <img
                          src={preview.dataUrl}
                          alt={`Trang ${pIdx + 1}`}
                          className="w-full h-full object-contain pointer-events-none select-none"
                          draggable={false}
                        />

                        {/* DETECTED SIGNATURES ON THIS PAGE */}
                        {pageSigs.map((sig) => {
                          if (!sig.normalizedRect) return null;
                          const { x, y, w, h } = sig.normalizedRect;

                          if (sig.isErased) {
                            return (
                              <div
                                key={`erased_${sig.id}`}
                                className="absolute bg-emerald-500/5 hover:bg-emerald-500/10 border border-dashed border-emerald-500/70 hover:border-emerald-400 rounded transition-all duration-150 group z-20"
                                style={{
                                  left: `${x * 100}%`,
                                  top: `${y * 100}%`,
                                  width: `${w * 100}%`,
                                  height: `${h * 100}%`,
                                }}
                                title={`Chữ ký đã tách: ${sig.name} (Tài liệu & chữ ký khác giữ nguyên)`}
                              >
                                <div className="absolute -top-6 left-0 bg-emerald-700/95 text-white font-medium px-2 py-0.5 rounded text-[10px] whitespace-nowrap shadow-md flex items-center gap-1.5 backdrop-blur-sm z-30 pointer-events-auto">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-300" />
                                  <span>Đã tách: {sig.name}</span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRestoreSignature(sig.id);
                                    }}
                                    className="ml-1 text-[9px] bg-slate-900/90 hover:bg-slate-950 text-amber-300 px-1.5 py-0.5 rounded font-bold flex items-center gap-0.5 transition cursor-pointer"
                                    title="Khôi phục chữ ký này"
                                  >
                                    <RotateCcw className="w-2.5 h-2.5" />
                                    <span>Khôi phục</span>
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          // Active signature box with 4 smart corner anchors
                          const isSnapped =
                            smartCornerSnapped?.sigId === sig.id &&
                            smartCornerSnapped?.pageIndex === pIdx;
                          const isEraser = activeTool === "eraser";

                          return (
                            <div
                              key={`sig_${sig.id}`}
                              onClick={(e) => {
                                if (isEraser) {
                                  e.stopPropagation();
                                  handleSmartEraseSignature(sig.id, "Khung chữ ký");
                                }
                              }}
                              className={`absolute border-2 transition-all duration-150 cursor-pointer ${
                                isSnapped
                                  ? "ring-4 ring-rose-500 border-rose-400 bg-rose-500/30 scale-[1.01] z-30"
                                  : isEraser
                                  ? "border-amber-400 bg-amber-500/15 hover:border-rose-400 hover:bg-rose-500/20 z-20"
                                  : "border-amber-500/70 bg-amber-500/10 z-10"
                              }`}
                              style={{
                                left: `${x * 100}%`,
                                top: `${y * 100}%`,
                                width: `${w * 100}%`,
                                height: `${h * 100}%`,
                              }}
                              title={
                                isEraser
                                  ? "Chạm hoặc quét vào 1 góc để xóa toàn bộ khung chữ ký"
                                  : sig.name
                              }
                            >
                              {/* Signature Floating Badge */}
                              <div
                                className={`absolute -top-6 left-0 px-2 py-0.5 rounded text-[10px] whitespace-nowrap shadow flex items-center gap-1 font-bold transition ${
                                  isSnapped
                                    ? "bg-rose-600 text-white animate-bounce"
                                    : "bg-amber-500 text-slate-950"
                                }`}
                              >
                                <FileSignature className="w-3 h-3" />
                                <span>{sig.name}</span>
                                {isEraser && (
                                  <span className="text-[9px] bg-slate-900 text-amber-300 px-1 rounded font-medium ml-0.5">
                                    Quét 1 góc để xóa
                                  </span>
                                )}
                              </div>

                              {/* 4 SMART CORNER RETICLES (XÁC ĐỊNH 4 GÓC CHỮ KÝ) */}
                              {isEraser && (
                                <>
                                  {/* Top-Left Corner */}
                                  <div
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSmartEraseSignature(sig.id, "Góc Trên - Trái");
                                    }}
                                    className={`absolute -top-1.5 -left-1.5 w-4 h-4 border-t-[3px] border-l-[3px] rounded-tl transition-all duration-150 cursor-pointer ${
                                      smartHoverCorner?.sigId === sig.id &&
                                      smartHoverCorner?.cornerId === "tl"
                                        ? "border-rose-500 bg-rose-500/40 scale-125 z-40"
                                        : "border-amber-400 bg-amber-400/25 hover:border-rose-400 hover:bg-rose-500/30"
                                    }`}
                                    title="Góc trên-trái: Quét hoặc chạm để xóa toàn bộ khung chữ ký"
                                  />
                                  {/* Top-Right Corner */}
                                  <div
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSmartEraseSignature(sig.id, "Góc Trên - Phải");
                                    }}
                                    className={`absolute -top-1.5 -right-1.5 w-4 h-4 border-t-[3px] border-r-[3px] rounded-tr transition-all duration-150 cursor-pointer ${
                                      smartHoverCorner?.sigId === sig.id &&
                                      smartHoverCorner?.cornerId === "tr"
                                        ? "border-rose-500 bg-rose-500/40 scale-125 z-40"
                                        : "border-amber-400 bg-amber-400/25 hover:border-rose-400 hover:bg-rose-500/30"
                                    }`}
                                    title="Góc trên-phải: Quét hoặc chạm để xóa toàn bộ khung chữ ký"
                                  />
                                  {/* Bottom-Left Corner */}
                                  <div
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSmartEraseSignature(sig.id, "Góc Dưới - Trái");
                                    }}
                                    className={`absolute -bottom-1.5 -left-1.5 w-4 h-4 border-b-[3px] border-l-[3px] rounded-bl transition-all duration-150 cursor-pointer ${
                                      smartHoverCorner?.sigId === sig.id &&
                                      smartHoverCorner?.cornerId === "bl"
                                        ? "border-rose-500 bg-rose-500/40 scale-125 z-40"
                                        : "border-amber-400 bg-amber-400/25 hover:border-rose-400 hover:bg-rose-500/30"
                                    }`}
                                    title="Góc dưới-trái: Quét hoặc chạm để xóa toàn bộ khung chữ ký"
                                  />
                                  {/* Bottom-Right Corner */}
                                  <div
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSmartEraseSignature(sig.id, "Góc Dưới - Phải");
                                    }}
                                    className={`absolute -bottom-1.5 -right-1.5 w-4 h-4 border-b-[3px] border-r-[3px] rounded-br transition-all duration-150 cursor-pointer ${
                                      smartHoverCorner?.sigId === sig.id &&
                                      smartHoverCorner?.cornerId === "br"
                                        ? "border-rose-500 bg-rose-500/40 scale-125 z-40"
                                        : "border-amber-400 bg-amber-400/25 hover:border-rose-400 hover:bg-rose-500/30"
                                    }`}
                                    title="Góc dưới-phải: Quét hoặc chạm để xóa toàn bộ khung chữ ký"
                                  />
                                </>
                              )}

                              {/* Snapped Notification Feedback Banner */}
                              {isSnapped && (
                                <div className="absolute inset-0 bg-rose-500/30 flex items-center justify-center text-white font-bold text-xs backdrop-blur-[0.5px]">
                                  <span className="bg-rose-600 px-2 py-0.5 rounded shadow">
                                    Nhả chuột để xóa khung chữ ký!
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* REDACT & ERASER BOXES ON THIS PAGE */}
                        {pageBoxes.map((box) => {
                          const isSelected = box.id === selectedBoxId;
                          const isSigEraser = box.id.startsWith("erase_sig_");
                          const sigId = isSigEraser ? box.id.replace("erase_sig_", "") : null;
                          const sigObj = sigId ? detectedSignatures.find((s) => s.id === sigId) : null;

                          return (
                            <div
                              key={box.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedBoxId(box.id);
                              }}
                              className={`absolute selectable-box transition-shadow touch-none ${
                                box.color === "white"
                                  ? "bg-white"
                                  : box.color === "black"
                                  ? "bg-black"
                                  : "bg-slate-400"
                              } ${
                                isSelected
                                  ? isSigEraser
                                    ? "ring-2 ring-emerald-500 shadow-xl z-30"
                                    : "ring-2 ring-blue-500 shadow-xl z-20"
                                  : isSigEraser
                                  ? "border border-dashed border-emerald-500/70 hover:ring-2 hover:ring-emerald-400/80 group z-20"
                                  : "hover:ring-1 hover:ring-blue-400/80 group z-10"
                              }`}
                              style={{
                                left: `${box.x * 100}%`,
                                top: `${box.y * 100}%`,
                                width: `${box.w * 100}%`,
                                height: `${box.h * 100}%`,
                              }}
                            >
                              {/* Selected state: Move & Resize Handles */}
                              {isSelected && (
                                <div
                                  onPointerDown={(e) => handleBoxPointerDown(e, box, "move")}
                                  onPointerMove={handleBoxPointerMove}
                                  onPointerUp={handleBoxPointerUp}
                                  className={`absolute inset-0 cursor-move border flex items-center justify-center select-none ${
                                    isSigEraser
                                      ? "bg-emerald-500/10 border-emerald-500/60"
                                      : "bg-blue-500/10 border-blue-500/50"
                                  }`}
                                  title="Nhấn giữ và kéo để thay đổi vị trí vùng tẩy"
                                >
                                  <div
                                    className={`absolute -top-7 left-0 px-2 py-0.5 rounded text-[10px] font-bold shadow-md flex items-center gap-1.5 whitespace-nowrap z-30 pointer-events-auto ${
                                      isSigEraser ? "bg-emerald-700 text-white" : "bg-blue-600 text-white"
                                    }`}
                                  >
                                    {isSigEraser ? (
                                      <>
                                        <CheckCircle2 className="w-3 h-3 text-emerald-300" />
                                        <span>Đã tẩy: {sigObj?.name || "Chữ ký số"}</span>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteBox(box.id);
                                          }}
                                          className="ml-1 px-1.5 py-0.5 bg-slate-900 hover:bg-slate-950 text-amber-300 rounded text-[9px] font-bold flex items-center gap-0.5 transition cursor-pointer"
                                          title="Khôi phục lại chữ ký gốc"
                                        >
                                          <RotateCcw className="w-2.5 h-2.5" />
                                          <span>Khôi phục</span>
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <Move className="w-3 h-3 text-blue-200" />
                                        <span>Kéo đổi vị trí</span>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteBox(box.id);
                                          }}
                                          className="ml-1 p-0.5 hover:bg-rose-600 rounded transition"
                                          title="Xóa vùng tẩy này"
                                        >
                                          <Trash2 className="w-3 h-3 text-rose-200 hover:text-white" />
                                        </button>
                                      </>
                                    )}
                                  </div>

                                  <div
                                    onPointerDown={(e) => handleBoxPointerDown(e, box, "resize")}
                                    onPointerMove={handleBoxPointerMove}
                                    onPointerUp={handleBoxPointerUp}
                                    className={`absolute -bottom-1.5 -right-1.5 w-4 h-4 border-2 border-white rounded-full cursor-se-resize shadow flex items-center justify-center text-white z-40 ${
                                      isSigEraser ? "bg-emerald-600" : "bg-blue-600"
                                    }`}
                                    title="Kéo để mở rộng hoặc thu nhỏ vùng tẩy"
                                  />
                                </div>
                              )}

                              {/* Non-selected hover action button */}
                              {!isSelected && (
                                <div className="opacity-0 group-hover:opacity-100 absolute inset-0 border border-emerald-500/50 bg-emerald-500/10 flex items-center justify-center transition pointer-events-auto">
                                  {isSigEraser ? (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteBox(box.id);
                                      }}
                                      className="prevent-draw px-2 py-1 rounded bg-slate-900/90 text-amber-300 shadow hover:bg-slate-950 border border-amber-400/40 text-[10px] font-bold flex items-center gap-1 transition"
                                      title="Khôi phục chữ ký này"
                                    >
                                      <RotateCcw className="w-3 h-3 text-amber-400" />
                                      <span>Khôi phục chữ ký</span>
                                    </button>
                                  ) : (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteBox(box.id);
                                      }}
                                      className="prevent-draw p-1 rounded-md bg-rose-600 text-white shadow hover:bg-rose-500 transition"
                                      title="Xóa vùng tẩy này"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* LIVE DRAWING RECTANGLE ON THIS SPECIFIC PAGE */}
                        {isDrawingThisPage && currentBox && (
                          <div
                            className={`absolute pointer-events-none border-2 ${
                              activeTool === "eraser"
                                ? "border-amber-400 bg-amber-400/20 border-dashed"
                                : redactColor === "white"
                                ? "border-blue-400 bg-white/70"
                                : redactColor === "black"
                                ? "border-blue-400 bg-black/70"
                                : "border-blue-400 bg-slate-400/70"
                            }`}
                            style={{
                              left: `${currentBox.x * 100}%`,
                              top: `${currentBox.y * 100}%`,
                              width: `${currentBox.w * 100}%`,
                              height: `${currentBox.h * 100}%`,
                            }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-slate-400 text-xs py-12">Đang kết xuất các trang tài liệu...</div>
              )}
            </div>

            {/* FLOATING ACTION TOOLBAR (DOCKED AT BOTTOM) */}
            <div className="p-2 sm:p-3 bg-slate-900/95 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 z-20">
              {/* Tool Selection Group */}
              <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
                <button
                  onClick={() => setActiveTool("view")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    activeTool === "view"
                      ? "bg-slate-800 text-white shadow"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                  title="Chế độ xem & cuộn chuột mượt mà"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Xem & Cuộn</span>
                </button>

                <button
                  id="tool-eraser"
                  onClick={() => setActiveTool("eraser")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    activeTool === "eraser"
                      ? "bg-amber-600 text-white shadow-md shadow-amber-950/40"
                      : "text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                  }`}
                  title="Cục tẩy (Eraser): Chạm hoặc quét vào 1 góc của khung chữ ký để xóa toàn bộ khung"
                >
                  <Eraser className="w-3.5 h-3.5" />
                  <span>Cục tẩy</span>
                </button>

                <button
                  id="tool-redact"
                  onClick={() => setActiveTool("redact")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    activeTool === "redact"
                      ? "bg-blue-600 text-white shadow-md shadow-blue-950/40"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                  title="Vẽ vùng che (Trắng / Đen / Xám)"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Vùng che</span>
                </button>
              </div>

              {/* Tool hint or color picker */}
              {activeTool === "eraser" && (
                <div className="hidden md:flex items-center gap-1.5 text-[11px] text-amber-300/90 bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20">
                  <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
                  <span>Quét vào 1 góc của chữ ký để tự động xóa toàn bộ khung</span>
                </div>
              )}

              {activeTool === "redact" && (
                <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
                  <button
                    onClick={() => setRedactColor("white")}
                    className={`px-2 py-1 rounded-md text-[11px] font-bold transition ${
                      redactColor === "white"
                        ? "bg-white text-slate-950 shadow"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Trắng (In ấn)
                  </button>
                  <button
                    onClick={() => setRedactColor("black")}
                    className={`px-2 py-1 rounded-md text-[11px] font-bold transition ${
                      redactColor === "black"
                        ? "bg-slate-800 text-white border border-slate-600"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Đen
                  </button>
                  <button
                    onClick={() => setRedactColor("gray")}
                    className={`px-2 py-1 rounded-md text-[11px] font-bold transition ${
                      redactColor === "gray"
                        ? "bg-slate-400 text-slate-950"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Xám
                  </button>
                </div>
              )}

              {/* Zoom Controls */}
              <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
                <button
                  onClick={handleZoomOut}
                  disabled={zoom <= 0.5}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 transition"
                  title="Thu nhỏ"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={handleZoomReset}
                  className="px-2 py-1 rounded text-xs font-semibold text-slate-300 hover:text-white"
                  title="Đặt lại 100%"
                >
                  {Math.round(zoom * 100)}%
                </button>

                <button
                  onClick={handleZoomIn}
                  disabled={zoom >= 2.5}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 transition"
                  title="Phóng to"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={handleZoomReset}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                  title="Vừa màn hình (100%)"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Page Navigator with Direct Page Jump Input (Nhập số trang để nhảy đến trang mong muốn) */}
              {detectionResult && (detectionResult.totalPages > 0 || (detectionResult.pagePreviews?.length ?? 0) > 0) && (
                <div className="flex items-center gap-1.5 bg-slate-950/90 px-2.5 py-1.5 rounded-xl border border-slate-800 text-xs shadow-inner">
                  <button
                    onClick={() => scrollToPage(activePageIndex - 1)}
                    disabled={activePageIndex <= 0}
                    className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-25 disabled:hover:bg-transparent transition"
                    title="Trang trước"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <span className="text-slate-400 font-medium">Trang</span>
                  <input
                    type="number"
                    min={1}
                    max={detectionResult?.totalPages || detectionResult?.pagePreviews?.length || 1}
                    value={pageInputVal}
                    onChange={(e) => setPageInputVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const p = parseInt(pageInputVal, 10);
                        if (!isNaN(p)) {
                          scrollToPage(p - 1);
                        }
                      }
                    }}
                    onBlur={() => {
                      const p = parseInt(pageInputVal, 10);
                      if (!isNaN(p)) {
                        scrollToPage(p - 1);
                      } else {
                        setPageInputVal(String(activePageIndex + 1));
                      }
                    }}
                    className="w-12 text-center font-bold text-white bg-slate-800 border border-slate-700 rounded-lg py-0.5 px-1 focus:border-blue-500 focus:outline-none text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    title="Nhập số trang và nhấn Enter để nhảy đến trang mong muốn"
                  />
                  <span className="text-slate-400 font-medium">
                    / {detectionResult?.totalPages || detectionResult?.pagePreviews?.length || 1}
                  </span>

                  <button
                    onClick={() => scrollToPage(activePageIndex + 1)}
                    disabled={activePageIndex >= (detectionResult?.totalPages || detectionResult?.pagePreviews?.length || 1) - 1}
                    className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-25 disabled:hover:bg-transparent transition"
                    title="Trang sau"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Clear active page redactions button */}
              {activePageBoxes.length > 0 && (
                <button
                  onClick={handleClearPageBoxes}
                  className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 text-xs border border-rose-500/20 transition flex items-center gap-1"
                  title="Xóa tất cả vùng tẩy/che trên trang này"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Dọn trang</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* SUCCESS MODAL AFTER EXPORT (Optional workflow forward) */}
      {processedUrl && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm">Xuất PDF thành công!</h3>
                  <p className="text-[11px] text-slate-400 font-mono truncate max-w-[240px]">
                    {processedFileName}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setProcessedUrl(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 mb-4 text-xs">
              {/* Direct Print Button */}
              <button
                onClick={() => {
                  if (processedBlob) PDFSignatureEngine.printPDF(processedBlob);
                }}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition shadow-lg shadow-emerald-950/40"
              >
                <Printer className="w-4 h-4" />
                <span>In tài liệu này ngay</span>
              </button>

              {/* Forward to Highlight PDF */}
              {onOpenHighlightWithFile && processedBlob && (
                <button
                  onClick={() => {
                    const exportedFile = new File([processedBlob], processedFileName, {
                      type: "application/pdf",
                    });
                    onOpenHighlightWithFile(exportedFile);
                  }}
                  className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-semibold border border-amber-500/30 transition"
                >
                  <Highlighter className="w-4 h-4 text-amber-400" />
                  <span>Chuyển sang Highlight PDF</span>
                </button>
              )}

              {/* Forward to PDF to JPEG */}
              {onOpenToJPEGWithFile && processedBlob && (
                <button
                  onClick={() => {
                    const exportedFile = new File([processedBlob], processedFileName, {
                      type: "application/pdf",
                    });
                    onOpenToJPEGWithFile(exportedFile);
                  }}
                  className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 font-semibold border border-cyan-500/30 transition"
                >
                  <FileImage className="w-4 h-4 text-cyan-400" />
                  <span>Chuyển sang PDF to JPEG</span>
                </button>
              )}
            </div>

            <button
              onClick={() => setProcessedUrl(null)}
              className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
            >
              Tiếp tục chỉnh sửa
            </button>
          </div>
        </div>
      )}

      {/* DIRECT PRINT ASSISTANT DIALOG */}
      {showPrintDialog && (
        <div className="fixed inset-0 z-[60] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-lg w-full p-6 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400">
                  <Printer className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Hộp thoại In trực tiếp</h3>
                  <p className="text-xs text-slate-400">Tài liệu đã được làm sạch chữ ký số chuyên nghiệp</p>
                </div>
              </div>
              <button
                onClick={() => setShowPrintDialog(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              Trang in đã được kết xuất sẵn sàng với độ phân giải cao. Bạn có thể bấm nút bên dưới để mở hộp thoại in của máy tính hoặc trình duyệt ngay.
            </p>

            {/* Quick Preview Thumbnail */}
            {printPages.length > 0 && (
              <div className="mb-4 bg-slate-950 p-2 rounded-xl border border-slate-800 flex items-center justify-center max-h-48 overflow-hidden">
                <img
                  src={printPages[0]}
                  alt="Xem trước trang in"
                  className="max-h-44 object-contain rounded border border-slate-700/50 shadow"
                />
              </div>
            )}

            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => {
                  if (directPrintBlob) {
                    PDFSignatureEngine.printPDF(directPrintBlob);
                  } else {
                    window.print();
                  }
                }}
                className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-sm shadow-lg shadow-emerald-950/40 flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Mở máy in ngay (In tài liệu)</span>
              </button>

              <button
                onClick={() => {
                  if (directPrintUrl) {
                    window.open(directPrintUrl, "_blank");
                  } else if (directPrintBlob) {
                    const url = URL.createObjectURL(directPrintBlob);
                    window.open(url, "_blank");
                  } else {
                    window.print();
                  }
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-semibold text-xs shadow-md shadow-blue-950/30 flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Mở bản PDF trong Tab mới để in (Ctrl + P / Máy in rời)</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (directPrintBlob) {
                      const url = URL.createObjectURL(directPrintBlob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = generateDocumentFileName({ extension: "pdf" });
                      a.click();
                      showToast("Đã tải tệp PDF sạch về máy.");
                    }
                  }}
                  className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs flex items-center justify-center gap-1.5 transition cursor-pointer border border-slate-700/60"
                >
                  <Download className="w-3.5 h-3.5 text-slate-400" />
                  <span>Tải PDF sạch về máy</span>
                </button>

                <button
                  onClick={() => setShowPrintDialog(false)}
                  className="py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white font-medium text-xs transition cursor-pointer border border-slate-700/60"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* HIDDEN PRINT PORTAL FOR BROWSER PRINT (WINDOW.PRINT) */}
      <div id="vietscan-direct-print-portal" className="hidden print:block fixed inset-0 z-[99999] bg-white text-black p-0 m-0">
        {printPages.map((src, idx) => (
          <div
            key={`print_portal_page_${idx}`}
            style={{
              pageBreakAfter: "always",
              breakAfter: "page",
              width: "100%",
              height: "100%",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              margin: 0,
              padding: 0,
            }}
          >
            <img
              src={src}
              alt={`Page ${idx + 1}`}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                width: "auto",
                height: "auto",
                display: "block",
                objectFit: "contain",
              }}
            />
          </div>
        ))}
      </div>

      {/* LOADING OVERLAY */}
      {isLoading && (
        <div className="fixed inset-0 z-[70] bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center p-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 animate-spin mb-3">
            <FileSignature className="w-6 h-6" />
          </div>
          <p className="text-sm font-semibold text-white">{loadingText || "Đang xử lý..."}</p>
        </div>
      )}
    </div>
  );
};
