import React, { useState, useEffect } from "react";
import {
  ArrowLeft,
  Copy,
  Check,
  Download,
  Sparkles,
  RefreshCw,
  Cpu,
  FileText,
  CreditCard,
  Edit3,
} from "lucide-react";
import { OCRResult, ScannedPage, ScanMode } from "../types";
import { OCREngine } from "../utils/ocrEngine";

interface OCRViewerModalProps {
  page: ScannedPage;
  category?: ScanMode;
  onClose: () => void;
}

export const OCRViewerModal: React.FC<OCRViewerModalProps> = ({ page, category = "document", onClose }) => {
  const [ocrMode, setOcrMode] = useState<"local" | "ai">("local");
  const [loading, setLoading] = useState<boolean>(true);
  const [progressMsg, setProgressMsg] = useState<string>("Đang khởi tạo nhận diện ký tự...");
  const [progressPercent, setProgressPercent] = useState<number>(10);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const [editableText, setEditableText] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Run OCR
  const runRecognition = async (useAi: boolean = false) => {
    setLoading(true);
    setErrorMsg(null);

    try {
      if (useAi) {
        setProgressMsg("Đang gửi yêu cầu trích xuất AI thông minh...");
        setProgressPercent(50);
        const mode = category === "cccd" ? "id_card" : category === "driver_license" ? "driver_license" : "document";
        const result = await OCREngine.runAiOCR(page.processedImage, mode);
        setOcrResult(result);
        setEditableText(result.text);
      } else {
        const result = await OCREngine.runLocalOCR(page.processedImage, "vie", (pct, status) => {
          setProgressPercent(pct);
          setProgressMsg(status);
        });
        setOcrResult(result);
        setEditableText(result.text);
      }
    } catch (err: any) {
      console.error("OCR recognition error:", err);
      setErrorMsg(err.message || "Lỗi xử lý OCR");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runRecognition(ocrMode === "ai");
  }, [ocrMode]);

  // Copy to clipboard
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editableText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn("Copy failed:", e);
    }
  };

  // Download text file
  const handleDownloadTxt = () => {
    const blob = new Blob([editableText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `VietScan_OCR_${Date.now()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800">
        <button
          id="btn-ocr-back"
          onClick={onClose}
          className="flex items-center gap-1 px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 active:scale-95 transition text-sm font-medium"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Quay lại</span>
        </button>

        <div className="text-center">
          <h2 className="text-sm font-bold text-white">Trích xuất văn bản (OCR)</h2>
          <p className="text-[11px] text-slate-400">Nhận diện chữ tiếng Việt & tiếng Anh</p>
        </div>

        <button
          id="btn-ocr-copy"
          onClick={handleCopy}
          disabled={!editableText}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-bold shadow transition disabled:opacity-50"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
          <span>{copied ? "Đã chép" : "Sao chép"}</span>
        </button>
      </div>

      {/* Engine Switcher Ribbon */}
      <div className="flex items-center justify-center gap-3 px-4 py-2.5 bg-slate-900/90 border-b border-slate-800">
        <button
          id="btn-ocr-mode-local"
          onClick={() => setOcrMode("local")}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition active:scale-95 ${
            ocrMode === "local"
              ? "bg-blue-600 text-white shadow-md"
              : "bg-slate-800 text-slate-400 hover:text-slate-200"
          }`}
        >
          <Cpu className="w-3.5 h-3.5" />
          <span>OCR Cục bộ (Offline 100%)</span>
        </button>

        <button
          id="btn-ocr-mode-ai"
          onClick={() => setOcrMode("ai")}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition active:scale-95 ${
            ocrMode === "ai"
              ? "bg-purple-600 text-white shadow-md"
              : "bg-slate-800 text-slate-400 hover:text-slate-200"
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-300" />
          <span>AI Trích xuất thông minh</span>
        </button>
      </div>

      {/* Main Content Area */}
      <div className="relative flex-1 w-full h-full p-4 overflow-y-auto bg-slate-950 flex flex-col items-center">
        {loading ? (
          <div className="my-auto flex flex-col items-center gap-4 text-center max-w-xs">
            <RefreshCw className="w-10 h-10 text-blue-500 animate-spin" />
            <div>
              <p className="text-sm font-semibold text-white mb-1">{progressMsg}</p>
              <div className="w-48 h-2 bg-slate-800 rounded-full overflow-hidden mx-auto mt-2">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
            <p className="text-xs text-slate-400">Quá trình diễn ra an toàn trực tiếp trên trình duyệt</p>
          </div>
        ) : errorMsg ? (
          <div className="my-auto p-6 bg-red-950/30 border border-red-800/50 rounded-2xl text-center max-w-sm">
            <p className="text-sm font-semibold text-red-400 mb-3">{errorMsg}</p>
            <button
              onClick={() => runRecognition(ocrMode === "ai")}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white"
            >
              Thử lại
            </button>
          </div>
        ) : (
          <div className="w-full max-w-2xl flex flex-col gap-4">
            {/* Structured Key-Value Fields if Available */}
            {ocrResult?.structuredFields && Object.keys(ocrResult.structuredFields).length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow">
                <div className="flex items-center gap-2 mb-2.5 text-xs font-bold text-blue-400">
                  <CreditCard className="w-4 h-4" />
                  <span>THÔNG TIN TRÍCH XUẤT TỰ ĐỘNG</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {Object.entries(ocrResult.structuredFields).map(([key, val]) => (
                    <div key={key} className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-850">
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">{key}</span>
                      <span className="text-white font-medium text-xs break-words">{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Editable Full Extracted Text */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                  <Edit3 className="w-3.5 h-3.5 text-blue-400" />
                  <span>Văn bản trích xuất (Có thể chỉnh sửa)</span>
                </div>
                <span className="text-[11px] text-slate-500">{editableText.length} ký tự</span>
              </div>

              <textarea
                id="textarea-ocr-content"
                value={editableText}
                onChange={(e) => setEditableText(e.target.value)}
                rows={12}
                className="w-full bg-slate-950 text-slate-200 p-3 rounded-lg border border-slate-800 focus:border-blue-500 focus:outline-none text-xs font-mono leading-relaxed resize-y"
                placeholder="Nội dung văn bản quét được..."
              />
            </div>
          </div>
        )}
      </div>

      {/* Bottom Download Bar */}
      <div className="flex items-center justify-between gap-3 px-6 py-3.5 bg-slate-900 border-t border-slate-800">
        <button
          id="btn-ocr-download-txt"
          onClick={handleDownloadTxt}
          disabled={!editableText}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-semibold transition disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          <span>Lưu file .TXT</span>
        </button>

        <button
          id="btn-ocr-copy-bottom"
          onClick={handleCopy}
          disabled={!editableText}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-bold shadow transition disabled:opacity-50"
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          <span>{copied ? "Đã sao chép" : "Sao chép toàn bộ"}</span>
        </button>
      </div>
    </div>
  );
};
