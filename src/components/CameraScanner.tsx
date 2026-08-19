import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  Camera,
  RotateCcw,
  Zap,
  ZapOff,
  Image as ImageIcon,
  Check,
  Sparkles,
  ArrowLeft,
  Info,
  AlertCircle,
  FileText,
  CreditCard,
  Award,
  IdCard,
  RefreshCw,
} from "lucide-react";
import { ScanMode, QuadPoints, ScannedPage, FilterMode } from "../types";
import { CVEngine } from "../utils/cvEngine";

interface CameraScannerProps {
  initialMode?: ScanMode;
  onCapturePage: (page: ScannedPage, isLastPage?: boolean) => void;
  onFinishedScanning: () => void;
  onClose: () => void;
  scannedPagesCount: number;
}

export const CameraScanner: React.FC<CameraScannerProps> = ({
  initialMode = "document",
  onCapturePage,
  onFinishedScanning,
  onClose,
  scannedPagesCount,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const animFrameId = useRef<number | null>(null);

  const [mode, setMode] = useState<ScanMode>(initialMode);
  const [autoCapture, setAutoCapture] = useState<boolean>(true);
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [guidance, setGuidance] = useState<string>("Đang khởi động camera...");
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [steadyCounter, setSteadyCounter] = useState<number>(0);
  const [detectedQuad, setDetectedQuad] = useState<QuadPoints | null>(null);

  // For 2-sided modes (CCCD / Driver License)
  const [cardSide, setCardSide] = useState<"front" | "back">("front");

  // Start Camera stream
  const startCamera = useCallback(async () => {
    setIsInitializing(true);
    setCameraError(null);

    try {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
      }

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        // Check torch capability
        const track = stream.getVideoTracks()[0];
        const capabilities: any = track.getCapabilities ? track.getCapabilities() : {};
        if (capabilities.torch) {
          setHasTorch(true);
        }
      }

      setIsInitializing(false);
      setGuidance("Đưa tài liệu vào khung hình");
    } catch (err: any) {
      console.error("Camera access error:", err);
      setIsInitializing(false);
      let errMsg = "Không thể mở máy ảnh. Vui lòng cho phép quyền Camera trong cài đặt trình duyệt.";
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        errMsg = "Quyền truy cập Camera đã bị từ chối. Hãy mở Cài đặt trình duyệt để cấp quyền lại.";
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        errMsg = "Không tìm thấy máy ảnh trên thiết bị này. Bạn có thể tải ảnh từ thư viện thiết bị.";
      }
      setCameraError(errMsg);
    }
  }, []);

  useEffect(() => {
    startCamera();

    return () => {
      if (animFrameId.current) {
        cancelAnimationFrame(animFrameId.current);
      }
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [startCamera]);

  // Toggle Torch/Flash
  const toggleTorch = async () => {
    if (!videoRef.current?.srcObject) return;
    const stream = videoRef.current.srcObject as MediaStream;
    const track = stream.getVideoTracks()[0];
    try {
      const nextState = !torchOn;
      await (track as any).applyConstraints({
        advanced: [{ torch: nextState }],
      });
      setTorchOn(nextState);
    } catch (err) {
      console.warn("Could not toggle torch:", err);
    }
  };

  // Sound and Haptic feedback helper
  const triggerCaptureFeedback = () => {
    try {
      if (navigator.vibrate) {
        navigator.vibrate([40, 30, 40]);
      }
      // Simple web audio beep
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.12);
    } catch (e) {
      // ignore
    }
  };

  // Perform Capture & Warp
  const captureFrame = useCallback(
    async (manualQuad?: QuadPoints) => {
      if (!videoRef.current || isCapturing) return;
      setIsCapturing(true);
      triggerCaptureFeedback();

      const video = videoRef.current;
      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;

      // Draw high-res still frame
      const frameCanvas = document.createElement("canvas");
      frameCanvas.width = vw;
      frameCanvas.height = vh;
      const ctx = frameCanvas.getContext("2d");
      if (!ctx) {
        setIsCapturing(false);
        return;
      }
      ctx.drawImage(video, 0, 0, vw, vh);

      const rawDataUrl = frameCanvas.toDataURL("image/jpeg", 0.95);

      // Determine quad
      const targetAspectType = mode === "cccd" || mode === "driver_license" ? "card" : "document";
      const q =
        manualQuad ||
        detectedQuad ||
        CVEngine.detectDocumentQuad(frameCanvas, vw, vh, targetAspectType).quad ||
        CVEngine.getDefaultQuad(vw, vh, targetAspectType);

      // Warp perspective
      const warped = CVEngine.warpPerspective(frameCanvas, q);

      // Apply initial clean filter
      const defaultFilter: FilterMode = mode === "photo" ? "photo" : "document";
      const processedCanvas = CVEngine.applyFilter(warped, defaultFilter, 0);
      const processedDataUrl = processedCanvas.toDataURL("image/jpeg", 0.92);

      const newPage: ScannedPage = {
        id: `page_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        originalImage: rawDataUrl,
        processedImage: processedDataUrl,
        quad: q,
        filter: defaultFilter,
        rotation: 0,
        createdAt: Date.now(),
        width: processedCanvas.width,
        height: processedCanvas.height,
      };

      // If in 2-sided card mode (CCCD or Driver License)
      if (mode === "cccd" || mode === "driver_license") {
        if (cardSide === "front") {
          onCapturePage(newPage, false);
          setCardSide("back");
          setGuidance("Lật sang MẶT SAU của thẻ");
          setIsCapturing(false);
          setSteadyCounter(0);
          return;
        } else {
          // Completed both sides!
          onCapturePage(newPage, true);
          setIsCapturing(false);
          return;
        }
      }

      onCapturePage(newPage, false);
      setIsCapturing(false);
      setSteadyCounter(0);
    },
    [isCapturing, detectedQuad, mode, cardSide, onCapturePage]
  );

  // Real-time detection loop
  useEffect(() => {
    let lastTime = performance.now();
    let localSteadyCount = 0;

    const processFrame = () => {
      const video = videoRef.current;
      const overlay = overlayCanvasRef.current;

      if (video && video.readyState >= 2 && overlay && !isCapturing) {
        const vw = video.clientWidth;
        const vh = video.clientHeight;

        overlay.width = vw;
        overlay.height = vh;
        const ctx = overlay.getContext("2d");

        if (ctx) {
          ctx.clearRect(0, 0, vw, vh);

          const targetAspect = mode === "cccd" || mode === "driver_license" ? "card" : "document";
          const quality = CVEngine.evaluateFrameQuality(video, null);

          // Detect document quad on current video frame
          const { quad: detected, confidence, isClear } = CVEngine.detectDocumentQuad(
            video,
            video.videoWidth,
            video.videoHeight,
            targetAspect
          );

          // Scale quad to overlay screen coordinates
          const scaleX = vw / video.videoWidth;
          const scaleY = vh / video.videoHeight;

          const toScreen = (p: { x: number; y: number }) => ({
            x: p.x * scaleX,
            y: p.y * scaleY,
          });

          const p0 = toScreen(detected.topLeft);
          const p1 = toScreen(detected.topRight);
          const p2 = toScreen(detected.bottomRight);
          const p3 = toScreen(detected.bottomLeft);

          // Draw document target boundary
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineTo(p3.x, p3.y);
          ctx.closePath();

          const isGood = isClear && quality.canAutoCapture;
          ctx.lineWidth = isGood ? 3 : 2;
          ctx.strokeStyle = isGood ? "#22c55e" : "rgba(59, 130, 246, 0.8)";
          ctx.fillStyle = isGood ? "rgba(34, 197, 94, 0.12)" : "rgba(59, 130, 246, 0.06)";
          ctx.fill();
          ctx.stroke();

          // Draw Corner Bracket Accents
          const drawCorner = (pt: { x: number; y: number }) => {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
            ctx.fillStyle = isGood ? "#22c55e" : "#3b82f6";
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = "#ffffff";
            ctx.stroke();
          };
          drawCorner(p0);
          drawCorner(p1);
          drawCorner(p2);
          drawCorner(p3);
          ctx.restore();

          setDetectedQuad(detected);

          // Update guidance text
          if (mode === "cccd") {
            setGuidance(
              cardSide === "front"
                ? "Đưa MẶT TRƯỚC CCCD vào khung hình"
                : "Đưa MẶT SAU CCCD vào khung hình"
            );
          } else if (mode === "driver_license") {
            setGuidance(
              cardSide === "front"
                ? "Đưa MẶT TRƯỚC Bằng lái vào khung"
                : "Đưa MẶT SAU Bằng lái vào khung"
            );
          } else {
            setGuidance(quality.guidance);
          }

          // Auto capture logic: 10 consecutive steady frames (~0.8 sec)
          if (autoCapture && isGood) {
            localSteadyCount++;
            setSteadyCounter(localSteadyCount);
            if (localSteadyCount >= 10) {
              localSteadyCount = 0;
              captureFrame(detected);
            }
          } else {
            localSteadyCount = Math.max(0, localSteadyCount - 1);
            setSteadyCounter(localSteadyCount);
          }
        }
      }

      animFrameId.current = requestAnimationFrame(processFrame);
    };

    animFrameId.current = requestAnimationFrame(processFrame);
    return () => {
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
    };
  }, [autoCapture, mode, cardSide, isCapturing, captureFrame]);

  // Handle local image file import
  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList: File[] = Array.from(files);
    fileList.forEach((file: File) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        const img = new Image();
        img.onload = () => {
          const targetAspectType = mode === "cccd" || mode === "driver_license" ? "card" : "document";
          const { quad } = CVEngine.detectDocumentQuad(img, img.naturalWidth, img.naturalHeight, targetAspectType);
          const warped = CVEngine.warpPerspective(img, quad);
          const processedCanvas = CVEngine.applyFilter(warped, "document", 0);
          const processedUrl = processedCanvas.toDataURL("image/jpeg", 0.92);

          const newPage: ScannedPage = {
            id: `page_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            originalImage: dataUrl,
            processedImage: processedUrl,
            quad: quad,
            filter: "document",
            rotation: 0,
            createdAt: Date.now(),
            width: processedCanvas.width,
            height: processedCanvas.height,
          };

          onCapturePage(newPage, false);
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black text-white select-none">
      {/* Top Header Bar */}
      <div className="relative z-10 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent">
        <button
          id="btn-camera-close"
          onClick={onClose}
          className="p-2.5 rounded-full bg-slate-900/60 backdrop-blur-md text-white hover:bg-slate-800 transition active:scale-95"
          title="Đóng camera"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* Guidance Pill */}
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/80 backdrop-blur border border-slate-700/50 shadow-md text-xs font-medium text-slate-200">
          {steadyCounter > 0 ? (
            <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Đang chụp ({Math.min(100, steadyCounter * 10)}%)...</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              <span>{guidance}</span>
            </div>
          )}
        </div>

        {/* Top Actions: Torch & Auto Toggle */}
        <div className="flex items-center gap-2">
          {hasTorch && (
            <button
              id="btn-toggle-torch"
              onClick={toggleTorch}
              className={`p-2.5 rounded-full backdrop-blur-md transition active:scale-95 ${
                torchOn ? "bg-amber-500 text-black" : "bg-slate-900/60 text-white"
              }`}
              title="Đèn flash"
            >
              {torchOn ? <Zap className="w-5 h-5" /> : <ZapOff className="w-5 h-5" />}
            </button>
          )}

          <button
            id="btn-toggle-autocapture"
            onClick={() => setAutoCapture(!autoCapture)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold backdrop-blur-md border transition active:scale-95 ${
              autoCapture
                ? "bg-blue-600/90 border-blue-400 text-white shadow-lg shadow-blue-500/20"
                : "bg-slate-900/60 border-slate-700 text-slate-300"
            }`}
            title="Tự động chụp khi tài liệu rõ nét"
          >
            {autoCapture ? "Auto: BẬT" : "Auto: TẮT"}
          </button>
        </div>
      </div>

      {/* 2-Sided Step indicator for CCCD / Driver License */}
      {(mode === "cccd" || mode === "driver_license") && (
        <div className="relative z-10 flex justify-center px-4 pb-2">
          <div className="flex items-center gap-3 px-4 py-1.5 rounded-full bg-slate-900/90 border border-slate-700 text-xs font-medium">
            <span
              className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full ${
                cardSide === "front" ? "bg-blue-600 text-white font-bold" : "text-slate-400"
              }`}
            >
              1. Mặt trước
            </span>
            <span className="text-slate-600">→</span>
            <span
              className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full ${
                cardSide === "back" ? "bg-blue-600 text-white font-bold" : "text-slate-400"
              }`}
            >
              2. Mặt sau
            </span>
          </div>
        </div>
      )}

      {/* Main Viewfinder Area */}
      <div className="relative flex-1 w-full h-full overflow-hidden flex items-center justify-center bg-black">
        {cameraError ? (
          <div className="flex flex-col items-center justify-center p-6 text-center max-w-sm">
            <AlertCircle className="w-14 h-14 text-amber-400 mb-3" />
            <h3 className="text-lg font-semibold text-white mb-2">Không thể truy cập camera</h3>
            <p className="text-sm text-slate-400 mb-6">{cameraError}</p>
            <div className="flex flex-col gap-3 w-full">
              <button
                id="btn-retry-camera"
                onClick={startCamera}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-blue-600 text-white font-semibold shadow active:scale-95"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Thử lại Camera</span>
              </button>
              <button
                id="btn-import-file-fallback"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-slate-800 text-slate-200 font-medium active:scale-95"
              >
                <ImageIcon className="w-4 h-4" />
                <span>Chọn ảnh từ thiết bị</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="absolute inset-0 w-full h-full object-cover"
            />
            <canvas ref={overlayCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
          </>
        )}

        {isInitializing && !cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-slate-300">Đang kích hoạt camera...</p>
          </div>
        )}
      </div>

      {/* Mode Selector Strip */}
      <div className="relative z-10 flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-950/90 overflow-x-auto no-scrollbar border-t border-slate-800/80">
        {[
          { id: "document", label: "Tài liệu A4", icon: FileText },
          { id: "cccd", label: "CCCD 2 mặt", icon: IdCard },
          { id: "driver_license", label: "Bằng lái xe", icon: CreditCard },
          { id: "certificate", label: "Bằng cấp/Chứng chỉ", icon: Award },
          { id: "photo", label: "Ảnh màu", icon: ImageIcon },
        ].map((item) => {
          const Icon = item.icon;
          const isSelected = mode === item.id;
          return (
            <button
              key={item.id}
              id={`tab-mode-${item.id}`}
              onClick={() => {
                setMode(item.id as ScanMode);
                setCardSide("front");
              }}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition active:scale-95 ${
                isSelected
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                  : "bg-slate-900 text-slate-400 hover:text-slate-200"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Bottom Shutter & Action Bar */}
      <div className="relative z-10 flex items-center justify-between px-6 py-4 bg-slate-950">
        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileImport}
          className="hidden"
        />

        {/* Gallery / Import Button */}
        <button
          id="btn-import-gallery"
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center gap-1 p-2 rounded-xl text-slate-400 hover:text-white active:scale-95 transition"
          title="Chọn ảnh từ thiết bị"
        >
          <div className="p-3 rounded-full bg-slate-900 border border-slate-800">
            <ImageIcon className="w-6 h-6" />
          </div>
          <span className="text-[11px] font-medium">Nhập ảnh</span>
        </button>

        {/* Main Big Shutter Button */}
        <button
          id="btn-shutter"
          onClick={() => captureFrame()}
          disabled={isCapturing}
          className="relative group p-2 active:scale-90 transition transform"
          title="Bấm để chụp ảnh"
        >
          {/* Outer ring */}
          <div className="w-20 h-20 rounded-full border-4 border-white/90 flex items-center justify-center p-1 group-hover:border-blue-400 transition">
            {/* Inner solid button */}
            <div className="w-full h-full rounded-full bg-white group-hover:bg-blue-500 transition shadow-lg flex items-center justify-center">
              {isCapturing && <RefreshCw className="w-6 h-6 text-slate-900 animate-spin" />}
            </div>
          </div>
        </button>

        {/* Done / Finished Button with Scanned Pages Badge */}
        <button
          id="btn-finish-scanning"
          onClick={onFinishedScanning}
          disabled={scannedPagesCount === 0}
          className={`flex flex-col items-center gap-1 p-2 rounded-xl transition active:scale-95 ${
            scannedPagesCount > 0 ? "text-blue-400 hover:text-blue-300" : "text-slate-600 opacity-40"
          }`}
          title="Hoàn tất và xử lý tài liệu"
        >
          <div className="relative p-3 rounded-full bg-slate-900 border border-slate-800">
            <Check className="w-6 h-6" />
            {scannedPagesCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shadow">
                {scannedPagesCount}
              </span>
            )}
          </div>
          <span className="text-[11px] font-medium">Đã xong</span>
        </button>
      </div>
    </div>
  );
};
