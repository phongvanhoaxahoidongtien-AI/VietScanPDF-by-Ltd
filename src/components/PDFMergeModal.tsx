import React, { useState } from "react";
import {
  FileText,
  Upload,
  ArrowUp,
  ArrowDown,
  Trash2,
  Check,
  RotateCcw,
  Layers,
  FileDown,
  Share2,
  AlertCircle,
  X,
} from "lucide-react";
import { PDFToolsEngine } from "../utils/pdfToolsEngine";
import { PDFGenerator } from "../utils/pdfGenerator";
import { generateDocumentFileName } from "../utils/naming";

interface PDFFileItem {
  id: string;
  name: string;
  size: number;
  arrayBuffer: ArrayBuffer;
}

interface PDFMergeModalProps {
  onClose: () => void;
}

export const PDFMergeModal: React.FC<PDFMergeModalProps> = ({ onClose }) => {
  const [fileList, setFileList] = useState<PDFFileItem[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mergedPdfUrl, setMergedPdfUrl] = useState<string | null>(null);
  const [mergedBlob, setMergedBlob] = useState<Blob | null>(null);
  const [mergedFileName, setMergedFileName] = useState<string>("");

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setErrorMsg(null);
    const newItems: PDFFileItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
        setErrorMsg(`Tệp "${f.name}" không phải là định dạng PDF.`);
        continue;
      }
      try {
        const buffer = await f.arrayBuffer();
        newItems.push({
          id: `pdf_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          name: f.name,
          size: f.size,
          arrayBuffer: buffer,
        });
      } catch (err) {
        console.error("Error reading file:", err);
      }
    }

    setFileList((prev) => [...prev, ...newItems]);
    e.target.value = "";
  };

  const handleMove = (index: number, direction: "up" | "down") => {
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= fileList.length) return;

    const copy = [...fileList];
    const [moved] = copy.splice(index, 1);
    copy.splice(targetIdx, 0, moved);
    setFileList(copy);
  };

  const handleRemove = (index: number) => {
    setFileList((prev) => prev.filter((_, i) => i !== index));
  };

  const handleMerge = async () => {
    if (fileList.length < 2) {
      setErrorMsg("Vui lòng chọn ít nhất 2 tệp PDF để ghép.");
      return;
    }

    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const buffers = fileList.map((f) => f.arrayBuffer);
      const mergedBytes = await PDFToolsEngine.mergePDFs(buffers);

      const blob = new Blob([mergedBytes], { type: "application/pdf" });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md select-none">
      <div className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Ghép nhiều file PDF (Merge PDF)</h3>
              <p className="text-xs text-slate-400">Gộp các file PDF riêng lẻ thành 1 tài liệu duy nhất</p>
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

          {!mergedPdfUrl ? (
            <>
              {/* File Upload Drop Area */}
              <label
                htmlFor="pdf-merge-input"
                className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-700 hover:border-blue-500/80 rounded-2xl bg-slate-950/50 cursor-pointer transition text-center group"
              >
                <div className="p-3 rounded-full bg-blue-600/10 text-blue-400 group-hover:scale-110 transition mb-2">
                  <Upload className="w-6 h-6" />
                </div>
                <p className="text-sm font-semibold text-white">Bấm để chọn hoặc kéo thả các tệp PDF</p>
                <p className="text-xs text-slate-400 mt-1">Hỗ trợ chọn nhiều file PDF cùng lúc</p>
                <input
                  id="pdf-merge-input"
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  onChange={handleFilesSelected}
                  className="hidden"
                />
              </label>

              {/* Selected Files List */}
              {fileList.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-400 px-1">
                    <span>Thứ tự ghép ({fileList.length} tệp)</span>
                    <span>Dùng nút mũi tên để đổi thứ tự</span>
                  </div>

                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {fileList.map((item, idx) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs"
                      >
                        <div className="flex items-center gap-2.5 max-w-[65%] truncate">
                          <span className="w-5 h-5 rounded-full bg-blue-600/20 text-blue-400 font-bold flex items-center justify-center shrink-0 text-[11px]">
                            {idx + 1}
                          </span>
                          <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="text-slate-200 font-medium truncate">{item.name}</span>
                          <span className="text-[10px] text-slate-500 shrink-0">
                            ({Math.round(item.size / 1024)} KB)
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleMove(idx, "up")}
                            disabled={idx === 0}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30"
                            title="Di chuyển lên"
                          >
                            <ArrowUp className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleMove(idx, "down")}
                            disabled={idx === fileList.length - 1}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30"
                            title="Di chuyển xuống"
                          >
                            <ArrowDown className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleRemove(idx)}
                            className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-950/30"
                            title="Xóa tệp"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Merge Success View */
            <div className="space-y-4 text-center py-4">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                <Check className="w-8 h-8" />
              </div>
              <div>
                <h4 className="text-base font-bold text-white">Ghép tệp PDF thành công!</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                  Tài liệu mới đã sẵn sàng để tải về hoặc chia sẻ ngay.
                </p>
                <p className="text-xs font-mono text-blue-400 mt-2 bg-slate-950/80 py-1 px-3 rounded-lg inline-block border border-slate-800">
                  {mergedFileName}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-3 pt-2">
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
                  setFileList([]);
                }}
                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 mt-2"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Ghép bộ tệp khác</span>
              </button>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        {!mergedPdfUrl && (
          <div className="p-4 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between">
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 text-xs font-semibold"
            >
              Hủy
            </button>

            <button
              onClick={handleMerge}
              disabled={isProcessing || fileList.length < 2}
              className="flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-600/30 disabled:opacity-40 transition active:scale-98"
            >
              <Check className="w-4 h-4" />
              <span>{isProcessing ? "Đang ghép..." : "Bắt đầu ghép PDF"}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
