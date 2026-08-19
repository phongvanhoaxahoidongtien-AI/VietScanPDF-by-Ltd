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
import { ScanMode, QuadPoints, ScannedPage, FilterMode, Point } from "../types";
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
  const [screenQuad, setScreenQuad] = useState<QuadPoints | null>(null);

  // For 2-sided modes (CCCD / Driver License)
  const [cardSide, setCardSide] = useState<"front" | "back">("front");

  // History tracking for auto-capture stability check
  const quadHistoryRef = useRef<QuadPoints[]>([]);
  const smoothedQuadRef = useRef<QuadPoints | null>(null);
  const isCapturingRef = useRef<boolean>(false);

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
        if (capabilities && capabilities.torch) {
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
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        const audioCtx = new AudioCtxClass();
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
      }
    } catch (e) {
      // Audio autoplay policy fallback
    }
  };

  // Perform Capture & Warp
  const captureFrame = useCallback(
    async (manualQuad?: QuadPoints) => {
      if (!videoRef.current || isCapturingRef.current) return;
      isCapturingRef.current = true;
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
        isCapturingRef.current = false;
        setIsCapturing(false);
        return;
      }
      ctx.drawImage(video, 0, 0, vw, vh);

      const rawDataUrl = frameCanvas.toDataURL("image/jpeg", 0.95);

      // Determine quad to crop
      const targetAspectType = mode === "cccd" || mode === "driver_license" ? "card" : "document";
      const detectedResult = CVEngine.detectDocumentQuad(frameCanvas, vw, vh, targetAspectType);
      const q =
        manualQuad ||
        detectedQuad ||
        (detectedResult.isRealQuad ? detectedResult.quad : null) ||
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

      // Handle 2-sided card mode (CCCD or Driver License)
      if (mode === "cccd" || mode === "driver_license") {
        if (cardSide === "front") {
          onCapturePage(newPage, false);
          setCardSide("back");
          setGuidance("Lật sang MẶT SAU của thẻ");
          setSteadyCounter(0);
          quadHistoryRef.current = [];
          smoothedQuadRef.current = null;
          setTimeout(() => {
            isCapturingRef.current = false;
            setIsCapturing(false);
          }, 400);
          return;
        } else {
          // Completed both sides!
          onCapturePage(newPage, true);
          setTimeout(() => {
            isCapturingRef.current = false;
            setIsCapturing(false);
          }, 400);
          return;
        }
      }

      onCapturePage(newPage, false);
      setSteadyCounter(0);
      quadHistoryRef.current = [];
      smoothedQuadRef.current = null;
      setTimeout(() => {
        isCapturingRef.current = false;
        setIsCapturing(false);
      }, 400);
    },
    [detectedQuad, mode, cardSide, onCapturePage]
  );

  // Real-time detection & 4-corner polygon tracking loop
  useEffect(() => {
    let localSteadyCount = 0;

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const smoothPoint = (current: Point, target: Point, alpha: number): Point => ({
      x: lerp(current.x, target.x, alpha),
      y: lerp(current.y, target.y, alpha),
    });

    const processFrame = () => {
      const video = videoRef.current;
      const overlay = overlayCanvasRef.current;

      if (video && video.readyState >= 2 && overlay && !isCapturingRef.current) {
        const vw = video.clientWidth;
        const vh = video.clientHeight;

        if (overlay.width !== vw || overlay.height !== vh) {
          overlay.width = vw;
          overlay.height = vh;
        }

        const ctx = overlay.getContext("2d");

        if (ctx) {
          ctx.clearRect(0, 0, vw, vh);

          const targetAspect = mode === "cccd" || mode === "driver_license" ? "card" : "document";

          // Detect document quad on current video frame
          const detection = CVEngine.detectDocumentQuad(
            video,
            video.videoWidth,
            video.videoHeight,
            targetAspect
          );

          const detected = detection.quad;
          const isReal = detection.isRealQuad;

          // Evaluate sharpness, brightness, stability
          const quality = CVEngine.evaluateFrameQuality(video, isReal ? detected : null);

          // Map quad coordinates to screen overlay
          const scaleX = vw / (video.videoWidth || 1);
          const scaleY = vh / (video.videoHeight || 1);

          const targetScreenQuad: QuadPoints = {
            topLeft: { x: detected.topLeft.x * scaleX, y: detected.topLeft.y * scaleY },
            topRight: { x: detected.topRight.x * scaleX, y: detected.topRight.y * scaleY },
            bottomRight: { x: detected.bottomRight.x * scaleX, y: detected.bottomRight.y * scaleY },
            bottomLeft: { x: detected.bottomLeft.x * scaleX, y: detected.bottomLeft.y * scaleY },
          };

          // Apply Exponential Moving Average (EMA) smoothing for fluid overlay rendering
          if (!smoothedQuadRef.current) {
            smoothedQuadRef.current = targetScreenQuad;
          } else {
            const alpha = 0.45; // Smooth factor
            smoothedQuadRef.current = {
              topLeft: smoothPoint(smoothedQuadRef.current.topLeft, targetScreenQuad.topLeft, alpha),
              topRight: smoothPoint(smoothedQuadRef.current.topRight, targetScreenQuad.topRight, alpha),
              bottomRight: smoothPoint(
                smoothedQuadRef.current.bottomRight,
                targetScreenQuad.bottomRight,
                alpha
              ),
              bottomLeft: smoothPoint(
                smoothedQuadRef.current.bottomLeft,
                targetScreenQuad.bottomLeft,
                alpha
              ),
            };
          }

          const curScreen = smoothedQuadRef.current;
          const p0 = curScreen.topLeft;
          const p1 = curScreen.topRight;
          const p2 = curScreen.bottomRight;
          const p3 = curScreen.bottomLeft;

          // Check corner drift across consecutive frames
          const history = quadHistoryRef.current;
          history.push(detected);
          if (history.length > 6) history.shift();

          let isStableCorners = false;
          if (history.length >= 4 && isReal) {
            let maxDrift = 0;
            const last = history[history.length - 1];
            for (let i = 0; i < history.length - 1; i++) {
              const h = history[i];
              const d0 = Math.hypot(h.topLeft.x - last.topLeft.x, h.topLeft.y - last.topLeft.y);
              const d1 = Math.hypot(h.topRight.x - last.topRight.x, h.topRight.y - last.topRight.y);
              const d2 = Math.hypot(
                h.bottomRight.x - last.bottomRight.x,
                h.bottomRight.y - last.bottomRight.y
              );
              const d3 = Math.hypot(
                h.bottomLeft.x - last.bottomLeft.x,
                h.bottomLeft.y - last.bottomLeft.y
              );
              const curMax = Math.max(d0, d1, d2, d3);
              if (curMax > maxDrift) maxDrift = curMax;
            }

            // If corner drift is within 3.5% of frame width, it is steady!
            const driftThreshold = video.videoWidth * 0.035;
            isStableCorners = maxDrift < driftThreshold;
          }

          const isDocumentReady = isReal && quality.canAutoCapture && isStableCorners;

          // 1. Draw polygon boundary with glowing aesthetics
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineTo(p3.x, p3.y);
          ctx.closePath();

          if (isDocumentReady) {
            ctx.strokeStyle = "#10b981"; // Emerald
            ctx.lineWidth = 3.5;
            ctx.fillStyle = "rgba(16, 185, 129, 0.18)";
            ctx.shadowColor = "#10b981";
            ctx.shadowBlur = 12;
          } else if (isReal) {
            ctx.strokeStyle = "#3b82f6"; // Blue
            ctx.lineWidth = 2.5;
            ctx.fillStyle = "rgba(59, 130, 246, 0.08)";
            ctx.shadowColor = "#3b82f6";
            ctx.shadowBlur = 6;
          } else {
            ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
            ctx.lineWidth = 1.5;
            ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
            ctx.setLineDash([6, 6]);
          }

          ctx.fill();
          ctx.stroke();
          ctx.restore();

          // 2. Draw 4 distinctive corner brackets
          const drawCornerAccent = (pt: Point, angleDeg: number) => {
            ctx.save();
            ctx.translate(pt.x, pt.y);

            // Outer circle
            ctx.beginPath();
            ctx.arc(0, 0, isDocumentReady ? 8 : 6, 0, Math.PI * 2);
            ctx.fillStyle = isDocumentReady ? "#10b981" : isReal ? "#3b82f6" : "#ffffff";
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = "#ffffff";
            ctx.stroke();

            // Corner crosshair brackets
            ctx.rotate((angleDeg * Math.PI) / 180);
            ctx.beginPath();
            ctx.moveTo(0, 16);
            ctx.lineTo(0, 0);
            ctx.lineTo(16, 0);
            ctx.strokeStyle = isDocumentReady ? "#10b981" : isReal ? "#60a5fa" : "#ffffff";
            ctx.lineWidth = 3;
            ctx.lineCap = "round";
            ctx.stroke();

            ctx.restore();
          };

          drawCornerAccent(p0, 0);
          drawCornerAccent(p1, 90);
          drawCornerAccent(p2, 180);
          drawCornerAccent(p3, 270);

          setDetectedQuad(detected);
          setScreenQuad(curScreen);

          // Update guidance message
          if (mode === "cccd") {
            setGuidance(
              cardSide === "front"
                ? isDocumentReady
                  ? "Giữ yên để tự động chụp Mặt trước..."
                  : "Đưa MẶT TRƯỚC CCCD vào khung hình"
                : isDocumentReady
                ? "Giữ yên để tự động chụp Mặt sau..."
                : "Đưa MẶT SAU CCCD vào khung hình"
            );
          } else if (mode === "driver_license") {
            setGuidance(
              cardSide === "front"
                ? isDocumentReady
                  ? "Giữ yên để tự động chụp Bằng lái..."
                  : "Đưa MẶT TRƯỚC Bằng lái vào khung"
                : isDocumentReady
                ? "Giữ yên để tự động chụp Mặt sau..."
                : "Đưa MẶT SAU Bằng lái vào khung"
            );
          } else {
            if (isDocumentReady) {
              setGuidance("Đã nhận diện chuẩn - Giữ yên để chụp...");
            } else if (isReal) {
              setGuidance("Giữ điện thoại ổn định để lấy nét...");
            } else {
              setGuidance(quality.guidance);
            }
          }

          // Auto-capture countdown logic (7 consecutive steady frames ~ 0.45s)
          if (autoCapture && isDocumentReady) {
            localSteadyCount++;
            setSteadyCounter(localSteadyCount);
            if (localSteadyCount >= 7) {
              localSteadyCount = 0;
              setSteadyCounter(0);
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
  }, [autoCapture, mode, cardSide, captureFrame]);

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
          const detectedResult = CVEngine.detectDocumentQuad(
            img,
            img.naturalWidth,
            img.naturalHeight,
            targetAspectType
          );
          const q = detectedResult.isRealQuad
            ? detectedResult.quad
            : CVEngine.getDefaultQuad(img.naturalWidth, img.naturalHeight, targetAspectType);

          const warped = CVEngine.warpPerspective(img, q);
          const processedCanvas = CVEngine.applyFilter(warped, "document", 0);
          const processedUrl = processedCanvas.toDataURL("image/jpeg", 0.92);

          const newPage: ScannedPage = {
            id: `page_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            originalImage: dataUrl,
            processedImage: processedUrl,
            quad: q,
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
    <div className="fixed inset-0 z-40 flex flex-col bg-black text-white select-none h-screen-dvh min-h-screen-dvh w-full overflow-hidden">
      {/* Top Header Bar with Safe Area */}
      <div className="relative z-50 flex items-center justify-between px-4 pt-safe pb-2 bg-gradient-to-b from-black/90 via-black/50 to-transparent">
        {/* Back / Close Button */}
        <button
          id="btn-camera-close"
          onClick={onClose}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center p-2.5 rounded-full bg-slate-900/80 backdrop-blur-md text-white hover:bg-slate-800 transition active:scale-95 border border-slate-700/50 shadow-md"
          title="Đóng camera và quay lại"
          aria-label="Đóng camera"
        >
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>

        {/* Guidance Pill */}
        <div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-slate-900/90 backdrop-blur border border-slate-700/60 shadow-lg text-xs font-medium text-slate-200 max-w-[200px] sm:max-w-xs truncate">
          {steadyCounter > 0 ? (
            <div className="flex items-center gap-1.5 text-emerald-400 font-semibold truncate">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <span className="truncate">Đang chụp ({Math.min(100, Math.round((steadyCounter / 7) * 100))}%)...</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 truncate">
              <Sparkles className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="truncate">{guidance}</span>
            </div>
          )}
        </div>

        {/* Top Actions: Torch & Auto Toggle */}
        <div className="flex items-center gap-2">
          {hasTorch && (
            <button
              id="btn-toggle-torch"
              onClick={toggleTorch}
              className={`min-w-[40px] min-h-[40px] flex items-center justify-center p-2 rounded-full backdrop-blur-md transition active:scale-95 border border-slate-700/50 ${
                torchOn ? "bg-amber-500 text-black border-amber-400" : "bg-slate-900/80 text-white"
              }`}
              title="Đèn flash"
            >
              {torchOn ? <Zap className="w-5 h-5" /> : <ZapOff className="w-5 h-5" />}
            </button>
          )}

          <button
            id="btn-toggle-autocapture"
            onClick={() => setAutoCapture(!autoCapture)}
            className={`px-3 py-2 rounded-full text-xs font-semibold backdrop-blur-md border transition active:scale-95 ${
              autoCapture
                ? "bg-emerald-600/90 border-emerald-400 text-white shadow-lg shadow-emerald-600/25"
                : "bg-slate-900/80 border-slate-700 text-slate-300"
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
          <div className="flex items-center gap-3 px-4 py-1.5 rounded-full bg-slate-900/90 border border-slate-700 text-xs font-medium shadow-md">
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
      <div className="relative z-10 flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-950/95 overflow-x-auto no-scrollbar border-t border-slate-800/80">
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
                setSteadyCounter(0);
                quadHistoryRef.current = [];
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

      {/* Bottom Shutter & Action Bar with Safe Area */}
      <div className="relative z-10 flex items-center justify-between px-6 pt-3 pb-safe bg-slate-950 border-t border-slate-900">
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
          className="min-w-[48px] flex flex-col items-center gap-1 p-2 rounded-xl text-slate-400 hover:text-white active:scale-95 transition"
          title="Chọn ảnh từ thiết bị"
        >
          <div className="p-3 rounded-full bg-slate-900 border border-slate-800 shadow-sm">
            <ImageIcon className="w-6 h-6" />
          </div>
          <span className="text-[11px] font-medium">Nhập ảnh</span>
        </button>

        {/* Main Big Shutter Button with Steady Progress Ring */}
        <button
          id="btn-shutter"
          onClick={() => captureFrame()}
          disabled={isCapturing}
          className="relative group p-2 active:scale-90 transition transform"
          title="Bấm để chụp ảnh thủ công"
        >
          {/* Outer ring */}
          <div
            className={`w-20 h-20 rounded-full border-4 flex items-center justify-center p-1 transition ${
              steadyCounter > 0
                ? "border-emerald-400 scale-105 shadow-lg shadow-emerald-500/30"
                : "border-white/90 group-hover:border-blue-400"
            }`}
          >
            {/* Inner solid button */}
            <div
              className={`w-full h-full rounded-full transition shadow-lg flex items-center justify-center ${
                steadyCounter > 0 ? "bg-emerald-500" : "bg-white group-hover:bg-blue-500"
              }`}
            >
              {isCapturing && <RefreshCw className="w-6 h-6 text-slate-900 animate-spin" />}
            </div>
          </div>
        </button>

        {/* Done / Finished Button with Scanned Pages Badge */}
        <button
          id="btn-finish-scanning"
          onClick={onFinishedScanning}
          disabled={scannedPagesCount === 0}
          className={`min-w-[48px] flex flex-col items-center gap-1 p-2 rounded-xl transition active:scale-95 ${
            scannedPagesCount > 0 ? "text-blue-400 hover:text-blue-300" : "text-slate-600 opacity-40"
          }`}
          title="Hoàn tất và xử lý tài liệu"
        >
          <div className="relative p-3 rounded-full bg-slate-900 border border-slate-800 shadow-sm">
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
