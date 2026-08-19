import React, { useState, useEffect } from "react";
import {
  ArrowLeft,
  ShieldCheck,
  HardDrive,
  Trash2,
  Download,
  Smartphone,
  Info,
  CheckCircle,
  HelpCircle,
  Share2,
} from "lucide-react";
import { StorageService, UserSettings } from "../utils/storage";

interface SettingsModalProps {
  onClose: () => void;
  onClearAll: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, onClearAll }) => {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [storageInfo, setStorageInfo] = useState<{ usedBytes: number; count: number }>({
    usedBytes: 0,
    count: 0,
  });
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    const load = async () => {
      const s = await StorageService.getSettings();
      const st = await StorageService.getStorageUsage();
      setSettings(s);
      setStorageInfo(st);
    };
    load();
  }, []);

  const handleToggleAutoCapture = async () => {
    if (!settings) return;
    const next = { ...settings, autoCaptureEnabled: !settings.autoCaptureEnabled };
    setSettings(next);
    await StorageService.saveSettings(next);
  };

  const handleClearData = async () => {
    if (confirm("CẢNH BÁO: Thao tác này sẽ xóa vĩnh viễn toàn bộ tài liệu đã lưu trong bộ nhớ máy. Bạn có chắc không?")) {
      setClearing(true);
      await StorageService.clearAllDocuments();
      onClearAll();
      const st = await StorageService.getStorageUsage();
      setStorageInfo(st);
      setClearing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800">
        <button
          id="btn-settings-back"
          onClick={onClose}
          className="flex items-center gap-1 px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 active:scale-95 transition text-sm font-medium"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Quay lại</span>
        </button>

        <h2 className="text-sm font-bold text-white">Cài đặt & Thông tin</h2>

        <div className="w-16" />
      </div>

      {/* Settings Body */}
      <div className="flex-1 overflow-y-auto p-4 max-w-2xl w-full mx-auto flex flex-col gap-5">
        {/* Privacy Highlight Card */}
        <div className="bg-gradient-to-r from-blue-950/40 to-indigo-950/40 border border-blue-800/40 rounded-2xl p-4 flex items-start gap-3.5">
          <div className="p-2.5 rounded-xl bg-blue-600/20 text-blue-400 shrink-0">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white mb-1">Bảo mật & Quyền riêng tư 100%</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Mọi ảnh scan tài liệu, CCCD, bằng lái xe của bạn được xử lý và lưu trữ hoàn toàn cục bộ trong bộ nhớ
              trình duyệt (IndexedDB). Không tự động tải lên bất kỳ máy chủ nào.
            </p>
          </div>
        </div>

        {/* Scan Preference Section */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Tùy chọn Quét</h4>

          <div className="flex items-center justify-between py-2 border-b border-slate-800/80">
            <div>
              <p className="text-sm font-semibold text-white">Tự động chụp (Auto Capture)</p>
              <p className="text-xs text-slate-400">Tự động chụp khi tài liệu nằm phẳng và rõ nét</p>
            </div>
            <button
              id="switch-auto-capture"
              onClick={handleToggleAutoCapture}
              className={`w-12 h-6.5 flex items-center rounded-full p-1 transition duration-200 ${
                settings?.autoCaptureEnabled ? "bg-blue-600 justify-end" : "bg-slate-700 justify-start"
              }`}
            >
              <div className="w-5 h-5 rounded-full bg-white shadow-md" />
            </button>
          </div>

          <div className="flex items-center justify-between py-2 pt-3">
            <div>
              <p className="text-sm font-semibold text-white">Chế độ lọc mặc định</p>
              <p className="text-xs text-slate-400">Tự động làm trắng nền và tăng độ tương phản văn bản</p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded bg-slate-800 text-blue-400">
              Văn bản Scan
            </span>
          </div>
        </div>

        {/* PWA & Add to Home Screen Instructions */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Smartphone className="w-4 h-4 text-blue-400" />
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Cài đặt ứng dụng vào màn hình chính (PWA)
            </h4>
          </div>

          <div className="flex flex-col gap-2.5 text-xs text-slate-300">
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
              <p className="font-semibold text-white mb-1">📱 Dành cho iPhone / iPad (Safari):</p>
              <p className="text-slate-400">
                Bấm vào biểu tượng <strong>Chia sẻ (Share <Share2 className="w-3 h-3 inline" />)</strong> ở thanh dưới Safari → chọn <strong>"Thêm vào MH chính" (Add to Home Screen)</strong>.
              </p>
            </div>

            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
              <p className="font-semibold text-white mb-1">🤖 Dành cho Android (Chrome / Cốc Cốc):</p>
              <p className="text-slate-400">
                Bấm vào dấu <strong>3 chấm (⋮)</strong> góc trên trình duyệt → chọn <strong>"Cài đặt ứng dụng"</strong> hoặc <strong>"Thêm vào Màn hình chính"</strong>.
              </p>
            </div>
          </div>
        </div>

        {/* Storage Management */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <HardDrive className="w-4 h-4 text-blue-400" />
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Bộ nhớ trên máy</h4>
          </div>

          <div className="flex items-center justify-between mb-4 text-xs">
            <div>
              <p className="text-white font-medium">Tài liệu đã lưu: {storageInfo.count} bản ghi</p>
              <p className="text-slate-400">Dung lượng: ~{Math.round(storageInfo.usedBytes / 1024)} KB</p>
            </div>
          </div>

          <button
            id="btn-clear-all-data"
            onClick={handleClearData}
            disabled={clearing || storageInfo.count === 0}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-red-950/40 hover:bg-red-900/40 border border-red-800/40 text-red-400 text-xs font-semibold active:scale-95 transition disabled:opacity-40"
          >
            <Trash2 className="w-4 h-4" />
            <span>Xóa toàn bộ dữ liệu scan</span>
          </button>
        </div>

        {/* Footer Info */}
        <div className="text-center text-xs text-slate-500 py-2">
          <p className="font-semibold text-slate-400">VietScanPDF • Phiên bản 1.0 (PWA Ready)</p>
          <p className="text-[11px] mt-1">
            Ứng dụng độc lập phục vụ nhu cầu scan tài liệu hành chính, CCCD & bằng lái xe chuẩn A4.
          </p>
        </div>
      </div>
    </div>
  );
};
