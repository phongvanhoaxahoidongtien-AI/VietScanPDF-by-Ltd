import React from "react";
import { FileText, IdCard, X, ArrowLeft, Layers, Sparkles, CheckCircle2 } from "lucide-react";

export type ImportTypeChoice = "document" | "cccd";

interface ImportTypeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectType: (type: ImportTypeChoice) => void;
}

export const ImportTypeModal: React.FC<ImportTypeModalProps> = ({
  isOpen,
  onClose,
  onSelectType,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pt-safe-top pb-safe bg-slate-950/85 backdrop-blur-md select-none animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/95">
          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 active:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white transition text-xs font-semibold"
            >
              <ArrowLeft className="w-4 h-4 text-blue-400" />
              <span>Quay lại</span>
            </button>
            <div>
              <h3 className="text-base font-bold text-white leading-tight">Chọn loại ảnh cần nhập</h3>
              <p className="text-xs text-slate-400">Chọn định dạng xử lý phù hợp với ảnh của bạn</p>
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

        {/* Content Options */}
        <div className="p-5 space-y-3.5">
          {/* Option 1: Document */}
          <button
            id="btn-import-type-document"
            onClick={() => onSelectType("document")}
            className="w-full group flex items-start gap-4 p-4 rounded-2xl bg-slate-950/80 hover:bg-slate-850 border border-slate-800 hover:border-blue-500/60 active:scale-[0.98] transition text-left shadow-sm"
          >
            <div className="p-3 rounded-2xl bg-blue-600/20 text-blue-400 border border-blue-500/30 group-hover:bg-blue-600 group-hover:text-white transition shrink-0">
              <FileText className="w-7 h-7" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="text-base font-bold text-white group-hover:text-blue-400 transition">
                  Tài liệu / Văn bản
                </h4>
                <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-bold border border-blue-500/20">
                  Nhiều trang
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Mỗi ảnh được lưu thành <strong className="text-slate-200">1 trang A4 riêng lẻ</strong> (hóa đơn, văn bản, sách, hợp đồng...).
              </p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-500">
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span>Giữ nguyên từng trang độc lập</span>
              </div>
            </div>
          </button>

          {/* Option 2: CCCD / GPLX */}
          <button
            id="btn-import-type-card"
            onClick={() => onSelectType("cccd")}
            className="w-full group flex items-start gap-4 p-4 rounded-2xl bg-slate-950/80 hover:bg-slate-850 border border-slate-800 hover:border-emerald-500/60 active:scale-[0.98] transition text-left shadow-sm"
          >
            <div className="p-3 rounded-2xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 group-hover:bg-emerald-600 group-hover:text-white transition shrink-0">
              <IdCard className="w-7 h-7" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="text-base font-bold text-white group-hover:text-emerald-400 transition">
                  CCCD / Bằng lái xe / Thẻ ID
                </h4>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-bold border border-emerald-500/20">
                  Chuẩn 1 trang A4
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Tự động <strong className="text-slate-200">căn 4 góc ~70% vùng trung tâm</strong> của ảnh (không tràn viền), và <strong className="text-emerald-400">gom mặt trước & sau thành 1 trang A4 duy nhất</strong> chuẩn kích thước thật (85.6mm x 53.98mm).
              </p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-emerald-400/90 font-medium">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Ghép 2 mặt lên 1 trang A4 kích thước thật</span>
              </div>
            </div>
          </button>
        </div>

        {/* Footer tip */}
        <div className="px-5 py-3 bg-slate-950/90 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-500">
          <span>Hỗ trợ chọn cùng lúc 1 hoặc nhiều ảnh</span>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white font-medium"
          >
            Hủy bỏ
          </button>
        </div>
      </div>
    </div>
  );
};
