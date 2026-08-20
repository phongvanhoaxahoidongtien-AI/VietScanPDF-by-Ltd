import React, { useState, useRef, useEffect } from "react";
import {
  Highlighter,
  Upload,
  Check,
  RotateCcw,
  FileDown,
  Share2,
  AlertCircle,
  X,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { PDFToolsEngine, HighlightRect } from "../utils/pdfToolsEngine";
import { PDFGenerator } from "../utils/pdfGenerator";
import { generateDocumentFileName } from "../utils/naming";

interface PDFHighlightModalProps {
  onClose: () => void;
}

export const PDFHighlightModal: React.FC<PDFHighlightModalProps> = ({ onClose }) => {
  const [file, setFile] = useState<File | null>(null);
  const [arrayBuffer, setArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);

  // Highlighting rectangles per page index: Map<pageIndex, HighlightRect[]>
  const [highlightsMap, setHighlightsMap] = useState<Record<number, HighlightRect[]>>({});

  // Drawing state
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [currentDraftRect, setCurrentDraftRect] = useState<HighlightRect | null>(null);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [highlightedPdfUrl, setHighlightedPdfUrl] = useState<string | null>(null);
  const [highlightedBlob, setHighlightedBlob] = useState<Blob | null>(null);
  const [highlightedFileName, setHighlightedFileName] = useState<string>("");

  const pageContainerRef = useRef<HTMLDivElement>(null);

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
      const buffer = await f.arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const count = pdfDoc.getPageCount();

      setFile(f);
      setArrayBuffer(buffer);
      setTotalPages(count);
      setCurrentPageIndex(0);
      setHighlightsMap({});
    } catch (err) {
      console.error("Failed to read PDF:", err);
      setErrorMsg("Không thể đọc tệp PDF. Vui lòng kiểm tra lại tệp.");
    }
  };

  // Pointer / Touch drawing handlers for highlighting box
  const getRelativeCoords = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pageContainerRef.current) return { x: 0, y: 0 };
    const rect = pageContainerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!file) return;
    const coords = getRelativeCoords(e);
    setIsDrawing(true);
    setStartPoint(coords);
    setCurrentDraftRect({
      x: coords.x,
      y: coords.y,
      width: 0,
      height: 0,
    });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDrawing || !startPoint) return;
    const coords = getRelativeCoords(e);

    const minX = Math.min(startPoint.x, coords.x);
    const minY = Math.min(startPoint.y, coords.y);
    const width = Math.abs(coords.x - startPoint.x);
    const height = Math.abs(coords.y - startPoint.y);

    setCurrentDraftRect({
      x: minX,
      y: minY,
      width,
      height,
    });
  };

  const handlePointerUp = () => {
    if (!isDrawing || !currentDraftRect) {
      setIsDrawing(false);
      return;
    }

    // Minimum threshold for a highlight area
    if (currentDraftRect.width > 0.02 && currentDraftRect.height > 0.01) {
      setHighlightsMap((prev) => {
        const existing = prev[currentPageIndex] || [];
        return {
          ...prev,
          [currentPageIndex]: [...existing, currentDraftRect],
        };
      });
    }

    setIsDrawing(false);
    setStartPoint(null);
    setCurrentDraftRect(null);
  };

  const handleClearCurrentPageHighlights = () => {
    setHighlightsMap((prev) => {
      const copy = { ...prev };
      delete copy[currentPageIndex];
      return copy;
    });
  };

  const handleApplyHighlight = async () => {
    if (!arrayBuffer) return;

    const allHighlightArrays = Object.values(highlightsMap) as HighlightRect[][];
    const hasAny = allHighlightArrays.some((arr) => arr.length > 0);
    if (!hasAny) {
      setErrorMsg("Vui lòng kéo chuột/tay bôi vàng ít nhất 1 vùng văn bản trên trang.");
      return;
    }

    setIsProcessing(true);
    setErrorMsg(null);

    try {
      let currentBuffer: ArrayBuffer = arrayBuffer;

      // Apply highlights sequentially page by page
      for (const [pageIdxStr, hls] of Object.entries(highlightsMap) as [string, HighlightRect[]][]) {
        const pageIdx = parseInt(pageIdxStr, 10);
        if (hls && hls.length > 0) {
          const resultBytes = await PDFToolsEngine.highlightPDF(currentBuffer, pageIdx, hls);
          currentBuffer = resultBytes.buffer as ArrayBuffer;
        }
      }

      const blob = new Blob([currentBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const fileName = `Highlight_${generateDocumentFileName()}`;

      setHighlightedBlob(blob);
      setHighlightedPdfUrl(url);
      setHighlightedFileName(fileName);
    } catch (err: any) {
      console.error("Highlight error:", err);
      setErrorMsg(err.message || "Không thể bôi vàng PDF. Vui lòng thử lại.");
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
    await PDFGenerator.sharePDFOrImage(highlightedBlob, highlightedFileName, "Tài liệu PDF đã Highlight");
  };

  const currentHighlights = highlightsMap[currentPageIndex] || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md select-none">
      <div className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <Highlighter className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Highlight PDF (Bôi vàng văn bản)</h3>
              <p className="text-xs text-slate-400">Kéo thả chuột/ngón tay để đánh dấu vùng quan trọng</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-2xl bg-red-950/50 border border-red-800/60 text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {!highlightedPdfUrl ? (
            <>
              {!file ? (
                /* File Upload Drop Area */
                <label
                  htmlFor="pdf-hl-input"
                  className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-slate-700 hover:border-amber-500/80 rounded-2xl bg-slate-950/50 cursor-pointer transition text-center group"
                >
                  <div className="p-3.5 rounded-full bg-amber-500/10 text-amber-400 group-hover:scale-110 transition mb-3">
                    <Upload className="w-7 h-7" />
                  </div>
                  <p className="text-sm font-semibold text-white">Chọn tệp PDF cần bôi vàng</p>
                  <p className="text-xs text-slate-400 mt-1">Bấm để tải tệp PDF từ điện thoại hoặc máy tính</p>
                  <input
                    id="pdf-hl-input"
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              ) : (
                /* Canvas Interactive Highlight Board */
                <div className="space-y-3">
                  {/* Page Controls & Navigation */}
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCurrentPageIndex((prev) => Math.max(0, prev - 1))}
                        disabled={currentPageIndex === 0}
                        className="p-1.5 rounded-lg bg-slate-900 text-slate-300 hover:text-white disabled:opacity-30"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="font-bold text-white">
                        Trang {currentPageIndex + 1} / {totalPages}
                      </span>
                      <button
                        onClick={() => setCurrentPageIndex((prev) => Math.min(totalPages - 1, prev + 1))}
                        disabled={currentPageIndex === totalPages - 1}
                        className="p-1.5 rounded-lg bg-slate-900 text-slate-300 hover:text-white disabled:opacity-30"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-amber-400 font-semibold">
                        {currentHighlights.length} điểm bôi vàng
                      </span>
                      {currentHighlights.length > 0 && (
                        <button
                          onClick={handleClearCurrentPageHighlights}
                          className="flex items-center gap-1 px-2 py-1 rounded bg-red-950/40 text-red-400 hover:bg-red-900/40 text-[10px] font-semibold border border-red-800/40"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Xóa trang này</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Interactive Page Canvas Stage */}
                  <div className="relative w-full aspect-[1/1.414] max-h-80 mx-auto rounded-2xl bg-white border-2 border-dashed border-amber-500/50 shadow-inner overflow-hidden flex items-center justify-center">
                    <div
                      ref={pageContainerRef}
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      className="relative w-full h-full cursor-crosshair touch-none select-none bg-slate-50 flex flex-col justify-center items-center p-6 text-center"
                    >
                      {/* Document Placeholder Lines */}
                      <div className="w-full space-y-3 pointer-events-none opacity-40">
                        <div className="h-4 bg-slate-400 rounded w-2/3 mx-auto" />
                        <div className="h-2.5 bg-slate-300 rounded w-full" />
                        <div className="h-2.5 bg-slate-300 rounded w-5/6" />
                        <div className="h-2.5 bg-slate-300 rounded w-4/5" />
                        <div className="h-2.5 bg-slate-300 rounded w-full" />
                        <div className="h-2.5 bg-slate-300 rounded w-3/4" />
                        <div className="h-2.5 bg-slate-300 rounded w-5/6" />
                        <div className="h-2.5 bg-slate-300 rounded w-2/3" />
                      </div>

                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="px-3 py-1.5 rounded-full bg-slate-900/80 backdrop-blur text-white text-[11px] font-semibold shadow-lg">
                          👆 Kéo tay hoặc chuột trên khung để bôi vàng
                        </span>
                      </div>

                      {/* Render Applied Highlights on this page */}
                      {currentHighlights.map((hl, i) => (
                        <div
                          key={i}
                          style={{
                            left: `${hl.x * 100}%`,
                            top: `${hl.y * 100}%`,
                            width: `${hl.width * 100}%`,
                            height: `${hl.height * 100}%`,
                          }}
                          className="absolute bg-amber-400/40 border border-amber-500/80 rounded pointer-events-none transition-all shadow-sm"
                        />
                      ))}

                      {/* Render Current Drawing Highlight Rect */}
                      {isDrawing && currentDraftRect && (
                        <div
                          style={{
                            left: `${currentDraftRect.x * 100}%`,
                            top: `${currentDraftRect.y * 100}%`,
                            width: `${currentDraftRect.width * 100}%`,
                            height: `${currentDraftRect.height * 100}%`,
                          }}
                          className="absolute bg-amber-400/50 border-2 border-amber-500 rounded pointer-events-none animate-pulse"
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Highlight Success View */
            <div className="space-y-4 text-center py-4">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                <Check className="w-8 h-8" />
              </div>
              <div>
                <h4 className="text-base font-bold text-white">Highlight văn bản PDF thành công!</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                  Đã thêm lớp bôi vàng vector sắc nét vào tài liệu PDF của bạn.
                </p>
                <p className="text-xs font-mono text-amber-400 mt-2 bg-slate-950/80 py-1 px-3 rounded-lg inline-block border border-slate-800">
                  {highlightedFileName}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-3 pt-2">
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
                  setFile(null);
                  setArrayBuffer(null);
                  setHighlightsMap({});
                }}
                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 mt-2"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Highlight tệp PDF khác</span>
              </button>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        {!highlightedPdfUrl && (
          <div className="p-4 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between">
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 text-xs font-semibold"
            >
              Hủy
            </button>

            <button
              onClick={handleApplyHighlight}
              disabled={isProcessing || !file}
              className="flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-lg shadow-amber-500/30 disabled:opacity-40 transition active:scale-98"
            >
              <Check className="w-4 h-4" />
              <span>{isProcessing ? "Đang áp dụng..." : "Lưu PDF Highlight"}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
