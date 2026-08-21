import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ArrowLeft,
  Camera,
  Image as ImageIcon,
  Zap,
  ZapOff,
  Copy,
  Check,
  ExternalLink,
  Share2,
  RefreshCw,
  IdCard,
  Wifi,
  Globe,
  FileText,
  User,
  Phone,
  Mail,
  AlertCircle,
  ShieldCheck,
  ClipboardPaste,
  Link as LinkIcon,
  Loader2,
  X,
} from "lucide-react";
import jsQR from "jsqr";

interface QRScannerModalProps {
  onClose: () => void;
}

export interface ParsedCCCD {
  id: string;
  oldId?: string;
  name: string;
  dob: string;
  gender: string;
  address: string;
  issueDate: string;
}

export interface ParsedWifi {
  ssid: string;
  password?: string;
  auth?: string;
  hidden?: boolean;
}

export interface ParsedVCard {
  name?: string;
  phone?: string;
  email?: string;
  org?: string;
  address?: string;
}

export type QRContentType = "cccd" | "url" | "wifi" | "vcard" | "phone" | "email" | "text";

export const QRScannerModal: React.FC<QRScannerModalProps> = ({ onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const animFrameId = useRef<number | null>(null);

  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(true);

  // Decoded QR State
  const [rawDecodedText, setRawDecodedText] = useState<string | null>(null);
  const [contentType, setContentType] = useState<QRContentType>("text");
  const [parsedCCCD, setParsedCCCD] = useState<ParsedCCCD | null>(null);
  const [parsedWifi, setParsedWifi] = useState<ParsedWifi | null>(null);
  const [parsedVCard, setParsedVCard] = useState<ParsedVCard | null>(null);
  const [copied, setCopied] = useState(false);

  // Link & Clipboard input modal state
  const [isUrlModalOpen, setIsUrlModalOpen] = useState<boolean>(false);
  const [inputUrl, setInputUrl] = useState<string>("");
  const [isLoadingUrl, setIsLoadingUrl] = useState<boolean>(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [pasteToast, setPasteToast] = useState<string | null>(null);

  // Sound and Haptic feedback
  const triggerScanFeedback = () => {
    try {
      if (navigator.vibrate) {
        navigator.vibrate([40, 30, 40]);
      }
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(1200, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.12);
      }
    } catch (e) {
      // Ignored
    }
  };

  // Content analysis and parser
  const parseQRContent = (text: string) => {
    const trimmed = text.trim();

    // 1. CCCD QR Check: format is pipe delimited "id|oldId|name|dob|gender|address|issueDate"
    const pipeParts = trimmed.split("|");
    if (pipeParts.length >= 6 && /^\d{12}$/.test(pipeParts[0])) {
      const id = pipeParts[0];
      const oldId = pipeParts[1] || "";
      const name = pipeParts[2];
      const rawDob = pipeParts[3]; // ddmmyyyy
      const gender = pipeParts[4];
      const address = pipeParts[5];
      const rawIssue = pipeParts[6] || "";

      const formatDdmmyyyy = (raw: string) => {
        if (raw && raw.length === 8) {
          return `${raw.slice(0, 2)}/${raw.slice(2, 4)}/${raw.slice(4, 8)}`;
        }
        return raw;
      };

      setContentType("cccd");
      setParsedCCCD({
        id,
        oldId: oldId || undefined,
        name,
        dob: formatDdmmyyyy(rawDob),
        gender,
        address,
        issueDate: formatDdmmyyyy(rawIssue),
      });
      return;
    }

    // 2. Wi-Fi: "WIFI:T:WPA;S:MySSID;P:MyPass;H:false;;"
    if (trimmed.toUpperCase().startsWith("WIFI:")) {
      const ssidMatch = trimmed.match(/S:([^;]*)/i);
      const passMatch = trimmed.match(/P:([^;]*)/i);
      const authMatch = trimmed.match(/T:([^;]*)/i);
      const hiddenMatch = trimmed.match(/H:([^;]*)/i);

      setContentType("wifi");
      setParsedWifi({
        ssid: ssidMatch ? ssidMatch[1] : "Không rõ SSID",
        password: passMatch ? passMatch[1] : "",
        auth: authMatch ? authMatch[1] : "WPA",
        hidden: hiddenMatch ? hiddenMatch[1].toLowerCase() === "true" : false,
      });
      return;
    }

    // 3. vCard
    if (trimmed.toUpperCase().startsWith("BEGIN:VCARD")) {
      const fnMatch = trimmed.match(/FN:([^\r\n]*)/i) || trimmed.match(/N:([^\r\n]*)/i);
      const telMatch = trimmed.match(/TEL[^\:]*:([^\r\n]*)/i);
      const emailMatch = trimmed.match(/EMAIL[^\:]*:([^\r\n]*)/i);
      const orgMatch = trimmed.match(/ORG:([^\r\n]*)/i);
      const adrMatch = trimmed.match(/ADR[^\:]*:([^\r\n]*)/i);

      setContentType("vcard");
      setParsedVCard({
        name: fnMatch ? fnMatch[1].replace(/;/g, " ").trim() : "",
        phone: telMatch ? telMatch[1].trim() : "",
        email: emailMatch ? emailMatch[1].trim() : "",
        org: orgMatch ? orgMatch[1].trim() : "",
        address: adrMatch ? adrMatch[1].replace(/;/g, " ").trim() : "",
      });
      return;
    }

    // 4. URL
    if (/^(https?:\/\/|www\.)/i.test(trimmed)) {
      setContentType("url");
      return;
    }

    // 5. Phone
    if (/^tel:/i.test(trimmed) || /^\+?[0-9]{9,15}$/.test(trimmed.replace(/\s+/g, ""))) {
      setContentType("phone");
      return;
    }

    // 6. Email
    if (/^mailto:/i.test(trimmed) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setContentType("email");
      return;
    }

    // Fallback: Plain text
    setContentType("text");
  };

  const handleQRDecoded = (text: string) => {
    setRawDecodedText(text);
    parseQRContent(text);
    setIsScanning(false);
    triggerScanFeedback();
  };

  // Start Camera
  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
      }

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        const track = stream.getVideoTracks()[0];
        const capabilities: any = track.getCapabilities ? track.getCapabilities() : {};
        if (capabilities && capabilities.torch) {
          setHasTorch(true);
        }
      }
    } catch (err: any) {
      console.error("Camera access error:", err);
      let msg = "Không thể mở camera. Vui lòng cấp quyền Camera.";
      if (err.name === "NotAllowedError") {
        msg = "Quyền truy cập Camera đã bị từ chối. Hãy mở cài đặt để cho phép.";
      }
      setCameraError(msg);
    }
  }, []);

  useEffect(() => {
    if (isScanning) {
      startCamera();
    }

    return () => {
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [isScanning, startCamera]);

  // Frame processing loop using jsQR
  useEffect(() => {
    if (!isScanning) return;

    const scanFrame = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video && video.readyState >= 2 && canvas) {
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 480;

        // Process on modest resolution for fast performance
        const targetW = 480;
        const scale = Math.min(1, targetW / vw);
        const w = Math.round(vw * scale);
        const h = Math.round(vh * scale);

        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);
          const imgData = ctx.getImageData(0, 0, w, h);
          const qrCode = jsQR(imgData.data, w, h, {
            inversionAttempts: "attemptBoth",
          });

          if (qrCode && qrCode.data && qrCode.data.trim()) {
            handleQRDecoded(qrCode.data);
            return;
          }
        }
      }

      animFrameId.current = requestAnimationFrame(scanFrame);
    };

    animFrameId.current = requestAnimationFrame(scanFrame);

    return () => {
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
    };
  }, [isScanning]);

  // Toggle Torch
  const toggleTorch = async () => {
    if (!videoRef.current?.srcObject) return;
    const stream = videoRef.current.srcObject as MediaStream;
    const track = stream.getVideoTracks()[0];
    try {
      const next = !torchOn;
      await (track as any).applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch (e) {
      console.warn(e);
    }
  };

  // Core QR decode from any loaded HTMLImageElement
  const decodeImageElement = (img: HTMLImageElement): boolean => {
    try {
      const c = document.createElement("canvas");
      // Scale down extra huge images to avoid memory spikes
      const maxDim = 1200;
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return false;
      ctx.drawImage(img, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      const qrCode = jsQR(imgData.data, w, h, {
        inversionAttempts: "attemptBoth",
      });

      if (qrCode && qrCode.data && qrCode.data.trim()) {
        handleQRDecoded(qrCode.data);
        return true;
      }
      return false;
    } catch (e) {
      console.error("Decode error:", e);
      return false;
    }
  };

  // Decode QR from uploaded image file
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const success = decodeImageElement(img);
        if (!success) {
          alert("Không tìm thấy mã QR trong ảnh vừa chọn. Vui lòng chọn ảnh rõ nét hơn.");
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Decode QR from image URL
  const handleDecodeFromUrl = async (urlToFetch?: string) => {
    const targetUrl = (urlToFetch || inputUrl).trim();
    if (!targetUrl) {
      setUrlError("Vui lòng nhập đường dẫn liên kết hình ảnh.");
      return;
    }

    setIsLoadingUrl(true);
    setUrlError(null);

    try {
      const img = new Image();
      img.crossOrigin = "anonymous";

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Không thể tải hình ảnh từ liên kết này. Vui lòng kiểm tra lại link hoặc quyền truy cập."));
        img.src = targetUrl;
      });

      const success = decodeImageElement(img);
      if (success) {
        setIsUrlModalOpen(false);
        setInputUrl("");
      } else {
        setUrlError("Đã tải được ảnh nhưng không tìm thấy mã QR bên trong. Hãy thử một liên kết ảnh khác rõ nét hơn.");
      }
    } catch (err: any) {
      setUrlError(err.message || "Lỗi tải ảnh từ liên kết. Hãy thử copy ảnh và Dán trực tiếp.");
    } finally {
      setIsLoadingUrl(false);
    }
  };

  // Paste image from system clipboard (Desktop / Mobile)
  const handlePasteFromClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((t) => t.startsWith("image/"));
          if (imageType) {
            const blob = await item.getType(imageType);
            const reader = new FileReader();
            reader.onload = (ev) => {
              const dataUrl = ev.target?.result as string;
              const img = new Image();
              img.onload = () => {
                const ok = decodeImageElement(img);
                if (!ok) {
                  showToast("Không tìm thấy mã QR trong ảnh vừa dán.");
                } else {
                  showToast("Đã đọc thành công mã QR từ bộ nhớ tạm!");
                }
              };
              img.src = dataUrl;
            };
            reader.readAsDataURL(blob);
            return;
          }
        }
      }

      // Check if text in clipboard is an image URL
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = (await navigator.clipboard.readText()).trim();
        if (text) {
          if (text.startsWith("http://") || text.startsWith("https://") || text.startsWith("data:image/")) {
            handleDecodeFromUrl(text);
            return;
          }
        }
      }

      showToast("Bộ nhớ tạm chưa có ảnh. Bạn hãy sao chép một hình ảnh mã QR rồi bấm Dán lại (hoặc nhấn Ctrl+V / Cmd+V).");
    } catch (e: any) {
      console.warn("Clipboard read error:", e);
      showToast("Vui lòng nhấn tổ hợp phím Ctrl+V (hoặc Cmd+V) để dán ảnh trực tiếp.");
    }
  };

  const showToast = (msg: string) => {
    setPasteToast(msg);
    setTimeout(() => setPasteToast(null), 3500);
  };

  // Global paste event listener
  useEffect(() => {
    const handleWindowPaste = (e: ClipboardEvent) => {
      if (!isScanning) return;
      if (!e.clipboardData) return;

      const items = e.clipboardData.items;
      let handled = false;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            handled = true;
            const reader = new FileReader();
            reader.onload = (ev) => {
              const url = ev.target?.result as string;
              const img = new Image();
              img.onload = () => {
                const success = decodeImageElement(img);
                if (success) {
                  showToast("Đã đọc thành công mã QR từ ảnh vừa dán!");
                } else {
                  showToast("Không tìm thấy mã QR trong ảnh vừa dán.");
                }
              };
              img.src = url;
            };
            reader.readAsDataURL(blob);
            break;
          }
        }
      }

      if (!handled) {
        const pastedText = e.clipboardData.getData("text").trim();
        if (pastedText.startsWith("http://") || pastedText.startsWith("https://") || pastedText.startsWith("data:image/")) {
          handleDecodeFromUrl(pastedText);
        }
      }
    };

    window.addEventListener("paste", handleWindowPaste);
    return () => window.removeEventListener("paste", handleWindowPaste);
  }, [isScanning]);

  // Reset to continue scanning
  const handleScanAgain = () => {
    setRawDecodedText(null);
    setParsedCCCD(null);
    setParsedWifi(null);
    setParsedVCard(null);
    setIsScanning(true);
  };

  // Copy text helper
  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  // Share
  const handleShare = async () => {
    if (!rawDecodedText) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Kết quả quét mã QR",
          text: rawDecodedText,
        });
      } else {
        handleCopy(rawDecodedText);
      }
    } catch (e) {
      // Dismissed
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white select-none overflow-hidden">
      {/* Hidden processing canvas & file input */}
      <canvas ref={canvasRef} className="hidden" />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageUpload}
        className="hidden"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-safe-top pb-3 bg-slate-900 border-b border-slate-800 shrink-0">
        <button
          id="btn-qr-scan-back"
          onClick={onClose}
          className="min-w-[44px] min-h-[44px] flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 active:bg-slate-700 border border-slate-700/80 text-slate-100 hover:text-white active:scale-95 transition text-xs font-semibold shadow-sm"
        >
          <ArrowLeft className="w-5 h-5 text-blue-400" />
          <span>Quay lại</span>
        </button>

        <h2 className="text-sm font-bold text-white">Quét / Đọc Mã QR</h2>

        <div className="flex items-center gap-1">
          {hasTorch && isScanning && (
            <button
              id="btn-qr-torch"
              onClick={toggleTorch}
              className={`p-2 rounded-lg transition ${
                torchOn ? "bg-amber-400 text-slate-950" : "bg-slate-800 text-slate-300 hover:text-white"
              }`}
            >
              {torchOn ? <Zap className="w-5 h-5" /> : <ZapOff className="w-5 h-5" />}
            </button>
          )}

          <button
            id="btn-qr-paste-clip"
            onClick={handlePasteFromClipboard}
            title="Dán ảnh từ bộ nhớ tạm (Ctrl+V)"
            className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-semibold active:scale-95 transition border border-slate-700/60"
          >
            <ClipboardPaste className="w-4 h-4 text-emerald-400" />
            <span className="hidden sm:inline">Dán ảnh</span>
          </button>

          <button
            id="btn-qr-url-link"
            onClick={() => {
              setUrlError(null);
              setIsUrlModalOpen(true);
            }}
            title="Nhập ảnh từ link"
            className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-semibold active:scale-95 transition border border-slate-700/60"
          >
            <LinkIcon className="w-4 h-4 text-sky-400" />
            <span className="hidden sm:inline">Từ Link</span>
          </button>

          <button
            id="btn-qr-import-image"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold active:scale-95 transition shadow-sm"
          >
            <ImageIcon className="w-4 h-4 text-white" />
            <span>Chọn ảnh</span>
          </button>
        </div>
      </div>

      {/* Toast Alert */}
      {pasteToast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-slate-900/95 border border-blue-500/50 text-white text-xs font-medium shadow-2xl backdrop-blur-md animate-fade-in flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0" />
          <span>{pasteToast}</span>
        </div>
      )}

      {/* Camera Live Viewfinder when scanning */}
      {isScanning ? (
        <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="w-full h-full object-cover"
          />

          {/* Camera Error Message */}
          {cameraError && (
            <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center z-30">
              <AlertCircle className="w-12 h-12 text-rose-500 mb-3" />
              <h3 className="text-base font-bold text-white mb-1">Lỗi Máy Ảnh</h3>
              <p className="text-xs text-slate-400 max-w-sm mb-4">{cameraError}</p>
              <div className="flex flex-wrap gap-2 justify-center">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs"
                >
                  Chọn ảnh từ máy
                </button>
                <button
                  onClick={handlePasteFromClipboard}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs"
                >
                  Dán ảnh (Clipboard)
                </button>
              </div>
            </div>
          )}

          {/* Viewfinder Reticle Overlay */}
          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
            {/* Dimmed backdrop around square */}
            <div className="relative w-72 h-72 rounded-3xl border-2 border-blue-500/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.65)] overflow-hidden flex items-center justify-center">
              {/* Corner Accents */}
              <div className="absolute top-2 left-2 w-6 h-6 border-t-4 border-l-4 border-blue-400 rounded-tl-lg" />
              <div className="absolute top-2 right-2 w-6 h-6 border-t-4 border-r-4 border-blue-400 rounded-tr-lg" />
              <div className="absolute bottom-2 left-2 w-6 h-6 border-b-4 border-l-4 border-blue-400 rounded-bl-lg" />
              <div className="absolute bottom-2 right-2 w-6 h-6 border-b-4 border-r-4 border-blue-400 rounded-br-lg" />

              {/* Animated Laser Scanning Line */}
              <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-blue-400 to-transparent shadow-[0_0_12px_#38bdf8] animate-pulse" />
            </div>

            <p className="text-xs font-semibold text-white/90 bg-slate-900/80 backdrop-blur-md px-4 py-1.5 rounded-full border border-slate-700 mt-6 shadow-lg">
              Hướng camera vào mã QR hoặc mã CCCD
            </p>

            {/* Quick action floating pills on mobile */}
            <div className="pointer-events-auto flex items-center gap-2 mt-4">
              <button
                onClick={handlePasteFromClipboard}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/90 hover:bg-slate-800 border border-emerald-500/40 text-emerald-400 text-xs font-semibold backdrop-blur-md active:scale-95 transition shadow-lg"
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                <span>Dán từ bộ nhớ tạm</span>
              </button>
              <button
                onClick={() => {
                  setUrlError(null);
                  setIsUrlModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/90 hover:bg-slate-800 border border-sky-500/40 text-sky-400 text-xs font-semibold backdrop-blur-md active:scale-95 transition shadow-lg"
              >
                <LinkIcon className="w-3.5 h-3.5" />
                <span>Nhập link ảnh</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Result Detail View */
        <div className="flex-1 overflow-y-auto p-4 max-w-2xl w-full mx-auto pb-24">
          <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl space-y-5">
            {/* Header Badge */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {contentType === "cccd" && (
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold">
                    <IdCard className="w-4 h-4" />
                    <span>Mã QR CCCD Gắn Chip</span>
                  </div>
                )}
                {contentType === "url" && (
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 text-xs font-bold">
                    <Globe className="w-4 h-4" />
                    <span>Liên kết Website</span>
                  </div>
                )}
                {contentType === "wifi" && (
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-bold">
                    <Wifi className="w-4 h-4" />
                    <span>Mạng Wi-Fi</span>
                  </div>
                )}
                {contentType === "vcard" && (
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30 text-xs font-bold">
                    <User className="w-4 h-4" />
                    <span>Danh bạ</span>
                  </div>
                )}
                {contentType === "phone" && (
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold">
                    <Phone className="w-4 h-4" />
                    <span>Số điện thoại</span>
                  </div>
                )}
                {contentType === "email" && (
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 text-xs font-bold">
                    <Mail className="w-4 h-4" />
                    <span>Email</span>
                  </div>
                )}
                {contentType === "text" && (
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-700 text-slate-300 border border-slate-600 text-xs font-bold">
                    <FileText className="w-4 h-4" />
                    <span>Văn bản thuần</span>
                  </div>
                )}
              </div>

              <span className="text-[11px] text-slate-400">Đã quét thành công</span>
            </div>

            {/* Structured CCCD Details */}
            {contentType === "cccd" && parsedCCCD && (
              <div className="p-4 rounded-2xl bg-slate-950 border border-emerald-500/30 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="text-xs text-slate-400">Số Định Danh Cá Nhân (CCCD)</span>
                  <span className="text-base font-mono font-bold text-emerald-400 tracking-wider">
                    {parsedCCCD.id}
                  </span>
                </div>

                {parsedCCCD.oldId && (
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                    <span className="text-xs text-slate-400">Số CMND cũ</span>
                    <span className="text-sm font-mono font-semibold text-slate-200">
                      {parsedCCCD.oldId}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="text-xs text-slate-400">Họ và Tên</span>
                  <span className="text-sm font-bold text-white uppercase">
                    {parsedCCCD.name}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4 pb-2 border-b border-slate-800">
                  <div>
                    <span className="text-[11px] text-slate-400 block">Ngày sinh</span>
                    <span className="text-xs font-semibold text-slate-200">{parsedCCCD.dob}</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block">Giới tính</span>
                    <span className="text-xs font-semibold text-slate-200">{parsedCCCD.gender}</span>
                  </div>
                </div>

                <div className="pb-2 border-b border-slate-800">
                  <span className="text-[11px] text-slate-400 block mb-0.5">Nơi thường trú</span>
                  <span className="text-xs font-medium text-slate-200 leading-relaxed">
                    {parsedCCCD.address}
                  </span>
                </div>

                {parsedCCCD.issueDate && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Ngày cấp</span>
                    <span className="text-xs font-semibold text-slate-200">
                      {parsedCCCD.issueDate}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Structured Wi-Fi Details */}
            {contentType === "wifi" && parsedWifi && (
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="text-xs text-slate-400">Tên Mạng (SSID)</span>
                  <span className="text-sm font-bold text-white">{parsedWifi.ssid}</span>
                </div>

                {parsedWifi.password ? (
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                    <span className="text-xs text-slate-400">Mật khẩu</span>
                    <span className="text-sm font-mono font-bold text-amber-400">
                      {parsedWifi.password}
                    </span>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 pb-2 border-b border-slate-800">
                    Mạng không đặt mật khẩu (Mở)
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Bảo mật</span>
                  <span className="text-xs text-slate-300">{parsedWifi.auth}</span>
                </div>
              </div>
            )}

            {/* Structured vCard Details */}
            {contentType === "vcard" && parsedVCard && (
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                {parsedVCard.name && (
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                    <span className="text-xs text-slate-400">Họ và tên</span>
                    <span className="text-sm font-bold text-white">{parsedVCard.name}</span>
                  </div>
                )}
                {parsedVCard.phone && (
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                    <span className="text-xs text-slate-400">Số điện thoại</span>
                    <span className="text-sm font-mono font-bold text-emerald-400">
                      {parsedVCard.phone}
                    </span>
                  </div>
                )}
                {parsedVCard.email && (
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                    <span className="text-xs text-slate-400">Email</span>
                    <span className="text-xs text-slate-200">{parsedVCard.email}</span>
                  </div>
                )}
                {parsedVCard.org && (
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                    <span className="text-xs text-slate-400">Tổ chức</span>
                    <span className="text-xs text-slate-200">{parsedVCard.org}</span>
                  </div>
                )}
                {parsedVCard.address && (
                  <div>
                    <span className="text-xs text-slate-400 block mb-0.5">Địa chỉ</span>
                    <span className="text-xs text-slate-200">{parsedVCard.address}</span>
                  </div>
                )}
              </div>
            )}

            {/* Raw Text Box */}
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                Nội dung gốc mã QR
              </label>
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 font-mono text-xs text-slate-200 break-all max-h-48 overflow-y-auto leading-relaxed">
                {rawDecodedText}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2.5 pt-2">
              {contentType === "url" && rawDecodedText && (
                <a
                  href={rawDecodedText.startsWith("http") ? rawDecodedText : `https://${rawDecodedText}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md shadow-blue-600/20 active:scale-95 transition"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Mở liên kết trình duyệt</span>
                </a>
              )}

              {contentType === "wifi" && parsedWifi?.password && (
                <button
                  onClick={() => handleCopy(parsedWifi.password!)}
                  className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold active:scale-95 transition"
                >
                  <Copy className="w-4 h-4" />
                  <span>Sao chép mật khẩu Wi-Fi</span>
                </button>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  id="btn-qr-result-copy"
                  onClick={() => handleCopy(rawDecodedText || "")}
                  className="flex items-center justify-center gap-1.5 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-750 text-white text-xs font-bold active:scale-95 transition"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? "Đã sao chép" : "Sao chép"}</span>
                </button>

                <button
                  id="btn-qr-result-share"
                  onClick={handleShare}
                  className="flex items-center justify-center gap-1.5 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-750 text-white text-xs font-bold active:scale-95 transition"
                >
                  <Share2 className="w-4 h-4 text-blue-400" />
                  <span>Chia sẻ</span>
                </button>
              </div>

              <button
                id="btn-qr-scan-continue"
                onClick={handleScanAgain}
                className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg active:scale-95 transition"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Tiếp tục quét mã khác</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* URL Link Input Modal */}
      {isUrlModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center font-bold">
                  <LinkIcon className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Quét Mã QR từ Link ảnh</h3>
                  <p className="text-[11px] text-slate-400">Dán đường dẫn ảnh chứa mã QR trên mạng</p>
                </div>
              </div>
              <button
                onClick={() => setIsUrlModalOpen(false)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <div className="relative">
                <input
                  type="url"
                  placeholder="https://example.com/qr-code.png"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleDecodeFromUrl();
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 pr-20"
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      if (text) setInputUrl(text.trim());
                    } catch (e) {
                      // Ignored
                    }
                  }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 font-semibold active:scale-95 transition"
                >
                  Dán link
                </button>
              </div>

              {urlError && (
                <div className="flex items-start gap-1.5 text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-xl">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{urlError}</span>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsUrlModalOpen(false)}
                className="flex-1 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-semibold"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isLoadingUrl || !inputUrl.trim()}
                onClick={() => handleDecodeFromUrl()}
                className="flex-1 py-2.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-sky-600/20"
              >
                {isLoadingUrl ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Đang tải...</span>
                  </>
                ) : (
                  <span>Tải & Quét QR</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
