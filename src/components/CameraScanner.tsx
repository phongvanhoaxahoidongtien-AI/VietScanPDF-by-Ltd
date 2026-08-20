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
  AlertCircle,
  FileText,
  CreditCard,
  Award,
  IdCard,
  RefreshCw,
  Crop,
  Trash2,
  Plus,
  CheckCircle2,
  Eye,
  Sun,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { ScanMode, QuadPoints, ScannedPage, FilterMode, Point, DocumentQualityCheck, CardSideAnalysis } from "../types";
import { CVEngine } from "../utils/cvEngine";
import { DocumentTracker } from "../utils/documentTracker";
import { CropAdjuster } from "./CropAdjuster";

export type ScannerState =
  | "INITIALIZING"
  | "SEARCHING"
  | "DETECTING"
  | "STABILIZING"
  | "READY"
  | "CAPTURING"
  | "REVIEW";

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

  // Scanner State Machine
  const [scannerState, setScannerState] = useState<ScannerState>("INITIALIZING");
  const [mode, setMode] = useState<ScanMode>(initialMode);
  const [autoCapture, setAutoCapture] = useState<boolean>(true);
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<string>("Đang khởi động máy ảnh...");
  const [isFlashing, setIsFlashing] = useState<boolean>(false);
  const [steadyCounter, setSteadyCounter] = useState<number>(0);
  const [stabilityScore, setStabilityScore] = useState<number>(0);
  const [confidenceScore, setConfidenceScore] = useState<number>(0);
  const [isDetected, setIsDetected] = useState<boolean>(false);
  const [detectedQuad, setDetectedQuad] = useState<QuadPoints | null>(null);
  const [screenQuad, setScreenQuad] = useState<QuadPoints | null>(null);

  // Quality and Card Side Analysis
  const [latestQuality, setLatestQuality] = useState<DocumentQualityCheck | null>(null);
  const [latestCardSide, setLatestCardSide] = useState<CardSideAnalysis | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  // For 2-sided modes (CCCD / Driver License)
  const [cardSide, setCardSide] = useState<"front" | "back">("front");
  const [frontPageDraft, setFrontPageDraft] = useState<ScannedPage | null>(null);

  // Page Review & Jumping sheet state
  const [reviewingPage, setReviewingPage] = useState<ScannedPage | null>(null);
  const [isAdjustingCrop, setIsAdjustingCrop] = useState<boolean>(false);

  // Document Tracker Instance
  const trackerRef = useRef<DocumentTracker>(new DocumentTracker());
  const isCapturingRef = useRef<boolean>(false);
  const currentScannerStateRef = useRef<ScannerState>("INITIALIZING");

  // Keep state ref synchronized for zero-latency frame loop checks
  useEffect(() => {
    currentScannerStateRef.current = scannerState;
  }, [scannerState]);

  // Start Camera Stream
  const startCamera = useCallback(async () => {
    setScannerState("INITIALIZING");
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

      setScannerState("SEARCHING");
      setGuidance("Đưa tài liệu vào khung hình");
    } catch (err: any) {
      console.error("Camera access error:", err);
      let errMsg = "Không thể mở máy ảnh. Vui lòng cấp quyền Camera trong cài đặt trình duyệt.";
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        errMsg = "Quyền truy cập Camera đã bị từ chối. Hãy mở Cài đặt trình duyệt để cho phép.";
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        errMsg = "Không tìm thấy máy ảnh trên thiết bị. Bạn có thể chọn ảnh từ thư viện.";
      }
      setCameraError(errMsg);
      setScannerState("INITIALIZING");
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

  // Reset tracker on mode or cardSide change
  useEffect(() => {
    trackerRef.current.reset();
    setSteadyCounter(0);
    setStabilityScore(0);
    setConfidenceScore(0);
    setIsDetected(false);
    setDuplicateWarning(null);
    if (scannerState !== "REVIEW") {
      setScannerState("SEARCHING");
    }
  }, [mode, cardSide]);

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
        navigator.vibrate([50, 40, 50]);
      }
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        const audioCtx = new AudioCtxClass();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
      }
    } catch (e) {
      // Autoplay policy fallback
    }
  };

  // Perform High Quality Capture, Warp & Perceptual Anti-Duplicate Verification
  const captureFrame = useCallback(
    async (manualQuad?: QuadPoints) => {
      if (!videoRef.current || isCapturingRef.current || currentScannerStateRef.current === "REVIEW") {
        return;
      }

      isCapturingRef.current = true;
      setScannerState("CAPTURING");
      setIsFlashing(true);
      triggerCaptureFeedback();

      setTimeout(() => setIsFlashing(false), 140);

      const video = videoRef.current;
      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;

      // Draw high-res still frame
      const frameCanvas = document.createElement("canvas");
      frameCanvas.width = vw;
      frameCanvas.height = vh;
      const ctx = frameCanvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        isCapturingRef.current = false;
        setScannerState("SEARCHING");
        return;
      }
      ctx.drawImage(video, 0, 0, vw, vh);

      const rawDataUrl = frameCanvas.toDataURL("image/jpeg", 0.95);

      // Determine quad to crop (prioritize tracked smoothed quad)
      const targetAspectType = mode === "cccd" || mode === "driver_license" ? "card" : "document";
      const detectedResult = CVEngine.detectDocumentQuad(frameCanvas, vw, vh, targetAspectType);
      const q =
        manualQuad ||
        detectedQuad ||
        (detectedResult.isRealQuad ? detectedResult.quad : null) ||
        CVEngine.getDefaultQuad(vw, vh, targetAspectType);

      // Warp perspective
      const warped = CVEngine.warpPerspective(frameCanvas, q);

      // Compute perceptual hash for duplicate detection
      const pHash = CVEngine.computePerceptualHashFromCanvas(warped);

      // Anti-duplicate validation for CCCD / 2-sided card
      if ((mode === "cccd" || mode === "driver_license") && cardSide === "back" && frontPageDraft?.perceptualHash) {
        const similarity = CVEngine.compareHashSimilarity(frontPageDraft.perceptualHash, pHash);
        if (similarity > 0.88) {
          // Warning: User captured the front side again!
          setDuplicateWarning("Ảnh bị trùng với Mặt trước! Vui lòng lật sang Mặt sau của thẻ.");
          setTimeout(() => setDuplicateWarning(null), 3500);
          isCapturingRef.current = false;
          setScannerState("SEARCHING");
          trackerRef.current.reset(1200);
          return;
        }
      }

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
        perceptualHash: pHash,
        detectedSide: cardSide,
      };

      // Transition to REVIEW state & lock Auto-Capture
      setReviewingPage(newPage);
      setScannerState("REVIEW");
      trackerRef.current.setCooldown(6000); // Strict capture lock
      isCapturingRef.current = false;
    },
    [detectedQuad, mode, cardSide, frontPageDraft]
  );

  // Next Page / Confirm Action
  const handleProceedNextPage = (finishImmediately: boolean = false) => {
    if (!reviewingPage) return;

    const pageToSave = reviewingPage;
    setReviewingPage(null);
    setIsAdjustingCrop(false);

    // 2-Sided card handling (CCCD / GPLX)
    if (mode === "cccd" || mode === "driver_license") {
      if (cardSide === "front" && !finishImmediately) {
        setFrontPageDraft(pageToSave);
        onCapturePage(pageToSave, false);
        setCardSide("back");
        setGuidance("Lật sang MẶT SAU của thẻ");
        setScannerState("SEARCHING");
        trackerRef.current.reset(1500);
        setSteadyCounter(0);
        return;
      } else {
        // Back side completed or direct finish
        onCapturePage(pageToSave, true);
        return;
      }
    }

    // Normal multi-page document scanning
    onCapturePage(pageToSave, finishImmediately);
    if (!finishImmediately) {
      setScannerState("SEARCHING");
      trackerRef.current.reset(1200);
      setSteadyCounter(0);
      setGuidance("Đưa trang tiếp theo vào khung hình");
    }
  };

  // Discard current page and retake immediately
  const handleRetakeCurrentPage = () => {
    setReviewingPage(null);
    setIsAdjustingCrop(false);
    setScannerState("SEARCHING");
    trackerRef.current.reset(600);
    setSteadyCounter(0);
    setGuidance("Căn chỉnh lại tài liệu để chụp lại");
  };

  // Update crop from in-place CropAdjuster
  const handleCropAdjustComplete = (warpedCanvas: HTMLCanvasElement, adjustedQuad: QuadPoints) => {
    if (!reviewingPage) return;
    const defaultFilter: FilterMode = reviewingPage.filter || "document";
    const processedCanvas = CVEngine.applyFilter(warpedCanvas, defaultFilter, reviewingPage.rotation || 0);
    const processedDataUrl = processedCanvas.toDataURL("image/jpeg", 0.92);
    const pHash = CVEngine.computePerceptualHashFromCanvas(warpedCanvas);

    setReviewingPage({
      ...reviewingPage,
      processedImage: processedDataUrl,
      quad: adjustedQuad,
      width: processedCanvas.width,
      height: processedCanvas.height,
      perceptualHash: pHash,
    });
    setIsAdjustingCrop(false);
  };

  // Real-time detection & 4-corner polygon tracking loop with Temporal Filter
  useEffect(() => {
    const processFrame = () => {
      const video = videoRef.current;
      const overlay = overlayCanvasRef.current;
      const currentState = currentScannerStateRef.current;

      if (video && video.readyState >= 2 && overlay) {
        const vw = video.clientWidth;
        const vh = video.clientHeight;

        if (overlay.width !== vw || overlay.height !== vh) {
          overlay.width = vw;
          overlay.height = vh;
        }

        const ctx = overlay.getContext("2d");

        if (ctx) {
          ctx.clearRect(0, 0, vw, vh);

          // If currently in REVIEW or CAPTURING, skip detection calculation
          if (currentState === "REVIEW" || isCapturingRef.current) {
            animFrameId.current = requestAnimationFrame(processFrame);
            return;
          }

          const targetAspect = mode === "cccd" || mode === "driver_license" ? "card" : "document";

          // 1. Raw Edge & Contour Detection
          const detection = CVEngine.detectDocumentQuad(
            video,
            video.videoWidth,
            video.videoHeight,
            targetAspect
          );

          setLatestQuality(detection.quality || null);
          setLatestCardSide(detection.cardSide || null);

          // 2. Tracking & Temporal Smoothing via DocumentTracker
          const trackResult = trackerRef.current.update(
            detection.isRealQuad ? detection.quad : null,
            detection.confidence,
            video.videoWidth,
            video.videoHeight,
            detection.quality,
            detection.cardSide,
            mode === "cccd" || mode === "driver_license" ? cardSide : undefined
          );

          setIsDetected(trackResult.isDetected);
          setStabilityScore(trackResult.stabilityScore);
          setConfidenceScore(Math.round(trackResult.confidence * 100));
          setSteadyCounter(trackResult.stableFrames);

          // Update State Machine
          if (trackResult.isReadyForCapture) {
            setScannerState("READY");
          } else if (trackResult.isDetected && trackResult.stabilityScore >= 50) {
            setScannerState("STABILIZING");
          } else if (trackResult.isDetected) {
            setScannerState("DETECTING");
          } else {
            setScannerState("SEARCHING");
          }

          // 3. Coordinate mapping from video space to screen space
          const scaleX = vw / (video.videoWidth || 1);
          const scaleY = vh / (video.videoHeight || 1);

          let curScreen: QuadPoints;
          if (trackResult.smoothedQuad) {
            curScreen = {
              topLeft: {
                x: trackResult.smoothedQuad.topLeft.x * scaleX,
                y: trackResult.smoothedQuad.topLeft.y * scaleY,
              },
              topRight: {
                x: trackResult.smoothedQuad.topRight.x * scaleX,
                y: trackResult.smoothedQuad.topRight.y * scaleY,
              },
              bottomRight: {
                x: trackResult.smoothedQuad.bottomRight.x * scaleX,
                y: trackResult.smoothedQuad.bottomRight.y * scaleY,
              },
              bottomLeft: {
                x: trackResult.smoothedQuad.bottomLeft.x * scaleX,
                y: trackResult.smoothedQuad.bottomLeft.y * scaleY,
              },
            };
          } else {
            const defQ = CVEngine.getDefaultQuad(video.videoWidth, video.videoHeight, targetAspect);
            curScreen = {
              topLeft: { x: defQ.topLeft.x * scaleX, y: defQ.topLeft.y * scaleY },
              topRight: { x: defQ.topRight.x * scaleX, y: defQ.topRight.y * scaleY },
              bottomRight: { x: defQ.bottomRight.x * scaleX, y: defQ.bottomRight.y * scaleY },
              bottomLeft: { x: defQ.bottomLeft.x * scaleX, y: defQ.bottomLeft.y * scaleY },
            };
          }

          const p0 = curScreen.topLeft;
          const p1 = curScreen.topRight;
          const p2 = curScreen.bottomRight;
          const p3 = curScreen.bottomLeft;

          // 4. Render stabilized polygon overlay
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineTo(p3.x, p3.y);
          ctx.closePath();

          if (trackResult.isReadyForCapture) {
            ctx.strokeStyle = "#10b981"; // Emerald green
            ctx.lineWidth = 3.5;
            ctx.fillStyle = "rgba(16, 185, 129, 0.22)";
            ctx.shadowColor = "#10b981";
            ctx.shadowBlur = 16;
          } else if (trackResult.isDetected && trackResult.stabilityScore >= 50) {
            ctx.strokeStyle = "#06b6d4"; // Cyan
            ctx.lineWidth = 2.8;
            ctx.fillStyle = "rgba(6, 182, 212, 0.12)";
            ctx.shadowColor = "#06b6d4";
            ctx.shadowBlur = 10;
          } else if (trackResult.isDetected) {
            ctx.strokeStyle = "#3b82f6"; // Primary Blue
            ctx.lineWidth = 2.2;
            ctx.fillStyle = "rgba(59, 130, 246, 0.08)";
            ctx.shadowColor = "#3b82f6";
            ctx.shadowBlur = 6;
          } else {
            ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
            ctx.lineWidth = 1.5;
            ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
            ctx.setLineDash([6, 6]);
          }

          ctx.fill();
          ctx.stroke();
          ctx.restore();

          // 5. Draw 4 precision corner target brackets
          const drawCornerAccent = (pt: Point, angleDeg: number) => {
            ctx.save();
            ctx.translate(pt.x, pt.y);

            // Outer target circle
            ctx.beginPath();
            ctx.arc(0, 0, trackResult.isReadyForCapture ? 8 : 6, 0, Math.PI * 2);
            ctx.fillStyle = trackResult.isReadyForCapture
              ? "#10b981"
              : trackResult.isDetected
              ? "#3b82f6"
              : "#ffffff";
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = "#ffffff";
            ctx.stroke();

            // Precision Corner angle bracket
            ctx.rotate((angleDeg * Math.PI) / 180);
            ctx.beginPath();
            ctx.moveTo(0, 20);
            ctx.lineTo(0, 0);
            ctx.lineTo(20, 0);
            ctx.strokeStyle = trackResult.isReadyForCapture
              ? "#10b981"
              : trackResult.isDetected
              ? "#60a5fa"
              : "#ffffff";
            ctx.lineWidth = 3.5;
            ctx.lineCap = "round";
            ctx.stroke();

            ctx.restore();
          };

          drawCornerAccent(p0, 0);
          drawCornerAccent(p1, 90);
          drawCornerAccent(p2, 180);
          drawCornerAccent(p3, 270);

          setDetectedQuad(trackResult.smoothedQuad || (detection.isRealQuad ? detection.quad : null));
          setScreenQuad(curScreen);

          // 6. Update Guidance Message
          setGuidance(trackResult.guidance);

          // 7. Auto Capture Triggering (Strictly when isReadyForCapture === true)
          if (
            autoCapture &&
            trackResult.isReadyForCapture &&
            !isCapturingRef.current &&
            currentScannerStateRef.current !== "REVIEW"
          ) {
            captureFrame(trackResult.smoothedQuad || undefined);
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

  // Handle image import from device
  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    fileList.forEach((file: File) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        const img = new Image();
        img.onload = () => {
          // Default to widest frame (4 full outer corners) as requested by user
          const fullQuad: QuadPoints = {
            topLeft: { x: 0, y: 0 },
            topRight: { x: img.naturalWidth, y: 0 },
            bottomRight: { x: img.naturalWidth, y: img.naturalHeight },
            bottomLeft: { x: 0, y: img.naturalHeight },
          };

          const warped = CVEngine.warpPerspective(img, fullQuad);
          const processedCanvas = CVEngine.applyFilter(warped, "document", 0);
          const processedUrl = processedCanvas.toDataURL("image/jpeg", 0.92);
          const pHash = CVEngine.computePerceptualHashFromCanvas(warped);

          const newPage: ScannedPage = {
            id: `page_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            originalImage: dataUrl,
            processedImage: processedUrl,
            quad: fullQuad,
            filter: "document",
            rotation: 0,
            createdAt: Date.now(),
            width: processedCanvas.width,
            height: processedCanvas.height,
            perceptualHash: pHash,
            detectedSide: cardSide,
          };

          setReviewingPage(newPage);
          setScannerState("REVIEW");
          trackerRef.current.setCooldown(5000);
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const is2SidedCard = mode === "cccd" || mode === "driver_license";

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black text-white select-none h-screen min-h-screen w-full overflow-hidden">
      {/* Visual Shutter Flash Effect */}
      {isFlashing && (
        <div className="absolute inset-0 z-50 bg-white opacity-85 pointer-events-none transition-opacity duration-140" />
      )}

      {/* Duplicate Page / Side Warning Toast */}
      {duplicateWarning && (
        <div className="absolute top-16 inset-x-4 z-50 max-w-md mx-auto p-3 rounded-2xl bg-amber-600/95 text-white font-semibold text-xs shadow-2xl border border-amber-400 flex items-center gap-2.5 animate-bounce">
          <AlertCircle className="w-5 h-5 shrink-0 text-amber-200" />
          <span>{duplicateWarning}</span>
        </div>
      )}

      {/* Top Header Bar */}
      <div className="relative z-50 flex items-center justify-between px-4 pt-safe pb-2 bg-gradient-to-b from-black/90 via-black/50 to-transparent">
        {/* Back / Close Button */}
        <button
          id="btn-camera-close"
          onClick={onClose}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center p-2.5 rounded-full bg-slate-900/80 backdrop-blur-md text-white hover:bg-slate-800 transition active:scale-95 border border-slate-700/50 shadow-md"
          title="Đóng máy ảnh"
          aria-label="Đóng máy ảnh"
        >
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>

        {/* Guidance Pill */}
        <div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-slate-900/90 backdrop-blur border border-slate-700/60 shadow-lg text-xs font-medium text-slate-200 max-w-[220px] sm:max-w-xs truncate">
          {scannerState === "READY" ? (
            <div className="flex items-center gap-1.5 text-emerald-400 font-semibold truncate">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
              <span className="truncate">{guidance}</span>
            </div>
          ) : isDetected ? (
            <div className="flex items-center gap-1.5 text-blue-400 font-medium truncate">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
              <span className="truncate">{guidance}</span>
            </div>
          ) : (
            <span className="truncate text-slate-300">{guidance}</span>
          )}
        </div>

        {/* Top Actions: Torch & Auto-Capture */}
        <div className="flex items-center gap-2">
          {hasTorch && (
            <button
              id="btn-camera-torch"
              onClick={toggleTorch}
              className={`min-w-[44px] min-h-[44px] flex items-center justify-center p-2.5 rounded-full backdrop-blur-md transition active:scale-95 border shadow-md ${
                torchOn
                  ? "bg-amber-500 text-slate-950 border-amber-400 font-bold"
                  : "bg-slate-900/80 text-white border-slate-700/50 hover:bg-slate-800"
              }`}
              title="Bật/Tắt Đèn Flash"
              aria-label="Bật/Tắt Đèn Flash"
            >
              {torchOn ? <Zap className="w-5 h-5 fill-current" /> : <ZapOff className="w-5 h-5" />}
            </button>
          )}

          {/* Auto-Capture Toggle Pill */}
          <button
            id="btn-toggle-autocapture"
            onClick={() => setAutoCapture((prev) => !prev)}
            className={`min-w-[44px] min-h-[44px] flex items-center gap-1.5 px-3 py-2 rounded-full backdrop-blur-md transition active:scale-95 border text-xs font-semibold shadow-md ${
              autoCapture
                ? "bg-emerald-600/90 text-white border-emerald-500/80 shadow-emerald-950/40"
                : "bg-slate-900/80 text-slate-300 border-slate-700/50 hover:bg-slate-800"
            }`}
            title="Bật/Tắt Tự động chụp khi giữ yên"
          >
            <Sparkles className={`w-3.5 h-3.5 ${autoCapture ? "text-emerald-200" : "text-slate-400"}`} />
            <span>{autoCapture ? "Tự động" : "Thủ công"}</span>
          </button>
        </div>
      </div>

      {/* Main Viewport & Video Stream */}
      <div className="relative flex-1 w-full h-full bg-black overflow-hidden flex items-center justify-center">
        {/* HTML5 Camera Video Element */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Real-time Augmented Polygon Canvas Overlay */}
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none z-10"
        />

        {/* Real-time Quality Meters (Độ nét, Độ sáng, Ổn định) */}
        {isDetected && scannerState !== "REVIEW" && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-slate-950/85 backdrop-blur border border-slate-700/60 shadow-lg text-[11px]">
            <div className="flex items-center gap-1">
              <Eye className="w-3 h-3 text-slate-400" />
              <span className="text-slate-400">Nét:</span>
              <span
                className={`font-semibold ${
                  latestQuality?.isSharp ? "text-emerald-400" : "text-amber-400"
                }`}
              >
                {latestQuality?.sharpness || confidenceScore}%
              </span>
            </div>
            <div className="w-[1px] h-3 bg-slate-700" />
            <div className="flex items-center gap-1">
              <Sun className="w-3 h-3 text-slate-400" />
              <span className="text-slate-400">Sáng:</span>
              <span
                className={`font-semibold ${
                  latestQuality?.isWellExposed ? "text-emerald-400" : "text-amber-400"
                }`}
              >
                {latestQuality?.brightness || 120}
              </span>
            </div>
            <div className="w-[1px] h-3 bg-slate-700" />
            <div className="flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-slate-400" />
              <span className="text-slate-400">Ổn định:</span>
              <span
                className={`font-semibold ${
                  stabilityScore >= 70 ? "text-emerald-400" : "text-amber-400"
                }`}
              >
                {stabilityScore}%
              </span>
            </div>
          </div>
        )}

        {/* 2-Sided Card Guide Watermark */}
        {is2SidedCard && scannerState !== "REVIEW" && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-950/85 backdrop-blur border border-indigo-700/60 text-xs font-semibold text-indigo-200 shadow-xl">
            <IdCard className="w-4 h-4 text-indigo-400" />
            <span>
              {cardSide === "front" ? "ĐANG CHỤP: MẶT TRƯỚC THẺ" : "ĐANG CHỤP: MẶT SAU THẺ"}
            </span>
          </div>
        )}

        {/* Camera Permission / Error Dialog */}
        {cameraError && (
          <div className="absolute inset-0 z-30 flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-md">
            <div className="max-w-sm w-full p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center shadow-2xl">
              <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Không thể mở máy ảnh</h3>
              <p className="text-sm text-slate-300 mb-6 leading-relaxed">{cameraError}</p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={startCamera}
                  className="w-full min-h-[44px] flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold text-white transition active:scale-98 shadow-lg shadow-blue-600/30"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Thử lại</span>
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full min-h-[44px] flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 font-medium text-slate-200 transition active:scale-98"
                >
                  <ImageIcon className="w-4 h-4" />
                  <span>Chọn ảnh từ thiết bị</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Hidden File Input for Device Image Import */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileImport}
        className="hidden"
      />

      {/* REVIEW & JUMPING SHEET MODAL (Auto-Capture is 100% LOCKED here) */}
      <AnimatePresence>
        {scannerState === "REVIEW" && reviewingPage && (
          <motion.div
            initial={{ opacity: 0, y: 120 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 120 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
            className="absolute bottom-0 inset-x-0 z-50 p-4 pb-safe bg-slate-900/95 backdrop-blur-xl border-t border-slate-800 shadow-2xl rounded-t-3xl flex flex-col gap-4"
          >
            {/* Sheet Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">
                    {is2SidedCard
                      ? cardSide === "front"
                        ? "Đã chụp Mặt trước"
                        : "Đã chụp Mặt sau"
                      : `Đã chụp Trang ${scannedPagesCount + 1}`}
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    {is2SidedCard
                      ? "Kiểm tra chất lượng trước khi quét mặt tiếp theo"
                      : "Kiểm tra tài liệu đã căn chuẩn chưa"}
                  </p>
                </div>
              </div>

              {/* Adjust Corners Button */}
              <button
                id="btn-review-crop"
                onClick={() => setIsAdjustingCrop(true)}
                className="min-h-[38px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition active:scale-95"
              >
                <Crop className="w-3.5 h-3.5 text-blue-400" />
                <span>Chỉnh 4 góc</span>
              </button>
            </div>

            {/* Thumbnail Preview Area with Jumping Sheet Effect */}
            <div className="relative w-full h-44 rounded-2xl bg-black/60 border border-slate-800 overflow-hidden flex items-center justify-center p-2">
              <img
                src={reviewingPage.processedImage}
                alt="Bản quét vừa chụp"
                className="max-h-full max-w-full object-contain rounded-lg shadow-md border border-slate-700/50"
              />
              <div className="absolute top-2 right-2 px-2 py-1 rounded bg-black/70 backdrop-blur text-[10px] font-semibold text-emerald-400 border border-emerald-500/30">
                Đã xử lý & Tự căn thẳng
              </div>
            </div>

            {/* Primary Action Buttons */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              {/* Retake Button */}
              <button
                id="btn-review-retake"
                onClick={handleRetakeCurrentPage}
                className="min-h-[46px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-200 font-semibold text-sm border border-slate-700 transition active:scale-98"
              >
                <Trash2 className="w-4 h-4 text-red-400" />
                <span>Chụp lại</span>
              </button>

              {/* Next Page / 2nd Side / Done Button */}
              {is2SidedCard ? (
                cardSide === "front" ? (
                  <button
                    id="btn-review-next-side"
                    onClick={() => handleProceedNextPage(false)}
                    className="min-h-[46px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition active:scale-98 shadow-lg shadow-blue-600/30"
                  >
                    <span>Lật sang Mặt sau</span>
                    <Plus className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    id="btn-review-finish-card"
                    onClick={() => handleProceedNextPage(true)}
                    className="min-h-[46px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition active:scale-98 shadow-lg shadow-emerald-600/30"
                  >
                    <Check className="w-4 h-4" />
                    <span>Ghép 2 mặt & Lưu</span>
                  </button>
                )
              ) : (
                <button
                  id="btn-review-next-page"
                  onClick={() => handleProceedNextPage(false)}
                  className="min-h-[46px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition active:scale-98 shadow-lg shadow-blue-600/30"
                >
                  <Plus className="w-4 h-4" />
                  <span>Trang tiếp theo</span>
                </button>
              )}
            </div>

            {/* Complete Scanning Session Button */}
            {!is2SidedCard && (
              <button
                id="btn-review-finish-all"
                onClick={() => handleProceedNextPage(true)}
                className="w-full min-h-[42px] flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-emerald-400 text-xs font-bold border border-emerald-500/30 transition active:scale-98"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Hoàn tất & Mở tài liệu ({scannedPagesCount + 1} trang)</span>
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Manual Crop Adjuster Modal (When user taps "Chỉnh 4 góc") */}
      {isAdjustingCrop && reviewingPage && (
        <CropAdjuster
          imageSrc={reviewingPage.originalImage}
          initialQuad={reviewingPage.quad}
          aspectMode={mode === "cccd" || mode === "driver_license" ? "card" : "document"}
          onComplete={handleCropAdjustComplete}
          onCancel={() => setIsAdjustingCrop(false)}
        />
      )}

      {/* Bottom Camera Controller Bar (When not in review mode) */}
      {scannerState !== "REVIEW" && (
        <div className="relative z-30 flex flex-col bg-gradient-to-t from-black/95 via-black/80 to-transparent pt-2 pb-safe px-4">
          {/* Mode Selector Horizontal Scroll */}
          <div className="flex items-center justify-center gap-1.5 py-2 overflow-x-auto no-scrollbar">
            {[
              { id: "document", label: "Tài liệu A4", icon: FileText },
              { id: "cccd", label: "CCCD (2 mặt)", icon: IdCard },
              { id: "driver_license", label: "Bằng lái", icon: Award },
              { id: "card", label: "Thẻ Card", icon: CreditCard },
              { id: "photo", label: "Ảnh màu", icon: ImageIcon },
            ].map((item) => {
              const IconComp = item.icon;
              const isActive = mode === item.id;
              return (
                <button
                  key={item.id}
                  id={`btn-mode-${item.id}`}
                  onClick={() => {
                    setMode(item.id as ScanMode);
                    setCardSide("front");
                  }}
                  className={`min-h-[38px] flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition active:scale-95 whitespace-nowrap ${
                    isActive
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30"
                      : "bg-slate-900/60 text-slate-300 hover:bg-slate-800/80 border border-slate-800"
                  }`}
                >
                  <IconComp className="w-3.5 h-3.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Shutter Button & Secondary Controls */}
          <div className="flex items-center justify-between px-6 py-4">
            {/* Device Library Import Button */}
            <button
              id="btn-camera-gallery"
              onClick={() => fileInputRef.current?.click()}
              className="min-w-[48px] min-h-[48px] flex flex-col items-center justify-center p-2 rounded-full bg-slate-900/80 backdrop-blur border border-slate-700 text-slate-200 hover:bg-slate-800 transition active:scale-95"
              title="Chọn ảnh từ Thư viện"
            >
              <ImageIcon className="w-5 h-5 text-slate-300" />
            </button>

            {/* Main Shutter Button */}
            <button
              id="btn-camera-shutter"
              onClick={() => captureFrame()}
              disabled={scannerState === "CAPTURING"}
              className="relative w-18 h-18 sm:w-20 sm:h-20 rounded-full bg-white flex items-center justify-center shadow-2xl active:scale-95 transition-transform"
              title="Chụp ảnh ngay"
              aria-label="Chụp ảnh ngay"
            >
              {/* Animated Ring when document is stabilized */}
              <div
                className={`absolute -inset-1.5 rounded-full border-2 transition-colors duration-300 ${
                  scannerState === "READY"
                    ? "border-emerald-400 animate-pulse"
                    : scannerState === "STABILIZING"
                    ? "border-blue-400"
                    : "border-white/40"
                }`}
              />
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-white border-2 border-slate-950 flex items-center justify-center">
                <Camera className="w-6 h-6 text-slate-950" />
              </div>
            </button>

            {/* Finish Scan Session Button (if already has scanned pages) */}
            {scannedPagesCount > 0 ? (
              <button
                id="btn-camera-finish-existing"
                onClick={onFinishedScanning}
                className="min-w-[48px] min-h-[48px] flex flex-col items-center justify-center p-2 rounded-full bg-emerald-600 text-white font-bold hover:bg-emerald-500 transition active:scale-95 shadow-lg shadow-emerald-600/30"
                title="Xong và xem toàn bộ tài liệu"
              >
                <Check className="w-5 h-5" />
                <span className="text-[10px] font-bold">{scannedPagesCount}</span>
              </button>
            ) : (
              <div className="w-12 h-12" />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
