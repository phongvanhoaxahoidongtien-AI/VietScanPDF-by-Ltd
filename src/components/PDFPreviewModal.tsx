import React, { useState, useEffect } from "react";
import {
  ArrowLeft,
  Download,
  Share2,
  Printer,
  FileText,
  Check,
  RefreshCw,
  Sliders,
  Maximize,
  Copy,
} from "lucide-react";
import { PDFExportOptions, ScannedDocument } from "../types";
import { PDFGenerator } from "../utils/pdfGenerator";

interface PDFPreviewModalProps {
  document: ScannedDocument;
  onClose: () => void;
}

export const PDFPreviewModal: React.FC<PDFPreviewModalProps> = ({ document: doc, onClose }) => {
  const isCardMode = doc.category === "cccd" || doc.category === "driver_license";

  const [options, setOptions] = useState<PDFExportOptions>({
    paperSize: "a4",
    orientation: isCardMode ? "portrait" : "portrait",
    marginMm: isCardMode ? 10 : 8,
    quality: 0.95,
    twoSidedMode: isCardMode && doc.pages.length >= 2,
  });

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState<boolean>(true);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // Generate PDF
  const generatePDF = async () => {
    setIsGenerating(true);
    try {
      const { blob, url, fileName: name } = await PDFGenerator.generateDocumentPDF(doc, options);
      setPdfBlob(blob);
      setPdfUrl(url);
      setFileName(name);
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    generatePDF();
  }, [options, doc]);

  // Handle Download
  const handleDownload = () => {
    if (pdfBlob && fileName) {
      PDFGenerator.downloadBlob(pdfBlob, fileName);
    }
  };

  // Handle Share
  const handleShare = async () => {
    if (pdfBlob && fileName) {
      await PDFGenerator.sharePDFOrImage(pdfBlob, fileName, doc.title);
    }
  };

  // Handle Print
  const handlePrint = () => {
    if (pdfUrl) {
      const printWindow = window.open(pdfUrl);
      if (printWindow) {
        printWindow.addEventListener("load", () => {
          printWindow.print();
        });
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white select-none h-screen-dvh min-h-screen-dvh w-full overflow-hidden">
      {/* Top Bar with Safe Area */}
      <div className="flex items-center justify-between px-4 pt-safe-top pb-3 bg-slate-900 border-b border-slate-800 shrink-0">
        <button
          id="btn-pdf-back"
          onClick={onClose}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 active:bg-slate-700 border border-slate-700/80 text-slate-100 hover:text-white active:scale-95 transition text-xs font-semibold shadow-sm"
        >
          <ArrowLeft className="w-5 h-5 text-blue-400" />
          <span>Quay lại</span>
        </button>

        <div className="text-center px-2 truncate">
          <h2 className="text-sm font-bold text-white truncate">Xuất & In File PDF</h2>
          <p className="text-[11px] text-slate-400 truncate">
            {isCardMode ? "Chuẩn in thẻ CCCD 2 mặt trên A4" : `${doc.pages.length} trang tài liệu`}
          </p>
        </div>

        <button
          id="btn-pdf-share-top"
          onClick={handleShare}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-bold shadow transition"
        >
          <Share2 className="w-4 h-4" />
          <span>Chia sẻ</span>
        </button>
      </div>

      {/* Settings Ribbon */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-900/90 border-b border-slate-800/80 overflow-x-auto no-scrollbar text-xs">
        {/* Paper Size */}
        <div className="flex items-center gap-1.5 bg-slate-800 px-2.5 py-1 rounded-lg">
          <span className="text-slate-400 font-medium">Khổ giấy:</span>
          <select
            id="select-paper-size"
            value={options.paperSize}
            onChange={(e) => setOptions({ ...options, paperSize: e.target.value as any })}
            className="bg-transparent text-white font-semibold focus:outline-none cursor-pointer"
          >
            <option value="a4" className="bg-slate-800 text-white">
              Khổ A4 (Chuẩn)
            </option>
            <option value="a5" className="bg-slate-800 text-white">
              Khổ A5
            </option>
            <option value="letter" className="bg-slate-800 text-white">
              Letter
            </option>
          </select>
        </div>

        {/* Orientation */}
        <div className="flex items-center gap-1.5 bg-slate-800 px-2.5 py-1 rounded-lg">
          <span className="text-slate-400 font-medium">Chiều:</span>
          <select
            id="select-orientation"
            value={options.orientation}
            onChange={(e) => setOptions({ ...options, orientation: e.target.value as any })}
            className="bg-transparent text-white font-semibold focus:outline-none cursor-pointer"
          >
            <option value="portrait" className="bg-slate-800 text-white">
              Khổ Dọc
            </option>
            <option value="landscape" className="bg-slate-800 text-white">
              Khổ Ngang
            </option>
          </select>
        </div>

        {/* Margin */}
        <div className="flex items-center gap-1.5 bg-slate-800 px-2.5 py-1 rounded-lg">
          <span className="text-slate-400 font-medium">Lề:</span>
          <select
            id="select-margin"
            value={options.marginMm}
            onChange={(e) => setOptions({ ...options, marginMm: Number(e.target.value) })}
            className="bg-transparent text-white font-semibold focus:outline-none cursor-pointer"
          >
            <option value={8} className="bg-slate-800 text-white">
              Tiêu chuẩn (8mm)
            </option>
            <option value={15} className="bg-slate-800 text-white">
              In ấn (15mm)
            </option>
            <option value={0} className="bg-slate-800 text-white">
              Tràn viền (0mm)
            </option>
          </select>
        </div>
      </div>

      {/* PDF Visual Viewer */}
      <div className="relative flex-1 w-full h-full bg-slate-950 p-4 flex items-center justify-center overflow-auto">
        {isGenerating ? (
          <div className="flex flex-col items-center gap-3 text-slate-300">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
            <span className="text-xs font-medium">Đang kết xuất PDF độ nét cao...</span>
          </div>
        ) : pdfUrl ? (
          <div className="w-full max-w-2xl h-full flex flex-col items-center justify-center">
            {/* Visual Page Mockup on White Sheet */}
            <div className="w-full h-full max-h-[64vh] rounded-xl overflow-hidden shadow-2xl border border-slate-700 bg-white">
              <iframe
                src={`${pdfUrl}#toolbar=0&navpanes=0`}
                className="w-full h-full border-none"
                title="Xem trước PDF"
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-2 text-center">
              Dung lượng ước tính: ~{Math.round((pdfBlob?.size || 0) / 1024)} KB
            </p>
          </div>
        ) : (
          <div className="text-slate-400 text-xs">Không thể hiển thị bản xem trước</div>
        )}
      </div>

      {/* Bottom Action Bar with Safe Area */}
      <div className="flex items-center justify-around gap-3 px-6 pt-3 pb-safe bg-slate-900 border-t border-slate-800">
        <button
          id="btn-pdf-print"
          onClick={handlePrint}
          className="flex-1 min-h-[44px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-sm font-semibold transition"
        >
          <Printer className="w-5 h-5 text-slate-300" />
          <span>In ngay</span>
        </button>

        <button
          id="btn-pdf-download"
          onClick={handleDownload}
          className="flex-1 min-h-[44px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-sm font-bold shadow-lg shadow-blue-600/30 transition"
        >
          <Download className="w-5 h-5" />
          <span>Tải file PDF</span>
        </button>
      </div>
    </div>
  );
};
