import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  Camera,
  RotateCcw,
  RotateCw,
  Zap,
  ZapOff,
  Image as ImageIcon,
  Check,
  ArrowLeft,
  AlertCircle,
  FileText,
  CreditCard,
  RefreshCw,
  Crop,
  Trash2,
  Plus,
  CheckCircle2,
  Scan,
  Layers,
  Sparkles,
  X,
  ChevronRight,
  Maximize2,
  SlidersHorizontal,
  FolderOpen,
  CameraOff,
  HelpCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  ScanMode,
  QuadPoints,
  ScannedPage,
  FilterMode,
  Point,
} from "../types";
import { CVEngine } from "../utils/cvEngine";
import { CameraHelper } from "../utils/cameraHelper";
import { CropAdjuster } from "./CropAdjuster";

export type FrameRatioType = "a4_portrait" | "a4_landscape" | "card" | "free";
export type CaptureModeType = "single" | "batch";

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
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Camera & Device State
  const [isCameraReady, setIsCameraReady] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [isFlashing, setIsFlashing] = useState<boolean>(false);
  const [isStartingCamera, setIsStartingCamera] = useState<boolean>(true);

  // Guided Framing Settings
  const [frameRatio, setFrameRatio] = useState<FrameRatioType>(
    initialMode === "cccd" || initialMode === "driver_license"
      ? "card"
      : "a4_portrait"
  );
  const [guideRect, setGuideRect] = useState<{ x: number; y: number; width: number; height: number }>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  // Capture System Modes: Single Page vs. Continuous Batch
  const [captureMode, setCaptureMode] = useState<CaptureModeType>("single");

  // Single-Page Review State
  const [reviewPage, setReviewPage] = useState<ScannedPage | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterMode>("document");
  const [rotationDeg, setRotationDeg] = useState<number>(0);
  const [isAdjustingCrop, setIsAdjustingCrop] = useState<boolean>(false);

  // Batch-Mode State (Microsoft Lens Style)
  const [batchPages, setBatchPages] = useState<ScannedPage[]>([]);
  const [showBatchGallery, setShowBatchGallery] = useState<boolean>(false);
  const [selectedBatchIndex, setSelectedBatchIndex] = useState<number | null>(null);
  const [animatingThumb, setAnimatingThumb] = useState<string | null>(null);

  // Play synthetic camera shutter audio
  const playShutterSound = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(900, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch {
      // Audio context might be restricted before gesture
    }

    if (typeof navigator !== "undefined" && navigator.vibrate) {
      try {
        navigator.vibrate([35, 20, 35]);
      } catch {}
    }
  }, []);

  // Compute Guide Frame Dimensions on screen based on container size & selected ratio
  const updateGuideDimensions = useCallback(() => {
    if (!containerRef.current) return;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    if (cw === 0 || ch === 0) return;

    let targetRatio = 1 / 1.414; // Default A4 portrait (0.707)
    if (frameRatio === "a4_portrait") {
      targetRatio = 1 / 1.414;
    } else if (frameRatio === "a4_landscape") {
      targetRatio = 1.414 / 1;
    } else if (frameRatio === "card") {
      targetRatio = 85.6 / 53.98; // CCCD/GPLX ~1.586
    } else if (frameRatio === "free") {
      targetRatio = cw / ch;
    }

    let boxW = 0;
    let boxH = 0;

    if (targetRatio > 1) {
      // Landscape box (Cards, Landscape A4)
      boxW = Math.min(cw * 0.90, 680);
      boxH = boxW / targetRatio;
      if (boxH > ch * 0.80) {
        boxH = ch * 0.80;
        boxW = boxH * targetRatio;
      }
    } else {
      // Portrait box (A4 Portrait)
      boxH = Math.min(ch * 0.78, 850);
      boxW = boxH * targetRatio;
      if (boxW > cw * 0.90) {
        boxW = cw * 0.90;
        boxH = boxW / targetRatio;
      }
    }

    const startX = (cw - boxW) / 2;
    const startY = (ch - boxH) / 2;

    setGuideRect({
      x: Math.round(startX),
      y: Math.round(startY),
      width: Math.round(boxW),
      height: Math.round(boxH),
    });
  }, [frameRatio]);

  // Window resize & orientation change listener
  useEffect(() => {
    updateGuideDimensions();
    window.addEventListener("resize", updateGuideDimensions);
    window.addEventListener("orientationchange", updateGuideDimensions);
    return () => {
      window.removeEventListener("resize", updateGuideDimensions);
      window.removeEventListener("orientationchange", updateGuideDimensions);
    };
  }, [updateGuideDimensions]);

  // Initialize Camera Stream with rock-solid fallback
  const startCamera = useCallback(async (facing: "environment" | "user") => {
    setIsStartingCamera(true);
    setCameraError(null);
    setIsCameraReady(false);

    // Release old stream
    if (streamRef.current) {
      CameraHelper.stopStream(streamRef.current);
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    try {
      let stream: MediaStream | null = null;
      let torchAvailable = false;

      // Tier 1: Try exact environment (for real mobile back camera)
      if (facing === "environment") {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { exact: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          });
        } catch (eExact) {
          console.warn("Exact environment failed, falling back to ideal:", eExact);
        }
      }

      // Tier 2: Ideal facing mode
      if (!stream) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: facing },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          });
        } catch (eIdeal) {
          console.warn("Ideal facing failed, trying plain camera:", eIdeal);
        }
      }

      // Tier 3: Any available camera
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      streamRef.current = stream;

      // Check torch capability
      try {
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          const caps: any = (videoTrack as any).getCapabilities ? (videoTrack as any).getCapabilities() : {};
          torchAvailable = !!caps?.torch;
        }
      } catch {
        torchAvailable = false;
      }
      setHasTorch(torchAvailable);

      if (videoRef.current) {
        const video = videoRef.current;
        video.srcObject = stream;

        // Ensure video plays smoothly
        await new Promise<void>((resolve) => {
          if (video.readyState >= 2) {
            resolve();
          } else {
            video.onloadedmetadata = () => resolve();
          }
        });

        try {
          await video.play();
        } catch (playErr) {
          console.warn("Video play interrupted, retrying:", playErr);
        }

        setIsCameraReady(true);
        setIsStartingCamera(false);
        setTimeout(updateGuideDimensions, 100);
      }
    } catch (err: any) {
      console.error("Camera acquisition failed:", err);
      const friendlyErr = CameraHelper.formatError(err);
      setCameraError(friendlyErr.message);
      setIsStartingCamera(false);
      setIsCameraReady(false);
    }
  }, [updateGuideDimensions]);

  // Boot camera on mount
  useEffect(() => {
    startCamera(facingMode);
    return () => {
      if (streamRef.current) {
        CameraHelper.stopStream(streamRef.current);
        streamRef.current = null;
      }
    };
  }, [facingMode, startCamera]);

  // Toggle Torch / Flashlight
  const toggleTorch = async () => {
    if (!streamRef.current || !hasTorch) return;
    try {
      const track = streamRef.current.getVideoTracks()[0];
      if (track) {
        const newTorch = !torchOn;
        await (track as any).applyConstraints({
          advanced: [{ torch: newTorch }],
        });
        setTorchOn(newTorch);
      }
    } catch (e) {
      console.warn("Could not toggle torch:", e);
    }
  };

  // Switch between front and back camera
  const switchCamera = () => {
    setTorchOn(false);
    const nextFacing = facingMode === "environment" ? "user" : "environment";
    setFacingMode(nextFacing);
  };

  // Perform High Resolution Guided Frame Crop from Video Feed
  const captureGuidedFrame = useCallback(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container || video.readyState < 2) return null;

    const vw = video.videoWidth || 1920;
    const vh = video.videoHeight || 1080;
    const cw = container.clientWidth;
    const ch = container.clientHeight;

    if (cw === 0 || ch === 0 || guideRect.width === 0 || guideRect.height === 0) return null;

    // 1. Draw raw video snapshot to high-resolution canvas
    const rawCanvas = document.createElement("canvas");
    rawCanvas.width = vw;
    rawCanvas.height = vh;
    const rawCtx = rawCanvas.getContext("2d", { willReadFrequently: true });
    if (!rawCtx) return null;

    rawCtx.drawImage(video, 0, 0, vw, vh);
    const rawDataUrl = rawCanvas.toDataURL("image/jpeg", 0.95);

    // 2. Compute video coordinates under 'object-fit: cover'
    const videoAspect = vw / vh;
    const containerAspect = cw / ch;

    let renderedW = cw;
    let renderedH = ch;
    let offsetX = 0;
    let offsetY = 0;

    if (containerAspect > videoAspect) {
      // Container is wider -> top/bottom of video is cropped
      renderedW = cw;
      renderedH = cw / videoAspect;
      offsetY = (ch - renderedH) / 2;
    } else {
      // Container is taller -> left/right of video is cropped
      renderedH = ch;
      renderedW = ch * videoAspect;
      offsetX = (cw - renderedW) / 2;
    }

    const scale = vw / renderedW;
    const relX = guideRect.x - offsetX;
    const relY = guideRect.y - offsetY;

    const srcX = Math.max(0, Math.min(vw - 20, relX * scale));
    const srcY = Math.max(0, Math.min(vh - 20, relY * scale));
    const srcW = Math.max(20, Math.min(vw - srcX, guideRect.width * scale));
    const srcH = Math.max(20, Math.min(vh - srcY, guideRect.height * scale));

    // 3. Crop guided area
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = Math.round(srcW);
    cropCanvas.height = Math.round(srcH);
    const cropCtx = cropCanvas.getContext("2d", { willReadFrequently: true });
    if (!cropCtx) return null;

    cropCtx.drawImage(
      rawCanvas,
      srcX, srcY, srcW, srcH,
      0, 0, cropCanvas.width, cropCanvas.height
    );

    // 4. Apply initial document enhancement filter
    const enhancedCanvas = CVEngine.applyFilter(cropCanvas, "document", 0);
    const processedDataUrl = enhancedCanvas.toDataURL("image/jpeg", 0.92);

    const quad: QuadPoints = {
      topLeft: { x: srcX, y: srcY },
      topRight: { x: srcX + srcW, y: srcY },
      bottomRight: { x: srcX + srcW, y: srcY + srcH },
      bottomLeft: { x: srcX, y: srcY + srcH },
    };

    const newPage: ScannedPage = {
      id: `scan_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      originalImage: rawDataUrl,
      processedImage: processedDataUrl,
      quad,
      filter: "document",
      rotation: 0,
      width: cropCanvas.width,
      height: cropCanvas.height,
      createdAt: Date.now(),
    };

    return newPage;
  }, [guideRect]);

  // Handle Capture Action
  const handleCapture = () => {
    if (!isCameraReady || isStartingCamera) return;

    // Trigger visual flash & audio feedback
    setIsFlashing(true);
    playShutterSound();
    setTimeout(() => setIsFlashing(false), 200);

    const page = captureGuidedFrame();
    if (!page) return;

    if (captureMode === "single") {
      // Chế độ A: Chụp từng trang -> Hiển thị màn hình Preview xem lại ngay
      setReviewPage(page);
      setActiveFilter("document");
      setRotationDeg(0);
    } else {
      // Chế độ B: Chụp liên tục (Microsoft Lens style) -> Gom vào Stack góc trái
      setBatchPages((prev) => [...prev, page]);
      setAnimatingThumb(page.processedImage);
      setTimeout(() => setAnimatingThumb(null), 600);
    }
  };

  // Import photo from device library
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (!dataUrl) return;

      const img = new Image();
      img.onload = () => {
        const targetAspect = frameRatio === "card" ? "card" : "document";
        const defaultQuad = CVEngine.getDefaultQuad(img.naturalWidth, img.naturalHeight, targetAspect);
        const warpedCanvas = CVEngine.warpPerspective(img, defaultQuad);
        const enhancedCanvas = CVEngine.applyFilter(warpedCanvas, "document", 0);

        const page: ScannedPage = {
          id: `import_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          originalImage: dataUrl,
          processedImage: enhancedCanvas.toDataURL("image/jpeg", 0.92),
          quad: defaultQuad,
          filter: "document",
          rotation: 0,
          width: enhancedCanvas.width,
          height: enhancedCanvas.height,
          createdAt: Date.now(),
        };

        if (captureMode === "single") {
          setReviewPage(page);
          setActiveFilter("document");
          setRotationDeg(0);
        } else {
          setBatchPages((prev) => [...prev, page]);
          setAnimatingThumb(page.processedImage);
          setTimeout(() => setAnimatingThumb(null), 600);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // Re-apply filter and rotation on review page
  const updateReviewFilterAndRotation = (newFilter: FilterMode, newRotation: number) => {
    if (!reviewPage) return;
    setActiveFilter(newFilter);
    setRotationDeg(newRotation);

    const img = new Image();
    img.onload = () => {
      const warpedCanvas = CVEngine.warpPerspective(img, reviewPage.quad);
      const filteredCanvas = CVEngine.applyFilter(warpedCanvas, newFilter, newRotation);
      setReviewPage({
        ...reviewPage,
        filter: newFilter,
        rotation: newRotation,
        processedImage: filteredCanvas.toDataURL("image/jpeg", 0.92),
      });
    };
    img.src = reviewPage.originalImage;
  };

  // Apply Crop adjustments from CropAdjuster
  const handleCropComplete = (warpedCanvas: HTMLCanvasElement, adjustedQuad: QuadPoints) => {
    if (!reviewPage) return;
    const filteredCanvas = CVEngine.applyFilter(warpedCanvas, activeFilter, rotationDeg);
    setReviewPage({
      ...reviewPage,
      quad: adjustedQuad,
      width: filteredCanvas.width,
      height: filteredCanvas.height,
      processedImage: filteredCanvas.toDataURL("image/jpeg", 0.92),
    });
    setIsAdjustingCrop(false);
  };

  // Confirm Single-page usage
  const handleUseSinglePage = () => {
    if (!reviewPage) return;
    onCapturePage(reviewPage, true);
    onFinishedScanning();
  };

  // Retake single-page
  const handleRetakeSinglePage = () => {
    setReviewPage(null);
  };

  // Confirm & Save All Batch Pages
  const handleSaveAllBatchPages = () => {
    if (batchPages.length === 0) return;
    batchPages.forEach((pg, idx) => {
      const isLast = idx === batchPages.length - 1;
      onCapturePage(pg, isLast);
    });
    onFinishedScanning();
  };

  // Remove page in batch
  const handleRemoveBatchPage = (index: number) => {
    setBatchPages((prev) => prev.filter((_, idx) => idx !== index));
    if (selectedBatchIndex === index) {
      setSelectedBatchIndex(null);
    }
  };

  // Rotate page in batch
  const handleRotateBatchPage = (index: number) => {
    const page = batchPages[index];
    if (!page) return;
    const nextRot = ((page.rotation || 0) + 90) % 360;

    const img = new Image();
    img.onload = () => {
      const warpedCanvas = CVEngine.warpPerspective(img, page.quad);
      const filteredCanvas = CVEngine.applyFilter(warpedCanvas, page.filter || "document", nextRot);
      const updatedPage: ScannedPage = {
        ...page,
        rotation: nextRot,
        processedImage: filteredCanvas.toDataURL("image/jpeg", 0.92),
      };
      setBatchPages((prev) => prev.map((p, i) => (i === index ? updatedPage : p)));
    };
    img.src = page.originalImage;
  };

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 bg-black text-white select-none overflow-hidden flex flex-col font-sans"
    >
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImportFile}
        className="hidden"
      />

      {/* Screen Shutter Flash Effect */}
      <div
        className={`absolute inset-0 z-50 pointer-events-none bg-white transition-opacity duration-150 ${
          isFlashing ? "opacity-90" : "opacity-0"
        }`}
      />

      {/* MAIN CAMERA STREAM VIEW (When not in review mode) */}
      {!reviewPage && !showBatchGallery && (
        <div className="relative w-full h-full flex-1 flex flex-col justify-between overflow-hidden">
          {/* Background Live Video */}
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            // @ts-ignore
            webkit-playsinline="true"
            className="absolute inset-0 w-full h-full object-cover z-0"
          />

          {/* Fallback / Loading Overlay */}
          {(isStartingCamera || !isCameraReady) && !cameraError && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-sm">
              <div className="w-12 h-12 rounded-full border-3 border-blue-500 border-t-transparent animate-spin mb-4" />
              <p className="text-slate-200 text-sm font-medium">Đang khởi động Camera HD...</p>
              <p className="text-slate-400 text-xs mt-1">Độ nét cao • Căn chỉnh tức thì</p>
            </div>
          )}

          {/* Camera Error Message */}
          {cameraError && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 bg-slate-950 text-center">
              <div className="w-16 h-16 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center mb-4">
                <CameraOff className="w-8 h-8 text-red-400" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Không thể mở Camera</h3>
              <p className="text-sm text-slate-300 max-w-sm mb-6 leading-relaxed">
                {cameraError}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
                <button
                  onClick={() => startCamera(facingMode)}
                  className="flex-1 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 active:scale-95 transition-all"
                >
                  <RefreshCw className="w-4 h-4" />
                  Thử lại Camera
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium flex items-center justify-center gap-2 border border-slate-700 active:scale-95 transition-all"
                >
                  <FolderOpen className="w-4 h-4" />
                  Chọn từ máy
                </button>
              </div>
            </div>
          )}

          {/* Darkened Mask Overlay with Cutout Guided Frame */}
          {isCameraReady && guideRect.width > 0 && (
            <div className="absolute inset-0 z-10 pointer-events-none">
              <svg className="w-full h-full">
                <defs>
                  <mask id="guided-mask">
                    {/* White everywhere (darken) */}
                    <rect width="100%" height="100%" fill="white" />
                    {/* Black cutout inside the guide rect (transparent video shines through) */}
                    <rect
                      x={guideRect.x}
                      y={guideRect.y}
                      width={guideRect.width}
                      height={guideRect.height}
                      rx="14"
                      ry="14"
                      fill="black"
                    />
                  </mask>
                </defs>
                {/* Semi-transparent dark mask covering everything except the guide box */}
                <rect
                  width="100%"
                  height="100%"
                  fill="rgba(3, 7, 18, 0.65)"
                  mask="url(#guided-mask)"
                />
              </svg>

              {/* High-Precision Guide Box Highlight & Metal Corner Brackets */}
              <div
                style={{
                  left: `${guideRect.x}px`,
                  top: `${guideRect.y}px`,
                  width: `${guideRect.width}px`,
                  height: `${guideRect.height}px`,
                }}
                className="absolute pointer-events-none rounded-2xl border-2 border-blue-400/90 shadow-[0_0_25px_rgba(59,130,246,0.35)]"
              >
                {/* 4 Corner L-Brackets */}
                <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-emerald-400 rounded-tl-lg" />
                <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-emerald-400 rounded-tr-lg" />
                <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-emerald-400 rounded-bl-lg" />
                <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-emerald-400 rounded-br-lg" />

                {/* Subtle Rule of Thirds Guidelines */}
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-20 pointer-events-none">
                  <div className="border-r border-b border-white" />
                  <div className="border-r border-b border-white" />
                  <div className="border-b border-white" />
                  <div className="border-r border-b border-white" />
                  <div className="border-r border-b border-white" />
                  <div className="border-b border-white" />
                  <div className="border-r border-white" />
                  <div className="border-r border-white" />
                  <div />
                </div>

                {/* Center Crosshair Aim */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center opacity-40">
                  <div className="w-full h-[1px] bg-white" />
                  <div className="absolute h-full w-[1px] bg-white" />
                </div>
              </div>
            </div>
          )}

          {/* TOP BAR: Controls & Mode Switchers */}
          <div className="relative z-20 pt-3 px-4 pb-2 flex flex-col gap-2.5 bg-gradient-to-b from-black/90 via-black/50 to-transparent">
            <div className="flex items-center justify-between">
              {/* Back / Close Button */}
              <button
                onClick={onClose}
                className="w-10 h-10 rounded-full bg-slate-900/80 backdrop-blur border border-slate-700/60 flex items-center justify-center text-slate-200 active:scale-95 transition-all"
                title="Đóng Camera"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>

              {/* Capture Mode Toggle: Từng trang (Mặc định) vs Chụp liên tục */}
              <div className="flex items-center p-1 rounded-full bg-slate-950/85 backdrop-blur border border-slate-800 shadow-lg">
                <button
                  onClick={() => setCaptureMode("single")}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
                    captureMode === "single"
                      ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  Từng trang
                </button>
                <button
                  onClick={() => setCaptureMode("batch")}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
                    captureMode === "batch"
                      ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  Chụp liên tục
                  {batchPages.length > 0 && (
                    <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-emerald-500 text-[10px] font-bold text-white">
                      {batchPages.length}
                    </span>
                  )}
                </button>
              </div>

              {/* Torch & Camera Switch */}
              <div className="flex items-center gap-2">
                {hasTorch && (
                  <button
                    onClick={toggleTorch}
                    className={`w-10 h-10 rounded-full backdrop-blur border flex items-center justify-center active:scale-95 transition-all ${
                      torchOn
                        ? "bg-amber-400 text-slate-950 border-amber-300 shadow-lg shadow-amber-400/40"
                        : "bg-slate-900/80 text-slate-200 border-slate-700/60"
                    }`}
                    title="Bật/Tắt đèn Flash"
                  >
                    {torchOn ? <Zap className="w-5 h-5 fill-current" /> : <ZapOff className="w-5 h-5" />}
                  </button>
                )}
                <button
                  onClick={switchCamera}
                  className="w-10 h-10 rounded-full bg-slate-900/80 backdrop-blur border border-slate-700/60 flex items-center justify-center text-slate-200 active:scale-95 transition-all"
                  title="Đổi camera trước/sau"
                >
                  <RotateCcw className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Quick Frame Ratio Presets (A4 Dọc / A4 Ngang / CCCD) */}
            <div className="flex items-center justify-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar">
              <button
                onClick={() => setFrameRatio("a4_portrait")}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1 ${
                  frameRatio === "a4_portrait"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/60 shadow-sm"
                    : "bg-slate-900/60 text-slate-400 border border-slate-800 hover:text-slate-200"
                }`}
              >
                <div className="w-2.5 h-3.5 border border-current rounded-xs" />
                A4 Dọc
              </button>
              <button
                onClick={() => setFrameRatio("a4_landscape")}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1 ${
                  frameRatio === "a4_landscape"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/60 shadow-sm"
                    : "bg-slate-900/60 text-slate-400 border border-slate-800 hover:text-slate-200"
                }`}
              >
                <div className="w-3.5 h-2.5 border border-current rounded-xs" />
                A4 Ngang
              </button>
              <button
                onClick={() => setFrameRatio("card")}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1 ${
                  frameRatio === "card"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/60 shadow-sm"
                    : "bg-slate-900/60 text-slate-400 border border-slate-800 hover:text-slate-200"
                }`}
              >
                <CreditCard className="w-3 h-3" />
                CCCD / Bằng lái
              </button>
              <button
                onClick={() => setFrameRatio("free")}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1 ${
                  frameRatio === "free"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/60 shadow-sm"
                    : "bg-slate-900/60 text-slate-400 border border-slate-800 hover:text-slate-200"
                }`}
              >
                <Maximize2 className="w-3 h-3" />
                Toàn màn hình
              </button>
            </div>
          </div>

          {/* Floating Guidance Badge */}
          <div className="relative z-20 flex justify-center px-4 pointer-events-none">
            <div className="px-3.5 py-1.5 rounded-full bg-slate-950/85 backdrop-blur border border-slate-700/60 text-xs font-medium text-slate-200 shadow-lg flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              <span>Căn tài liệu gọn trong khung & bấm nút Chụp</span>
            </div>
          </div>

          {/* BOTTOM CONTROLS & SHUTTER BUTTON */}
          <div className="relative z-20 pb-8 pt-4 px-6 bg-gradient-to-t from-black/95 via-black/70 to-transparent flex items-center justify-between">
            {/* Left Slot: Gallery / Batch Stack or File Import */}
            <div className="w-16 flex items-center justify-center">
              {captureMode === "batch" && batchPages.length > 0 ? (
                <button
                  onClick={() => setShowBatchGallery(true)}
                  className="relative group p-1 active:scale-95 transition-all"
                  title="Xem các trang đã chụp"
                >
                  <div className="w-13 h-13 rounded-xl border-2 border-emerald-400 overflow-hidden shadow-lg shadow-emerald-500/30 bg-slate-900">
                    <img
                      src={batchPages[batchPages.length - 1].processedImage}
                      alt="Thumbnail"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {/* Badge Counter */}
                  <div className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded-full bg-emerald-500 text-white font-bold text-[11px] shadow">
                    {batchPages.length}
                  </div>
                </button>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center gap-1 text-slate-400 hover:text-white active:scale-95 transition-all"
                  title="Chọn ảnh từ thư viện"
                >
                  <div className="w-11 h-11 rounded-full bg-slate-900/80 border border-slate-700/60 flex items-center justify-center">
                    <ImageIcon className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-medium">Thư viện</span>
                </button>
              )}
            </div>

            {/* Center Slot: Large Shutter Button */}
            <div className="flex flex-col items-center">
              <button
                onClick={handleCapture}
                disabled={!isCameraReady || isStartingCamera}
                className={`relative w-20 h-20 rounded-full border-4 border-white flex items-center justify-center active:scale-90 transition-all shadow-[0_0_30px_rgba(255,255,255,0.25)] ${
                  !isCameraReady ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                }`}
                title="Bấm để chụp ảnh"
              >
                <div className="w-16 h-16 rounded-full bg-white transition-transform duration-100 hover:scale-95 active:scale-90" />
              </button>
            </div>

            {/* Right Slot: Finish Batch or Reset Stream */}
            <div className="w-16 flex items-center justify-center">
              {captureMode === "batch" && batchPages.length > 0 ? (
                <button
                  onClick={() => setShowBatchGallery(true)}
                  className="flex flex-col items-center gap-1 text-emerald-400 hover:text-emerald-300 active:scale-95 transition-all"
                >
                  <div className="w-11 h-11 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                    <Check className="w-6 h-6 stroke-[3]" />
                  </div>
                  <span className="text-[10px] font-bold">Xong ({batchPages.length})</span>
                </button>
              ) : (
                <button
                  onClick={() => startCamera(facingMode)}
                  className="flex flex-col items-center gap-1 text-slate-400 hover:text-white active:scale-95 transition-all"
                  title="Làm mới camera"
                >
                  <div className="w-11 h-11 rounded-full bg-slate-900/80 border border-slate-700/60 flex items-center justify-center">
                    <RefreshCw className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-medium">Làm mới</span>
                </button>
              )}
            </div>
          </div>

          {/* Flying Thumbnail Animation into Stack (Batch Mode) */}
          <AnimatePresence>
            {animatingThumb && (
              <motion.div
                initial={{ scale: 1, opacity: 1, x: "0%", y: "0%" }}
                animate={{ scale: 0.15, opacity: 0.7, x: "-42vw", y: "38vh" }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, ease: "easeInOut" }}
                className="absolute inset-0 pointer-events-none z-40 flex items-center justify-center"
              >
                <div className="w-64 h-80 rounded-2xl overflow-hidden shadow-2xl border-2 border-emerald-400">
                  <img src={animatingThumb} alt="Flying Thumb" className="w-full h-full object-cover" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* SINGLE-PAGE REVIEW SCREEN (Chế độ A) */}
      {reviewPage && !isAdjustingCrop && (
        <div className="relative w-full h-full flex flex-col justify-between bg-slate-950 z-30">
          {/* Top Bar */}
          <div className="pt-4 px-4 pb-3 flex items-center justify-between border-b border-slate-800/80 bg-slate-900/60 backdrop-blur">
            <button
              onClick={handleRetakeSinglePage}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-medium hover:bg-slate-700 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Chụp lại
            </button>
            <span className="text-sm font-semibold text-white">Xem trước & Bộ lọc</span>
            <button
              onClick={() => setIsAdjustingCrop(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/40 text-blue-400 text-xs font-medium hover:bg-blue-600/30 transition-colors"
            >
              <Crop className="w-4 h-4" />
              Cắt 4 góc
            </button>
          </div>

          {/* Main Image Preview */}
          <div className="flex-1 p-4 flex items-center justify-center overflow-hidden">
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="max-h-[62vh] max-w-[90vw] rounded-xl overflow-hidden shadow-2xl border border-slate-700 bg-white"
            >
              <img
                src={reviewPage.processedImage}
                alt="Scanned Preview"
                className="max-h-[62vh] w-auto object-contain"
              />
            </motion.div>
          </div>

          {/* Quick Filters & Rotation Controls */}
          <div className="px-4 py-3 bg-slate-900/90 border-t border-slate-800 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">Bộ lọc màu:</span>
              <button
                onClick={() => updateReviewFilterAndRotation(activeFilter, (rotationDeg + 90) % 360)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
              >
                <RotateCw className="w-3.5 h-3.5" />
                Xoay 90°
              </button>
            </div>

            {/* Filter Pills */}
            <div className="grid grid-cols-4 gap-2">
              <button
                onClick={() => updateReviewFilterAndRotation("document", rotationDeg)}
                className={`py-2 px-1 rounded-xl text-xs font-medium transition-all text-center ${
                  activeFilter === "document"
                    ? "bg-blue-600 text-white font-semibold shadow-lg shadow-blue-600/30"
                    : "bg-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                Văn bản
              </button>
              <button
                onClick={() => updateReviewFilterAndRotation("bw", rotationDeg)}
                className={`py-2 px-1 rounded-xl text-xs font-medium transition-all text-center ${
                  activeFilter === "bw"
                    ? "bg-blue-600 text-white font-semibold shadow-lg shadow-blue-600/30"
                    : "bg-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                Trắng đen
              </button>
              <button
                onClick={() => updateReviewFilterAndRotation("magic", rotationDeg)}
                className={`py-2 px-1 rounded-xl text-xs font-medium transition-all text-center ${
                  activeFilter === "magic"
                    ? "bg-blue-600 text-white font-semibold shadow-lg shadow-blue-600/30"
                    : "bg-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                Màu sắc
              </button>
              <button
                onClick={() => updateReviewFilterAndRotation("original", rotationDeg)}
                className={`py-2 px-1 rounded-xl text-xs font-medium transition-all text-center ${
                  activeFilter === "original"
                    ? "bg-blue-600 text-white font-semibold shadow-lg shadow-blue-600/30"
                    : "bg-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                Ảnh gốc
              </button>
            </div>

            {/* Bottom Actions: Chụp lại vs Sử dụng ảnh này */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={handleRetakeSinglePage}
                className="py-3.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm flex items-center justify-center gap-2 border border-slate-700 active:scale-95 transition-all"
              >
                <RotateCcw className="w-4 h-4" />
                Chụp lại
              </button>
              <button
                onClick={handleUseSinglePage}
                className="py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 active:scale-95 transition-all"
              >
                <Check className="w-5 h-5 stroke-[2.5]" />
                Sử dụng ảnh này
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CROP ADJUSTER SCREEN */}
      {reviewPage && isAdjustingCrop && (
        <CropAdjuster
          imageSrc={reviewPage.originalImage}
          initialQuad={reviewPage.quad}
          aspectMode={frameRatio === "card" ? "card" : "document"}
          onComplete={handleCropComplete}
          onCancel={() => setIsAdjustingCrop(false)}
        />
      )}

      {/* BATCH GALLERY MODAL (Chế độ B: Quản lý nhiều trang - Microsoft Lens Style) */}
      {showBatchGallery && (
        <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col justify-between">
          {/* Header */}
          <div className="pt-4 px-4 pb-3 flex items-center justify-between border-b border-slate-800 bg-slate-900/80 backdrop-blur">
            <button
              onClick={() => setShowBatchGallery(false)}
              className="flex items-center gap-1 text-slate-300 hover:text-white text-sm font-medium"
            >
              <ArrowLeft className="w-5 h-5" />
              Tiếp tục chụp
            </button>
            <span className="text-sm font-bold text-white">
              Đã chụp {batchPages.length} trang
            </span>
            <button
              onClick={() => setBatchPages([])}
              disabled={batchPages.length === 0}
              className="text-red-400 hover:text-red-300 text-xs font-medium disabled:opacity-30"
            >
              Xóa tất cả
            </button>
          </div>

          {/* Grid of Pages */}
          <div className="flex-1 p-4 overflow-y-auto">
            {batchPages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-slate-400">
                <Layers className="w-12 h-12 mb-2 opacity-40 text-slate-500" />
                <p className="text-sm">Chưa có trang nào trong danh sách</p>
                <button
                  onClick={() => setShowBatchGallery(false)}
                  className="mt-4 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-medium"
                >
                  Quay lại chụp ngay
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {batchPages.map((page, index) => (
                  <div
                    key={page.id || index}
                    className="relative group rounded-xl overflow-hidden border border-slate-800 bg-slate-900 shadow-md flex flex-col"
                  >
                    {/* Thumbnail */}
                    <div className="aspect-[3/4] w-full bg-white overflow-hidden relative">
                      <img
                        src={page.processedImage}
                        alt={`Trang ${index + 1}`}
                        className="w-full h-full object-contain"
                      />
                      {/* Page Number Badge */}
                      <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-slate-950/80 backdrop-blur text-white text-[11px] font-bold">
                        Trang {index + 1}
                      </div>
                    </div>

                    {/* Card Actions */}
                    <div className="p-2 flex items-center justify-between bg-slate-900 border-t border-slate-800">
                      <button
                        onClick={() => handleRotateBatchPage(index)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                        title="Xoay 90°"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRemoveBatchPage(index)}
                        className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs"
                        title="Xóa trang này"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bottom Actions for Batch Mode */}
          <div className="p-4 bg-slate-900 border-t border-slate-800 flex items-center gap-3">
            <button
              onClick={() => setShowBatchGallery(false)}
              className="flex-1 py-3.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm flex items-center justify-center gap-2 border border-slate-700 active:scale-95 transition-all"
            >
              <Plus className="w-4 h-4" />
              Chụp thêm trang
            </button>
            <button
              onClick={handleSaveAllBatchPages}
              disabled={batchPages.length === 0}
              className="flex-1 py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 disabled:opacity-40 active:scale-95 transition-all"
            >
              <Check className="w-5 h-5 stroke-[2.5]" />
              Hoàn tất ({batchPages.length} trang)
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
