import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Highlighter,
  Upload,
  Check,
  RotateCcw,
  FileDown,
  Share2,
  AlertCircle,
  X,
  ArrowLeft,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize,
  RotateCw,
  Crop,
  Undo,
  Redo,
  Sparkles,
  RefreshCw,
  Edit3,
  Square,
  Eraser,
  Move,
} from "lucide-react";
import { PDFToolsEngine, PDFPageItem, HighlightStroke } from "../utils/pdfToolsEngine";
import { PDFGenerator } from "../utils/pdfGenerator";
import { generateDocumentFileName } from "../utils/naming";
import { PDFPageCropModal } from "./PDFPageCropModal";

interface PDFHighlightModalProps {
  onClose: () => void;
}

const HIGHLIGHT_COLORS = [
  { name: "Vàng dạ quang", hex: "#ffe600", bg: "bg-yellow-400", border: "border-yellow-300" },
  { name: "Xanh lá dạ quang", hex: "#00e676", bg: "bg-emerald-400", border: "border-emerald-300" },
  { name: "Hồng dạ quang", hex: "#ff4081", bg: "bg-pink-500", border: "border-pink-400" },
  { name: "Xanh ngọc dạ quang", hex: "#00e5ff", bg: "bg-cyan-400", border: "border-cyan-300" },
  { name: "Cam dạ quang", hex: "#ff9100", bg: "bg-amber-500", border: "border-amber-400" },
  { name: "Tím dạ quang", hex: "#d500f9", bg: "bg-purple-500", border: "border-purple-400" },
];

const BRUSH_SIZES = [
  { label: "Siêu mảnh (Chữ nhỏ)", sizeFactor: 0.006, px: 6 },
  { label: "Mảnh (Chữ thường)", sizeFactor: 0.012, px: 12 },
  { label: "Vừa (Dòng chữ)", sizeFactor: 0.020, px: 20 },
  { label: "Đậm (Tiêu đề)", sizeFactor: 0.035, px: 35 },
];

export const PDFHighlightModal: React.FC<PDFHighlightModalProps> = ({ onClose }) => {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PDFPageItem[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);

  // Highlighting strokes map: Record<pageId, HighlightStroke[]>
  const [highlightsMap, setHighlightsMap] = useState<Record<string, HighlightStroke[]>>({});
  // History for undo/redo per page: Record<pageId, HighlightStroke[][]>
  const [historyMap, setHistoryMap] = useState<Record<string, HighlightStroke[][]>>({});
  const [redoMap, setRedoMap] = useState<Record<string, HighlightStroke[][]>>({});

  // Tool settings
  const [drawTool, setDrawTool] = useState<"pen" | "box" | "eraser" | "pan">("pen");
  const [selectedColor, setSelectedColor] = useState<string>("#ffe600");
  const [selectedSizeIndex, setSelectedSizeIndex] = useState<number>(1); // Medium default

  // Zoom & Pan state
  const [zoomLevel, setZoomLevel] = useState<number>(1.0); // 1.0 = 100%, up to 4.0 = 400%
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const panStartRef = useRef<{ x: number; y: number; startPanX: number; startPanY: number }>({
    x: 0,
    y: 0,
    startPanX: 0,
    startPanY: 0,
  });

  // Active drawing state
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [currentPathPoints, setCurrentPathPoints] = useState<{ x: number; y: number }[]>([]);
  const [boxStartPoint, setBoxStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [currentDraftBox, setCurrentDraftBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // States for processing & modals
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [croppingPage, setCroppingPage] = useState<PDFPageItem | null>(null);

  // Export results
  const [highlightedPdfUrl, setHighlightedPdfUrl] = useState<string | null>(null);
  const [highlightedBlob, setHighlightedBlob] = useState<Blob | null>(null);
  const [highlightedFileName, setHighlightedFileName] = useState<string>("");

  const pageContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentPage = pages[currentPageIndex] || null;
  const currentHighlights = currentPage ? highlightsMap[currentPage.id] || [] : [];

  // File loading handler
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const f = files[0];
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      setErrorMsg("Tệp đã chọn không phải định dạng PDF.");
      return;
    }

    try {
      setErrorMsg(null);
      setIsExtracting(true);
      const buffer = await f.arrayBuffer();
      const extracted = await PDFToolsEngine.renderPDFToPages(buffer, f.name);

      setFile(f);
      setPages(extracted);
      setCurrentPageIndex(0);
      setHighlightsMap({});
      setHistoryMap({});
      setRedoMap({});
      setZoomLevel(1.0);
      setPanOffset({ x: 0, y: 0 });
    } catch (err: any) {
      console.error("Failed to read PDF:", err);
      setErrorMsg(err.message || "Không thể đọc tệp PDF. Vui lòng kiểm tra lại tệp.");
    } finally {
      setIsExtracting(false);
      if (e.target) e.target.value = "";
    }
  };

  // Convert client pointer event coordinates to normalized page coordinate (0..1)
  const getNormalizedCoordinates = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pageContainerRef.current) return { x: 0, y: 0 };
    const rect = pageContainerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x, y };
  };

  // Push new state to history for Undo
  const pushToHistory = (pageId: string, newHighlights: HighlightStroke[]) => {
    setHighlightsMap((prev) => ({ ...prev, [pageId]: newHighlights }));
    setHistoryMap((prev) => {
      const pageHist = prev[pageId] || [];
      return { ...prev, [pageId]: [...pageHist, currentHighlights] };
    });
    // Clear redo on new action
    setRedoMap((prev) => ({ ...prev, [pageId]: [] }));
  };

  // Undo
  const handleUndo = () => {
    if (!currentPage) return;
    const pageId = currentPage.id;
    const pageHist = historyMap[pageId] || [];
    if (pageHist.length === 0) return;

    const previousState = pageHist[pageHist.length - 1];
    setRedoMap((prev) => ({
      ...prev,
      [pageId]: [...(prev[pageId] || []), currentHighlights],
    }));

    setHighlightsMap((prev) => ({ ...prev, [pageId]: previousState }));
    setHistoryMap((prev) => ({ ...prev, [pageId]: pageHist.slice(0, -1) }));
  };

  // Redo
  const handleRedo = () => {
    if (!currentPage) return;
    const pageId = currentPage.id;
    const pageRedo = redoMap[pageId] || [];
    if (pageRedo.length === 0) return;

    const nextState = pageRedo[pageRedo.length - 1];
    setHistoryMap((prev) => ({
      ...prev,
      [pageId]: [...(prev[pageId] || []), currentHighlights],
    }));

    setHighlightsMap((prev) => ({ ...prev, [pageId]: nextState }));
    setRedoMap((prev) => ({ ...prev, [pageId]: pageRedo.slice(0, -1) }));
  };

  // Clear all highlights on current page
  const handleClearCurrentPage = () => {
    if (!currentPage) return;
    pushToHistory(currentPage.id, []);
  };

  // Rotate current page 90 degrees
  const handleRotateCurrentPage = async () => {
    if (!currentPage) return;
    try {
      const { dataUrl, width, height } = await PDFToolsEngine.rotateImageDataUrl(
        currentPage.renderedImage,
        90
      );
      setPages((prev) =>
        prev.map((p, i) =>
          i === currentPageIndex
            ? {
                ...p,
                renderedImage: dataUrl,
                rotation: (p.rotation + 90) % 360,
                width,
                height,
              }
            : p
        )
      );
    } catch (err) {
      console.error("Rotate error:", err);
    }
  };

  // Crop completion callback
  const handleCropComplete = (newImageSrc: string) => {
    if (!croppingPage) return;
    setPages((prev) =>
      prev.map((p) =>
        p.id === croppingPage.id
          ? {
              ...p,
              renderedImage: newImageSrc,
              isCropped: true,
            }
          : p
      )
    );
    setCroppingPage(null);
  };

  // Pointer down (start drawing / box / erasing / panning)
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!currentPage) return;

    if (drawTool === "pan" || e.button === 1 || e.altKey) {
      // Pan mode
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        startPanX: panOffset.x,
        startPanY: panOffset.y,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    const coords = getNormalizedCoordinates(e);
    setIsDrawing(true);

    if (drawTool === "pen") {
      setCurrentPathPoints([coords]);
    } else if (drawTool === "box") {
      setBoxStartPoint(coords);
      setCurrentDraftBox({ x: coords.x, y: coords.y, w: 0, h: 0 });
    } else if (drawTool === "eraser") {
      // Remove any highlight stroke close to this point
      eraseAtPoint(coords);
    }

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  // Pointer move
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPanning) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPanOffset({
        x: panStartRef.current.startPanX + dx,
        y: panStartRef.current.startPanY + dy,
      });
      return;
    }

    if (!isDrawing || !currentPage) return;
    const coords = getNormalizedCoordinates(e);

    if (drawTool === "pen") {
      setCurrentPathPoints((prev) => [...prev, coords]);
    } else if (drawTool === "box" && boxStartPoint) {
      const minX = Math.min(boxStartPoint.x, coords.x);
      const minY = Math.min(boxStartPoint.y, coords.y);
      const w = Math.abs(coords.x - boxStartPoint.x);
      const h = Math.abs(coords.y - boxStartPoint.y);
      setCurrentDraftBox({ x: minX, y: minY, w, h });
    } else if (drawTool === "eraser") {
      eraseAtPoint(coords);
    }
  };

  // Pointer up
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPanning) {
      setIsPanning(false);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (err) {}
      return;
    }

    if (!isDrawing || !currentPage) {
      setIsDrawing(false);
      return;
    }

    const currentBrush = BRUSH_SIZES[selectedSizeIndex];

    if (drawTool === "pen" && currentPathPoints.length > 1) {
      const newStroke: HighlightStroke = {
        id: `stroke_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        type: "path",
        color: selectedColor,
        opacity: 0.45,
        points: currentPathPoints,
        size: currentBrush.sizeFactor,
      };
      pushToHistory(currentPage.id, [...currentHighlights, newStroke]);
    } else if (drawTool === "box" && currentDraftBox && currentDraftBox.w > 0.005 && currentDraftBox.h > 0.003) {
      const newBoxStroke: HighlightStroke = {
        id: `box_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        type: "box",
        color: selectedColor,
        opacity: 0.45,
        x: currentDraftBox.x,
        y: currentDraftBox.y,
        w: currentDraftBox.w,
        h: currentDraftBox.h,
      };
      pushToHistory(currentPage.id, [...currentHighlights, newBoxStroke]);
    }

    setIsDrawing(false);
    setCurrentPathPoints([]);
    setBoxStartPoint(null);
    setCurrentDraftBox(null);

    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (err) {}
  };

  // Erase stroke helper
  const eraseAtPoint = (pt: { x: number; y: number }) => {
    if (!currentPage) return;
    const threshold = 0.035;

    const remaining = currentHighlights.filter((hl) => {
      if (hl.type === "box" && hl.x !== undefined && hl.y !== undefined && hl.w !== undefined && hl.h !== undefined) {
        return !(
          pt.x >= hl.x - 0.01 &&
          pt.x <= hl.x + hl.w + 0.01 &&
          pt.y >= hl.y - 0.01 &&
          pt.y <= hl.y + hl.h + 0.01
        );
      } else if (hl.type === "path" && hl.points) {
        return !hl.points.some((p) => Math.hypot(p.x - pt.x, p.y - pt.y) < threshold);
      }
      return true;
    });

    if (remaining.length !== currentHighlights.length) {
      setHighlightsMap((prev) => ({ ...prev, [currentPage.id]: remaining }));
    }
  };

  // Zoom controls
  const handleZoom = (direction: "in" | "out" | "reset") => {
    if (direction === "reset") {
      setZoomLevel(1.0);
      setPanOffset({ x: 0, y: 0 });
    } else if (direction === "in") {
      setZoomLevel((prev) => Math.min(4.0, +(prev + 0.35).toFixed(2)));
    } else {
      setZoomLevel((prev) => Math.max(0.75, +(prev - 0.35).toFixed(2)));
    }
  };

  // Export Highlighted PDF
  const handleExportPDF = async () => {
    if (pages.length === 0) return;

    setIsProcessing(true);
    setErrorMsg(null);

    try {
      // Process every page with its highlights burned on canvas
      const processedPages: { renderedImage: string }[] = [];

      for (const page of pages) {
        const pageHls = highlightsMap[page.id] || [];
        const burnedImage = await PDFToolsEngine.burnHighlightsToImage(
          page.renderedImage,
          pageHls
        );
        processedPages.push({ renderedImage: burnedImage });
      }

      const blob = await PDFToolsEngine.generatePDFFromPages(processedPages);
      const url = URL.createObjectURL(blob);
      const fileName = `Highlight_${generateDocumentFileName()}`;

      setHighlightedBlob(blob);
      setHighlightedPdfUrl(url);
      setHighlightedFileName(fileName);
    } catch (err: any) {
      console.error("Export error:", err);
      setErrorMsg(err.message || "Không thể xuất file PDF. Vui lòng thử lại.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!highlightedBlob) return;
    PDFGenerator.downloadBlob(highlightedBlob, highlightedFileName);
  };

  const handleShare = async () => {
    if (!highlightedBlob) return;
    await PDFGenerator.sharePDFOrImage(highlightedBlob, highlightedFileName, "Tài liệu PDF Highlight");
  };

  const canUndo = currentPage && (historyMap[currentPage.id] || []).length > 0;
  const canRedo = currentPage && (redoMap[currentPage.id] || []).length > 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-2 sm:p-4 pt-safe-top pb-safe bg-slate-950/90 backdrop-blur-md select-none overflow-hidden animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col h-full max-h-[calc(100dvh-2.5rem)]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-3 sm:px-5 py-3 border-b border-slate-800 bg-slate-900/95 shrink-0 gap-2">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              id="btn-pdf-highlight-back"
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 active:bg-slate-700 border border-slate-700/80 text-slate-100 hover:text-white active:scale-95 transition text-xs font-semibold shadow-sm min-h-[40px]"
            >
              <ArrowLeft className="w-4 h-4 text-amber-400" />
              <span>Quay lại</span>
            </button>
            <div className="hidden xs:flex p-2 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <Highlighter className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white leading-tight">Highlight PDF (Bôi đậm & Tô chữ)</h3>
              <p className="text-[11px] sm:text-xs text-slate-400 hidden sm:block">
                Xem toàn bộ các trang, phóng to tô từng dòng chữ nhỏ, xoay & cắt trang linh hoạt
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-950">
          {errorMsg && (
            <div className="m-3 p-3 rounded-2xl bg-red-950/60 border border-red-800/80 text-red-300 text-xs flex items-center gap-2.5 shrink-0">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {!highlightedPdfUrl ? (
            <>
              {!file || pages.length === 0 ? (
                /* File Upload Area */
                <div className="flex-1 flex items-center justify-center p-6">
                  <label
                    htmlFor="pdf-hl-input"
                    className="flex flex-col items-center justify-center p-10 sm:p-14 border-2 border-dashed border-slate-700 hover:border-amber-500/80 rounded-3xl bg-slate-950/60 cursor-pointer transition text-center group max-w-lg w-full"
                  >
                    <div className="p-4 rounded-2xl bg-amber-500/10 text-amber-400 group-hover:scale-110 transition mb-3">
                      <Upload className="w-8 h-8" />
                    </div>
                    <h4 className="text-base font-bold text-white">Bấm để chọn tệp PDF cần Highlight</h4>
                    <p className="text-xs text-slate-400 mt-1">
                      Xem được toàn bộ các trang, hỗ trợ phóng to 400% để tô chuẩn từng chữ nhỏ nhất.
                    </p>
                    <span className="mt-4 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition shadow-lg shadow-amber-500/30">
                      Chọn tệp PDF
                    </span>
                    <input
                      ref={fileInputRef}
                      id="pdf-hl-input"
                      type="file"
                      accept="application/pdf,.pdf"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </label>
                </div>
              ) : (
                /* Full Multi-Page Highlighting Studio */
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Top Control Bar: Drawing Tools, Brush Sizes, Colors, Zoom, Undo */}
                  <div className="px-3 sm:px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
                    {/* Left: Tools Picker */}
                    <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                      <button
                        onClick={() => setDrawTool("pen")}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                          drawTool === "pen"
                            ? "bg-amber-500 text-slate-950 shadow"
                            : "text-slate-400 hover:text-white"
                        }`}
                        title="Bút dạ quang tự do (Tô theo từng nét chữ)"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Bút tô</span>
                      </button>

                      <button
                        onClick={() => setDrawTool("box")}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                          drawTool === "box"
                            ? "bg-amber-500 text-slate-950 shadow"
                            : "text-slate-400 hover:text-white"
                        }`}
                        title="Kéo hộp chữ nhật (Thẳng theo dòng)"
                      >
                        <Square className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Kéo dải</span>
                      </button>

                      <button
                        onClick={() => setDrawTool("eraser")}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                          drawTool === "eraser"
                            ? "bg-amber-500 text-slate-950 shadow"
                            : "text-slate-400 hover:text-white"
                        }`}
                        title="Tẩy xóa nét highlight"
                      >
                        <Eraser className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Tẩy</span>
                      </button>

                      <button
                        onClick={() => setDrawTool("pan")}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                          drawTool === "pan"
                            ? "bg-blue-600 text-white shadow"
                            : "text-slate-400 hover:text-white"
                        }`}
                        title="Di chuyển trang (Khi phóng to)"
                      >
                        <Move className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Di chuyển</span>
                      </button>
                    </div>

                    {/* Middle: Color Palette & Brush Size */}
                    <div className="flex items-center gap-2">
                      {/* Color Palette */}
                      <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                        {HIGHLIGHT_COLORS.map((c) => (
                          <button
                            key={c.hex}
                            onClick={() => setSelectedColor(c.hex)}
                            className={`w-6 h-6 rounded-full transition transform ${c.bg} ${
                              selectedColor === c.hex
                                ? "ring-2 ring-white scale-110 shadow-md"
                                : "opacity-75 hover:opacity-100"
                            }`}
                            title={c.name}
                          />
                        ))}
                      </div>

                      {/* Brush Size Picker */}
                      <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                        {BRUSH_SIZES.map((b, idx) => (
                          <button
                            key={idx}
                            onClick={() => setSelectedSizeIndex(idx)}
                            className={`px-2 py-1 rounded-lg text-[11px] font-bold transition ${
                              selectedSizeIndex === idx
                                ? "bg-slate-800 text-white border border-slate-700"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                            title={b.label}
                          >
                            <span className="flex items-center gap-1">
                              <span
                                className="rounded-full bg-amber-400 inline-block"
                                style={{ width: `${6 + idx * 3}px`, height: `${6 + idx * 3}px` }}
                              />
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Right: Zoom & History Controls */}
                    <div className="flex items-center gap-1.5">
                      {/* Zoom Controls */}
                      <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-xl border border-slate-800 text-xs">
                        <button
                          onClick={() => handleZoom("out")}
                          className="p-1 text-slate-400 hover:text-white"
                          title="Thu nhỏ"
                        >
                          <ZoomOut className="w-3.5 h-3.5" />
                        </button>
                        <span className="font-mono text-[11px] text-amber-400 min-w-[38px] text-center font-bold">
                          {Math.round(zoomLevel * 100)}%
                        </span>
                        <button
                          onClick={() => handleZoom("in")}
                          className="p-1 text-slate-400 hover:text-white"
                          title="Phóng to"
                        >
                          <ZoomIn className="w-3.5 h-3.5" />
                        </button>
                        {zoomLevel !== 1.0 && (
                          <button
                            onClick={() => handleZoom("reset")}
                            className="p-1 text-slate-400 hover:text-white"
                            title="Đặt lại 100%"
                          >
                            <Maximize className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Undo / Redo */}
                      <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                        <button
                          onClick={handleUndo}
                          disabled={!canUndo}
                          className="p-1.5 rounded text-slate-400 hover:text-white disabled:opacity-30"
                          title="Hoàn tác (Undo)"
                        >
                          <Undo className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={handleRedo}
                          disabled={!canRedo}
                          className="p-1.5 rounded text-slate-400 hover:text-white disabled:opacity-30"
                          title="Làm lại (Redo)"
                        >
                          <Redo className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Page Rotate & Crop tools */}
                      <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                        <button
                          onClick={handleRotateCurrentPage}
                          className="p-1.5 rounded text-emerald-400 hover:text-emerald-300"
                          title="Xoay trang 90°"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => currentPage && setCroppingPage(currentPage)}
                          className="p-1.5 rounded text-blue-400 hover:text-blue-300"
                          title="Cắt lề / Crop trang"
                        >
                          <Crop className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={handleClearCurrentPage}
                          className="p-1.5 rounded text-red-400 hover:text-red-300"
                          title="Xóa highlight trang này"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Main Page Viewport with Zoom and Interactive Highlight Stage */}
                  <div className="relative flex-1 w-full overflow-hidden bg-slate-950 flex items-center justify-center p-2 sm:p-4">
                    {currentPage && (
                      <div
                        className="relative max-h-full max-w-full flex items-center justify-center overflow-auto rounded-xl shadow-2xl transition-transform"
                        style={{
                          transform: `scale(${zoomLevel}) translate(${panOffset.x / zoomLevel}px, ${
                            panOffset.y / zoomLevel
                          }px)`,
                          transformOrigin: "center center",
                        }}
                      >
                        {/* Interactive Page Container */}
                        <div
                          ref={pageContainerRef}
                          onPointerDown={handlePointerDown}
                          onPointerMove={handlePointerMove}
                          onPointerUp={handlePointerUp}
                          onPointerCancel={handlePointerUp}
                          className={`relative inline-block select-none touch-none ${
                            drawTool === "pan" ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair"
                          }`}
                        >
                          {/* Base PDF Rendered Page Image */}
                          <img
                            src={currentPage.renderedImage}
                            alt={`Trang ${currentPageIndex + 1}`}
                            className="max-h-[62vh] sm:max-h-[66vh] w-auto object-contain rounded-lg shadow-xl pointer-events-none bg-white"
                          />

                          {/* Applied Highlights Layer */}
                          <svg
                            className="absolute inset-0 w-full h-full pointer-events-none"
                            viewBox="0 0 1000 1000"
                            preserveAspectRatio="none"
                          >
                            {currentHighlights.map((hl) => {
                              if (
                                hl.type === "box" &&
                                hl.x !== undefined &&
                                hl.y !== undefined &&
                                hl.w !== undefined &&
                                hl.h !== undefined
                              ) {
                                return (
                                  <rect
                                    key={hl.id}
                                    x={hl.x * 1000}
                                    y={hl.y * 1000}
                                    width={hl.w * 1000}
                                    height={hl.h * 1000}
                                    fill={hl.color}
                                    fillOpacity={hl.opacity}
                                    rx={2}
                                    style={{ mixBlendMode: "multiply" }}
                                  />
                                );
                              } else if (hl.type === "path" && hl.points && hl.points.length > 0) {
                                const d = hl.points.reduce((acc, pt, i) => {
                                  return i === 0
                                    ? `M ${(pt.x * 1000).toFixed(1)} ${(pt.y * 1000).toFixed(1)}`
                                    : `${acc} L ${(pt.x * 1000).toFixed(1)} ${(pt.y * 1000).toFixed(1)}`;
                                }, "");
                                const strokeW = (hl.size || 0.016) * 1000;
                                return (
                                  <path
                                    key={hl.id}
                                    d={d}
                                    fill="none"
                                    stroke={hl.color}
                                    strokeWidth={strokeW}
                                    strokeOpacity={hl.opacity}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    style={{ mixBlendMode: "multiply" }}
                                  />
                                );
                              }
                              return null;
                            })}

                            {/* Active Draft Drawing Strokes */}
                            {isDrawing && drawTool === "pen" && currentPathPoints.length > 0 && (
                              <path
                                d={currentPathPoints.reduce((acc, pt, i) => {
                                  return i === 0
                                    ? `M ${(pt.x * 1000).toFixed(1)} ${(pt.y * 1000).toFixed(1)}`
                                    : `${acc} L ${(pt.x * 1000).toFixed(1)} ${(pt.y * 1000).toFixed(1)}`;
                                }, "")}
                                fill="none"
                                stroke={selectedColor}
                                strokeWidth={BRUSH_SIZES[selectedSizeIndex].sizeFactor * 1000}
                                strokeOpacity={0.65}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{ mixBlendMode: "multiply" }}
                              />
                            )}

                            {isDrawing && drawTool === "box" && currentDraftBox && (
                              <rect
                                x={currentDraftBox.x * 1000}
                                y={currentDraftBox.y * 1000}
                                width={currentDraftBox.w * 1000}
                                height={currentDraftBox.h * 1000}
                                fill={selectedColor}
                                fillOpacity={0.5}
                                stroke={selectedColor}
                                strokeWidth="2"
                                rx={2}
                                style={{ mixBlendMode: "multiply" }}
                              />
                            )}
                          </svg>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Bottom Multi-Page Thumbnail Carousel Bar */}
                  <div className="px-4 py-2.5 bg-slate-900 border-t border-slate-800 flex items-center justify-between gap-3 shrink-0">
                    {/* Navigation Buttons */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCurrentPageIndex((prev) => Math.max(0, prev - 1))}
                        disabled={currentPageIndex === 0}
                        className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white disabled:opacity-30 transition"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="text-xs font-bold text-white min-w-[70px] text-center">
                        Trang {currentPageIndex + 1} / {pages.length}
                      </span>
                      <button
                        onClick={() => setCurrentPageIndex((prev) => Math.min(pages.length - 1, prev + 1))}
                        disabled={currentPageIndex === pages.length - 1}
                        className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white disabled:opacity-30 transition"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Horizontal Page Thumbnails */}
                    <div className="flex-1 flex items-center gap-2 overflow-x-auto py-1 px-2 max-w-xl mx-auto scrollbar-thin">
                      {pages.map((p, idx) => {
                        const isCurrent = idx === currentPageIndex;
                        const pageHlCount = (highlightsMap[p.id] || []).length;

                        return (
                          <button
                            key={p.id}
                            onClick={() => {
                              setCurrentPageIndex(idx);
                              setZoomLevel(1.0);
                              setPanOffset({ x: 0, y: 0 });
                            }}
                            className={`relative shrink-0 w-11 h-14 rounded-lg border-2 overflow-hidden bg-slate-950 transition ${
                              isCurrent
                                ? "border-amber-400 ring-2 ring-amber-500/40 scale-105"
                                : "border-slate-800 opacity-60 hover:opacity-100"
                            }`}
                          >
                            <img
                              src={p.renderedImage}
                              alt={`Trang ${idx + 1}`}
                              className="w-full h-full object-cover"
                            />
                            <span className="absolute bottom-0 inset-x-0 bg-slate-950/85 text-[9px] text-white font-bold text-center">
                              {idx + 1}
                            </span>
                            {pageHlCount > 0 && (
                              <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-amber-400 shadow" />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* Export Action Button */}
                    <button
                      onClick={handleExportPDF}
                      disabled={isProcessing}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-lg shadow-amber-500/30 disabled:opacity-40 transition active:scale-98 shrink-0"
                    >
                      {isProcessing ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Đang lưu PDF...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          <span>Lưu PDF Highlight</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Highlight Success View */
            <div className="space-y-4 text-center py-10 px-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                <Check className="w-8 h-8" />
              </div>
              <div>
                <h4 className="text-lg font-bold text-white">Highlight tài liệu PDF thành công!</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                  Đã ghi nhận toàn bộ các nét bút và vùng bôi vàng trên tất cả các trang với độ sắc nét cao.
                </p>
                <p className="text-xs font-mono text-amber-400 mt-2 bg-slate-950/80 py-1 px-3 rounded-lg inline-block border border-slate-800">
                  {highlightedFileName}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-3 pt-3 max-w-md mx-auto">
                <button
                  onClick={handleDownload}
                  className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition active:scale-98 shadow-lg shadow-amber-500/30"
                >
                  <FileDown className="w-4 h-4" />
                  <span>Tải file PDF</span>
                </button>
                <button
                  onClick={handleShare}
                  className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition active:scale-98 border border-slate-700"
                >
                  <Share2 className="w-4 h-4 text-amber-400" />
                  <span>Chia sẻ</span>
                </button>
              </div>

              <button
                onClick={() => {
                  setHighlightedPdfUrl(null);
                  setHighlightedBlob(null);
                }}
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 mt-3"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Tiếp tục chỉnh sửa nét tô</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Crop Modal for Active Page */}
      {croppingPage && (
        <PDFPageCropModal
          imageSrc={croppingPage.renderedImage}
          pageNumber={currentPageIndex + 1}
          onComplete={handleCropComplete}
          onCancel={() => setCroppingPage(null)}
        />
      )}
    </div>
  );
};
