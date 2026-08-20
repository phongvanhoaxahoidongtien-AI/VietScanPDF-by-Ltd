import React, { useState } from "react";
import {
  ArrowLeft,
  Check,
  Move,
  GripVertical,
  X,
  FileText,
  RotateCcw,
} from "lucide-react";
import { ScannedPage, ScannedDocument } from "../types";

interface PageReorderModalProps {
  document: ScannedDocument;
  onSaveReorder: (reorderedPages: ScannedPage[]) => void;
  onClose: () => void;
}

export const PageReorderModal: React.FC<PageReorderModalProps> = ({
  document: doc,
  onSaveReorder,
  onClose,
}) => {
  const [pages, setPages] = useState<ScannedPage[]>([...doc.pages]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Drag and drop event handlers
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const copy = [...pages];
    const [moved] = copy.splice(draggedIndex, 1);
    copy.splice(targetIndex, 0, moved);

    setPages(copy);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleMoveOneStep = (index: number, direction: "left" | "right") => {
    const targetIdx = direction === "left" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= pages.length) return;

    const copy = [...pages];
    const [moved] = copy.splice(index, 1);
    copy.splice(targetIdx, 0, moved);
    setPages(copy);
  };

  const handleSave = () => {
    onSaveReorder(pages);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 pt-safe-top pb-safe bg-slate-950/85 backdrop-blur-md select-none">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-800 bg-slate-900/90 gap-2">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 active:bg-slate-700 border border-slate-700/80 text-slate-100 hover:text-white active:scale-95 transition text-xs font-semibold shadow-sm min-h-[40px]"
            >
              <ArrowLeft className="w-4 h-4 text-blue-400" />
              <span>Quay lại</span>
            </button>
            <div className="hidden xs:flex p-2 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <Move className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white">Sắp xếp thứ tự các trang</h3>
              <p className="text-[11px] sm:text-xs text-slate-400 hidden sm:block">Kéo thả thẻ trang để thay đổi vị trí</p>
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

        {/* Reorder Grid Body */}
        <div className="p-5 flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {pages.map((page, idx) => {
              const isDragging = draggedIndex === idx;
              const isTarget = dragOverIndex === idx;

              return (
                <div
                  key={page.id}
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={(e) => handleDrop(e, idx)}
                  className={`group relative flex flex-col rounded-2xl border bg-slate-950 p-2 transition duration-200 cursor-grab active:cursor-grabbing ${
                    isDragging
                      ? "opacity-30 scale-95 border-dashed border-blue-500"
                      : isTarget
                      ? "border-blue-400 bg-blue-950/30 scale-105"
                      : "border-slate-800 hover:border-slate-700 shadow-md"
                  }`}
                >
                  {/* Thumbnail Image */}
                  <div className="relative w-full aspect-[1/1.414] rounded-xl bg-black/50 overflow-hidden mb-2 flex items-center justify-center">
                    <img
                      src={page.processedImage}
                      alt={`Trang ${idx + 1}`}
                      className="max-h-full max-w-full object-contain pointer-events-none"
                    />

                    {/* Page Number Badge */}
                    <span className="absolute top-2 left-2 w-6 h-6 rounded-full bg-blue-600/90 backdrop-blur text-white text-xs font-black flex items-center justify-center shadow-md">
                      {idx + 1}
                    </span>

                    {/* Drag Grip Icon */}
                    <div className="absolute top-2 right-2 p-1 rounded-md bg-black/60 text-slate-300">
                      <GripVertical className="w-3.5 h-3.5" />
                    </div>
                  </div>

                  {/* Manual Step Controls (for Mobile touch users) */}
                  <div className="flex items-center justify-between px-1 text-[11px] font-semibold text-slate-400">
                    <button
                      onClick={() => handleMoveOneStep(idx, "left")}
                      disabled={idx === 0}
                      className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 disabled:opacity-30"
                    >
                      ← Lên
                    </button>
                    <span>Trang {idx + 1}</span>
                    <button
                      onClick={() => handleMoveOneStep(idx, "right")}
                      disabled={idx === pages.length - 1}
                      className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 disabled:opacity-30"
                    >
                      Xuống →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between">
          <button
            onClick={() => setPages([...doc.pages])}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-semibold"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Khôi phục gốc</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 text-xs font-semibold"
            >
              Hủy
            </button>

            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-600/30 transition active:scale-98"
            >
              <Check className="w-4 h-4" />
              <span>Áp dụng thứ tự mới</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
