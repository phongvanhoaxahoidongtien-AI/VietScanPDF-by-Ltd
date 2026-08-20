import React, { useState } from "react";
import {
  ArrowLeft,
  RotateCw,
  Crop,
  Trash2,
  Plus,
  FileText,
  Sparkles,
  Share2,
  FileDown,
  Layers,
  Image as ImageIcon,
  Check,
  Type,
  Maximize2,
  Move,
} from "lucide-react";
import { FilterMode, ScannedDocument, ScannedPage, QuadPoints } from "../types";
import { CVEngine } from "../utils/cvEngine";
import { CropAdjuster } from "./CropAdjuster";
import { PageReorderModal } from "./PageReorderModal";

interface PageEditorProps {
  document: ScannedDocument;
  onUpdateDocument: (doc: ScannedDocument) => void;
  onAddMorePages: () => void;
  onOpenPDFPreview: () => void;
  onOpenLongImage: () => void;
  onOpenOCR: (page: ScannedPage) => void;
  onBack: () => void;
}

export const PageEditor: React.FC<PageEditorProps> = ({
  document: doc,
  onUpdateDocument,
  onAddMorePages,
  onOpenPDFPreview,
  onOpenLongImage,
  onOpenOCR,
  onBack,
}) => {
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);
  const [isCropping, setIsCropping] = useState<boolean>(false);
  const [isReordering, setIsReordering] = useState<boolean>(false);
  const [isApplyingFilter, setIsApplyingFilter] = useState<boolean>(false);

  const activePage = doc.pages[currentPageIndex] || doc.pages[0];

  // Apply Filter to current active page
  const handleApplyFilter = async (filter: FilterMode) => {
    if (!activePage || isApplyingFilter) return;
    setIsApplyingFilter(true);

    try {
      const rawImg = await CVEngine.loadImage(activePage.originalImage);
      const warped = CVEngine.warpPerspective(rawImg, activePage.quad);
      const filtered = CVEngine.applyFilter(warped, filter, activePage.rotation);
      const newProcessedDataUrl = filtered.toDataURL("image/jpeg", 0.92);

      const updatedPages = doc.pages.map((p, idx) =>
        idx === currentPageIndex
          ? {
              ...p,
              filter,
              processedImage: newProcessedDataUrl,
            }
          : p
      );

      onUpdateDocument({
        ...doc,
        pages: updatedPages,
        thumbnail: updatedPages[0].processedImage,
        updatedAt: Date.now(),
      });
    } catch (e) {
      console.error("Filter apply error:", e);
    } finally {
      setIsApplyingFilter(false);
    }
  };

  // Rotate 90 degrees clockwise
  const handleRotate = async () => {
    if (!activePage) return;
    const nextRotation = (activePage.rotation + 90) % 360;

    const rawImg = await CVEngine.loadImage(activePage.originalImage);
    const warped = CVEngine.warpPerspective(rawImg, activePage.quad);
    const rotatedCanvas = CVEngine.applyFilter(warped, activePage.filter, nextRotation);
    const newProcessedUrl = rotatedCanvas.toDataURL("image/jpeg", 0.92);

    const updatedPages = doc.pages.map((p, idx) =>
      idx === currentPageIndex
        ? {
            ...p,
            rotation: nextRotation,
            processedImage: newProcessedUrl,
            width: rotatedCanvas.width,
            height: rotatedCanvas.height,
          }
        : p
    );

    onUpdateDocument({
      ...doc,
      pages: updatedPages,
      thumbnail: updatedPages[0].processedImage,
      updatedAt: Date.now(),
    });
  };

  // Handle re-crop confirmation
  const handleCropComplete = (warpedCanvas: HTMLCanvasElement, adjustedQuad: QuadPoints) => {
    const filteredCanvas = CVEngine.applyFilter(warpedCanvas, activePage.filter, activePage.rotation);
    const newProcessedUrl = filteredCanvas.toDataURL("image/jpeg", 0.92);

    const updatedPages = doc.pages.map((p, idx) =>
      idx === currentPageIndex
        ? {
            ...p,
            quad: adjustedQuad,
            processedImage: newProcessedUrl,
            width: filteredCanvas.width,
            height: filteredCanvas.height,
          }
        : p
    );

    onUpdateDocument({
      ...doc,
      pages: updatedPages,
      thumbnail: updatedPages[0].processedImage,
      updatedAt: Date.now(),
    });

    setIsCropping(false);
  };

  // Delete current page
  const handleDeletePage = () => {
    if (doc.pages.length <= 1) {
      if (confirm("Xóa trang duy nhất này sẽ xóa toàn bộ tài liệu. Bạn có chắc không?")) {
        onBack();
      }
      return;
    }

    const updatedPages = doc.pages.filter((_, idx) => idx !== currentPageIndex);
    const nextIdx = Math.max(0, Math.min(currentPageIndex, updatedPages.length - 1));

    setCurrentPageIndex(nextIdx);
    onUpdateDocument({
      ...doc,
      pages: updatedPages,
      thumbnail: updatedPages[0].processedImage,
      updatedAt: Date.now(),
    });
  };

  // Move page position (left/right)
  const handleMovePage = (direction: "left" | "right") => {
    const targetIdx = direction === "left" ? currentPageIndex - 1 : currentPageIndex + 1;
    if (targetIdx < 0 || targetIdx >= doc.pages.length) return;

    const newPages = [...doc.pages];
    const [moved] = newPages.splice(currentPageIndex, 1);
    newPages.splice(targetIdx, 0, moved);

    setCurrentPageIndex(targetIdx);
    onUpdateDocument({
      ...doc,
      pages: newPages,
      thumbnail: newPages[0].processedImage,
      updatedAt: Date.now(),
    });
  };

  // Title change
  const handleTitleChange = (newTitle: string) => {
    onUpdateDocument({
      ...doc,
      title: newTitle,
      updatedAt: Date.now(),
    });
  };

  if (isCropping && activePage) {
    return (
      <CropAdjuster
        imageSrc={activePage.originalImage}
        initialQuad={activePage.quad}
        aspectMode={doc.category === "cccd" || doc.category === "driver_license" ? "card" : "document"}
        onComplete={handleCropComplete}
        onCancel={() => setIsCropping(false)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-950 text-white select-none h-screen-dvh min-h-screen-dvh w-full overflow-hidden">
      {/* Top App Bar with Safe Area */}
      <div className="flex items-center justify-between px-4 pt-safe pb-2 bg-slate-900/95 backdrop-blur border-b border-slate-800">
        <button
          id="btn-editor-back"
          onClick={onBack}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 active:scale-95 transition"
          aria-label="Quay lại"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex-1 mx-3 text-center truncate">
          <input
            id="input-document-title"
            type="text"
            value={doc.title}
            onChange={(e) => handleTitleChange(e.target.value)}
            className="w-full max-w-xs text-center text-sm font-semibold bg-transparent border-b border-transparent hover:border-slate-600 focus:border-blue-500 focus:outline-none text-white transition py-0.5 truncate"
            placeholder="Tên tài liệu..."
          />
          <p className="text-[11px] text-slate-400">
            Trang {currentPageIndex + 1} / {doc.pages.length}
          </p>
        </div>

        {/* Primary Export Button */}
        <button
          id="btn-open-pdf-preview"
          onClick={onOpenPDFPreview}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-bold shadow transition"
        >
          <FileDown className="w-4 h-4" />
          <span>Tạo PDF</span>
        </button>
      </div>

      {/* Main Preview Center Area */}
      <div className="relative flex-1 w-full h-full overflow-hidden flex items-center justify-center p-4 bg-slate-950">
        {activePage && (
          <div className="relative max-h-full max-w-full flex items-center justify-center shadow-2xl rounded-lg overflow-hidden border border-slate-800 bg-white">
            <img
              src={activePage.processedImage}
              alt={`Trang ${currentPageIndex + 1}`}
              className="max-h-[52vh] max-w-full object-contain select-none"
            />
          </div>
        )}
      </div>

      {/* Filter Selection Chips */}
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-900 border-t border-slate-800/80 overflow-x-auto no-scrollbar">
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider shrink-0 pl-1">
          Bộ lọc:
        </span>
        {[
          { id: "document", label: "Tài liệu", desc: "Nền trắng nét" },
          { id: "magic", label: "Tự nhiên", desc: "Xóa bóng" },
          { id: "auto", label: "Tự động", desc: "Tương phản" },
          { id: "bw", label: "Đen trắng", desc: "Văn bản rõ" },
          { id: "grayscale", label: "Màu xám", desc: "Ảnh xám" },
          { id: "photo", label: "Ảnh màu", desc: "Nguyên bản" },
          { id: "original", label: "Gốc", desc: "Không lọc" },
        ].map((f) => {
          const isSelected = activePage?.filter === f.id;
          return (
            <button
              key={f.id}
              id={`filter-${f.id}`}
              onClick={() => handleApplyFilter(f.id as FilterMode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition active:scale-95 ${
                isSelected
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              <span>{f.label}</span>
            </button>
          );
        })}
      </div>

      {/* Editing Toolbar: Rotate, Crop, OCR, Long Image */}
      <div className="flex items-center justify-around px-2 py-2 bg-slate-900/90 border-t border-slate-800">
        <button
          id="btn-tool-crop"
          onClick={() => setIsCropping(true)}
          className="min-h-[44px] flex flex-col items-center justify-center gap-1 p-2 rounded-lg text-slate-300 hover:text-white active:scale-95 transition"
        >
          <Crop className="w-5 h-5 text-blue-400" />
          <span className="text-[10px] font-medium">Cắt / Căn góc</span>
        </button>

        <button
          id="btn-tool-rotate"
          onClick={handleRotate}
          className="min-h-[44px] flex flex-col items-center justify-center gap-1 p-2 rounded-lg text-slate-300 hover:text-white active:scale-95 transition"
        >
          <RotateCw className="w-5 h-5 text-blue-400" />
          <span className="text-[10px] font-medium">Xoay 90°</span>
        </button>

        <button
          id="btn-tool-ocr"
          onClick={() => activePage && onOpenOCR(activePage)}
          className="min-h-[44px] flex flex-col items-center justify-center gap-1 p-2 rounded-lg text-slate-300 hover:text-white active:scale-95 transition"
        >
          <Type className="w-5 h-5 text-emerald-400" />
          <span className="text-[10px] font-medium">Đọc chữ OCR</span>
        </button>

        {doc.pages.length > 1 && (
          <button
            id="btn-tool-reorder"
            onClick={() => setIsReordering(true)}
            className="min-h-[44px] flex flex-col items-center justify-center gap-1 p-2 rounded-lg text-slate-300 hover:text-white active:scale-95 transition"
          >
            <Move className="w-5 h-5 text-blue-400" />
            <span className="text-[10px] font-medium">Đổi thứ tự</span>
          </button>
        )}

        {doc.pages.length > 1 && (
          <button
            id="btn-tool-longimage"
            onClick={onOpenLongImage}
            className="min-h-[44px] flex flex-col items-center justify-center gap-1 p-2 rounded-lg text-slate-300 hover:text-white active:scale-95 transition"
          >
            <Layers className="w-5 h-5 text-amber-400" />
            <span className="text-[10px] font-medium">Ghép ảnh dài</span>
          </button>
        )}

        <button
          id="btn-tool-delete-page"
          onClick={handleDeletePage}
          className="min-h-[44px] flex flex-col items-center justify-center gap-1 p-2 rounded-lg text-slate-300 hover:text-red-400 active:scale-95 transition"
        >
          <Trash2 className="w-5 h-5 text-red-400" />
          <span className="text-[10px] font-medium">Xóa trang</span>
        </button>
      </div>

      {/* Bottom Thumbnail Strip & Add Page Button with Safe Area */}
      <div className="flex items-center gap-3 px-4 pt-2.5 pb-safe bg-slate-950 border-t border-slate-800 overflow-x-auto no-scrollbar">
        {doc.pages.map((p, idx) => {
          const isSelected = idx === currentPageIndex;
          return (
            <button
              key={p.id}
              id={`thumb-page-${idx}`}
              onClick={() => setCurrentPageIndex(idx)}
              className={`relative shrink-0 w-14 h-20 rounded-md overflow-hidden border-2 transition active:scale-95 ${
                isSelected
                  ? "border-blue-500 ring-2 ring-blue-500/40 shadow-lg"
                  : "border-slate-700 opacity-60 hover:opacity-100"
              }`}
            >
              <img src={p.processedImage} alt={`Trang ${idx + 1}`} className="w-full h-full object-cover" />
              <span className="absolute bottom-0.5 right-0.5 px-1 rounded bg-black/70 text-[9px] font-bold text-white">
                {idx + 1}
              </span>
            </button>
          );
        })}

        {/* Add Page Button */}
        <button
          id="btn-add-more-pages"
          onClick={onAddMorePages}
          className="flex flex-col items-center justify-center shrink-0 w-14 h-20 rounded-md border-2 border-dashed border-slate-700 hover:border-blue-500 text-slate-400 hover:text-blue-400 bg-slate-900 active:scale-95 transition"
          title="Chụp thêm trang mới"
        >
          <Plus className="w-5 h-5 mb-0.5" />
          <span className="text-[9px] font-semibold">Thêm</span>
        </button>
      </div>

      {/* Page Reorder Modal */}
      {isReordering && (
        <PageReorderModal
          document={doc}
          onSaveReorder={(reorderedPages) => {
            onUpdateDocument({
              ...doc,
              pages: reorderedPages,
              thumbnail: reorderedPages[0]?.processedImage || "",
              updatedAt: Date.now(),
            });
            setCurrentPageIndex(0);
          }}
          onClose={() => setIsReordering(false)}
        />
      )}
    </div>
  );
};
