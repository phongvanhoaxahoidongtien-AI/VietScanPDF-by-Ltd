import React, { useState, useRef } from "react";
import {
  FileText,
  Upload,
  ArrowLeft,
  ArrowRight,
  Trash2,
  Check,
  RotateCcw,
  Layers,
  FileDown,
  Share2,
  AlertCircle,
  X,
  RotateCw,
  Crop,
  Plus,
  Eye,
  Copy,
  RefreshCw,
} from "lucide-react";
import { PDFToolsEngine, PDFPageItem } from "../utils/pdfToolsEngine";
import { PDFGenerator } from "../utils/pdfGenerator";
import { generateDocumentFileName } from "../utils/naming";
import { PDFPageCropModal } from "./PDFPageCropModal";

interface PDFMergeModalProps {
  onClose: () => void;
}

export const PDFMergeModal: React.FC<PDFMergeModalProps> = ({ onClose }) => {
  const [pages, setPages] = useState<PDFPageItem[]>([]);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Preview & Crop states
  const [previewPage, setPreviewPage] = useState<PDFPageItem | null>(null);
  const [croppingPage, setCroppingPage] = useState<PDFPageItem | null>(null);

  // Merged result
  const [mergedPdfUrl, setMergedPdfUrl] = useState<string | null>(null);
  const [mergedBlob, setMergedBlob] = useState<Blob | null>(null);
  const [mergedFileName, setMergedFileName] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle PDF or Image files upload
  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setErrorMsg(null);
    setIsExtracting(true);

    try {
      const extractedPages: PDFPageItem[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isPDF = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
        const isImg = file.type.startsWith("image/");

        if (!isPDF && !isImg) {
          setErrorMsg(`Tệp "${file.name}" không được hỗ trợ (chỉ nhận PDF hoặc Ảnh).`);
          continue;
        }

        const buffer = await file.arrayBuffer();

        if (isPDF) {
          const pdfPages = await PDFToolsEngine.renderPDFToPages(buffer, file.name);
          extractedPages.push(...pdfPages);
        } else if (isImg) {
          // Wrap single image as a page
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });

          extractedPages.push({
            id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            sourceFileName: file.name,
            sourceFileId: `img_src_${Date.now()}`,
            pageIndex: 0,
            pageNumber: 1,
            originalImage: dataUrl,
            renderedImage: dataUrl,
            rotation: 0,
            width: 1200,
            height: 1600,
          });
        }
      }

      setPages((prev) => [...prev, ...extractedPages]);
    } catch (err: any) {
      console.error("Error reading file:", err);
      setErrorMsg(err.message || "Có lỗi xảy ra khi đọc tệp. Vui lòng thử lại.");
    } finally {
      setIsExtracting(false);
      if (e.target) e.target.value = "";
    }
  };

  // Move page position (reorder)
  const handleMovePage = (index: number, direction: "left" | "right") => {
    const targetIdx = direction === "left" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= pages.length) return;

    const copy = [...pages];
    const [moved] = copy.splice(index, 1);
    copy.splice(targetIdx, 0, moved);
    setPages(copy);
  };

  // Rotate single page 90 degrees
  const handleRotatePage = async (index: number) => {
    const page = pages[index];
    if (!page) return;

    try {
      const { dataUrl, width, height } = await PDFToolsEngine.rotateImageDataUrl(
        page.renderedImage,
        90
      );
      setPages((prev) =>
        prev.map((p, i) =>
          i === index
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

  // Remove page
  const handleRemovePage = (index: number) => {
    setPages((prev) => prev.filter((_, i) => i !== index));
  };

  // Duplicate page
  const handleDuplicatePage = (index: number) => {
    const page = pages[index];
    if (!page) return;
    const duplicated: PDFPageItem = {
      ...page,
      id: `dup_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    };
    const copy = [...pages];
    copy.splice(index + 1, 0, duplicated);
    setPages(copy);
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

  // Merge and generate PDF
  const handleMergeAllPages = async () => {
    if (pages.length < 2) {
      setErrorMsg("Vui lòng chọn hoặc giữ lại ít nhất 2 trang để ghép thành 1 file PDF.");
      return;
    }

    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const blob = await PDFToolsEngine.generatePDFFromPages(pages);
      const url = URL.createObjectURL(blob);
      const fileName = `Ghep_${generateDocumentFileName()}`;

      setMergedBlob(blob);
      setMergedPdfUrl(url);
      setMergedFileName(fileName);
    } catch (err: any) {
      console.error("Merge error:", err);
      setErrorMsg(err.message || "Không thể ghép file PDF. Vui lòng thử lại.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!mergedBlob) return;
    PDFGenerator.downloadBlob(mergedBlob, mergedFileName);
  };

  const handleShare = async () => {
    if (!mergedBlob) return;
    await PDFGenerator.sharePDFOrImage(mergedBlob, mergedFileName, "Tài liệu PDF đã ghép");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/90 backdrop-blur-md select-none">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[92vh] max-h-[92vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/95 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Ghép nhiều file PDF (PDF Merge)</h3>
              <p className="text-xs text-slate-400">
                Xem toàn bộ các trang, tự do đổi thứ tự, xoay & cắt từng trang theo ý muốn
              </p>
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
        <div className="p-4 sm:p-6 flex-1 overflow-y-auto space-y-4">
          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-red-950/60 border border-red-800/80 text-red-300 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {!mergedPdfUrl ? (
            <>
              {/* File Upload Drop Area */}
              {pages.length === 0 ? (
                <label
                  htmlFor="pdf-merge-input"
                  className="flex flex-col items-center justify-center p-10 sm:p-14 border-2 border-dashed border-slate-700 hover:border-blue-500/80 rounded-3xl bg-slate-950/60 cursor-pointer transition text-center group"
                >
                  <div className="p-4 rounded-2xl bg-blue-600/10 text-blue-400 group-hover:scale-110 transition mb-3">
                    <Upload className="w-8 h-8" />
                  </div>
                  <h4 className="text-base font-bold text-white">Bấm để chọn các tệp PDF cần ghép</h4>
                  <p className="text-xs text-slate-400 mt-1 max-w-md">
                    Hỗ trợ chọn nhiều file PDF cùng lúc. Toàn bộ các trang sẽ được giải nén để bạn tùy ý sắp xếp, xoay và cắt.
                  </p>
                  <span className="mt-4 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition shadow-lg shadow-blue-600/30">
                    Chọn tệp từ máy
                  </span>
                  <input
                    ref={fileInputRef}
                    id="pdf-merge-input"
                    type="file"
                    accept="application/pdf,.pdf,image/*"
                    multiple
                    onChange={handleFilesSelected}
                    className="hidden"
                  />
                </label>
              ) : (
                /* Multi-Page Visual Grid */
                <div className="space-y-4">
                  {/* Top Bar with Add More Files and Page Count */}
                  <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-950 border border-slate-800">
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1 rounded-xl bg-blue-600/20 text-blue-400 font-bold text-xs border border-blue-500/30">
                        {pages.length} trang tổng cộng
                      </span>
                      <span className="text-xs text-slate-400 hidden sm:inline">
                        Dùng nút mũi tên để di chuyển thứ tự trang
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isExtracting}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition active:scale-95"
                      >
                        <Plus className="w-4 h-4 text-blue-400" />
                        <span>Thêm tệp PDF / Ảnh</span>
                      </button>

                      <button
                        onClick={() => setPages([])}
                        className="p-2 rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-950/30 transition"
                        title="Xóa tất cả trang"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf,.pdf,image/*"
                      multiple
                      onChange={handleFilesSelected}
                      className="hidden"
                    />
                  </div>

                  {isExtracting && (
                    <div className="p-4 rounded-2xl bg-blue-950/40 border border-blue-800/50 flex items-center justify-center gap-3 text-xs text-blue-300">
                      <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                      <span>Đang trích xuất và hiển thị tất cả các trang PDF...</span>
                    </div>
                  )}

                  {/* Visual Grid of All Pages */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {pages.map((page, idx) => (
                      <div
                        key={page.id}
                        className="group relative flex flex-col rounded-2xl bg-slate-950 border border-slate-800 hover:border-blue-500/50 overflow-hidden transition shadow-sm"
                      >
                        {/* Page Header Bar */}
                        <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-b border-slate-800/80 text-[11px]">
                          <div className="flex items-center gap-1.5 font-bold text-white">
                            <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px]">
                              {idx + 1}
                            </span>
                            <span className="truncate max-w-[80px] text-slate-300" title={page.sourceFileName}>
                              {page.sourceFileName}
                            </span>
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
                          onClick={() => setPreviewPage(page)}
                          className="relative aspect-[1/1.414] bg-slate-900 flex items-center justify-center overflow-hidden cursor-pointer p-2"
                        >
                          <img
                            src={page.renderedImage}
                            alt={`Trang ${idx + 1}`}
                            className="w-full h-full object-contain drop-shadow-md rounded transition group-hover:scale-[1.02]"
                          />

                          {/* Hover Zoom Eye Icon */}
                          <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                            <div className="p-2 rounded-full bg-slate-900/90 text-white shadow">
                              <Eye className="w-4 h-4" />
                            </div>
                          </div>
                        </div>

                        {/* Action Tools for this page */}
                        <div className="p-2 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between gap-1">
                          {/* Reorder Buttons */}
                          <div className="flex items-center gap-0.5">
                            <button
                              onClick={() => handleMovePage(idx, "left")}
                              disabled={idx === 0}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-20"
                              title="Chuyển sang trước"
                            >
                              <ArrowLeft className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleMovePage(idx, "right")}
                              disabled={idx === pages.length - 1}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-20"
                              title="Chuyển sang sau"
                            >
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Edit Tools */}
                          <div className="flex items-center gap-0.5">
                            <button
                              onClick={() => handleRotatePage(idx)}
                              className="p-1.5 rounded-lg text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40"
                              title="Xoay 90°"
                            >
                              <RotateCw className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setCroppingPage(page)}
                              className="p-1.5 rounded-lg text-blue-400 hover:text-blue-300 hover:bg-blue-950/40"
                              title="Cắt góc / Crop trang"
                            >
                              <Crop className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDuplicatePage(idx)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                              title="Nhân bản trang"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleRemovePage(idx)}
                              className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-950/40"
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
            </>
          ) : (
            /* Merge Success View */
            <div className="space-y-4 text-center py-6">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                <Check className="w-8 h-8" />
              </div>
              <div>
                <h4 className="text-lg font-bold text-white">Ghép tệp PDF thành công!</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                  Đã ghép toàn bộ {pages.length} trang theo đúng thứ tự, xoay và cắt của bạn thành 1 tệp PDF hoàn chỉnh.
                </p>
                <p className="text-xs font-mono text-blue-400 mt-2 bg-slate-950/80 py-1 px-3 rounded-lg inline-block border border-slate-800">
                  {mergedFileName}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-3 pt-3 max-w-md mx-auto">
                <button
                  onClick={handleDownload}
                  className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition active:scale-98 shadow-lg shadow-blue-600/30"
                >
                  <FileDown className="w-4 h-4" />
                  <span>Tải file PDF</span>
                </button>
                <button
                  onClick={handleShare}
                  className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition active:scale-98 border border-slate-700"
                >
                  <Share2 className="w-4 h-4 text-blue-400" />
                  <span>Chia sẻ</span>
                </button>
              </div>

              <button
                onClick={() => {
                  setMergedPdfUrl(null);
                  setMergedBlob(null);
                }}
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 mt-3"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Tiếp tục chỉnh sửa hoặc ghép thêm</span>
              </button>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        {!mergedPdfUrl && pages.length > 0 && (
          <div className="p-4 border-t border-slate-800 bg-slate-900/95 flex items-center justify-between shrink-0">
            <div className="text-xs text-slate-400">
              Tổng số: <strong className="text-white">{pages.length}</strong> trang
            </div>

            <button
              onClick={handleMergeAllPages}
              disabled={isProcessing || pages.length < 2}
              className="flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-600/30 disabled:opacity-40 transition active:scale-98"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Đang tạo PDF...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Bắt đầu ghép {pages.length} trang</span>
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
            <h4 className="text-sm font-bold text-white mb-2">{previewPage.sourceFileName}</h4>
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
