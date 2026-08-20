import React, { useState, useEffect, useRef } from "react";
import {
  ArrowLeft,
  QrCode,
  Download,
  Copy,
  Share2,
  Check,
  Globe,
  FileText,
  Wifi,
  User,
  Phone,
  Mail,
  Palette,
  FileDown,
  Sparkles,
  IdCard,
} from "lucide-react";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";

interface QRGeneratorModalProps {
  onClose: () => void;
}

type QRType = "text" | "url" | "wifi" | "vcard" | "phone" | "email" | "cccd";

export const QRGeneratorModal: React.FC<QRGeneratorModalProps> = ({ onClose }) => {
  const [qrType, setQrType] = useState<QRType>("url");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [copiedText, setCopiedText] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);
  const [errorCorrectionLevel, setErrorCorrectionLevel] = useState<"L" | "M" | "Q" | "H">("M");
  const [darkColor, setDarkColor] = useState<string>("#000000");
  const [lightColor, setLightColor] = useState<string>("#ffffff");

  // Form states
  const [textContent, setTextContent] = useState("");
  const [urlContent, setUrlContent] = useState("https://");
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [wifiAuth, setWifiAuth] = useState<"WPA" | "WEP" | "nopass">("WPA");
  const [wifiHidden, setWifiHidden] = useState(false);

  // vCard
  const [vcardName, setVcardName] = useState("");
  const [vcardPhone, setVcardPhone] = useState("");
  const [vcardEmail, setVcardEmail] = useState("");
  const [vcardOrg, setVcardOrg] = useState("");
  const [vcardAddress, setVcardAddress] = useState("");

  // Phone & Email
  const [phoneNumber, setPhoneNumber] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  // CCCD Format
  const [cccdId, setCccdId] = useState("001098000123");
  const [cccdOldId, setCccdOldId] = useState("");
  const [cccdName, setCccdName] = useState("NGUYỄN VĂN AN");
  const [cccdDob, setCccdDob] = useState("15081995");
  const [cccdGender, setCccdGender] = useState<"Nam" | "Nữ">("Nam");
  const [cccdAddress, setCccdAddress] = useState("Phường Tràng Tiền, Quận Hoàn Kiếm, Hà Nội");
  const [cccdIssueDate, setCccdIssueDate] = useState("10052021");

  // Compute final payload string
  const computePayload = (): string => {
    switch (qrType) {
      case "text":
        return textContent || "VietScan QR Code";
      case "url":
        return urlContent || "https://vietscan.vn";
      case "wifi":
        return `WIFI:T:${wifiAuth};S:${wifiSsid};P:${wifiPassword};H:${wifiHidden ? "true" : "false"};;`;
      case "vcard":
        return `BEGIN:VCARD\nVERSION:3.0\nFN:${vcardName}\nTEL:${vcardPhone}\nEMAIL:${vcardEmail}\nORG:${vcardOrg}\nADR:;;${vcardAddress};;;\nEND:VCARD`;
      case "phone":
        return `tel:${phoneNumber}`;
      case "email":
        return `mailto:${emailTo}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
      case "cccd":
        return `${cccdId}|${cccdOldId}|${cccdName}|${cccdDob}|${cccdGender}|${cccdAddress}|${cccdIssueDate}`;
      default:
        return textContent || "";
    }
  };

  const payload = computePayload();

  // Generate QR code
  useEffect(() => {
    if (!payload.trim()) {
      setQrDataUrl("");
      return;
    }

    QRCode.toDataURL(payload, {
      width: 720,
      margin: 2,
      errorCorrectionLevel,
      color: {
        dark: darkColor,
        light: lightColor,
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error("QR Code Error:", err));
  }, [payload, errorCorrectionLevel, darkColor, lightColor]);

  // Download PNG
  const handleDownloadPNG = () => {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `VietScan_QR_${Date.now()}.png`;
    a.click();
  };

  // Download PDF
  const handleDownloadPDF = () => {
    if (!qrDataUrl) return;
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    const pageW = pdf.internal.pageSize.getWidth();
    const qrSize = 100; // 100mm
    const x = (pageW - qrSize) / 2;
    const y = 50;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(18);
    pdf.text("VIETSCAN - MÃ QR", pageW / 2, 35, { align: "center" });

    pdf.addImage(qrDataUrl, "PNG", x, y, qrSize, qrSize);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(80, 80, 80);

    const splitDesc = pdf.splitTextToSize(`Nội dung: ${payload.substring(0, 180)}`, pageW - 40);
    pdf.text(splitDesc, pageW / 2, y + qrSize + 15, { align: "center" });

    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);
    pdf.text("Tạo bởi ứng dụng VietScan • 100% Bảo mật Offline", pageW / 2, 280, { align: "center" });

    pdf.save(`VietScan_QR_${Date.now()}.pdf`);
  };

  // Copy raw text
  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(payload);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  // Copy PNG image to clipboard
  const handleCopyImage = async () => {
    if (!qrDataUrl) return;
    try {
      const res = await fetch(qrDataUrl);
      const blob = await res.blob();
      if ((window as any).ClipboardItem) {
        await navigator.clipboard.write([
          new (window as any).ClipboardItem({ "image/png": blob }),
        ]);
        setCopiedImage(true);
        setTimeout(() => setCopiedImage(false), 2000);
      } else {
        handleCopyText();
      }
    } catch (e) {
      handleCopyText();
    }
  };

  // Share
  const handleShare = async () => {
    if (!qrDataUrl) return;
    try {
      if (navigator.share) {
        const res = await fetch(qrDataUrl);
        const blob = await res.blob();
        const file = new File([blob], "vietscan-qrcode.png", { type: "image/png" });
        await navigator.share({
          title: "Mã QR từ VietScan",
          text: payload,
          files: [file],
        });
      } else {
        handleCopyText();
      }
    } catch (e) {
      // User dismissed
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white select-none overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-safe-top pb-3 bg-slate-900 border-b border-slate-800 shrink-0">
        <button
          id="btn-qr-gen-back"
          onClick={onClose}
          className="min-w-[44px] min-h-[44px] flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 active:bg-slate-700 border border-slate-700/80 text-slate-100 hover:text-white active:scale-95 transition text-xs font-semibold shadow-sm"
        >
          <ArrowLeft className="w-5 h-5 text-blue-400" />
          <span>Quay lại</span>
        </button>

        <div className="flex items-center gap-2">
          <QrCode className="w-5 h-5 text-blue-400" />
          <h2 className="text-sm font-bold text-white">Tạo Mã QR</h2>
        </div>

        <div className="w-16" />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 max-w-4xl w-full mx-auto pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: QR Type Selector & Form Inputs */}
          <div className="lg:col-span-7 space-y-4">
            {/* Type selector tabs */}
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Loại nội dung QR
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                <button
                  id="tab-qr-url"
                  onClick={() => setQrType("url")}
                  className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs font-semibold transition ${
                    qrType === "url"
                      ? "bg-blue-600 border-blue-500 text-white shadow-sm"
                      : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-850"
                  }`}
                >
                  <Globe className="w-4 h-4" />
                  <span>Website / Link</span>
                </button>

                <button
                  id="tab-qr-text"
                  onClick={() => setQrType("text")}
                  className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs font-semibold transition ${
                    qrType === "text"
                      ? "bg-blue-600 border-blue-500 text-white shadow-sm"
                      : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-850"
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  <span>Văn bản</span>
                </button>

                <button
                  id="tab-qr-wifi"
                  onClick={() => setQrType("wifi")}
                  className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs font-semibold transition ${
                    qrType === "wifi"
                      ? "bg-blue-600 border-blue-500 text-white shadow-sm"
                      : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-850"
                  }`}
                >
                  <Wifi className="w-4 h-4" />
                  <span>Mạng Wi-Fi</span>
                </button>

                <button
                  id="tab-qr-vcard"
                  onClick={() => setQrType("vcard")}
                  className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs font-semibold transition ${
                    qrType === "vcard"
                      ? "bg-blue-600 border-blue-500 text-white shadow-sm"
                      : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-850"
                  }`}
                >
                  <User className="w-4 h-4" />
                  <span>Danh bạ</span>
                </button>

                <button
                  id="tab-qr-phone"
                  onClick={() => setQrType("phone")}
                  className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs font-semibold transition ${
                    qrType === "phone"
                      ? "bg-blue-600 border-blue-500 text-white shadow-sm"
                      : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-850"
                  }`}
                >
                  <Phone className="w-4 h-4" />
                  <span>Điện thoại</span>
                </button>

                <button
                  id="tab-qr-email"
                  onClick={() => setQrType("email")}
                  className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs font-semibold transition ${
                    qrType === "email"
                      ? "bg-blue-600 border-blue-500 text-white shadow-sm"
                      : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-850"
                  }`}
                >
                  <Mail className="w-4 h-4" />
                  <span>Email</span>
                </button>

                <button
                  id="tab-qr-cccd"
                  onClick={() => setQrType("cccd")}
                  className={`col-span-2 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs font-semibold transition ${
                    qrType === "cccd"
                      ? "bg-blue-600 border-blue-500 text-white shadow-sm"
                      : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-850"
                  }`}
                >
                  <IdCard className="w-4 h-4" />
                  <span>Mã CCCD Gắn Chip (Mẫu)</span>
                </button>
              </div>
            </div>

            {/* Input Forms */}
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              {/* URL */}
              {qrType === "url" && (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Đường dẫn Website / URL
                  </label>
                  <input
                    id="input-qr-url"
                    type="url"
                    value={urlContent}
                    onChange={(e) => setUrlContent(e.target.value)}
                    placeholder="https://example.com"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-750 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              {/* Plain Text */}
              {qrType === "text" && (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Văn bản / Ghi chú
                  </label>
                  <textarea
                    id="input-qr-text"
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    placeholder="Nhập nội dung văn bản bất kỳ..."
                    rows={4}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-750 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              {/* Wi-Fi */}
              {qrType === "wifi" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Tên mạng Wi-Fi (SSID)
                    </label>
                    <input
                      id="input-qr-wifi-ssid"
                      type="text"
                      value={wifiSsid}
                      onChange={(e) => setWifiSsid(e.target.value)}
                      placeholder="VD: Nha_Toi_5G"
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-750 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Mật khẩu Wi-Fi
                    </label>
                    <input
                      id="input-qr-wifi-pass"
                      type="text"
                      value={wifiPassword}
                      onChange={(e) => setWifiPassword(e.target.value)}
                      placeholder="Mật khẩu mạng"
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-750 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Loại bảo mật
                      </label>
                      <select
                        id="select-qr-wifi-auth"
                        value={wifiAuth}
                        onChange={(e) => setWifiAuth(e.target.value as any)}
                        className="w-full px-3 py-2.5 bg-slate-950 border border-slate-750 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500"
                      >
                        <option value="WPA">WPA / WPA2 / WPA3</option>
                        <option value="WEP">WEP</option>
                        <option value="nopass">Không có mật khẩu</option>
                      </select>
                    </div>

                    <div className="flex items-end pb-2">
                      <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          id="check-qr-wifi-hidden"
                          type="checkbox"
                          checked={wifiHidden}
                          onChange={(e) => setWifiHidden(e.target.checked)}
                          className="rounded bg-slate-950 border-slate-700 text-blue-600 focus:ring-0"
                        />
                        <span>Mạng ẩn</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* vCard */}
              {qrType === "vcard" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Họ và Tên</label>
                    <input
                      type="text"
                      value={vcardName}
                      onChange={(e) => setVcardName(e.target.value)}
                      placeholder="VD: Nguyễn Văn A"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-750 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">Số điện thoại</label>
                      <input
                        type="tel"
                        value={vcardPhone}
                        onChange={(e) => setVcardPhone(e.target.value)}
                        placeholder="0912345678"
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-750 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">Email</label>
                      <input
                        type="email"
                        value={vcardEmail}
                        onChange={(e) => setVcardEmail(e.target.value)}
                        placeholder="email@example.com"
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-750 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Cơ quan / Tổ chức</label>
                    <input
                      type="text"
                      value={vcardOrg}
                      onChange={(e) => setVcardOrg(e.target.value)}
                      placeholder="Công ty / Đơn vị công tác"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-750 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Địa chỉ</label>
                    <input
                      type="text"
                      value={vcardAddress}
                      onChange={(e) => setVcardAddress(e.target.value)}
                      placeholder="Hà Nội, Việt Nam"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-750 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              )}

              {/* Phone */}
              {qrType === "phone" && (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Số điện thoại</label>
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="0912345678 hoặc +84..."
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-750 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              {/* Email */}
              {qrType === "email" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Địa chỉ nhận</label>
                    <input
                      type="email"
                      value={emailTo}
                      onChange={(e) => setEmailTo(e.target.value)}
                      placeholder="contact@example.com"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-750 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Tiêu đề thư</label>
                    <input
                      type="text"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      placeholder="Tiêu đề..."
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-750 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Nội dung thư</label>
                    <textarea
                      value={emailBody}
                      onChange={(e) => setEmailBody(e.target.value)}
                      rows={3}
                      placeholder="Nội dung cần gửi..."
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-750 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              )}

              {/* CCCD Form */}
              {qrType === "cccd" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">Số CCCD (12 số)</label>
                      <input
                        type="text"
                        maxLength={12}
                        value={cccdId}
                        onChange={(e) => setCccdId(e.target.value)}
                        className="w-full px-3 py-1.5 bg-slate-950 border border-slate-750 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">Số CMND cũ (nếu có)</label>
                      <input
                        type="text"
                        value={cccdOldId}
                        onChange={(e) => setCccdOldId(e.target.value)}
                        placeholder="Để trống nếu không có"
                        className="w-full px-3 py-1.5 bg-slate-950 border border-slate-750 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Họ và tên (IN HOA)</label>
                    <input
                      type="text"
                      value={cccdName}
                      onChange={(e) => setCccdName(e.target.value.toUpperCase())}
                      className="w-full px-3 py-1.5 bg-slate-950 border border-slate-750 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">Ngày sinh (ddmmyyyy)</label>
                      <input
                        type="text"
                        maxLength={8}
                        value={cccdDob}
                        onChange={(e) => setCccdDob(e.target.value)}
                        placeholder="15081995"
                        className="w-full px-3 py-1.5 bg-slate-950 border border-slate-750 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">Giới tính</label>
                      <select
                        value={cccdGender}
                        onChange={(e) => setCccdGender(e.target.value as any)}
                        className="w-full px-3 py-1.5 bg-slate-950 border border-slate-750 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500"
                      >
                        <option value="Nam">Nam</option>
                        <option value="Nữ">Nữ</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Địa chỉ thường trú</label>
                    <input
                      type="text"
                      value={cccdAddress}
                      onChange={(e) => setCccdAddress(e.target.value)}
                      className="w-full px-3 py-1.5 bg-slate-950 border border-slate-750 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Ngày cấp (ddmmyyyy)</label>
                    <input
                      type="text"
                      maxLength={8}
                      value={cccdIssueDate}
                      onChange={(e) => setCccdIssueDate(e.target.value)}
                      placeholder="10052021"
                      className="w-full px-3 py-1.5 bg-slate-950 border border-slate-750 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Customization Options */}
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
                <Palette className="w-4 h-4 text-blue-400" />
                <span>Tùy chỉnh màu sắc & độ chuẩn</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Màu mã QR</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={darkColor}
                      onChange={(e) => setDarkColor(e.target.value)}
                      className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0"
                    />
                    <span className="text-xs font-mono text-slate-300">{darkColor}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Màu nền</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={lightColor}
                      onChange={(e) => setLightColor(e.target.value)}
                      className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0"
                    />
                    <span className="text-xs font-mono text-slate-300">{lightColor}</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Mức độ sửa lỗi (Error Correction)</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(["L", "M", "Q", "H"] as const).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setErrorCorrectionLevel(lvl)}
                      className={`py-1.5 rounded-lg border text-xs font-semibold transition ${
                        errorCorrectionLevel === lvl
                          ? "bg-blue-600 border-blue-500 text-white"
                          : "bg-slate-950 border-slate-800 text-slate-400"
                      }`}
                    >
                      {lvl} ({lvl === "L" ? "7%" : lvl === "M" ? "15%" : lvl === "Q" ? "25%" : "30%"})
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Live QR Preview & Actions */}
          <div className="lg:col-span-5 flex flex-col items-center">
            <div className="w-full p-6 rounded-3xl bg-slate-900 border border-slate-800 flex flex-col items-center text-center shadow-xl">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
                Xem trước mã QR
              </span>

              {/* QR Canvas Box */}
              <div className="w-64 h-64 p-4 rounded-2xl bg-white border border-slate-700 shadow-2xl flex items-center justify-center overflow-hidden mb-4">
                {qrDataUrl ? (
                  <img
                    id="img-generated-qr"
                    src={qrDataUrl}
                    alt="VietScan Generated QR"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-xs text-slate-400">Đang tạo mã QR...</div>
                )}
              </div>

              {/* Summary Payload */}
              <div className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-left mb-5">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-0.5">
                  Dữ liệu giải mã:
                </span>
                <p className="text-xs text-slate-200 truncate font-mono">{payload || "Chưa có nội dung"}</p>
              </div>

              {/* Action Buttons */}
              <div className="w-full space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    id="btn-qr-download-png"
                    onClick={handleDownloadPNG}
                    disabled={!qrDataUrl}
                    className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-blue-600/20 active:scale-95 transition"
                  >
                    <Download className="w-4 h-4" />
                    <span>Lưu ảnh PNG</span>
                  </button>

                  <button
                    id="btn-qr-download-pdf"
                    onClick={handleDownloadPDF}
                    disabled={!qrDataUrl}
                    className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-indigo-600/20 active:scale-95 transition"
                  >
                    <FileDown className="w-4 h-4" />
                    <span>Xuất file PDF</span>
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    id="btn-qr-copy-image"
                    onClick={handleCopyImage}
                    disabled={!qrDataUrl}
                    className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl bg-slate-800 hover:bg-slate-750 disabled:opacity-50 text-slate-200 text-xs font-semibold active:scale-95 transition"
                  >
                    {copiedImage ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedImage ? "Đã chép" : "Chép ảnh"}</span>
                  </button>

                  <button
                    id="btn-qr-copy-text"
                    onClick={handleCopyText}
                    disabled={!payload}
                    className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl bg-slate-800 hover:bg-slate-750 disabled:opacity-50 text-slate-200 text-xs font-semibold active:scale-95 transition"
                  >
                    {copiedText ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedText ? "Đã chép" : "Chép text"}</span>
                  </button>

                  <button
                    id="btn-qr-share"
                    onClick={handleShare}
                    disabled={!qrDataUrl}
                    className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl bg-slate-800 hover:bg-slate-750 disabled:opacity-50 text-slate-200 text-xs font-semibold active:scale-95 transition"
                  >
                    <Share2 className="w-3.5 h-3.5 text-blue-400" />
                    <span>Chia sẻ</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
