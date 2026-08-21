import React from "react";
import {
  Camera,
  FileText,
  CreditCard,
  IdCard,
  Award,
  Image as ImageIcon,
  Sparkles,
  Upload,
  Shield,
  Layers,
  ChevronRight,
  Scissors,
  Highlighter,
  QrCode,
  ScanLine,
} from "lucide-react";
import { ScanMode, ScannedDocument } from "../types";

interface HomeScreenProps {
  onStartScan: (mode: ScanMode) => void;
  onImportPhotos: () => void;
  onOpenPDFMerge: () => void;
  onOpenPDFSplit: () => void;
  onOpenPDFHighlight: () => void;
  onOpenQRGenerator: () => void;
  onOpenQRScanner: () => void;
  recentDocuments: ScannedDocument[];
  onSelectDocument: (doc: ScannedDocument) => void;
  onViewAllDocuments: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onStartScan,
  onImportPhotos,
  onOpenPDFMerge,
  onOpenPDFSplit,
  onOpenPDFHighlight,
  onOpenQRGenerator,
  onOpenQRScanner,
  recentDocuments,
  onSelectDocument,
  onViewAllDocuments,
}) => {
  return (
    <div className="flex flex-col flex-1 w-full max-w-4xl mx-auto px-4 pt-safe-top pb-28 select-none">
      {/* Header Greeting */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-black tracking-tight text-white">VietScan</span>
            <span className="px-2 py-0.5 rounded-md bg-blue-600 text-white text-[10px] font-bold tracking-wide">
              PDF
            </span>
            <span className="text-xs font-semibold text-blue-400/90 tracking-tight">
              by Ltd
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">Quét văn bản & CCCD chuẩn A4 nhanh chóng</p>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
          <Shield className="w-3.5 h-3.5" />
          <span>Bảo mật 100% Offline</span>
        </div>
      </div>

      {/* Primary Big Action Button "QUÉT TÀI LIỆU" */}
      <div className="relative mb-6">
        <button
          id="btn-main-scan-hero"
          onClick={() => onStartScan("document")}
          className="group relative w-full overflow-hidden rounded-3xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 p-6 text-left shadow-xl shadow-blue-600/20 active:scale-[0.98] transition"
        >
          {/* Subtle geometric circles in background */}
          <div className="absolute -right-8 -bottom-8 w-40 h-40 rounded-full bg-white/10 blur-2xl group-hover:scale-125 transition duration-500" />
          <div className="absolute right-6 top-1/2 -translate-y-1/2 p-4 rounded-2xl bg-white/15 backdrop-blur-md text-white shadow-inner">
            <Camera className="w-10 h-10 group-hover:scale-110 transition duration-300" />
          </div>

          <div className="relative z-10 max-w-[65%]">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-white text-[11px] font-bold mb-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>Tự động nhận diện & làm phẳng</span>
            </div>
            <h2 className="text-2xl font-black text-white leading-tight">QUÉT TÀI LIỆU</h2>
            <p className="text-xs text-blue-100 mt-1 font-medium">
              Đưa camera vào văn bản, ứng dụng tự nhận diện 4 góc và chụp
            </p>
          </div>
        </button>
      </div>

      {/* Specialized Scan Category Cards */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Chế độ quét chuyên dụng</h3>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* CCCD 2 mặt */}
          <button
            id="card-mode-cccd"
            onClick={() => onStartScan("cccd")}
            className="flex flex-col items-start p-4 rounded-2xl bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-blue-500/50 active:scale-95 transition text-left group shadow-sm"
          >
            <div className="p-3 rounded-xl bg-blue-500/10 text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition mb-3">
              <IdCard className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-white group-hover:text-blue-400 transition">CCCD 2 Mặt</h4>
            <p className="text-[11px] text-slate-400 mt-0.5">Ghép 2 mặt lên 1 trang A4</p>
          </button>

          {/* Bằng lái xe 2 mặt */}
          <button
            id="card-mode-driver-license"
            onClick={() => onStartScan("driver_license")}
            className="flex flex-col items-start p-4 rounded-2xl bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-emerald-500/50 active:scale-95 transition text-left group shadow-sm"
          >
            <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-600 group-hover:text-white transition mb-3">
              <CreditCard className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-white group-hover:text-emerald-400 transition">Bằng Lái Xe</h4>
            <p className="text-[11px] text-slate-400 mt-0.5">Tự căn chỉnh & ghép trang</p>
          </button>

          {/* Bằng cấp / Chứng chỉ */}
          <button
            id="card-mode-certificate"
            onClick={() => onStartScan("certificate")}
            className="flex flex-col items-start p-4 rounded-2xl bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-purple-500/50 active:scale-95 transition text-left group shadow-sm"
          >
            <div className="p-3 rounded-xl bg-purple-500/10 text-purple-400 group-hover:bg-purple-600 group-hover:text-white transition mb-3">
              <Award className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-white group-hover:text-purple-400 transition">Bằng Cấp</h4>
            <p className="text-[11px] text-slate-400 mt-0.5">Giấy khen, chứng chỉ khổ A4</p>
          </button>

          {/* Nhập ảnh từ máy */}
          <button
            id="card-mode-import"
            onClick={onImportPhotos}
            className="flex flex-col items-start p-4 rounded-2xl bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-amber-500/50 active:scale-95 transition text-left group shadow-sm"
          >
            <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 group-hover:bg-amber-600 group-hover:text-white transition mb-3">
              <Upload className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-white group-hover:text-amber-400 transition">Nhập Ảnh</h4>
            <p className="text-[11px] text-slate-400 mt-0.5">Xử lý ảnh có sẵn trong máy</p>
          </button>
        </div>
      </div>

      {/* PDF Tools Section */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">PDF Tools</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Merge PDF */}
          <button
            id="btn-tool-merge-pdf"
            onClick={onOpenPDFMerge}
            className="flex items-center gap-3.5 p-4 rounded-2xl bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-blue-500/40 active:scale-[0.98] transition text-left group shadow-sm"
          >
            <div className="p-3 rounded-xl bg-blue-500/10 text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-white group-hover:text-blue-400 transition">Merge PDF</h4>
              <p className="text-[11px] text-slate-400 mt-0.5">Ghép nhiều file PDF thành 1</p>
            </div>
          </button>

          {/* Split PDF */}
          <button
            id="btn-tool-split-pdf"
            onClick={onOpenPDFSplit}
            className="flex items-center gap-3.5 p-4 rounded-2xl bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-emerald-500/40 active:scale-[0.98] transition text-left group shadow-sm"
          >
            <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-600 group-hover:text-white transition shrink-0">
              <Scissors className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-white group-hover:text-emerald-400 transition">Split PDF</h4>
              <p className="text-[11px] text-slate-400 mt-0.5">Tách trang lẻ & khoảng trang</p>
            </div>
          </button>

          {/* Highlight PDF */}
          <button
            id="btn-tool-highlight-pdf"
            onClick={onOpenPDFHighlight}
            className="flex items-center gap-3.5 p-4 rounded-2xl bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-amber-500/40 active:scale-[0.98] transition text-left group shadow-sm"
          >
            <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 group-hover:bg-amber-600 group-hover:text-white transition shrink-0">
              <Highlighter className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-white group-hover:text-amber-400 transition">Highlight PDF</h4>
              <p className="text-[11px] text-slate-400 mt-0.5">Bôi vàng văn bản trực quan</p>
            </div>
          </button>
        </div>
      </div>

      {/* QR Code Section */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">QR Code</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Tạo mã QR */}
          <button
            id="btn-qr-generate"
            onClick={onOpenQRGenerator}
            className="flex items-center gap-3.5 p-4 rounded-2xl bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-purple-500/40 active:scale-[0.98] transition text-left group shadow-sm"
          >
            <div className="p-3 rounded-xl bg-purple-500/10 text-purple-400 group-hover:bg-purple-600 group-hover:text-white transition shrink-0">
              <QrCode className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-white group-hover:text-purple-400 transition">Tạo Mã QR</h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Tạo QR văn bản, link, Wi-Fi, danh bạ & xuất ảnh PNG/PDF
              </p>
            </div>
          </button>

          {/* Quét / Đọc mã QR */}
          <button
            id="btn-qr-scan"
            onClick={onOpenQRScanner}
            className="flex items-center gap-3.5 p-4 rounded-2xl bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-cyan-500/40 active:scale-[0.98] transition text-left group shadow-sm"
          >
            <div className="p-3 rounded-xl bg-cyan-500/10 text-cyan-400 group-hover:bg-cyan-600 group-hover:text-white transition shrink-0">
              <ScanLine className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-white group-hover:text-cyan-400 transition">Quét / Đọc Mã QR</h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Quét camera/ảnh, đọc CCCD chip, Wi-Fi, link & tự sao chép
              </p>
            </div>
          </button>
        </div>
      </div>

      {/* Recent Scans Section */}
      {recentDocuments.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Tài liệu gần đây</h3>
            <button
              id="btn-view-all-docs"
              onClick={onViewAllDocuments}
              className="flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300"
            >
              <span>Xem tất cả ({recentDocuments.length})</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {recentDocuments.slice(0, 4).map((doc) => (
              <div
                key={doc.id}
                id={`recent-doc-${doc.id}`}
                onClick={() => onSelectDocument(doc)}
                className="flex items-center gap-3.5 p-3 rounded-2xl bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 transition cursor-pointer active:scale-[0.99]"
              >
                <div className="w-14 h-16 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center overflow-hidden shrink-0">
                  <img
                    src={doc.thumbnail || doc.pages[0]?.processedImage}
                    alt={doc.title}
                    className="w-full h-full object-cover"
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-white truncate">{doc.title}</h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {doc.pages.length} trang •{" "}
                    {new Date(doc.createdAt).toLocaleDateString("vi-VN", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>

                <ChevronRight className="w-5 h-5 text-slate-600 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

