import React, { useState } from "react";
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
  Layers,
} from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { PDFToolsEngine } from "../utils/pdfToolsEngine";
import { PDFGenerator } from "../utils/pdfGenerator";
import { generateDocumentFileName } from "../utils/naming";

interface PDFSplitModalProps {
  onClose: () => void;
}

export const PDFSplitModal: React.FC<PDFSplitModalProps> = ({ onClose }) => {
  const [file, setFile] = useState<File | null>(null);
  const [arrayBuffer, setArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [rangeInput, setRangeInput] = useState<string>("1");
  const [selectedPages, setSelectedPages] = useState<number[]>([0]);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [splitPdfUrl, setSplitPdfUrl] = useState<string | null>(null);
  const [splitBlob, setSplitBlob] = useState<Blob | null>(null);
  const [splitFileName, setSplitFileName] = useState<string>("");

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
      setRangeInput(count > 1 ? `1-${Math.min(count, 3)}` : "1");
      setSelectedPages(
        count > 1
          ? Array.from({ length: Math.min(count, 3) }, (_, i) => i)
          : [0]
      );
    } catch (err) {
      console.error("Failed to read PDF:", err);
      setErrorMsg("Không thể đọc tệp PDF. Có thể tệp bị khóa mật khẩu hoặc lỗi cấu trúc.");
    }
  };

  const handleRangeChange = (val: string) => {
    setRangeInput(val);
    if (totalPages > 0) {
      const parsed = PDFToolsEngine.parsePageRanges(val, totalPages);
      setSelectedPages(parsed);
    }
  };

  const togglePageSelect = (pageIndex: number) => {
    let updated: number[];
    if (selectedPages.includes(pageIndex)) {
      updated = selectedPages.filter((p) => p !== pageIndex);
    } else {
      updated = [...selectedPages, pageIndex].sort((a, b) => a - b);
    }
    setSelectedPages(updated);
    // Update range input text
    setRangeInput(updated.map((p) => p + 1).join(", "));
  };

  const handleSplit = async () => {
    if (!arrayBuffer || selectedPages.length === 0) {
      setErrorMsg("Vui lòng chọn ít nhất 1 trang để tách.");
      return;
    }

    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const splitBytes = await PDFToolsEngine.splitPDF(arrayBuffer, selectedPages);
      const blob = new Blob([splitBytes], { type: "application/pdf" });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md select-none">
      <div className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/30">
              <Scissors className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Tách trang PDF (Split PDF)</h3>
              <p className="text-xs text-slate-400">Trích xuất trang lẻ hoặc khoảng trang mong muốn</p>
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

          {!splitPdfUrl ? (
            <>
              {!file ? (
                /* File Upload Area */
                <label
                  htmlFor="pdf-split-input"
                  className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-slate-700 hover:border-emerald-500/80 rounded-2xl bg-slate-950/50 cursor-pointer transition text-center group"
                >
                  <div className="p-3.5 rounded-full bg-emerald-600/10 text-emerald-400 group-hover:scale-110 transition mb-3">
                    <Upload className="w-7 h-7" />
                  </div>
                  <p className="text-sm font-semibold text-white">Chọn tệp PDF cần tách trang</p>
                  <p className="text-xs text-slate-400 mt-1">Bấm để tải tệp PDF từ điện thoại hoặc máy tính</p>
                  <input
                    id="pdf-split-input"
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              ) : (
                /* Page Selection Interface */
                <div className="space-y-4">
                  {/* File Info Bar */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs">
                    <div className="flex items-center gap-2 truncate max-w-[70%]">
                      <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="font-semibold text-white truncate">{file.name}</span>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-slate-800 text-emerald-400 font-bold">
                      {totalPages} trang
                    </span>
                  </div>

                  {/* Range Input Field */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Nhập dải trang muốn trích xuất (Ví dụ: 1, 3-5, 8):
                    </label>
                    <input
                      type="text"
                      value={rangeInput}
                      onChange={(e) => handleRangeChange(e.target.value)}
                      placeholder="1, 3-5"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-medium text-xs focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  {/* Page Grid Selector */}
                  <div>
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-2">
                      <span>Hoặc bấm chọn trực tiếp các trang:</span>
                      <span className="text-emerald-400 font-bold">Đã chọn: {selectedPages.length} trang</span>
                    </div>

                    <div className="grid grid-cols-5 sm:grid-cols-8 gap-2 max-h-48 overflow-y-auto pr-1">
                      {Array.from({ length: totalPages }, (_, idx) => {
                        const isSelected = selectedPages.includes(idx);
                        return (
                          <button
                            key={idx}
                            onClick={() => togglePageSelect(idx)}
                            className={`flex flex-col items-center justify-center p-2 rounded-xl border text-xs font-bold transition active:scale-95 ${
                              isSelected
                                ? "bg-emerald-600 text-white border-emerald-400 shadow-md shadow-emerald-600/30"
                                : "bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-white"
                            }`}
                          >
                            <FileText className="w-3.5 h-3.5 mb-1" />
                            <span>{idx + 1}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Split Success View */
            <div className="space-y-4 text-center py-4">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                <Check className="w-8 h-8" />
              </div>
              <div>
                <h4 className="text-base font-bold text-white">Trích xuất trang PDF thành công!</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                  Đã tạo file PDF mới gồm {selectedPages.length} trang đã chọn.
                </p>
                <p className="text-xs font-mono text-emerald-400 mt-2 bg-slate-950/80 py-1 px-3 rounded-lg inline-block border border-slate-800">
                  {splitFileName}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-3 pt-2">
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
                  setFile(null);
                  setArrayBuffer(null);
                }}
                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 mt-2"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Tách tệp PDF khác</span>
              </button>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        {!splitPdfUrl && (
          <div className="p-4 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between">
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 text-xs font-semibold"
            >
              Hủy
            </button>

            <button
              onClick={handleSplit}
              disabled={isProcessing || !file || selectedPages.length === 0}
              className="flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/30 disabled:opacity-40 transition active:scale-98"
            >
              <Scissors className="w-4 h-4" />
              <span>{isProcessing ? "Đang tách..." : `Tách ${selectedPages.length} trang`}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
