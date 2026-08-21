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
  ClipboardPaste,
  Scan,
  ScanLine,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { ScanMode, QuadPoints, ScannedPage, FilterMode, Point, DocumentQualityCheck, CardSideAnalysis } from "../types";
import { CVEngine } from "../utils/cvEngine";
import { DocumentTracker } from "../utils/documentTracker";
import { CameraHelper } from "../utils/cameraHelper";
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

  // Search assistance & Thermal optimization refs
  const [showSearchHint, setShowSearchHint] = useState<boolean>(false);
  const searchStartTimeRef = useRef<number>(Date.now());
  const lastCvDetectTimeRef = useRef<number>(0);
  const lastTrackResultRef = useRef<any>(null);
  const lastDetectionRef = useRef<any>(null);

  // Document Tracker Instance
  const trackerRef = useRef<DocumentTracker>(new DocumentTracker());
  const isCapturingRef = useRef<boolean>(false);
  const currentScannerStateRef = useRef<ScannerState>("INITIALIZING");

  // Keep state ref synchronized for zero-latency frame loop checks
  useEffect(() => {
    currentScannerStateRef.current = scannerState;
  }, [scannerState]);

  // Start Camera Stream with Resilient Multi-Tier Fallback
  const startCamera = useCallback(async () => {
    setScannerState("INITIALIZING");
    setCameraError(null);

    try {
      if (videoRef.current && videoRef.current.srcObject) {
        CameraHelper.stopStream(videoRef.current.srcObject as MediaStream);
      }

      const res = await CameraHelper.acquireStream("environment");

      if (videoRef.current) {
        videoRef.current.srcObject = res.stream;
        await videoRef.current.play();
        setHasTorch(res.hasTorch);
      }

      setScannerState("SEARCHING");
      searchStartTimeRef.current = Date.now();
      setShowSearchHint(false);
      setGuidance("Đưa tài liệu vào khung hình");
    } catch (err: any) {
      console.warn("Camera access warning:", err?.message || err);
      const friendlyErr = CameraHelper.formatError(err);
      setCameraError(friendlyErr.message);
      setScannerState("INITIALIZING");
    }
  }, []);

  // Full restart for media sensor and CV tracker
  const restartCameraStream = useCallback(async () => {
    trackerRef.current.unlock();
    trackerRef.current.reset(0);
    lastCvDetectTimeRef.current = 0;
    lastTrackResultRef.current = null;
    lastDetectionRef.current = null;
    searchStartTimeRef.current = Date.now();
    setShowSearchHint(false);
    setDetectedQuad(null);
    setIsDetected(false);
    setSteadyCounter(0);
    setStabilityScore(0);
    setConfidenceScore(0);
    await startCamera();
  }, [startCamera]);

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
    lastCvDetectTimeRef.current = 0;
    lastTrackResultRef.current = null;
    lastDetectionRef.current = null;
    searchStartTimeRef.current = Date.now();
    setShowSearchHint(false);
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

  // Sound and Haptic feedback helper (Realistic, crisp mechanical shutter click sound)
  const triggerCaptureFeedback = () => {
    try {
      if (navigator.vibrate) {
        navigator.vibrate([60, 40, 90]);
      }
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        const audioCtx = new AudioCtxClass();
        const now = audioCtx.currentTime;

        // Snappy initial click (mechanical switch / leaf shutter release)
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.type = "sine";
        osc1.frequency.setValueAtTime(2400, now);
        osc1.frequency.exponentialRampToValueAtTime(320, now + 0.04);
        gain1.gain.setValueAtTime(0.4, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.start(now);
        osc1.stop(now + 0.04);

        // Crisp mechanical secondary click (aperture blade rebound)
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.type = "triangle";
        osc2.frequency.setValueAtTime(1800, now + 0.045);
        osc2.frequency.exponentialRampToValueAtTime(200, now + 0.09);
        gain2.gain.setValueAtTime(0.35, now + 0.045);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.start(now + 0.045);
        osc2.stop(now + 0.09);
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

      // Increased flash / shutter animation duration (doubled to 700ms for clear visual and tactile feedback)
      setTimeout(() => setIsFlashing(false), 700);

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
        trackerRef.current.unlock();
        trackerRef.current.reset(1200);
        lastCvDetectTimeRef.current = 0;
        searchStartTimeRef.current = Date.now();
        setShowSearchHint(false);
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
      trackerRef.current.unlock();
      trackerRef.current.reset(1000);
      lastCvDetectTimeRef.current = 0;
      searchStartTimeRef.current = Date.now();
      setShowSearchHint(false);
      setSteadyCounter(0);
      setGuidance("Đưa trang tiếp theo vào khung hình");
    }
  };

  // Discard current page and retake immediately (Fixed full reset of CV tracker)
  const handleRetakeCurrentPage = () => {
    setReviewingPage(null);
    setIsAdjustingCrop(false);
    isCapturingRef.current = false;
    setScannerState("SEARCHING");
    trackerRef.current.unlock();
    trackerRef.current.reset(0);
    lastCvDetectTimeRef.current = 0;
    lastTrackResultRef.current = null;
    lastDetectionRef.current = null;
    setDetectedQuad(null);
    setLatestQuality(null);
    setLatestCardSide(null);
    setSteadyCounter(0);
    setStabilityScore(0);
    setConfidenceScore(0);
    setIsDetected(false);
    searchStartTimeRef.current = Date.now();
    setShowSearchHint(false);
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

  // Real-time detection & 4-corner polygon tracking loop with Temporal Filter & Thermal Optimization
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
          const now = performance.now();
          const shouldRunDetection = (now - lastCvDetectTimeRef.current >= 85) || !lastTrackResultRef.current;

          let detection = lastDetectionRef.current;
          let trackResult = lastTrackResultRef.current;

          if (shouldRunDetection) {
            lastCvDetectTimeRef.current = now;

            // 1. Raw Edge & Contour Detection (Run at optimized ~11-12 FPS to eliminate overheating)
            detection = CVEngine.detectDocumentQuad(
              video,
              video.videoWidth,
              video.videoHeight,
              targetAspect
            );
            lastDetectionRef.current = detection;

            setLatestQuality(detection.quality || null);
            setLatestCardSide(detection.cardSide || null);

            // 2. Tracking & Temporal Smoothing via DocumentTracker
            trackResult = trackerRef.current.update(
              detection.isRealQuad ? detection.quad : null,
              detection.confidence,
              video.videoWidth,
              video.videoHeight,
              detection.quality,
              detection.cardSide,
              mode === "cccd" || mode === "driver_license" ? cardSide : undefined
            );
            lastTrackResultRef.current = trackResult;

            setIsDetected(trackResult.isDetected);
            setStabilityScore(trackResult.stabilityScore);
            setConfidenceScore(Math.round(trackResult.confidence * 100));
            setSteadyCounter(trackResult.stableFrames);

            // Long search hint logic (>7.5s without real detection)
            if (trackResult.isDetected) {
              searchStartTimeRef.current = Date.now();
              setShowSearchHint(false);
            } else {
              if (Date.now() - searchStartTimeRef.current > 7500) {
                setShowSearchHint(true);
              }
            }

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
          }

          if (trackResult) {
            // 3. Accurate coordinate mapping from video space to screen space considering CSS object-cover
            const vidW = video.videoWidth || 1280;
            const vidH = video.videoHeight || 720;
            const renderScale = Math.max(vw / vidW, vh / vidH);
            const renderW = vidW * renderScale;
            const renderH = vidH * renderScale;
            const offsetX = (vw - renderW) / 2;
            const offsetY = (vh - renderH) / 2;

            const mapToScreen = (pt: Point): Point => ({
              x: offsetX + pt.x * renderScale,
              y: offsetY + pt.y * renderScale,
            });

            let curScreen: QuadPoints;
            if (trackResult.smoothedQuad) {
              curScreen = {
                topLeft: mapToScreen(trackResult.smoothedQuad.topLeft),
                topRight: mapToScreen(trackResult.smoothedQuad.topRight),
                bottomRight: mapToScreen(trackResult.smoothedQuad.bottomRight),
                bottomLeft: mapToScreen(trackResult.smoothedQuad.bottomLeft),
              };
            } else {
              const defQ = CVEngine.getDefaultQuad(vidW, vidH, targetAspect);
              curScreen = {
                topLeft: mapToScreen(defQ.topLeft),
                topRight: mapToScreen(defQ.topRight),
                bottomRight: mapToScreen(defQ.bottomRight),
                bottomLeft: mapToScreen(defQ.bottomLeft),
              };
            }

            const p0 = curScreen.topLeft;
            const p1 = curScreen.topRight;
            const p2 = curScreen.bottomRight;
            const p3 = curScreen.bottomLeft;

            // 4. Render stabilized polygon overlay (Adobe Scan Style)
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.lineTo(p3.x, p3.y);
            ctx.closePath();

            const isReady = trackResult.isReadyForCapture;
            const isStabilizing = trackResult.isDetected && trackResult.stabilityScore >= 50;
            const isDetected = trackResult.isDetected;

            if (isReady) {
              ctx.strokeStyle = "#10b981"; // Emerald green
              ctx.lineWidth = 3.5;
              ctx.fillStyle = "rgba(16, 185, 129, 0.20)";
              ctx.shadowColor = "#10b981";
              ctx.shadowBlur = 16;
            } else if (isStabilizing) {
              ctx.strokeStyle = "#00d2ff"; // Adobe Scan Electric Cyan
              ctx.lineWidth = 3.0;
              ctx.fillStyle = "rgba(0, 210, 255, 0.12)";
              ctx.shadowColor = "#00d2ff";
              ctx.shadowBlur = 12;
            } else if (isDetected) {
              ctx.strokeStyle = "#3b82f6"; // Primary Blue
              ctx.lineWidth = 2.4;
              ctx.fillStyle = "rgba(59, 130, 246, 0.08)";
              ctx.shadowColor = "#3b82f6";
              ctx.shadowBlur = 8;
            } else {
              ctx.strokeStyle = "rgba(255, 255, 255, 0.40)";
              ctx.lineWidth = 1.6;
              ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
              ctx.setLineDash([8, 8]);
            }

            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 5. Draw Adobe Scan-style 4 Glowing Corner Pins with Expanding Pulse Radar
            const drawAdobeCorner = (pt: Point, angleDeg: number) => {
              ctx.save();
              ctx.translate(pt.x, pt.y);

              // 1. Expanding Outward Radar Pulse Wave
              const pulsePhase1 = ((now * 0.003) % 1); // 0 to 1
              const pulsePhase2 = (((now * 0.003) + 0.5) % 1);

              const radarColor = isReady
                ? "rgba(16, 185, 129, "
                : isStabilizing
                ? "rgba(0, 210, 255, "
                : isDetected
                ? "rgba(59, 130, 246, "
                : "rgba(255, 255, 255, ";

              // Primary Radar Wave
              ctx.beginPath();
              ctx.arc(0, 0, 8 + pulsePhase1 * 18, 0, Math.PI * 2);
              ctx.strokeStyle = radarColor + `${(1 - pulsePhase1) * 0.6})`;
              ctx.lineWidth = 1.8;
              ctx.stroke();

              // Secondary Radar Wave
              ctx.beginPath();
              ctx.arc(0, 0, 8 + pulsePhase2 * 18, 0, Math.PI * 2);
              ctx.strokeStyle = radarColor + `${(1 - pulsePhase2) * 0.4})`;
              ctx.lineWidth = 1.4;
              ctx.stroke();

              // Soft Glow Halo
              ctx.beginPath();
              ctx.arc(0, 0, 10, 0, Math.PI * 2);
              ctx.fillStyle = radarColor + "0.3)";
              ctx.fill();

              // Inner solid pin circle with crisp white border
              ctx.beginPath();
              ctx.arc(0, 0, isReady ? 6.5 : 5.5, 0, Math.PI * 2);
              ctx.fillStyle = isReady ? "#10b981" : isStabilizing ? "#00d2ff" : isDetected ? "#3b82f6" : "#ffffff";
              ctx.fill();
              ctx.lineWidth = 2;
              ctx.strokeStyle = "#ffffff";
              ctx.stroke();

              // Precision Corner Angle Bracket (Adobe Scan Crosshair L-Bracket)
              ctx.rotate((angleDeg * Math.PI) / 180);
              ctx.beginPath();
              ctx.moveTo(0, 26);
              ctx.lineTo(0, 0);
              ctx.lineTo(26, 0);
              ctx.strokeStyle = isReady ? "#10b981" : isStabilizing ? "#00d2ff" : isDetected ? "#60a5fa" : "#ffffff";
              ctx.lineWidth = 3.8;
              ctx.lineCap = "round";
              ctx.lineJoin = "round";
              ctx.stroke();

              ctx.restore();
            };

            drawAdobeCorner(p0, 0);
            drawAdobeCorner(p1, 90);
            drawAdobeCorner(p2, 180);
            drawAdobeCorner(p3, 270);

            setDetectedQuad(trackResult.smoothedQuad || (detection?.isRealQuad ? detection.quad : null));
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
      }

      animFrameId.current = requestAnimationFrame(processFrame);
    };

    animFrameId.current = requestAnimationFrame(processFrame);
    return () => {
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
    };
  }, [autoCapture, mode, cardSide, captureFrame]);

  // Process an image data URL (from gallery, clipboard, or sample)
  const processImageSource = useCallback((dataUrl: string) => {
    const img = new Image();
    img.onload = () => {
      const isCard = mode === "cccd" || mode === "driver_license";
      let selectedQuad: QuadPoints;

      if (isCard) {
        // For CCCD/GPLX: Crop centered ~70% region (15% margin on 4 sides) instead of 100% full frame
        const marginX = img.naturalWidth * 0.15;
        const marginY = img.naturalHeight * 0.15;
        selectedQuad = {
          topLeft: { x: marginX, y: marginY },
          topRight: { x: img.naturalWidth - marginX, y: marginY },
          bottomRight: { x: img.naturalWidth - marginX, y: img.naturalHeight - marginY },
          bottomLeft: { x: marginX, y: img.naturalHeight - marginY },
        };
      } else {
        // For Document: Full outer corners
        selectedQuad = {
          topLeft: { x: 0, y: 0 },
          topRight: { x: img.naturalWidth, y: 0 },
          bottomRight: { x: img.naturalWidth, y: img.naturalHeight },
          bottomLeft: { x: 0, y: img.naturalHeight },
        };
      }

      const warped = CVEngine.warpPerspective(img, selectedQuad);
      const processedCanvas = CVEngine.applyFilter(warped, "document", 0);
      const processedUrl = processedCanvas.toDataURL("image/jpeg", 0.92);
      const pHash = CVEngine.computePerceptualHashFromCanvas(warped);

      const newPage: ScannedPage = {
        id: `page_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        originalImage: dataUrl,
        processedImage: processedUrl,
        quad: selectedQuad,
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
  }, [mode, cardSide]);

  // Global paste handler for quick scanning
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
              const dataUrl = event.target?.result as string;
              if (dataUrl) processImageSource(dataUrl);
            };
            reader.readAsDataURL(file);
          }
          break;
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [processImageSource]);

  // Handle image import from device
  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    fileList.forEach((file: File) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        if (dataUrl) processImageSource(dataUrl);
      };
      reader.readAsDataURL(file);
    });

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Quick action to paste from clipboard via button
  const handlePasteFromClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imgType = item.types.find((t) => t.startsWith("image/"));
          if (imgType) {
            const blob = await item.getType(imgType);
            const reader = new FileReader();
            reader.onload = (ev) => {
              const dataUrl = ev.target?.result as string;
              if (dataUrl) processImageSource(dataUrl);
            };
            reader.readAsDataURL(blob);
            return;
          }
        }
      }
      alert("Không tìm thấy ảnh trong bộ nhớ tạm. Hãy chụp màn hình hoặc sao chép ảnh rồi bấm Dán.");
    } catch {
      alert("Hãy dùng phím tắt Ctrl+V (hoặc Cmd+V) để dán ảnh trực tiếp.");
    }
  };

  // Load sample document for testing
  const handleLoadSampleDocument = () => {
    const sampleUrl = CameraHelper.createSampleDocumentDataUrl();
    if (sampleUrl) {
      processImageSource(sampleUrl);
    }
  };

  const is2SidedCard = mode === "cccd" || mode === "driver_license";

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black text-white select-none h-screen min-h-screen w-full overflow-hidden">
      {/* Visual Shutter Flash Effect (Doubled duration for clear feedback) */}
      {isFlashing && (
        <div className="absolute inset-0 z-50 bg-white opacity-95 pointer-events-none transition-opacity duration-500" />
      )}

      {/* Duplicate Page / Side Warning Toast */}
      {duplicateWarning && (
        <div className="absolute top-16 inset-x-4 z-50 max-w-md mx-auto p-3 rounded-2xl bg-amber-600/95 text-white font-semibold text-xs shadow-2xl border border-amber-400 flex items-center gap-2.5 animate-bounce">
          <AlertCircle className="w-5 h-5 shrink-0 text-amber-200" />
          <span>{duplicateWarning}</span>
        </div>
      )}

      {/* Top Header Bar */}
      <div className="relative z-50 flex items-center justify-between px-4 pt-safe-top pb-3 bg-gradient-to-b from-black/95 via-black/70 to-transparent">
        {/* Back / Close Button */}
        <button
          id="btn-camera-close"
          onClick={onClose}
          className="min-w-[44px] min-h-[44px] flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-slate-900/90 backdrop-blur-md text-white hover:bg-slate-800 transition active:scale-95 border border-slate-700/60 shadow-lg"
          title="Quay lại màn hình chính"
          aria-label="Quay lại"
        >
          <ArrowLeft className="w-5 h-5 text-white" />
          <span className="text-xs font-semibold hidden xs:inline">Quay lại</span>
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

        {/* Adobe Scan Real-time Guidance Pill */}
        {scannerState !== "REVIEW" && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 max-w-[90vw]">
            <div
              className={`flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-xl border shadow-xl text-xs font-semibold transition-all duration-200 ${
                scannerState === "READY"
                  ? "bg-emerald-950/90 text-emerald-300 border-emerald-500/80 shadow-emerald-950/50 scale-105"
                  : scannerState === "STABILIZING"
                  ? "bg-cyan-950/90 text-cyan-300 border-cyan-500/70 shadow-cyan-950/50"
                  : isDetected
                  ? "bg-blue-950/90 text-blue-300 border-blue-500/60 shadow-blue-950/50"
                  : "bg-slate-950/85 text-slate-200 border-slate-700/60"
              }`}
            >
              {scannerState === "READY" ? (
                <Sparkles className="w-4 h-4 text-emerald-400 animate-spin" />
              ) : scannerState === "STABILIZING" ? (
                <div className="w-3.5 h-3.5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
              ) : isDetected ? (
                <Scan className="w-4 h-4 text-blue-400" />
              ) : (
                <ScanLine className="w-4 h-4 text-slate-400 animate-pulse" />
              )}
              <span className="truncate">
                {scannerState === "READY"
                  ? "Đang tự xử lý chụp ảnh..."
                  : scannerState === "STABILIZING" && autoCapture
                  ? `Giữ yên tĩnh để chụp (${Math.min(100, Math.round((steadyCounter / 5) * 100))}%)`
                  : isDetected
                  ? "Đã tìm thấy tài liệu • Giữ yên điện thoại"
                  : guidance || "Đang tìm kiếm tài liệu..."}
              </span>
            </div>
          </div>
        )}

        {/* 2-Sided Card Guide Watermark */}
        {is2SidedCard && scannerState !== "REVIEW" && (
          <div className="absolute top-28 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-950/85 backdrop-blur border border-indigo-700/60 text-xs font-semibold text-indigo-200 shadow-xl">
            <IdCard className="w-4 h-4 text-indigo-400" />
            <span>
              {cardSide === "front" ? "ĐANG CHỤP: MẶT TRƯỚC THẺ" : "ĐANG CHỤP: MẶT SAU THẺ"}
            </span>
          </div>
        )}

        {/* Subtle Assistant Alert Banner if detection takes too long */}
        {showSearchHint && scannerState !== "REVIEW" && !isDetected && (
          <div className="absolute bottom-6 inset-x-4 max-w-sm mx-auto z-20 p-3 rounded-2xl bg-slate-900/95 border border-slate-700/80 text-white shadow-2xl backdrop-blur-md flex flex-col gap-2 animate-fade-in">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-[11px] leading-relaxed text-slate-200">
                <span className="font-semibold text-amber-300">Chưa nhận diện được tài liệu?</span>
                <p className="text-slate-300 mt-0.5">
                  Đặt tài liệu trên mặt bàn tối có độ tương phản cao hoặc bấm nút chụp thủ công. Nếu camera bị đơ hoặc nhận diện chậm, hãy bấm làm mới máy ảnh.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowSearchHint(false)}
                className="px-2.5 py-1 text-[11px] font-medium text-slate-400 hover:text-slate-200"
              >
                Đã hiểu
              </button>
              <button
                type="button"
                onClick={restartCameraStream}
                className="flex items-center gap-1 px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold active:scale-95 transition"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Làm mới máy ảnh</span>
              </button>
            </div>
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
              <p className="text-sm text-slate-300 mb-5 leading-relaxed">{cameraError}</p>
              <div className="flex flex-col gap-2.5">
                <button
                  onClick={startCamera}
                  className="w-full min-h-[44px] flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold text-white transition active:scale-98 shadow-lg shadow-blue-600/30 text-sm"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Thử kết nối lại máy ảnh</span>
                </button>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full min-h-[44px] flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 font-semibold text-slate-200 transition active:scale-98 border border-slate-700 text-sm"
                >
                  <ImageIcon className="w-4 h-4 text-blue-400" />
                  <span>Chọn ảnh từ thiết bị</span>
                </button>

                <button
                  onClick={handlePasteFromClipboard}
                  className="w-full min-h-[44px] flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 font-semibold text-slate-200 transition active:scale-98 border border-slate-700 text-sm"
                >
                  <ClipboardPaste className="w-4 h-4 text-emerald-400" />
                  <span>Dán ảnh từ Clipboard (Ctrl+V)</span>
                </button>

                <button
                  onClick={handleLoadSampleDocument}
                  className="w-full min-h-[44px] flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 font-semibold text-emerald-300 transition active:scale-98 border border-emerald-500/40 text-sm"
                >
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <span>Thử quét tài liệu mẫu A4</span>
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

            {/* Main Shutter Button with Adobe Scan Circular Progress Countdown */}
            <button
              id="btn-camera-shutter"
              onClick={() => captureFrame()}
              disabled={scannerState === "CAPTURING"}
              className="relative w-20 h-20 sm:w-22 sm:h-22 rounded-full flex items-center justify-center shadow-2xl active:scale-95 transition-transform group"
              title={autoCapture ? "Tự động chụp khi giữ yên hoặc bấm để chụp ngay" : "Bấm để chụp ảnh"}
              aria-label="Chụp ảnh ngay"
            >
              {/* Outer SVG Auto-Capture Radial Progress Ring */}
              <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 88 88">
                {/* Background Track */}
                <circle
                  cx="44"
                  cy="44"
                  r="40"
                  fill="none"
                  stroke={autoCapture ? "rgba(255, 255, 255, 0.25)" : "rgba(255, 255, 255, 0.15)"}
                  strokeWidth="3.5"
                />
                {/* Active Filling Progress Arc */}
                {autoCapture && (
                  <circle
                    cx="44"
                    cy="44"
                    r="40"
                    fill="none"
                    stroke={scannerState === "READY" ? "#10b981" : "#00d2ff"}
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray="251.3"
                    strokeDashoffset={251.3 - (251.3 * Math.min(100, Math.max(0, (steadyCounter / 5) * 100))) / 100}
                    className="transition-all duration-100 ease-linear"
                  />
                )}
              </svg>

              {/* Inner Camera Shutter Circle */}
              <div
                className={`w-15 h-15 sm:w-16 sm:h-16 rounded-full flex items-center justify-center transition-all duration-200 ${
                  scannerState === "READY"
                    ? "bg-emerald-500 text-slate-950 scale-105 shadow-lg shadow-emerald-500/50"
                    : scannerState === "STABILIZING"
                    ? "bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/40"
                    : "bg-white text-slate-950 group-hover:bg-slate-100"
                }`}
              >
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
