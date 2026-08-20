import React, { useState, useRef } from "react";
import {
  FileText,
  Upload,
  Scissors,
  Check,
  RotateCcw,
  FileDown,
  Share2,
  AlertCircle,
  X,
  ArrowLeft,
  RotateCw,
  Crop,
  Eye,
  RefreshCw,
  CheckSquare,
  Square,
} from "lucide-react";
import { PDFToolsEngine, PDFPageItem } from "../utils/pdfToolsEngine";
import { PDFGenerator } from "../utils/pdfGenerator";
import { generateDocumentFileName } from "../utils/naming";
import { PDFPageCropModal } from "./PDFPageCropModal";

interface PDFSplitModalProps {
  onClose: () => void;
}

export const PDFSplitModal: React.FC<PDFSplitModalProps> = ({ onClose }) => {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PDFPageItem[]>([]);
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const [rangeInput, setRangeInput] = useState<string>("1");

  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Preview & Crop modal state
  const [previewPage, setPreviewPage] = useState<PDFPageItem | null>(null);
  const [croppingPage, setCroppingPage] = useState<PDFPageItem | null>(null);

  // Split results
  const [splitPdfUrl, setSplitPdfUrl] = useState<string | null>(null);
  const [splitBlob, setSplitBlob] = useState<Blob | null>(null);
  const [splitFileName, setSplitFileName] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);

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

      // Select first page by default or first 3 pages if multiple
      const defaultSelected = extracted.slice(0, Math.min(extracted.length, 3)).map((p) => p.id);
      setSelectedPageIds(defaultSelected);
      setRangeInput(extracted.length > 1 ? `1-${Math.min(extracted.length, 3)}` : "1");
    } catch (err: any) {
      console.error("Failed to read PDF:", err);
      setErrorMsg(err.message || "Không thể đọc tệp PDF. Vui lòng kiểm tra lại tệp.");
    } finally {
      setIsExtracting(false);
      if (e.target) e.target.value = "";
    }
  };

  // Toggle page selection
  const togglePageSelect = (pageId: string) => {
    let updated: string[];
    if (selectedPageIds.includes(pageId)) {
      updated = selectedPageIds.filter((id) => id !== pageId);
    } else {
      updated = [...selectedPageIds, pageId];
    }
    setSelectedPageIds(updated);

    // Update range input string
    const indices = updated
      .map((id) => pages.findIndex((p) => p.id === id) + 1)
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    setRangeInput(indices.join(", "));
  };

  // Handle manual range input typing
  const handleRangeChange = (val: string) => {
    setRangeInput(val);
    if (pages.length > 0) {
      const parsedIndices = PDFToolsEngine.parsePageRanges(val, pages.length);
      const newSelectedIds = parsedIndices
        .map((idx) => pages[idx]?.id)
        .filter(Boolean) as string[];
      setSelectedPageIds(newSelectedIds);
    }
  };

  const handleSelectAll = () => {
    setSelectedPageIds(pages.map((p) => p.id));
    setRangeInput(`1-${pages.length}`);
  };

  const handleDeselectAll = () => {
    setSelectedPageIds([]);
    setRangeInput("");
  };

  const handleSelectEven = () => {
    const evens = pages.filter((_, i) => (i + 1) % 2 === 0).map((p) => p.id);
    setSelectedPageIds(evens);
    setRangeInput(
      pages
        .map((_, i) => i + 1)
        .filter((n) => n % 2 === 0)
        .join(", ")
    );
  };

  const handleSelectOdd = () => {
    const odds = pages.filter((_, i) => (i + 1) % 2 !== 0).map((p) => p.id);
    setSelectedPageIds(odds);
    setRangeInput(
      pages
        .map((_, i) => i + 1)
        .filter((n) => n % 2 !== 0)
        .join(", ")
    );
  };

  // Rotate single page 90 degrees
  const handleRotatePage = async (pageId: string) => {
    const pageIdx = pages.findIndex((p) => p.id === pageId);
    if (pageIdx === -1) return;

    const page = pages[pageIdx];
    try {
      const { dataUrl, width, height } = await PDFToolsEngine.rotateImageDataUrl(
        page.renderedImage,
        90
      );
      setPages((prev) =>
        prev.map((p) =>
          p.id === pageId
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

  // Split and export selected pages
  const handleSplit = async () => {
    const selectedPages = pages.filter((p) => selectedPageIds.includes(p.id));
    if (selectedPages.length === 0) {
      setErrorMsg("Vui lòng chọn ít nhất 1 trang để trích xuất.");
      return;
    }

    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const blob = await PDFToolsEngine.generatePDFFromPages(selectedPages);
      const url = URL.createObjectURL(blob);
      const fileName = `Tach_${generateDocumentFileName()}`;

      setSplitBlob(blob);
      setSplitPdfUrl(url);
      setSplitFileName(fileName);
    } catch (err: any) {
      console.error("Split error:", err);
      setErrorMsg(err.message || "Không thể tách tệp PDF. Vui lòng thử lại.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!splitBlob) return;
    PDFGenerator.downloadBlob(splitBlob, splitFileName);
  };

  const handleShare = async () => {
    if (!splitBlob) return;
    await PDFGenerator.sharePDFOrImage(splitBlob, splitFileName, "Tài liệu PDF đã tách");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 pt-safe-top pb-safe bg-slate-950/90 backdrop-blur-md select-none">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[90vh] max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-800 bg-slate-900/95 shrink-0 gap-2">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              id="btn-pdf-split-back"
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 active:bg-slate-700 border border-slate-700/80 text-slate-100 hover:text-white active:scale-95 transition text-xs font-semibold shadow-sm min-h-[40px]"
            >
              <ArrowLeft className="w-4 h-4 text-emerald-400" />
              <span>Quay lại</span>
            </button>
            <div className="hidden xs:flex p-2 rounded-xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/30">
              <Scissors className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white leading-tight">Tách trang PDF (Split)</h3>
              <p className="text-[11px] sm:text-xs text-slate-400 hidden sm:block">
                Xem toàn bộ trang, chọn trang, xoay 90° & cắt trang
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
        <div className="p-4 sm:p-6 flex-1 overflow-y-auto space-y-4">
          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-red-950/60 border border-red-800/80 text-red-300 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {!splitPdfUrl ? (
            <>
              {!file || pages.length === 0 ? (
                /* File Upload Area */
                <label
                  htmlFor="pdf-split-input"
                  className="flex flex-col items-center justify-center p-10 sm:p-14 border-2 border-dashed border-slate-700 hover:border-emerald-500/80 rounded-3xl bg-slate-950/60 cursor-pointer transition text-center group"
                >
                  <div className="p-4 rounded-2xl bg-emerald-600/10 text-emerald-400 group-hover:scale-110 transition mb-3">
                    <Upload className="w-8 h-8" />
                  </div>
                  <h4 className="text-base font-bold text-white">Bấm để chọn tệp PDF cần tách</h4>
                  <p className="text-xs text-slate-400 mt-1 max-w-md">
                    Toàn bộ các trang sẽ được hiển thị dạng hình ảnh trực quan để bạn dễ dàng chọn lọc, xoay và cắt góc.
                  </p>
                  <span className="mt-4 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition shadow-lg shadow-emerald-600/30">
                    Chọn tệp PDF
                  </span>
                  <input
                    ref={fileInputRef}
                    id="pdf-split-input"
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              ) : (
                /* Page Selection & Tools Interface */
                <div className="space-y-4">
                  {/* File Info & Quick Filters Bar */}
                  <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 truncate max-w-md">
                        <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span className="text-xs font-bold text-white truncate">{file.name}</span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-emerald-400 font-bold">
                          {pages.length} trang
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          onClick={handleSelectAll}
                          className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] font-semibold transition"
                        >
                          Chọn tất cả
                        </button>
                        <button
                          onClick={handleSelectOdd}
                          className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] font-semibold transition"
                        >
                          Trang lẻ
                        </button>
                        <button
                          onClick={handleSelectEven}
                          className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] font-semibold transition"
                        >
                          Trang chẵn
                        </button>
                        <button
                          onClick={handleDeselectAll}
                          className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-red-400 text-[11px] font-semibold transition"
                        >
                          Bỏ chọn
                        </button>
                      </div>
                    </div>

                    {/* Range Input Field */}
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-semibold text-slate-400 shrink-0">
                        Nhập khoảng trang:
                      </label>
                      <input
                        type="text"
                        value={rangeInput}
                        onChange={(e) => handleRangeChange(e.target.value)}
                        placeholder="Ví dụ: 1, 3-5, 8"
                        className="flex-1 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  {isExtracting && (
                    <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-800/50 flex items-center justify-center gap-3 text-xs text-emerald-300">
                      <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                      <span>Đang tải và hiển thị toàn bộ các trang...</span>
                    </div>
                  )}

                  {/* Visual Grid of Pages with Selection & Edit Tools */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {pages.map((page, idx) => {
                      const isSelected = selectedPageIds.includes(page.id);

                      return (
                        <div
                          key={page.id}
                          className={`group relative flex flex-col rounded-2xl border transition shadow-sm overflow-hidden ${
                            isSelected
                              ? "bg-slate-950 border-emerald-500/80 ring-2 ring-emerald-500/30"
                              : "bg-slate-950/70 border-slate-800 hover:border-slate-700 opacity-70 hover:opacity-100"
                          }`}
                        >
                          {/* Page Header Bar with Checkbox */}
                          <div
                            onClick={() => togglePageSelect(page.id)}
                            className={`flex items-center justify-between px-3 py-2 border-b cursor-pointer transition ${
                              isSelected
                                ? "bg-emerald-950/50 border-emerald-800/50 text-emerald-300"
                                : "bg-slate-900 border-slate-800 text-slate-400"
                            }`}
                          >
                            <div className="flex items-center gap-2 font-bold text-xs">
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0" />
                              ) : (
                                <Square className="w-4 h-4 text-slate-500 shrink-0" />
                              )}
                              <span>Trang {idx + 1}</span>
                            </div>

                            <div className="flex items-center gap-1">
                              {page.rotation > 0 && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 font-mono">
                                  {page.rotation}°
                                </span>
                              )}
                              {page.isCropped && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-950 text-blue-400 font-medium">
                                  Đã cắt
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Page Thumbnail Preview */}
                          <div
                            onClick={() => togglePageSelect(page.id)}
                            className="relative aspect-[1/1.414] bg-slate-900 flex items-center justify-center overflow-hidden cursor-pointer p-2"
                          >
                            <img
                              src={page.renderedImage}
                              alt={`Trang ${idx + 1}`}
                              className="w-full h-full object-contain drop-shadow-md rounded transition group-hover:scale-[1.02]"
                            />
                          </div>

                          {/* Action Tools: Rotate, Crop, Preview */}
                          <div className="p-2 bg-slate-900/90 border-t border-slate-800 flex items-center justify-around gap-1">
                            <button
                              onClick={() => handleRotatePage(page.id)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 text-[11px] font-semibold"
                              title="Xoay 90°"
                            >
                              <RotateCw className="w-3.5 h-3.5" />
                              <span>Xoay</span>
                            </button>

                            <button
                              onClick={() => setCroppingPage(page)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg text-blue-400 hover:text-blue-300 hover:bg-blue-950/40 text-[11px] font-semibold"
                              title="Cắt góc / Crop trang"
                            >
                              <Crop className="w-3.5 h-3.5" />
                              <span>Cắt</span>
                            </button>

                            <button
                              onClick={() => setPreviewPage(page)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                              title="Xem phóng to"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Split Success View */
            <div className="space-y-4 text-center py-6">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                <Check className="w-8 h-8" />
              </div>
              <div>
                <h4 className="text-lg font-bold text-white">Trích xuất trang PDF thành công!</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                  Đã tạo file PDF mới gồm {selectedPageIds.length} trang đã chọn kèm theo góc xoay và các đường cắt của bạn.
                </p>
                <p className="text-xs font-mono text-emerald-400 mt-2 bg-slate-950/80 py-1 px-3 rounded-lg inline-block border border-slate-800">
                  {splitFileName}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-3 pt-3 max-w-md mx-auto">
                <button
                  onClick={handleDownload}
                  className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition active:scale-98 shadow-lg shadow-emerald-600/30"
                >
                  <FileDown className="w-4 h-4" />
                  <span>Tải file PDF</span>
                </button>
                <button
                  onClick={handleShare}
                  className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition active:scale-98 border border-slate-700"
                >
                  <Share2 className="w-4 h-4 text-emerald-400" />
                  <span>Chia sẻ</span>
                </button>
              </div>

              <button
                onClick={() => {
                  setSplitPdfUrl(null);
                  setSplitBlob(null);
                }}
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 mt-3"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Tiếp tục chọn trang hoặc tách tệp khác</span>
              </button>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        {!splitPdfUrl && pages.length > 0 && (
          <div className="p-4 border-t border-slate-800 bg-slate-900/95 flex items-center justify-between shrink-0">
            <div className="text-xs text-slate-400">
              Đã chọn: <strong className="text-emerald-400">{selectedPageIds.length}</strong> / {pages.length} trang
            </div>

            <button
              onClick={handleSplit}
              disabled={isProcessing || selectedPageIds.length === 0}
              className="flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/30 disabled:opacity-40 transition active:scale-98"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Đang tách PDF...</span>
                </>
              ) : (
                <>
                  <Scissors className="w-4 h-4" />
                  <span>Tách {selectedPageIds.length} trang đã chọn</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Full Page Zoom Preview Modal */}
      {previewPage && (
        <div
          onClick={() => setPreviewPage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-2xl max-h-[85vh] bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col items-center"
          >
            <button
              onClick={() => setPreviewPage(null)}
              className="absolute top-3 right-3 p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <h4 className="text-sm font-bold text-white mb-2">Trang {previewPage.pageNumber}</h4>
            <div className="flex-1 overflow-auto rounded-xl bg-slate-950 p-2 max-h-[70vh]">
              <img
                src={previewPage.renderedImage}
                alt="Xem trước"
                className="max-h-[68vh] object-contain rounded"
              />
            </div>
          </div>
        </div>
      )}

      {/* Crop Page Modal */}
      {croppingPage && (
        <PDFPageCropModal
          imageSrc={croppingPage.renderedImage}
          pageNumber={pages.findIndex((p) => p.id === croppingPage.id) + 1}
          onComplete={handleCropComplete}
          onCancel={() => setCroppingPage(null)}
        />
      )}
    </div>
  );
};
