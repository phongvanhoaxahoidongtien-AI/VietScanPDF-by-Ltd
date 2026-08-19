import React, { useState, useEffect } from "react";
import { ArrowLeft, Download, Share2, RefreshCw, Check, Image as ImageIcon } from "lucide-react";
import { ScannedDocument } from "../types";
import { CVEngine } from "../utils/cvEngine";
import { PDFGenerator } from "../utils/pdfGenerator";

interface LongImageModalProps {
  document: ScannedDocument;
  onClose: () => void;
}

export const LongImageModal: React.FC<LongImageModalProps> = ({ document: doc, onClose }) => {
  const [longImageDataUrl, setLongImageDataUrl] = useState<string | null>(null);
  const [isStitching, setIsStitching] = useState<boolean>(true);

  useEffect(() => {
    const stitch = async () => {
      setIsStitching(true);
      try {
        const result = await CVEngine.stitchVerticalLongImage(doc.pages, 24);
        setLongImageDataUrl(result);
      } catch (err) {
        console.error("Stitch long image error:", err);
      } finally {
        setIsStitching(false);
      }
    };
    stitch();
  }, [doc]);

  const handleDownload = () => {
    if (!longImageDataUrl) return;
    const link = document.createElement("a");
    link.href = longImageDataUrl;
    link.download = `${doc.title || "VietScan"}_Anh_Dai.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleShare = async () => {
    if (!longImageDataUrl) return;
    try {
      const res = await fetch(longImageDataUrl);
      const blob = await res.blob();
      const fileName = `${doc.title || "VietScan"}_Anh_Dai.jpg`;
      await PDFGenerator.sharePDFOrImage(blob, fileName, doc.title);
    } catch (e) {
      console.warn("Share failed:", e);
      handleDownload();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white select-none h-screen-dvh min-h-screen-dvh w-full overflow-hidden">
      {/* Header with Safe Area */}
      <div className="flex items-center justify-between px-4 pt-safe pb-2.5 bg-slate-900 border-b border-slate-800">
        <button
          id="btn-longimage-back"
          onClick={onClose}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 active:scale-95 transition text-sm font-medium"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Quay lại</span>
        </button>

        <div className="text-center px-2 truncate">
          <h2 className="text-sm font-bold text-white truncate">Ghép Ảnh Dài</h2>
          <p className="text-[11px] text-slate-400 truncate">Ghép {doc.pages.length} trang thành 1 ảnh dọc duy nhất</p>
        </div>

        <button
          id="btn-longimage-share"
          onClick={handleShare}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-bold shadow transition"
        >
          <Share2 className="w-4 h-4" />
          <span>Chia sẻ</span>
        </button>
      </div>

      {/* Main Image View */}
      <div className="relative flex-1 w-full h-full bg-slate-950 p-4 flex items-center justify-center overflow-auto">
        {isStitching ? (
          <div className="flex flex-col items-center gap-3 text-slate-300">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
            <span className="text-xs font-medium">Đang xử lý ghép ảnh dọc độ nét cao...</span>
          </div>
        ) : longImageDataUrl ? (
          <div className="max-w-md w-full h-full max-h-[64vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-2xl">
            <img
              src={longImageDataUrl}
              alt="Ảnh dài tổng hợp"
              className="w-full h-auto rounded object-contain"
            />
          </div>
        ) : (
          <div className="text-slate-400 text-xs">Không thể tạo ảnh dài</div>
        )}
      </div>

      {/* Bottom Download Bar with Safe Area */}
      <div className="flex items-center justify-center px-6 pt-3 pb-safe bg-slate-900 border-t border-slate-800">
        <button
          id="btn-longimage-download"
          onClick={handleDownload}
          disabled={!longImageDataUrl}
          className="w-full max-w-sm min-h-[44px] flex items-center justify-center gap-2 py-3 px-6 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-sm font-bold shadow-lg transition disabled:opacity-50"
        >
          <Download className="w-5 h-5" />
          <span>Tải ảnh JPG về điện thoại</span>
        </button>
      </div>
    </div>
  );
};
