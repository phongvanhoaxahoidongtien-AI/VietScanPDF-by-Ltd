import React from "react";
import {
  X,
  FileText,
  AlertTriangle,
  ExternalLink,
  Shield,
  FileSignature,
  ArrowUpRight,
  Globe,
  Sparkles,
} from "lucide-react";

export interface PDFToWordServer {
  id: string;
  name: string;
  link: string;
  subnote: string;
  badge?: string;
  description?: string;
  accentColor: string;
}

const SERVERS: PDFToWordServer[] = [
  {
    id: "pdf24",
    name: "PDF24",
    link: "https://tools.pdf24.org/vi/chuyen-doi-tu-pdf",
    subnote: "Không giới hạn",
    badge: "Khuyên dùng • Miễn phí 100%",
    description: "Chuyển đổi sang Word giữ định dạng gốc, không giới hạn dung lượng & số lần chuyển",
    accentColor: "from-blue-600/20 to-indigo-600/20 text-blue-400 border-blue-500/30",
  },
  {
    id: "smallpdf",
    name: "Smallpdf",
    link: "https://smallpdf.com/pdf-to-word",
    subnote: "Giới hạn miễn phí: 2 file/ngày",
    badge: "Chất lượng cao",
    description: "Công nghệ OCR nhận dạng ký tự tiếng Việt chuẩn xác, giao diện hiện đại",
    accentColor: "from-emerald-600/20 to-teal-600/20 text-emerald-400 border-emerald-500/30",
  },
  {
    id: "ilovepdf",
    name: "ILovePDF",
    link: "https://www.ilovepdf.com/pdf_to_word",
    subnote: "Giới hạn miễn phí 1–2 file/ngày",
    badge: "Rất phổ biến",
    description: "Tốc độ xử lý đám mây cực nhanh, chuyển đổi sang tài liệu DOCX dễ chỉnh sửa",
    accentColor: "from-rose-600/20 to-red-600/20 text-rose-400 border-rose-500/30",
  },
  {
    id: "sejda",
    name: "Sejda",
    link: "https://www.sejda.com/pdf-to-word",
    subnote: "Có giới hạn miễn phí theo ngày",
    badge: "Hỗ trợ tài liệu lớn",
    description: "Hỗ trợ tài liệu PDF nhiều trang, tự động xóa file sau 2 giờ trên máy chủ của họ",
    accentColor: "from-purple-600/20 to-violet-600/20 text-purple-400 border-purple-500/30",
  },
];

interface PDFToWordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSignatureModal?: () => void;
}

export const PDFToWordModal: React.FC<PDFToWordModalProps> = ({
  isOpen,
  onClose,
  onOpenSignatureModal,
}) => {
  if (!isOpen) return null;

  const handleOpenServer = (server: PDFToWordServer, e: React.MouseEvent) => {
    // Open in new tab/window, completely client-side without iframe or uploading through VietScan
    // The native <a> tag already has target="_blank" and rel="noopener noreferrer",
    // this fallback ensures smooth opening across all mobile webviews.
    try {
      window.open(server.link, "_blank", "noopener,noreferrer");
    } catch {
      // Handled by native <a> tag
    }
  };

  return (
    <div
      id="modal-pdf-to-word"
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 select-none overflow-y-auto animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[88vh] overflow-hidden text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/80 shrink-0 bg-slate-900/90 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-blue-600/20 border border-blue-500/30 text-blue-400">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  PDF to Word
                </h3>
                <span className="px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 text-[10px] font-bold border border-blue-500/30">
                  Trực tuyến
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Chuyển PDF sang Word bằng máy chủ trực tuyến
              </p>
            </div>
          </div>

          <button
            id="btn-close-pdf-to-word"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 active:scale-90 transition cursor-pointer"
            title="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 overscroll-contain">
          {/* NỘI DUNG KHUYẾN CÁO BẮT BUỘC (NỔI BẬT, MÀU CẢNH BÁO) */}
          <div
            id="warning-security-box"
            className="p-4 rounded-2xl bg-amber-500/10 border-2 border-amber-500/50 shadow-lg shadow-amber-950/20 text-amber-100"
          >
            <div className="flex items-center gap-2 mb-2 font-black text-amber-400 text-sm tracking-wide uppercase">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 animate-pulse" />
              <span>⚠️ Lưu ý bảo mật</span>
            </div>

            <p className="text-xs text-amber-200/95 font-semibold mb-2 leading-relaxed">
              Tính năng này sử dụng máy chủ trực tuyến bên thứ ba.
            </p>

            <ul className="space-y-1.5 text-xs text-amber-100/90 leading-relaxed font-medium">
              <li className="flex items-start gap-2">
                <span className="text-amber-400 font-black text-sm leading-none mt-0.5">•</span>
                <span>
                  Không tải lên tài liệu mật, tài liệu có dấu{" "}
                  <strong className="text-amber-300 font-bold">“Mật”</strong>,{" "}
                  <strong className="text-amber-300 font-bold">“Tối mật”</strong>,{" "}
                  <strong className="text-amber-300 font-bold">“Tuyệt mật”</strong>.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-400 font-black text-sm leading-none mt-0.5">•</span>
                <span>
                  Tài liệu cơ quan nhà nước cần được xóa chữ ký số trước khi sử dụng.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-400 font-black text-sm leading-none mt-0.5">•</span>
                <span>
                  Người sử dụng tự chịu trách nhiệm về các nội dung liên quan đến bảo vệ bí mật nhà
                  nước và thông tin cá nhân.
                </span>
              </li>
            </ul>

            {/* Quick Action to Clean Signatures First */}
            {onOpenSignatureModal && (
              <div className="mt-3 pt-3 border-t border-amber-500/20 flex items-center justify-between">
                <div className="text-[11px] text-amber-200/80 font-medium">
                  Tài liệu có chữ ký số cần xóa trước?
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSignatureModal();
                  }}
                  className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[11px] font-bold border border-amber-500/40 flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                >
                  <FileSignature className="w-3.5 h-3.5" />
                  <span>Xóa chữ ký số ngay</span>
                </button>
              </div>
            )}
          </div>

          {/* Server List Title */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-400" />
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Chọn máy chủ chuyển đổi (Mở tab mới)
              </h4>
            </div>
            <span className="text-[11px] text-slate-500">4 máy chủ uy tín</span>
          </div>

          {/* Danh sách 4 Server */}
          <div className="space-y-2.5">
            {SERVERS.map((server, idx) => (
              <a
                key={server.id}
                id={`btn-server-${server.id}`}
                href={server.link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => handleOpenServer(server, e)}
                className="group relative flex flex-col sm:flex-row sm:items-center justify-between p-3.5 sm:p-4 rounded-2xl bg-slate-800/80 hover:bg-slate-750 active:bg-slate-700 border border-slate-700/70 hover:border-blue-500/50 active:scale-[0.99] transition shadow-sm cursor-pointer"
              >
                <div className="flex items-start gap-3.5 min-w-0 mb-2 sm:mb-0">
                  <div
                    className={`w-10 h-10 rounded-xl bg-gradient-to-br ${server.accentColor} border flex items-center justify-center shrink-0 font-black text-sm group-hover:scale-105 transition`}
                  >
                    {idx + 1}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h5 className="text-sm sm:text-base font-bold text-white group-hover:text-blue-400 transition">
                        {server.name}
                      </h5>
                      {server.badge && (
                        <span className="px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-300 text-[10px] font-semibold border border-blue-500/20">
                          {server.badge}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                      {server.description}
                    </p>

                    {/* Ghi chú mờ dưới card */}
                    <div className="text-[11px] text-slate-500 font-medium mt-1 group-hover:text-slate-400 transition flex items-center gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-600 group-hover:bg-blue-400 transition" />
                      <span>{server.subnote}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-700/50">
                  <span className="hidden sm:inline-block text-xs font-semibold text-blue-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-0 -translate-x-1 transition duration-200">
                    Mở tab mới
                  </span>
                  <div className="p-2.5 rounded-xl bg-slate-700/60 group-hover:bg-blue-600 text-slate-300 group-hover:text-white transition shadow-sm">
                    <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition" />
                  </div>
                </div>
              </a>
            ))}
          </div>

          {/* Privacy Footnote */}
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 text-[11px] text-slate-400 flex items-start gap-2">
            <Shield className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <span className="text-slate-300 font-semibold">VietScan bảo vệ bạn:</span> Ứng dụng
              không tải tài liệu qua bất kỳ máy chủ trung gian nào của VietScan. Trình duyệt sẽ mở tab
              mới trực tiếp tới máy chủ bạn đã chọn và giữ nguyên phiên làm việc hiện tại của bạn.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800/80 bg-slate-900/90 flex items-center justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white font-bold text-xs transition cursor-pointer border border-slate-700/60"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
