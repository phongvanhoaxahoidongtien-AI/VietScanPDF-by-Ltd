import {
  createScanner,
  ScannerSession,
  ScannerConfig,
  CaptureResult as SdkCaptureResult,
} from "js-document-autocapture";
import {
  IDocumentScannerEngine,
  ScannerEngineType,
  ScannerEngineConfig,
  EngineDetectionResult,
  EngineCaptureResult,
  EngineGuidanceCode,
  EngineEventName,
} from "./types";
import { QuadPoints, Point } from "../../types";

type SdkGuidanceCode =
  | "DOCUMENT_NOT_FOUND"
  | "TOO_DARK_OR_BRIGHT"
  | "REDUCE_GLARE"
  | "TOO_BLURRY"
  | "HOLD_STEADY"
  | "MOVE_CLOSER"
  | "READY";

const GUIDANCE_MAP: Record<SdkGuidanceCode, { code: EngineGuidanceCode; text: string }> = {
  DOCUMENT_NOT_FOUND: {
    code: "DOCUMENT_NOT_FOUND",
    text: "Đang tìm kiếm tài liệu...",
  },
  TOO_DARK_OR_BRIGHT: {
    code: "TOO_DARK_OR_BRIGHT",
    text: "Điều chỉnh ánh sáng tài liệu",
  },
  REDUCE_GLARE: {
    code: "REDUCE_GLARE",
    text: "Nghiêng máy nhẹ tránh bóng lóa",
  },
  TOO_BLURRY: {
    code: "TOO_BLURRY",
    text: "Giữ điện thoại ổn định để lấy nét",
  },
  HOLD_STEADY: {
    code: "HOLD_STEADY",
    text: "Giữ yên tĩnh để chụp...",
  },
  MOVE_CLOSER: {
    code: "MOVE_CLOSER",
    text: "Đưa máy lại gần tài liệu hơn",
  },
  READY: {
    code: "READY",
    text: "Đang tự xử lý chụp ảnh...",
  },
};

export class AutocaptureEngine implements IDocumentScannerEngine {
  readonly engineType: ScannerEngineType = "autocapture";
  readonly displayName = "ML AutoCapture (Adobe-grade)";

  private scannerSession: ScannerSession | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private config: ScannerEngineConfig = {
    autoCapture: true,
    mode: "document",
    qualityPreset: "balanced",
    debug: false,
  };
  private listeners: Map<EngineEventName, Set<(payload: any) => void>> = new Map();
  private unsubs: Array<() => void> = [];
  private isRunning = false;
  private lastSmoothedQuad: QuadPoints | null = null;
  private consecutiveStableFrames = 0;

  async initialize(video: HTMLVideoElement, config?: Partial<ScannerEngineConfig>): Promise<boolean> {
    this.videoElement = video;
    if (config) {
      this.config = { ...this.config, ...config };
    }

    try {
      // Configure js-document-autocapture session
      const sdkConfig: Partial<ScannerConfig> = {
        videoElement: video,
        autoCapture: this.config.autoCapture,
        detection: "auto", // ML-first + OpenCV fallback + COCO-SSD
        quality: this.config.qualityPreset,
        webglWarp: true,
        cocoSsd: true,
        mlFallback: true,
        postCaptureRefine: true,
        maxCaptures: undefined, // unlimited captures
        debug: this.config.debug || false,
        autoCaptureCooldownMs: 3000,
        autoCaptureConsecutiveStableFrames: 4,
      };

      this.scannerSession = createScanner(sdkConfig);
      this.attachSdkEventListeners();
      return true;
    } catch (err) {
      console.warn("[AutocaptureEngine] Failed to initialize js-document-autocapture:", err);
      this.emit("warning", { message: "Không thể khởi chạy engine ML. Đang chuyển sang engine dự phòng..." });
      return false;
    }
  }

  private attachSdkEventListeners(): void {
    if (!this.scannerSession) return;

    // 1. Detection Event
    const unDetection = this.scannerSession.on("detection", (det: any) => {
      const isDetected = det.status === "found" && !!det.bestCandidate;
      let rawQuad: QuadPoints | null = null;

      if (isDetected && det.bestCandidate) {
        const q = det.bestCandidate.quad;
        rawQuad = {
          topLeft: { x: q.topLeft.x, y: q.topLeft.y },
          topRight: { x: q.topRight.x, y: q.topRight.y },
          bottomRight: { x: q.bottomRight.x, y: q.bottomRight.y },
          bottomLeft: { x: q.bottomLeft.x, y: q.bottomLeft.y },
        };
      }

      const detectionResult: Partial<EngineDetectionResult> = {
        quad: rawQuad,
        isDetected,
        confidence: det.bestCandidate?.confidence || det.bestCandidate?.score || 0,
        engineUsed: "autocapture",
      };

      this.emit("detection", detectionResult);
    });
    this.unsubs.push(unDetection);

    // 2. Stability Event
    const unStability = this.scannerSession.on("stability", (stab: any) => {
      let smoothedQuad: QuadPoints | null = null;
      if (stab.smoothedQuad) {
        const sq = stab.smoothedQuad;
        smoothedQuad = {
          topLeft: { x: sq.topLeft.x, y: sq.topLeft.y },
          topRight: { x: sq.topRight.x, y: sq.topRight.y },
          bottomRight: { x: sq.bottomRight.x, y: sq.bottomRight.y },
          bottomLeft: { x: sq.bottomLeft.x, y: sq.bottomLeft.y },
        };
        this.lastSmoothedQuad = smoothedQuad;
      }

      if (stab.stable) {
        this.consecutiveStableFrames++;
      } else {
        this.consecutiveStableFrames = Math.max(0, this.consecutiveStableFrames - 1);
      }

      const stabilityScore = Math.min(
        100,
        Math.round(stab.confidenceAccumulation * 100 || (stab.stable ? 85 : 30))
      );

      this.emit("detection", {
        smoothedQuad: smoothedQuad || this.lastSmoothedQuad,
        stabilityScore,
        stableFrames: this.consecutiveStableFrames,
        isReadyForCapture: stab.stable && this.consecutiveStableFrames >= 3,
        engineUsed: "autocapture",
      });
    });
    this.unsubs.push(unStability);

    // 3. Guidance Event
    const unGuidance = this.scannerSession.on("guidance", (code: SdkGuidanceCode) => {
      const mapped = GUIDANCE_MAP[code] || {
        code: "DOCUMENT_NOT_FOUND",
        text: "Đang tìm kiếm tài liệu...",
      };

      let guidanceText = mapped.text;
      if (code === "HOLD_STEADY" && this.consecutiveStableFrames > 0) {
        const pct = Math.min(100, Math.round((this.consecutiveStableFrames / 4) * 100));
        guidanceText = `Giữ yên tĩnh để chụp (${pct}%)...`;
      }

      this.emit("guidance", {
        guidanceCode: mapped.code,
        guidanceText,
      });
    });
    this.unsubs.push(unGuidance);

    // 4. Capture Event
    const unCapture = this.scannerSession.on("capture", async (cap: SdkCaptureResult) => {
      try {
        const dataUrl = await this.blobToDataUrl(cap.blob);
        const quad: QuadPoints = {
          topLeft: { x: cap.quad.topLeft.x, y: cap.quad.topLeft.y },
          topRight: { x: cap.quad.topRight.x, y: cap.quad.topRight.y },
          bottomRight: { x: cap.quad.bottomRight.x, y: cap.quad.bottomRight.y },
          bottomLeft: { x: cap.quad.bottomLeft.x, y: cap.quad.bottomLeft.y },
        };

        const result: EngineCaptureResult = {
          blob: cap.blob,
          dataUrl,
          width: cap.width,
          height: cap.height,
          quad,
          warpedDataUrl: dataUrl,
          engineUsed: "autocapture",
        };

        this.emit("capture", result);
      } catch (e) {
        console.error("[AutocaptureEngine] Error handling capture blob:", e);
      }
    });
    this.unsubs.push(unCapture);

    // 5. Error Event
    const unError = this.scannerSession.on("error", (err: Error) => {
      console.warn("[AutocaptureEngine] SDK Error:", err);
      this.emit("error", err);
    });
    this.unsubs.push(unError);

    // 6. Warning Event
    const unWarning = this.scannerSession.on("warning", (warn: string) => {
      this.emit("warning", { message: warn });
    });
    this.unsubs.push(unWarning);
  }

  async start(): Promise<void> {
    if (!this.scannerSession) return;
    try {
      await this.scannerSession.start();
      this.isRunning = true;
      this.emit("ready", { engine: this.engineType });
    } catch (e) {
      console.error("[AutocaptureEngine] Error starting session:", e);
      throw e;
    }
  }

  async stop(): Promise<void> {
    if (!this.scannerSession) return;
    try {
      await this.scannerSession.stop();
      this.isRunning = false;
    } catch (e) {
      console.warn("[AutocaptureEngine] Error stopping session:", e);
    }
  }

  async captureManual(): Promise<EngineCaptureResult | null> {
    if (!this.scannerSession) return null;
    try {
      const cap = await this.scannerSession.captureManual();
      const dataUrl = await this.blobToDataUrl(cap.blob);
      const quad: QuadPoints = {
        topLeft: { x: cap.quad.topLeft.x, y: cap.quad.topLeft.y },
        topRight: { x: cap.quad.topRight.x, y: cap.quad.topRight.y },
        bottomRight: { x: cap.quad.bottomRight.x, y: cap.quad.bottomRight.y },
        bottomLeft: { x: cap.quad.bottomLeft.x, y: cap.quad.bottomLeft.y },
      };

      return {
        blob: cap.blob,
        dataUrl,
        width: cap.width,
        height: cap.height,
        quad,
        warpedDataUrl: dataUrl,
        engineUsed: "autocapture",
      };
    } catch (e) {
      console.error("[AutocaptureEngine] captureManual failed:", e);
      return null;
    }
  }

  updateConfig(config: Partial<ScannerEngineConfig>): void {
    this.config = { ...this.config, ...config };
    if (this.scannerSession) {
      this.scannerSession.updateConfig({
        autoCapture: this.config.autoCapture,
        quality: this.config.qualityPreset,
      });
    }
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
          console.error(`[AutocaptureEngine] Error in ${event} handler:`, err);
        }
      });
    }
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async destroy(): Promise<void> {
    this.unsubs.forEach((un) => un());
    this.unsubs = [];
    if (this.scannerSession) {
      try {
        await this.scannerSession.destroy();
      } catch (e) {
        // ignore
      }
      this.scannerSession = null;
    }
    this.listeners.clear();
  }
}
