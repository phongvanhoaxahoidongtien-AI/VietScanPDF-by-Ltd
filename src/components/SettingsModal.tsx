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
  Copy,
  Check,
  X,
  QrCode,
  ExternalLink,
  Mail,
  Send,
} from "lucide-react";
import QRCode from "qrcode";
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

  // Share App State
  const [showShareModal, setShowShareModal] = useState<boolean>(false);
  const [shareQrUrl, setShareQrUrl] = useState<string>("");
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  const appUrl = typeof window !== "undefined" ? window.location.href : "https://vietscan.app";
  const shareTitle = "VietScan PDF by Ltd";
  const shareText =
    "VietScan PDF by Ltd – Ứng dụng quét tài liệu A4, CCCD, GPLX chuẩn, nhận diện chữ ký số & xử lý PDF bảo mật 100% trên thiết bị.";

  useEffect(() => {
    const load = async () => {
      const s = await StorageService.getSettings();
      const st = await StorageService.getStorageUsage();
      setSettings(s);
      setStorageInfo(st);
    };
    load();
  }, []);

  // Generate QR Code for sharing
  const generateShareQr = async () => {
    try {
      const url = await QRCode.toDataURL(appUrl, {
        width: 280,
        margin: 2,
        color: {
          dark: "#0f172a",
          light: "#ffffff",
        },
      });
      setShareQrUrl(url);
    } catch (e) {
      console.warn("Could not generate share QR:", e);
    }
  };

  // Trigger Native Web Share or Open Share Dialog
  const handleOpenShare = async () => {
    generateShareQr();

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: appUrl,
        });
        return;
      } catch (err: any) {
        if (err?.name === "AbortError") {
          return;
        }
      }
    }

    setShowShareModal(true);
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = appUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

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
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white select-none overflow-hidden">
      {/* Header with Safe Area spacing and robust touch target */}
      <div className="sticky top-0 z-20 flex items-center justify-between px-4 pt-safe-top pb-3 sm:pb-4 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 shadow-md shrink-0">
        <button
          id="btn-settings-back"
          onClick={onClose}
          className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 active:bg-slate-700 border border-slate-700/80 text-slate-100 hover:text-white active:scale-95 transition text-sm font-semibold shadow-sm min-h-[44px]"
        >
          <ArrowLeft className="w-5 h-5 text-blue-400" />
          <span>Quay lại</span>
        </button>

        <h2 className="text-sm font-bold text-white tracking-wide">Cài đặt & Thông tin</h2>

        {/* Nút Chia sẻ ứng dụng ở góc phải phần cài đặt */}
        <button
          id="btn-settings-share-app"
          onClick={handleOpenShare}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-95 text-white font-semibold text-xs sm:text-sm shadow-md shadow-blue-600/30 transition min-h-[44px] cursor-pointer"
          title="Chia sẻ ứng dụng VietScan PDF"
        >
          <Share2 className="w-4 h-4" />
          <span>Chia sẻ</span>
        </button>
      </div>

      {/* Settings Body */}
      <div className="flex-1 overflow-y-auto p-4 max-w-2xl w-full mx-auto flex flex-col gap-5 pb-32">
        {/* Share App Quick Card */}
        <div className="bg-gradient-to-r from-blue-950/50 via-indigo-950/40 to-slate-900 border border-blue-500/30 rounded-2xl p-4 flex items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30 shrink-0">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Chia sẻ VietScan PDF</h3>
              <p className="text-xs text-slate-300">Giới thiệu ứng dụng hoặc chia sẻ qua mã QR</p>
            </div>
          </div>
          <button
            onClick={() => {
              generateShareQr();
              setShowShareModal(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm active:scale-95 transition shrink-0"
          >
            <QrCode className="w-4 h-4" />
            <span>Mã QR & Link</span>
          </button>
        </div>

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
              <p className="text-sm font-semibold text-white">Chế độ lọc màu mặc định</p>
              <p className="text-xs text-slate-400">Ưu tiên ảnh gốc máy ảnh, bảo toàn độ nét & dải màu tự nhiên</p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded bg-slate-800 text-emerald-400 border border-emerald-500/20">
              Ảnh gốc (Máy ảnh)
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
        <div className="text-center text-xs text-slate-400 py-4 px-2 space-y-2 border-t border-slate-850">
          <p className="font-bold text-white text-sm">
            VietScanPDF by Ltd (Dieplt.dongtien@gmail.com)
          </p>
          <p className="text-xs text-slate-300 leading-relaxed max-w-lg mx-auto">
            Ứng dụng độc lập phục vụ scan và số hóa tài liệu hành chính, CCCD và Giấy phép lái xe theo chuẩn khổ A4.
          </p>
          <p className="text-xs text-slate-400 leading-relaxed max-w-lg mx-auto">
            Ứng dụng hỗ trợ người dân số hóa giấy tờ nhanh chóng, thuận tiện, phục vụ thực hiện thủ tục hành chính và góp phần thúc đẩy “Bình dân học vụ số”.
          </p>
        </div>
      </div>

      {/* SHARE APP MODAL */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl flex flex-col gap-5 text-white animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
                  <Share2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Chia sẻ ứng dụng</h3>
                  <p className="text-xs text-slate-400">VietScan PDF by Ltd</p>
                </div>
              </div>
              <button
                onClick={() => setShowShareModal(false)}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* QR Code Section */}
            <div className="flex flex-col items-center justify-center p-4 bg-slate-950/80 rounded-2xl border border-slate-800/80">
              {shareQrUrl ? (
                <div className="p-3 bg-white rounded-2xl shadow-lg mb-3">
                  <img src={shareQrUrl} alt="VietScan QR Code" className="w-48 h-48 object-contain" />
                </div>
              ) : (
                <div className="w-48 h-48 bg-slate-800 animate-pulse rounded-2xl mb-3" />
              )}
              <p className="text-xs text-slate-300 font-medium text-center">
                Quét mã QR bằng Camera điện thoại để mở & cài đặt ngay
              </p>
            </div>

            {/* Link Copy Box */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-400">Liên kết ứng dụng:</span>
              <div className="flex items-center gap-2 p-1.5 pl-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-xs text-slate-300 truncate flex-1 font-mono">
                  {appUrl}
                </span>
                <button
                  id="btn-copy-share-link"
                  onClick={handleCopyLink}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition active:scale-95 shrink-0 ${
                    copiedLink
                      ? "bg-emerald-600 text-white"
                      : "bg-blue-600 hover:bg-blue-500 text-white"
                  }`}
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Đã chép!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Sao chép</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Fast Channels */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <a
                href={`https://zalo.me/share?url=${encodeURIComponent(appUrl)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-blue-700/20 hover:bg-blue-700/30 text-blue-300 border border-blue-600/30 text-xs font-semibold active:scale-95 transition"
              >
                <Send className="w-4 h-4 text-blue-400" />
                <span>Gửi qua Zalo</span>
              </a>

              <a
                href={`mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(
                  shareText + "\n\nTruy cập ngay: " + appUrl
                )}`}
                className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 text-xs font-semibold active:scale-95 transition"
              >
                <Mail className="w-4 h-4 text-slate-300" />
                <span>Gửi qua Email</span>
              </a>
            </div>

            {/* Close */}
            <button
              onClick={() => setShowShareModal(false)}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition mt-1"
            >
              Đóng
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
