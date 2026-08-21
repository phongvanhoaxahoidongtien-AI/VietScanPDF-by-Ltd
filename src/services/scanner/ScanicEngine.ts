import { scanDocument, extractDocument, ScannerResult } from "scanic";
import {
  IDocumentScannerEngine,
  ScannerEngineType,
  ScannerEngineConfig,
  EngineDetectionResult,
  EngineCaptureResult,
  EngineEventName,
} from "./types";
import { QuadPoints, Point } from "../../types";
import { DocumentTracker } from "../../utils/documentTracker";
import { CVEngine } from "../../utils/cvEngine";

export class ScanicEngine implements IDocumentScannerEngine {
  readonly engineType: ScannerEngineType = "scanic";
  readonly displayName = "Scanic WASM (High Speed)";

  private videoElement: HTMLVideoElement | null = null;
  private config: ScannerEngineConfig = {
    autoCapture: true,
    mode: "document",
    qualityPreset: "balanced",
    debug: false,
  };
  private listeners: Map<EngineEventName, Set<(payload: any) => void>> = new Map();
  private isRunning = false;
  private animFrameId: number | null = null;
  private tracker = new DocumentTracker();
  private sampleCanvas: HTMLCanvasElement = document.createElement("canvas");
  private sampleCtx: CanvasRenderingContext2D | null = null;
  private isProcessing = false;
  private lastProcessTime = 0;

  async initialize(video: HTMLVideoElement, config?: Partial<ScannerEngineConfig>): Promise<boolean> {
    this.videoElement = video;
    if (config) {
      this.config = { ...this.config, ...config };
    }
    this.sampleCtx = this.sampleCanvas.getContext("2d", { willReadFrequently: true });
    this.tracker = new DocumentTracker({
      historySize: 10,
      minConfidenceHigh: 0.15,
      minConfidenceLow: 0.08,
      minStabilityScoreForCapture: 30,
      requiredStableFrames: 4,
      maxCornerDriftRatio: 0.08,
    });
    return true;
  }

  async start(): Promise<void> {
    if (!this.videoElement) return;
    this.isRunning = true;
    this.emit("ready", { engine: this.engineType });
    this.loop();
  }

  private loop = (): void => {
    if (!this.isRunning) return;

    const now = performance.now();
    // Process every ~60ms (~16fps) to keep CPU cool and smooth
    if (!this.isProcessing && now - this.lastProcessTime >= 55) {
      this.processVideoFrame();
      this.lastProcessTime = now;
    }

    this.animFrameId = requestAnimationFrame(this.loop);
  };

  private async processVideoFrame(): Promise<void> {
    if (!this.videoElement || this.videoElement.readyState < 2 || !this.sampleCtx) return;

    const vw = this.videoElement.videoWidth;
    const vh = this.videoElement.videoHeight;
    if (vw === 0 || vh === 0) return;

    this.isProcessing = true;
    try {
      // Downscale to max ~480px for high-speed WASM detection
      const scale = Math.min(1, 480 / Math.max(vw, vh));
      const dw = Math.round(vw * scale);
      const dh = Math.round(vh * scale);

      this.sampleCanvas.width = dw;
      this.sampleCanvas.height = dh;
      this.sampleCtx.drawImage(this.videoElement, 0, 0, dw, dh);

      // Run scanic edge detection
      const res: ScannerResult = await scanDocument(this.sampleCanvas, {
        mode: "detect",
        useWasmFullCanny: true,
        applyDilation: true,
      });

      let rawQuad: QuadPoints | null = null;
      let isDetected = false;
      let confidence = 0;

      if (res && res.success && res.corners) {
        const inv = 1 / scale;
        rawQuad = {
          topLeft: { x: Math.round(res.corners.topLeft.x * inv), y: Math.round(res.corners.topLeft.y * inv) },
          topRight: { x: Math.round(res.corners.topRight.x * inv), y: Math.round(res.corners.topRight.y * inv) },
          bottomRight: { x: Math.round(res.corners.bottomRight.x * inv), y: Math.round(res.corners.bottomRight.y * inv) },
          bottomLeft: { x: Math.round(res.corners.bottomLeft.x * inv), y: Math.round(res.corners.bottomLeft.y * inv) },
        };
        isDetected = true;
        confidence = res.confidence || res.score || 0.75;
      }

      // Quality analysis
      const targetAspect = this.config.mode === "cccd" || this.config.mode === "driver_license" ? "card" : "document";
      const quality = CVEngine.checkDocumentQuality(
        this.sampleCanvas,
        rawQuad || CVEngine.getDefaultQuad(vw, vh, targetAspect),
        vw,
        vh,
        targetAspect
      );

      // Stability tracker
      const trackResult = this.tracker.update(
        rawQuad,
        confidence,
        vw,
        vh,
        quality,
        undefined,
        this.config.cardSide
      );

      const detectionResult: EngineDetectionResult = {
        quad: rawQuad,
        smoothedQuad: trackResult.smoothedQuad,
        isDetected: trackResult.isDetected,
        confidence: trackResult.confidence,
        stabilityScore: trackResult.stabilityScore,
        stableFrames: trackResult.stableFrames,
        isReadyForCapture: trackResult.isReadyForCapture,
        guidanceCode: (trackResult.quality?.guidanceCode as any) || (trackResult.isDetected ? "HOLD_STEADY" : "DOCUMENT_NOT_FOUND"),
        guidanceText: trackResult.guidance || "Đang tìm kiếm tài liệu...",
        quality: trackResult.quality,
        cardSide: trackResult.cardSide,
        engineUsed: "scanic",
      };

      this.emit("detection", detectionResult);
      this.emit("guidance", {
        guidanceCode: detectionResult.guidanceCode,
        guidanceText: detectionResult.guidanceText,
      });

      // Auto-capture trigger
      if (this.config.autoCapture && trackResult.isReadyForCapture) {
        this.tracker.setCooldown(4000);
        const captureRes = await this.captureManual();
        if (captureRes) {
          this.emit("capture", captureRes);
        }
      }
    } catch (err) {
      console.warn("[ScanicEngine] Frame processing error:", err);
    } finally {
      this.isProcessing = false;
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  async captureManual(): Promise<EngineCaptureResult | null> {
    if (!this.videoElement || this.videoElement.readyState < 2) return null;

    try {
      const vw = this.videoElement.videoWidth;
      const vh = this.videoElement.videoHeight;

      // Full resolution frame capture
      const fullCanvas = document.createElement("canvas");
      fullCanvas.width = vw;
      fullCanvas.height = vh;
      const ctx = fullCanvas.getContext("2d");
      if (!ctx) return null;

      ctx.drawImage(this.videoElement, 0, 0, vw, vh);
      const rawDataUrl = fullCanvas.toDataURL("image/jpeg", 0.95);

      const quad =
        this.tracker.getSmoothedQuad() ||
        CVEngine.getDefaultQuad(
          vw,
          vh,
          this.config.mode === "cccd" || this.config.mode === "driver_license" ? "card" : "document"
        );

      const warpedCanvas = CVEngine.warpPerspective(fullCanvas, quad);
      const warpedDataUrl = warpedCanvas.toDataURL("image/jpeg", 0.92);

      return {
        dataUrl: rawDataUrl,
        warpedDataUrl,
        width: warpedCanvas.width,
        height: warpedCanvas.height,
        quad,
        engineUsed: "scanic",
      };
    } catch (e) {
      console.error("[ScanicEngine] captureManual failed:", e);
      return null;
    }
  }

  updateConfig(config: Partial<ScannerEngineConfig>): void {
    this.config = { ...this.config, ...config };
  }

  on(event: EngineEventName, handler: (payload: any) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => {
      this.listeners.get(event)?.delete(handler);
    };
  }

  private emit(event: EngineEventName, payload: any): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((fn) => {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[ScanicEngine] Error in ${event} handler:`, err);
        }
      });
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
    this.listeners.clear();
  }
}
