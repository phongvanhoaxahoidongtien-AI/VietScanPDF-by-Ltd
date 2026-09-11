import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  ArrowLeft,
  Upload,
  FileText,
  FileSpreadsheet,
  Layers,
  Plus,
  Trash2,
  RotateCw,
  MoveUp,
  MoveDown,
  Edit3,
  Type,
  Highlighter,
  Image as ImageIcon,
  Check,
  X,
  Download,
  Share2,
  FolderPlus,
  RefreshCw,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Sliders,
  CheckCircle2,
  AlertCircle,
  FileCode,
  FileImage,
  Undo2,
} from "lucide-react";
import {
  DocumentConverter,
  EditableDocPage,
  TextOverlayItem,
  ImageOverlayItem,
} from "../utils/documentConverter";
import { HighlightStroke } from "../utils/pdfToolsEngine";
import { generateDefaultDocumentTitle } from "../utils/naming";
import { ScannedDocument } from "../types";
import { StorageService } from "../utils/storage";

interface DocumentEditorModalProps {
  isOpen?: boolean;
  onClose: () => void;
  onForwardToHighlight: (file: File) => void;
  onForwardToPDFToJPEG: (file: File) => void;
  onSaveToDocuments?: (newDoc: ScannedDocument) => void;
}

const HIGHLIGHT_COLORS = [
  { name: "Vàng dạ quang", hex: "#ffe600" },
  { name: "Xanh lá dạ quang", hex: "#00e676" },
  { name: "Hồng dạ quang", hex: "#ff4081" },
  { name: "Xanh ngọc dạ quang", hex: "#00e5ff" },
  { name: "Cam dạ quang", hex: "#ff9100" },
];

const TEXT_COLORS = [
  { name: "Đen", hex: "#0f172a" },
  { name: "Xanh dương", hex: "#2563eb" },
  { name: "Đỏ", hex: "#dc2626" },
  { name: "Vàng", hex: "#eab308" },
  { name: "Trắng", hex: "#ffffff" },
];

export const DocumentEditorModal: React.FC<DocumentEditorModalProps> = ({
  isOpen,
  onClose,
  onForwardToHighlight,
  onForwardToPDFToJPEG,
  onSaveToDocuments,
}) => {
  if (isOpen === false) return null;

  // Document State
  const [docTitle, setDocTitle] = useState<string>(() => generateDefaultDocumentTitle());
  const [isEditingTitle, setIsEditingTitle] = useState<boolean>(false);
  const [pages, setPages] = useState<EditableDocPage[]>([]);
  const [activePageIndex, setActivePageIndex] = useState<number | null>(null);

  // Loading & Error states
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingStatus, setLoadingStatus] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Active Page Detail Tool states
  const [activeTool, setActiveTool] = useState<"view" | "highlight" | "text" | "image">("view");
  const [highlightColor, setHighlightColor] = useState<string>("#ffe600");
  const [highlightSize, setHighlightSize] = useState<number>(0.025); // relative to height
  const [highlightToolType, setHighlightToolType] = useState<"pen" | "box">("pen");
  const [highlightBrushPreset, setHighlightBrushPreset] = useState<"small" | "medium" | "large">("medium");
  const [boxStartPos, setBoxStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currentBoxCoords, setCurrentBoxCoords] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [isDrawingHighlight, setIsDrawingHighlight] = useState<boolean>(false);
  const [currentDrawPoints, setCurrentDrawPoints] = useState<{ x: number; y: number }[]>([]);

  // Text overlay modal state
  const [showAddTextModal, setShowAddTextModal] = useState<boolean>(false);
  const [textInput, setTextInput] = useState<string>("");
  const [textColor, setTextColor] = useState<string>("#0f172a");
  const [textBgColor, setTextBgColor] = useState<string>("#ffffff");
  const [textFontSize, setTextFontSize] = useState<number>(20);
  const [textIsBold, setTextIsBold] = useState<boolean>(true);

  // Dragging text/image state on canvas
  const [draggingItem, setDraggingItem] = useState<{
    type: "text" | "image";
    id: string;
    startX: number;
    startY: number;
    initItemX: number;
    initItemY: number;
  } | null>(null);

  // Export State
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number }>({
    current: 0,
    total: 0,
  });
  const [exportedResult, setExportedResult] = useState<{
    blob: Blob;
    url: string;
    fileName: string;
    file: File;
  } | null>(null);
  const [isSavedToApp, setIsSavedToApp] = useState<boolean>(false);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const appendFileInputRef = useRef<HTMLInputElement>(null);
  const imageOverlayInputRef = useRef<HTMLInputElement>(null);
  const detailCanvasContainerRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  // Handle Initial File Selection
  const handleSelectFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const { pages: convertedPages, title: detectedTitle } =
        await DocumentConverter.convertFileToPages(file, (status) => {
          setLoadingStatus(status);
        });

      // Standardized naming format: VietScan_by_Ltd_dd_mm_yy_hh_mm_ss
      setDocTitle(generateDefaultDocumentTitle());
      setPages(convertedPages);
      showToast(`Đã tải thành công ${convertedPages.length} trang.`);
    } catch (err: any) {
      console.error("Conversion error:", err);
      setErrorMsg(err.message || "Không thể xử lý tệp. Vui lòng kiểm tra lại định dạng tệp.");
    } finally {
      setIsLoading(false);
      setLoadingStatus("");
      if (e.target) e.target.value = "";
    }
  };

  // Append more pages from another file
  const handleAppendFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const { pages: newPages } = await DocumentConverter.convertFileToPages(file, (status) => {
        setLoadingStatus(status);
      });

      setPages((prev) => {
        const renumbered = newPages.map((p, idx) => ({
          ...p,
          pageNumber: prev.length + idx + 1,
        }));
        return [...prev, ...renumbered];
      });

      showToast(`Đã ghép thêm ${newPages.length} trang vào tài liệu.`);
    } catch (err: any) {
      console.error("Append file error:", err);
      showToast(err.message || "Không thể ghép thêm tệp.");
    } finally {
      setIsLoading(false);
      setLoadingStatus("");
      if (e.target) e.target.value = "";
    }
  };

  // Add a blank white page
  const handleAddBlankPage = () => {
    const newPage = DocumentConverter.createBlankPage(pages.length + 1);
    setPages((prev) => [...prev, newPage]);
    showToast("Đã thêm 1 trang trắng.");
  };

  // Move page position
  const handleMovePage = (index: number, direction: "up" | "down") => {
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === pages.length - 1) return;

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    const updated = [...pages];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;

    // Renumber
    const renumbered = updated.map((p, i) => ({ ...p, pageNumber: i + 1 }));
    setPages(renumbered);
  };

  // Rotate single page 90 degrees clockwise
  const handleRotatePage = (index: number) => {
    setPages((prev) => {
      const copy = [...prev];
      const cur = copy[index];
      const nextRot = ((cur.rotation + 90) % 360) as 0 | 90 | 180 | 270;
      copy[index] = { ...cur, rotation: nextRot };
      return copy;
    });
  };

  // Delete single page
  const handleDeletePage = (index: number) => {
    if (pages.length <= 1) {
      showToast("Tài liệu cần có ít nhất 1 trang.");
      return;
    }

    setPages((prev) => {
      const filtered = prev.filter((_, i) => i !== index);
      return filtered.map((p, i) => ({ ...p, pageNumber: i + 1 }));
    });

    if (activePageIndex === index) {
      setActivePageIndex(null);
    } else if (activePageIndex !== null && activePageIndex > index) {
      setActivePageIndex(activePageIndex - 1);
    }
    showToast("Đã xóa trang.");
  };

  // Duplicate single page
  const handleDuplicatePage = (index: number) => {
    const pageToDup = pages[index];
    const newPage: EditableDocPage = {
      ...pageToDup,
      id: `page_dup_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      pageNumber: index + 2,
    };

    setPages((prev) => {
      const updated = [...prev];
      updated.splice(index + 1, 0, newPage);
      return updated.map((p, i) => ({ ...p, pageNumber: i + 1 }));
    });
    showToast("Đã nhân bản trang.");
  };

  // Highlight Pointer Events
  const getNormalizedPointerPos = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!detailCanvasContainerRef.current) return { x: 0, y: 0 };
    const rect = detailCanvasContainerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activeTool !== "highlight") return;
    setIsDrawingHighlight(true);
    const pos = getNormalizedPointerPos(e);
    if (highlightToolType === "box") {
      setBoxStartPos(pos);
      setCurrentBoxCoords({ x: pos.x, y: pos.y, w: 0.001, h: 0.001 });
    } else {
      setCurrentDrawPoints([pos]);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activeTool === "highlight" && isDrawingHighlight) {
      const pos = getNormalizedPointerPos(e);
      if (highlightToolType === "box" && boxStartPos) {
        const x = Math.min(boxStartPos.x, pos.x);
        const y = Math.min(boxStartPos.y, pos.y);
        const w = Math.max(0.002, Math.abs(pos.x - boxStartPos.x));
        const h = Math.max(0.002, Math.abs(pos.y - boxStartPos.y));
        setCurrentBoxCoords({ x, y, w, h });
      } else {
        setCurrentDrawPoints((prev) => [...prev, pos]);
      }
    } else if (draggingItem && detailCanvasContainerRef.current && activePageIndex !== null) {
      const rect = detailCanvasContainerRef.current.getBoundingClientRect();
      const deltaX = (e.clientX - draggingItem.startX) / rect.width;
      const deltaY = (e.clientY - draggingItem.startY) / rect.height;

      const newX = Math.max(0.01, Math.min(0.95, draggingItem.initItemX + deltaX));
      const newY = Math.max(0.01, Math.min(0.95, draggingItem.initItemY + deltaY));

      setPages((prev) => {
        const copy = [...prev];
        const page = copy[activePageIndex];
        if (draggingItem.type === "text") {
          page.textOverlays = page.textOverlays.map((t) =>
            t.id === draggingItem.id ? { ...t, x: newX, y: newY } : t
          );
        } else if (draggingItem.type === "image") {
          page.imageOverlays = page.imageOverlays.map((img) =>
            img.id === draggingItem.id ? { ...img, x: newX, y: newY } : img
          );
        }
        return copy;
      });
    }
  };

  const handlePointerUp = () => {
    if (activeTool === "highlight" && isDrawingHighlight && activePageIndex !== null) {
      if (highlightToolType === "box" && currentBoxCoords && currentBoxCoords.w > 0.008 && currentBoxCoords.h > 0.004) {
        const newStroke: HighlightStroke = {
          id: `hl_box_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          type: "box",
          color: highlightColor,
          opacity: 0.55,
          x: currentBoxCoords.x,
          y: currentBoxCoords.y,
          w: currentBoxCoords.w,
          h: currentBoxCoords.h,
        };

        setPages((prev) => {
          const copy = [...prev];
          const page = copy[activePageIndex];
          page.highlights = [...(page.highlights || []), newStroke];
          return copy;
        });
      } else if (highlightToolType === "pen" && currentDrawPoints.length > 1) {
        const newStroke: HighlightStroke = {
          id: `hl_path_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          type: "path",
          color: highlightColor,
          opacity: 0.55,
          points: currentDrawPoints,
          size: highlightSize,
        };

        setPages((prev) => {
          const copy = [...prev];
          const page = copy[activePageIndex];
          page.highlights = [...(page.highlights || []), newStroke];
          return copy;
        });
      }
      setIsDrawingHighlight(false);
      setBoxStartPos(null);
      setCurrentBoxCoords(null);
      setCurrentDrawPoints([]);
    }

    if (draggingItem) {
      setDraggingItem(null);
    }
  };

  // Undo last highlight stroke
  const handleUndoHighlight = () => {
    if (activePageIndex === null) return;
    setPages((prev) => {
      const copy = [...prev];
      const page = copy[activePageIndex];
      if (page.highlights && page.highlights.length > 0) {
        page.highlights = page.highlights.slice(0, -1);
      }
      return copy;
    });
  };

  // Clear all highlights on active page
  const handleClearAllHighlights = () => {
    if (activePageIndex === null) return;
    setPages((prev) => {
      const copy = [...prev];
      copy[activePageIndex].highlights = [];
      return copy;
    });
    showToast("Đã xóa toàn bộ highlight trên trang.");
  };

  // Change highlight brush size preset
  const handleSelectBrushPreset = (preset: "small" | "medium" | "large") => {
    setHighlightBrushPreset(preset);
    if (preset === "small") setHighlightSize(0.016);
    else if (preset === "medium") setHighlightSize(0.028);
    else setHighlightSize(0.045);
  };

  // Add text overlay
  const handleConfirmAddText = () => {
    if (!textInput.trim() || activePageIndex === null) return;

    const newItem: TextOverlayItem = {
      id: `txt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      text: textInput.trim(),
      x: 0.2,
      y: 0.3,
      fontSize: textFontSize,
      color: textColor,
      bgColor: textBgColor,
      isBold: textIsBold,
    };

    setPages((prev) => {
      const copy = [...prev];
      copy[activePageIndex].textOverlays = [
        ...(copy[activePageIndex].textOverlays || []),
        newItem,
      ];
      return copy;
    });

    setTextInput("");
    setShowAddTextModal(false);
    showToast("Đã thêm chữ. Chạm và kéo để di chuyển vị trí.");
  };

  // Remove text overlay
  const handleDeleteText = (textId: string) => {
    if (activePageIndex === null) return;
    setPages((prev) => {
      const copy = [...prev];
      copy[activePageIndex].textOverlays = copy[activePageIndex].textOverlays.filter(
        (t) => t.id !== textId
      );
      return copy;
    });
  };

  // Add Image Overlay (Logo, Signature, Stamp)
  const handleAddImageOverlay = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || activePageIndex === null) return;

    const file = files[0];
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const aspect = img.naturalWidth / img.naturalHeight;
        const newImgOverlay: ImageOverlayItem = {
          id: `img_over_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          dataUrl,
          x: 0.35,
          y: 0.45,
          widthRatio: 0.3,
          aspectRatio: aspect,
          opacity: 1.0,
        };

        setPages((prev) => {
          const copy = [...prev];
          copy[activePageIndex].imageOverlays = [
            ...(copy[activePageIndex].imageOverlays || []),
            newImgOverlay,
          ];
          return copy;
        });

        showToast("Đã thêm chữ ký/hình ảnh. Kéo để định vị.");
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    if (e.target) e.target.value = "";
  };

  // Remove image overlay
  const handleDeleteImageOverlay = (imgId: string) => {
    if (activePageIndex === null) return;
    setPages((prev) => {
      const copy = [...prev];
      copy[activePageIndex].imageOverlays = copy[activePageIndex].imageOverlays.filter(
        (im) => im.id !== imgId
      );
      return copy;
    });
  };

  // Resize image overlay
  const handleResizeImageOverlay = (imgId: string, newRatio: number) => {
    if (activePageIndex === null) return;
    setPages((prev) => {
      const copy = [...prev];
      copy[activePageIndex].imageOverlays = copy[activePageIndex].imageOverlays.map((im) =>
        im.id === imgId ? { ...im, widthRatio: Math.max(0.1, Math.min(0.8, newRatio)) } : im
      );
      return copy;
    });
  };

  // Export to PDF
  const handleExportPDF = async () => {
    if (pages.length === 0) return;

    setIsExporting(true);
    setExportProgress({ current: 0, total: pages.length });

    try {
      const exportTitle = generateDefaultDocumentTitle();
      setDocTitle(exportTitle);
      const res = await DocumentConverter.exportToPDF(pages, exportTitle, (cur, tot) => {
        setExportProgress({ current: cur, total: tot });
      });

      setExportedResult(res);
      setIsSavedToApp(false);
    } catch (err: any) {
      console.error("Export PDF error:", err);
      showToast(err.message || "Lỗi khi xuất PDF.");
    } finally {
      setIsExporting(false);
    }
  };

  // Download PDF
  const handleDownloadPDF = () => {
    if (!exportedResult) return;
    const a = document.createElement("a");
    a.href = exportedResult.url;
    a.download = exportedResult.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast("Đã bắt đầu tải xuống PDF.");
  };

  // Save to VietScan ScannedDocument Store
  const handleSaveToDocuments = async () => {
    if (!exportedResult) return;
    try {
      const thumbnail = pages[0]?.renderedImage || pages[0]?.originalImage || "";
      const newDoc: ScannedDocument = {
        id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        title: docTitle,
        category: "document",
        pages: pages.map((p, idx) => ({
          id: p.id,
          originalImage: p.originalImage,
          processedImage: p.renderedImage,
          quad: {
            topLeft: { x: 0, y: 0 },
            topRight: { x: p.width, y: 0 },
            bottomRight: { x: p.width, y: p.height },
            bottomLeft: { x: 0, y: p.height },
          },
          filter: "document",
          rotation: p.rotation,
          createdAt: Date.now() + idx,
          width: p.width,
          height: p.height,
        })),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        thumbnail,
      };

      await StorageService.saveDocument(newDoc);
      onSaveToDocuments?.(newDoc);
      setIsSavedToApp(true);
      showToast("Đã lưu vào danh sách tài liệu VietScan!");
    } catch (err) {
      console.error("Save doc error:", err);
      showToast("Không thể lưu tài liệu.");
    }
  };

  // Web Share
  const handleSharePDF = async () => {
    if (!exportedResult) return;
    try {
      if (navigator.canShare && navigator.canShare({ files: [exportedResult.file] })) {
        await navigator.share({
          title: docTitle,
          text: `Tài liệu PDF được tạo bằng VietScan PDF: ${docTitle}`,
          files: [exportedResult.file],
        });
      } else if (navigator.share) {
        await navigator.share({
          title: docTitle,
          text: `Tài liệu PDF: ${docTitle}`,
          url: exportedResult.url,
        });
      } else {
        handleDownloadPDF();
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        handleDownloadPDF();
      }
    }
  };

  const activePage = activePageIndex !== null ? pages[activePageIndex] : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-2 sm:p-4 pt-safe-top pb-safe bg-slate-950/90 backdrop-blur-md select-none overflow-hidden animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col h-full max-h-[calc(100dvh-2.5rem)]">
        {/* Hidden inputs */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.doc,.xlsx,.xls,.csv"
          onChange={handleSelectFile}
          className="hidden"
        />
        <input
          ref={appendFileInputRef}
          type="file"
          accept=".pdf,.docx,.doc,.xlsx,.xls,.csv"
          onChange={handleAppendFile}
          className="hidden"
        />
        <input
          ref={imageOverlayInputRef}
          type="file"
          accept="image/*"
          onChange={handleAddImageOverlay}
          className="hidden"
        />

        {/* Toast */}
        {toastMessage && (
          <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-2xl bg-blue-600/95 backdrop-blur-md text-white text-xs font-semibold shadow-2xl border border-blue-400/30 flex items-center gap-2 animate-in slide-in-from-top duration-200">
            <Sparkles className="w-4 h-4 text-amber-300" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* TOP HEADER */}
        <div className="flex items-center justify-between px-3 sm:px-5 py-3 border-b border-slate-800 bg-slate-900/95 shrink-0 gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Primary Back / Exit Button */}
            <button
              id="btn-doc-editor-back"
              onClick={() => {
                if (activePageIndex !== null) {
                  setActivePageIndex(null);
                } else {
                  onClose();
                }
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 active:bg-slate-700 border border-slate-700/80 text-slate-100 hover:text-white active:scale-95 transition text-xs font-bold shadow-sm min-h-[40px] shrink-0"
              title={activePageIndex !== null ? "Quay lại danh sách trang" : "Thoát về màn hình Dashboard"}
            >
              <ArrowLeft className="w-4 h-4 text-blue-400 shrink-0" />
              <span>{activePageIndex !== null ? "Về danh sách trang" : "Về Dashboard"}</span>
            </button>

            {/* Change File button when viewing pages grid */}
            {pages.length > 0 && activePageIndex === null && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-750 border border-slate-700/60 text-slate-300 hover:text-white text-xs font-semibold transition"
                title="Chọn một tệp PDF, Word hoặc Excel khác để chỉnh sửa"
              >
                <FileCode className="w-3.5 h-3.5 text-emerald-400" />
                <span>Đổi tệp khác</span>
              </button>
            )}

            {/* Title / Breadcrumb */}
            <div className="min-w-0">
              {isEditingTitle ? (
                <input
                  type="text"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  onBlur={() => setIsEditingTitle(false)}
                  onKeyDown={(e) => e.key === "Enter" && setIsEditingTitle(false)}
                  autoFocus
                  className="bg-slate-800 text-white font-bold text-xs sm:text-sm px-2 py-1 rounded-lg border border-blue-500 outline-none w-44 sm:w-64"
                />
              ) : (
                <div
                  onClick={() => setIsEditingTitle(true)}
                  className="flex items-center gap-1.5 cursor-pointer group"
                  title="Nhấn để đổi tên tài liệu"
                >
                  <h3 className="text-xs sm:text-sm font-bold text-white truncate max-w-[130px] sm:max-w-[260px]">
                    {docTitle}
                  </h3>
                  <Edit3 className="w-3 h-3 text-slate-400 group-hover:text-blue-400 transition shrink-0" />
                </div>
              )}
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <span>Chỉnh sửa tài liệu</span>
                {pages.length > 0 && (
                  <>
                    <span>•</span>
                    <span className="text-blue-400 font-semibold">
                      {activePageIndex !== null
                        ? `Trang ${activePageIndex + 1} / ${pages.length}`
                        : `${pages.length} trang`}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Export PDF button on grid view */}
            {pages.length > 0 && activePageIndex === null && (
              <button
                id="btn-doc-editor-export"
                onClick={handleExportPDF}
                disabled={isExporting}
                className="flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-blue-600/30 active:scale-95 transition min-h-[40px] shrink-0"
              >
                {isExporting ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <Download className="w-4 h-4 text-white" />
                )}
                <span>Xuất PDF</span>
              </button>
            )}

            {/* Done with single page button */}
            {activePageIndex !== null && (
              <button
                onClick={() => setActivePageIndex(null)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-600/30 active:scale-95 transition min-h-[40px] shrink-0"
                title="Lưu các thay đổi trên trang này và quay về danh sách trang"
              >
                <Check className="w-4 h-4" />
                <span className="hidden xs:inline">Xong trang</span>
              </button>
            )}

            {/* Direct Close Button */}
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Đóng công cụ chỉnh sửa"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* BODY AREA */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-5 relative">
          {/* STEP 1: INITIAL FILE UPLOADER (When 0 pages) */}
          {pages.length === 0 && (
            <div className="flex flex-col items-center justify-center min-h-[60vh] max-w-xl mx-auto text-center px-4">
              <div className="p-4 rounded-3xl bg-blue-500/10 border border-blue-500/20 text-blue-400 mb-4 shadow-inner">
                <FileCode className="w-12 h-12" />
              </div>

              <h2 className="text-xl font-bold text-white mb-2">
                Chuyển đổi & Chỉnh sửa tài liệu
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 mb-6 leading-relaxed">
                Hỗ trợ <strong className="text-blue-400 font-semibold">PDF</strong>,{" "}
                <strong className="text-blue-400 font-semibold">Word (.docx)</strong>, và{" "}
                <strong className="text-emerald-400 font-semibold">Excel (.xlsx / .xls)</strong>. Tự
                động căn chỉnh vừa trang A4 để dễ dàng gửi đi hoặc in ấn.
              </p>

              {/* Upload trigger button */}
              <button
                id="btn-doc-editor-upload"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-sm shadow-xl shadow-blue-600/30 active:scale-[0.98] transition flex items-center justify-center gap-3 mb-6"
              >
                {isLoading ? (
                  <RefreshCw className="w-5 h-5 animate-spin text-white" />
                ) : (
                  <Upload className="w-5 h-5 text-white" />
                )}
                <span>{isLoading ? "Đang xử lý..." : "Chọn tệp PDF, Word hoặc Excel"}</span>
              </button>

              {/* Realtime Loading / Progress indicator */}
              {isLoading && (
                <div className="w-full max-w-sm p-4 rounded-2xl bg-slate-800/90 border border-blue-500/30 text-left animate-in fade-in duration-200">
                  <div className="flex items-center gap-3 mb-2">
                    <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
                    <span className="text-xs font-semibold text-white">
                      {loadingStatus || "Đang xử lý tệp..."}
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-700 overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full animate-pulse w-3/4" />
                  </div>
                </div>
              )}

              {/* Error message */}
              {errorMsg && (
                <div className="w-full max-w-sm p-3.5 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-start gap-2.5 text-left mb-4">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Format features badges */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full mt-2 text-left">
                <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800 flex items-start gap-3">
                  <div className="p-2 rounded-xl bg-red-500/10 text-red-400 shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">File PDF</h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Giữ nguyên bố cục gốc, cho phép sắp xếp, xoay & xóa trang.
                    </p>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800 flex items-start gap-3">
                  <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">Word (.docx)</h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Tự động dàn trang chuẩn A4 văn phòng, bảng biểu & hình ảnh.
                    </p>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800 flex items-start gap-3">
                  <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 shrink-0">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">Excel (.xlsx)</h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Căn bảng vừa trang A4 (dọc/ngang), không bị tràn lề khi gửi.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: THUMBNAILS OVERVIEW MODE */}
          {pages.length > 0 && activePageIndex === null && (
            <div>
              {/* Secondary Sub-toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 mb-4 p-2.5 rounded-2xl bg-slate-950/70 border border-slate-800">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAddBlankPage}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 active:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white transition text-xs font-semibold"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Thêm trang trắng</span>
                  </button>

                  <button
                    onClick={() => appendFileInputRef.current?.click()}
                    disabled={isLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 active:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white transition text-xs font-semibold"
                  >
                    <Upload className="w-3.5 h-3.5 text-blue-400" />
                    <span>Ghép thêm file...</span>
                  </button>
                </div>

                <div className="text-[11px] text-slate-400 flex items-center gap-1">
                  <span>Chạm vào trang để</span>
                  <strong className="text-blue-400">thêm chữ, highlight, con dấu</strong>
                </div>
              </div>

              {/* Thumbnails Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
                {pages.map((page, index) => (
                  <div
                    key={page.id}
                    className="relative group flex flex-col rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-blue-500/60 transition overflow-hidden shadow-md"
                  >
                    {/* Header badge with index */}
                    <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800/80 text-[11px] font-bold text-slate-300">
                      <span>Trang {page.pageNumber}</span>
                      {page.rotation !== 0 && (
                        <span className="text-[9px] font-semibold text-amber-400 bg-amber-500/10 px-1.5 py-0.2 rounded">
                          {page.rotation}°
                        </span>
                      )}
                    </div>

                    {/* Thumbnail Image Container */}
                    <div
                      onClick={() => setActivePageIndex(index)}
                      className="relative aspect-[1/1.414] bg-white cursor-pointer overflow-hidden flex items-center justify-center p-1"
                    >
                      <img
                        src={page.renderedImage}
                        alt={`Trang ${page.pageNumber}`}
                        style={{ transform: `rotate(${page.rotation}deg)` }}
                        className="max-w-full max-h-full object-contain pointer-events-none transition-transform duration-200"
                        loading="lazy"
                      />

                      {/* Overlays preview badges */}
                      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1">
                        {page.highlights && page.highlights.length > 0 && (
                          <span className="w-2 h-2 rounded-full bg-yellow-400 ring-2 ring-slate-950" />
                        )}
                        {page.textOverlays && page.textOverlays.length > 0 && (
                          <span className="w-2 h-2 rounded-full bg-blue-500 ring-2 ring-slate-950" />
                        )}
                        {page.imageOverlays && page.imageOverlays.length > 0 && (
                          <span className="w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-slate-950" />
                        )}
                      </div>

                      {/* Hover / Tap overlay prompt */}
                      <div className="absolute inset-0 bg-blue-600/20 opacity-0 group-hover:opacity-100 transition flex items-center justify-center backdrop-blur-[1px]">
                        <span className="px-2.5 py-1 rounded-lg bg-slate-900/90 text-white text-[11px] font-bold border border-slate-700 shadow-md">
                          Chỉnh sửa chi tiết
                        </span>
                      </div>
                    </div>

                    {/* Bottom Action buttons on card */}
                    <div className="flex items-center justify-between px-2 py-1.5 bg-slate-900 border-t border-slate-800/80">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleMovePage(index, "up")}
                          disabled={index === 0}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition"
                          title="Di chuyển lên trước"
                        >
                          <MoveUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleMovePage(index, "down")}
                          disabled={index === pages.length - 1}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition"
                          title="Di chuyển ra sau"
                        >
                          <MoveDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleRotatePage(index)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition"
                          title="Xoay 90°"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDuplicatePage(index)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-slate-800 transition"
                          title="Nhân bản trang"
                        >
                          <Layers className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeletePage(index)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition"
                          title="Xóa trang"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 3: SINGLE PAGE DETAIL INTERACTIVE EDITOR */}
          {activePage && activePageIndex !== null && (
            <div className="flex flex-col items-center justify-start h-full">
              {/* Active Page Top Control Sub-bar */}
              <div className="w-full flex flex-wrap items-center justify-between gap-2 mb-3 px-1">
                {/* Back to all pages button */}
                <button
                  onClick={() => setActivePageIndex(null)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 hover:text-white border border-slate-700 text-xs font-bold transition shadow-sm"
                  title="Trở về danh sách trang"
                >
                  <ArrowLeft className="w-3.5 h-3.5 text-blue-400" />
                  <span>Danh sách trang</span>
                </button>

                {/* Navigation prev / next */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setActivePageIndex(Math.max(0, activePageIndex - 1))}
                    disabled={activePageIndex === 0}
                    className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-30 disabled:pointer-events-none transition"
                    title="Trang trước"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-white">
                    Trang {activePageIndex + 1} / {pages.length}
                  </span>
                  <button
                    onClick={() =>
                      setActivePageIndex(Math.min(pages.length - 1, activePageIndex + 1))
                    }
                    disabled={activePageIndex === pages.length - 1}
                    className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-30 disabled:pointer-events-none transition"
                    title="Trang sau"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Quick actions for current page */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleRotatePage(activePageIndex)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-semibold border border-slate-700 transition"
                  >
                    <RotateCw className="w-3.5 h-3.5 text-amber-400" />
                    <span>Xoay 90°</span>
                  </button>

                  <button
                    onClick={() => handleDeletePage(activePageIndex)}
                    className="p-2 rounded-xl bg-slate-800 hover:bg-red-500/20 text-slate-300 hover:text-red-400 border border-slate-700 transition"
                    title="Xóa trang này"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Interactive Tool Selector Bar */}
              <div className="w-full flex items-center justify-center gap-1.5 p-1.5 rounded-2xl bg-slate-950/80 border border-slate-800 mb-2 overflow-x-auto no-scrollbar">
                <button
                  onClick={() => setActiveTool("view")}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
                    activeTool === "view"
                      ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                  }`}
                >
                  <span>Xem & Di chuyển</span>
                </button>

                <button
                  onClick={() => {
                    setActiveTool("highlight");
                    showToast("Chọn bút hoặc kéo dải dòng để tô highlight trực quan.");
                  }}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
                    activeTool === "highlight"
                      ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30 font-extrabold"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                  }`}
                >
                  <Highlighter className="w-3.5 h-3.5" />
                  <span>Highlight</span>
                </button>

                <button
                  onClick={() => setShowAddTextModal(true)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition"
                >
                  <Type className="w-3.5 h-3.5 text-blue-400" />
                  <span>Thêm chữ</span>
                </button>

                <button
                  onClick={() => imageOverlayInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Chữ ký / Con dấu</span>
                </button>
              </div>

              {/* Sub-bar for Highlight Tool */}
              {activeTool === "highlight" && (
                <div className="w-full flex flex-col p-2.5 rounded-2xl bg-slate-950 border border-slate-800 mb-3 gap-2.5 animate-in fade-in duration-150">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {/* Done with highlight mode button */}
                    <button
                      onClick={() => setActiveTool("view")}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold transition"
                      title="Quay lại chế độ xem và di chuyển trang"
                    >
                      <ArrowLeft className="w-3 h-3" />
                      <span>Xong Highlight</span>
                    </button>

                    {/* Mode Toggle: Pen vs Box */}
                    <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-xl border border-slate-800">
                      <button
                        onClick={() => setHighlightToolType("pen")}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                          highlightToolType === "pen"
                            ? "bg-amber-500 text-slate-950 shadow-sm"
                            : "text-slate-400 hover:text-white"
                        }`}
                      >
                        <Highlighter className="w-3 h-3" />
                        <span>Bút tự do</span>
                      </button>
                      <button
                        onClick={() => setHighlightToolType("box")}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                          highlightToolType === "box"
                            ? "bg-amber-500 text-slate-950 shadow-sm"
                            : "text-slate-400 hover:text-white"
                        }`}
                      >
                        <Layers className="w-3 h-3" />
                        <span>Kéo dải dòng</span>
                      </button>
                    </div>

                    {/* Brush Size Preset */}
                    <div className="flex items-center gap-1 bg-slate-900 px-1.5 py-0.5 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 font-medium">Nét:</span>
                      {(["small", "medium", "large"] as const).map((preset) => (
                        <button
                          key={preset}
                          onClick={() => handleSelectBrushPreset(preset)}
                          className={`px-2 py-0.5 rounded text-[11px] font-bold transition ${
                            highlightBrushPreset === preset
                              ? "bg-blue-600 text-white"
                              : "text-slate-400 hover:text-white"
                          }`}
                        >
                          {preset === "small" ? "Mảnh" : preset === "medium" ? "Vừa" : "Dày"}
                        </button>
                      ))}
                    </div>

                    {/* Actions: Undo & Clear All */}
                    <div className="flex items-center gap-1.5 ml-auto">
                      <button
                        onClick={handleUndoHighlight}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition"
                        title="Hoàn tác nét vừa tô"
                      >
                        <Undo2 className="w-3.5 h-3.5 text-amber-400" />
                        <span>Hoàn tác</span>
                      </button>

                      <button
                        onClick={handleClearAllHighlights}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-red-500/20 text-slate-300 hover:text-red-400 text-xs font-medium border border-slate-700 transition"
                        title="Xóa toàn bộ nét highlight trên trang này"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Xóa hết</span>
                      </button>
                    </div>
                  </div>

                  {/* Colors & Usage hint */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-900">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400 font-semibold pl-1">Màu highlight:</span>
                      <div className="flex items-center gap-2">
                        {HIGHLIGHT_COLORS.map((c) => (
                          <button
                            key={c.hex}
                            onClick={() => setHighlightColor(c.hex)}
                            style={{ backgroundColor: c.hex }}
                            className={`w-6 h-6 rounded-full transition shadow-sm ${
                              highlightColor === c.hex
                                ? "ring-2 ring-white ring-offset-2 ring-offset-slate-950 scale-110"
                                : "opacity-80 hover:opacity-100"
                            }`}
                            title={c.name}
                          />
                        ))}
                      </div>
                    </div>

                    <p className="text-[10px] text-amber-300/80 font-medium">
                      💡 {highlightToolType === "box" ? "Kéo thả chuột/tay để tạo dải vàng thẳng hàng" : "Vẽ tự do trực tiếp lên dòng văn bản"}
                    </p>
                  </div>
                </div>
              )}

              {/* Canvas Interactive Container */}
              <div className="relative flex-1 w-full flex items-center justify-center p-2 min-h-[420px] overflow-hidden">
                <div
                  ref={detailCanvasContainerRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  className={`relative max-w-full max-h-[62vh] aspect-[1/1.414] bg-white rounded-lg shadow-2xl overflow-hidden touch-none select-none border border-slate-300 ${
                    activeTool === "highlight" ? "cursor-crosshair" : "cursor-default"
                  }`}
                >
                  {/* Base Page Image with Rotation */}
                  <img
                    src={activePage.renderedImage}
                    alt="Active Page"
                    style={{
                      transform: `rotate(${activePage.rotation}deg)`,
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                    }}
                    className="pointer-events-none select-none"
                  />

                  {/* Highlight SVG Layer */}
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none select-none"
                    viewBox="0 0 1000 1000"
                    preserveAspectRatio="none"
                  >
                    {activePage.highlights?.map((stroke) => {
                      if (
                        stroke.type === "box" &&
                        stroke.x !== undefined &&
                        stroke.y !== undefined &&
                        stroke.w !== undefined &&
                        stroke.h !== undefined
                      ) {
                        return (
                          <rect
                            key={stroke.id}
                            x={stroke.x * 1000}
                            y={stroke.y * 1000}
                            width={stroke.w * 1000}
                            height={stroke.h * 1000}
                            rx={3}
                            fill={stroke.color}
                            fillOpacity={stroke.opacity || 0.55}
                            style={{ mixBlendMode: "multiply" }}
                          />
                        );
                      }
                      if (stroke.points && stroke.points.length > 1) {
                        const pathD = stroke.points.reduce(
                          (acc, pt, idx) =>
                            idx === 0
                              ? `M ${pt.x * 1000} ${pt.y * 1000}`
                              : `${acc} L ${pt.x * 1000} ${pt.y * 1000}`,
                          ""
                        );
                        return (
                          <path
                            key={stroke.id}
                            d={pathD}
                            stroke={stroke.color}
                            strokeWidth={(stroke.size || 0.025) * 1000}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                            opacity={stroke.opacity || 0.55}
                            style={{ mixBlendMode: "multiply" }}
                          />
                        );
                      }
                      return null;
                    })}

                    {/* Current drawing highlight stroke (Pen Mode) */}
                    {isDrawingHighlight && highlightToolType === "pen" && currentDrawPoints.length > 1 && (
                      <path
                        d={currentDrawPoints.reduce(
                          (acc, pt, idx) =>
                            idx === 0
                              ? `M ${pt.x * 1000} ${pt.y * 1000}`
                              : `${acc} L ${pt.x * 1000} ${pt.y * 1000}`,
                          ""
                        )}
                        stroke={highlightColor}
                        strokeWidth={highlightSize * 1000}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                        opacity={0.65}
                        style={{ mixBlendMode: "multiply" }}
                      />
                    )}

                    {/* Current drawing highlight box (Box Mode) */}
                    {isDrawingHighlight && highlightToolType === "box" && currentBoxCoords && (
                      <rect
                        x={currentBoxCoords.x * 1000}
                        y={currentBoxCoords.y * 1000}
                        width={currentBoxCoords.w * 1000}
                        height={currentBoxCoords.h * 1000}
                        rx={3}
                        fill={highlightColor}
                        fillOpacity={0.6}
                        stroke={highlightColor}
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        style={{ mixBlendMode: "multiply" }}
                      />
                    )}
                  </svg>

                  {/* Image Overlays (Signature, Stamp, Logo) */}
                  {activePage.imageOverlays?.map((imgItem) => (
                    <div
                      key={imgItem.id}
                      style={{
                        position: "absolute",
                        left: `${imgItem.x * 100}%`,
                        top: `${imgItem.y * 100}%`,
                        width: `${imgItem.widthRatio * 100}%`,
                        opacity: imgItem.opacity ?? 1,
                      }}
                      className="group/img touch-none"
                    >
                      <div
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setDraggingItem({
                            type: "image",
                            id: imgItem.id,
                            startX: e.clientX,
                            startY: e.clientY,
                            initItemX: imgItem.x,
                            initItemY: imgItem.y,
                          });
                        }}
                        className="relative p-1 border border-dashed border-blue-400/80 bg-blue-500/5 rounded cursor-move"
                      >
                        <img
                          src={imgItem.dataUrl}
                          alt="Signature"
                          className="w-full h-auto pointer-events-none"
                        />
                        {/* Control buttons */}
                        <div className="absolute -top-7 right-0 flex items-center gap-1 bg-slate-900/90 rounded-lg p-1 border border-slate-700 shadow-md">
                          <button
                            onClick={(ev) => {
                              ev.stopPropagation();
                              handleResizeImageOverlay(
                                imgItem.id,
                                imgItem.widthRatio - 0.05
                              );
                            }}
                            className="w-5 h-5 flex items-center justify-center rounded bg-slate-800 text-white text-xs font-bold"
                            title="Thu nhỏ"
                          >
                            -
                          </button>
                          <button
                            onClick={(ev) => {
                              ev.stopPropagation();
                              handleResizeImageOverlay(
                                imgItem.id,
                                imgItem.widthRatio + 0.05
                              );
                            }}
                            className="w-5 h-5 flex items-center justify-center rounded bg-slate-800 text-white text-xs font-bold"
                            title="Phóng to"
                          >
                            +
                          </button>
                          <button
                            onClick={(ev) => {
                              ev.stopPropagation();
                              handleDeleteImageOverlay(imgItem.id);
                            }}
                            className="w-5 h-5 flex items-center justify-center rounded bg-red-500/80 text-white"
                            title="Xóa ảnh"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Text Overlays */}
                  {activePage.textOverlays?.map((textItem) => (
                    <div
                      key={textItem.id}
                      style={{
                        position: "absolute",
                        left: `${textItem.x * 100}%`,
                        top: `${textItem.y * 100}%`,
                        color: textItem.color,
                        backgroundColor: textItem.bgColor || "transparent",
                        fontSize: `${textItem.fontSize * 0.8}px`,
                        fontWeight: textItem.isBold ? 700 : 500,
                      }}
                      className="group/txt px-2 py-0.5 rounded shadow-sm border border-dashed border-transparent hover:border-blue-400 cursor-move touch-none whitespace-nowrap"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setDraggingItem({
                          type: "text",
                          id: textItem.id,
                          startX: e.clientX,
                          startY: e.clientY,
                          initItemX: textItem.x,
                          initItemY: textItem.y,
                        });
                      }}
                    >
                      <span>{textItem.text}</span>
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          handleDeleteText(textItem.id);
                        }}
                        className="absolute -top-3 -right-3 w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center shadow-md opacity-0 group-hover/txt:opacity-100 transition"
                        title="Xóa chữ"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Bottom Sticky Action Bar: Clear & Convenient Navigation */}
              <div className="w-full flex items-center justify-between gap-3 mt-3 pt-3 border-t border-slate-800/80 bg-slate-900/60 backdrop-blur-sm px-2 rounded-2xl">
                <button
                  onClick={() => setActivePageIndex(null)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 hover:text-white border border-slate-700 font-bold text-xs transition active:scale-95 shadow-sm"
                  title="Quay lại danh sách tất cả các trang"
                >
                  <ArrowLeft className="w-4 h-4 text-blue-400" />
                  <span>← Về danh sách các trang</span>
                </button>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 hidden sm:inline font-medium">
                    Trang {activePageIndex + 1} / {pages.length}
                  </span>
                  <button
                    onClick={() => setActivePageIndex(null)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/30 transition active:scale-95"
                    title="Hoàn tất chỉnh sửa trang này và trở về danh sách trang"
                  >
                    <Check className="w-4 h-4" />
                    <span>Hoàn tất trang này</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* MODAL: ADD TEXT POPUP */}
        {showAddTextModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
            <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-base font-bold text-white flex items-center gap-2">
                  <Type className="w-5 h-5 text-blue-400" />
                  <span>Thêm chữ lên trang</span>
                </h4>
                <button
                  onClick={() => setShowAddTextModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Input text */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Nội dung văn bản:
                </label>
                <input
                  type="text"
                  placeholder="Ví dụ: ĐÃ DUYỆT, BẢN SAO, Ngày 20/10/2026..."
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  autoFocus
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm outline-none focus:border-blue-500"
                />
              </div>

              {/* Color Picker */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Màu chữ:
                </label>
                <div className="flex items-center gap-2">
                  {TEXT_COLORS.map((tc) => (
                    <button
                      key={tc.hex}
                      onClick={() => setTextColor(tc.hex)}
                      style={{ backgroundColor: tc.hex }}
                      className={`w-7 h-7 rounded-full border transition ${
                        textColor === tc.hex
                          ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-slate-900 scale-110"
                          : "border-slate-700 opacity-80"
                      }`}
                      title={tc.name}
                    />
                  ))}
                </div>
              </div>

              {/* Font Size & Bold */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Kích thước:
                  </label>
                  <div className="flex items-center gap-1.5">
                    {[
                      { l: "Nhỏ", sz: 16 },
                      { l: "Vừa", sz: 22 },
                      { l: "Lớn", sz: 30 },
                    ].map((s) => (
                      <button
                        key={s.sz}
                        onClick={() => setTextFontSize(s.sz)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                          textFontSize === s.sz
                            ? "bg-blue-600 text-white"
                            : "bg-slate-800 text-slate-400 hover:text-white"
                        }`}
                      >
                        {s.l}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Nền chữ:
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setTextBgColor("transparent")}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                        textBgColor === "transparent"
                          ? "bg-blue-600 text-white"
                          : "bg-slate-800 text-slate-400 hover:text-white"
                      }`}
                    >
                      Không nền
                    </button>
                    <button
                      onClick={() => setTextBgColor("#ffffff")}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                        textBgColor === "#ffffff"
                          ? "bg-blue-600 text-white"
                          : "bg-slate-800 text-slate-400 hover:text-white"
                      }`}
                    >
                      Nền trắng
                    </button>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-end gap-2.5">
                <button
                  onClick={() => setShowAddTextModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  Hủy
                </button>
                <button
                  onClick={handleConfirmAddText}
                  disabled={!textInput.trim()}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold"
                >
                  Thêm vào trang
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: EXPORT SUCCESS & NEXT ACTIONS */}
        {exportedResult && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
            <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2.5 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Xuất PDF thành công!</h3>
                    <p className="text-xs text-slate-400">
                      Tài liệu {pages.length} trang đã sẵn sàng gửi hoặc tiếp tục xử lý
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setExportedResult(null)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* File Info */}
              <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 mb-4 flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 shrink-0">
                  <FileText className="w-6 h-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-xs font-bold text-white truncate">
                    {exportedResult.fileName}
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Khổ chuẩn A4 • {pages.length} trang • {Math.round(exportedResult.blob.size / 1024)} KB
                  </p>
                </div>
              </div>

              {/* Primary Download & Save Buttons */}
              <div className="grid grid-cols-2 gap-2.5 mb-5">
                <button
                  onClick={handleDownloadPDF}
                  className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-blue-600 hover:bg-blue-500 active:scale-95 transition text-white font-bold text-xs shadow-lg shadow-blue-600/30"
                >
                  <Download className="w-4 h-4" />
                  <span>Tải về PDF</span>
                </button>

                <button
                  onClick={handleSaveToDocuments}
                  disabled={isSavedToApp}
                  className={`flex items-center justify-center gap-2 py-3 px-4 rounded-2xl border active:scale-95 transition text-xs font-bold ${
                    isSavedToApp
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                      : "bg-slate-800 hover:bg-slate-750 text-white border-slate-700"
                  }`}
                >
                  {isSavedToApp ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <FolderPlus className="w-4 h-4 text-blue-400" />
                  )}
                  <span>{isSavedToApp ? "Đã lưu vào App" : "Lưu vào App"}</span>
                </button>
              </div>

              {/* Seamless Forward Integration Section */}
              <div className="border-t border-slate-800/80 pt-4 mb-3">
                <h5 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">
                  Chuyển sang công cụ khác:
                </h5>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {/* Forward to Highlight PDF */}
                  <button
                    onClick={() => {
                      const f = exportedResult.file;
                      setExportedResult(null);
                      onClose();
                      onForwardToHighlight(f);
                    }}
                    className="flex items-center gap-3 p-3 rounded-2xl bg-slate-950 hover:bg-slate-850 border border-slate-800 hover:border-amber-500/50 active:scale-95 transition text-left group"
                  >
                    <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 group-hover:bg-amber-600 group-hover:text-white transition shrink-0">
                      <Highlighter className="w-5 h-5" />
                    </div>
                    <div>
                      <h6 className="text-xs font-bold text-white group-hover:text-amber-400 transition">
                        Highlight PDF
                      </h6>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Bôi vàng các đoạn quan trọng
                      </p>
                    </div>
                  </button>

                  {/* Forward to PDF to JPEG */}
                  <button
                    onClick={() => {
                      const f = exportedResult.file;
                      setExportedResult(null);
                      onClose();
                      onForwardToPDFToJPEG(f);
                    }}
                    className="flex items-center gap-3 p-3 rounded-2xl bg-slate-950 hover:bg-slate-850 border border-slate-800 hover:border-cyan-500/50 active:scale-95 transition text-left group"
                  >
                    <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 group-hover:bg-cyan-600 group-hover:text-white transition shrink-0">
                      <FileImage className="w-5 h-5" />
                    </div>
                    <div>
                      <h6 className="text-xs font-bold text-white group-hover:text-cyan-400 transition">
                        PDF to JPEG
                      </h6>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Xuất từng trang thành ảnh JPEG
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Share & Close button */}
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={handleSharePDF}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white font-medium"
                >
                  <Share2 className="w-4 h-4 text-blue-400" />
                  <span>Chia sẻ file</span>
                </button>

                <button
                  onClick={() => setExportedResult(null)}
                  className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
