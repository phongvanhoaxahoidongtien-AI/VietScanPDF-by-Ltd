import {
  IDocumentScannerEngine,
  ScannerEngineType,
  ScannerEngineConfig,
  EngineCapabilities,
  EngineEventName,
  EngineDetectionResult,
  EngineCaptureResult,
} from "./types";
import { AutocaptureEngine } from "./AutocaptureEngine";
import { ScanicEngine } from "./ScanicEngine";
import { JscanifyEngine } from "./JscanifyEngine";

export class ScannerEngineManager {
  private activeEngine: IDocumentScannerEngine | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private currentConfig: ScannerEngineConfig = {
    autoCapture: false,
    mode: "document",
    qualityPreset: "balanced",
    debug: false,
  };
  private preferredEngineType: ScannerEngineType | "auto" = "auto";
  private listeners: Map<EngineEventName, Set<(payload: any) => void>> = new Map();
  private unsubs: Array<() => void> = [];
  private capabilities: EngineCapabilities | null = null;
  private fallbackChain: ScannerEngineType[] = ["autocapture", "scanic", "jscanify"];
  private currentChainIndex = 0;

  async detectCapabilities(): Promise<EngineCapabilities> {
    if (this.capabilities) return this.capabilities;

    let webglSupported = false;
    try {
      const canvas = document.createElement("canvas");
      webglSupported = !!(
        window.WebGLRenderingContext &&
        (canvas.getContext("webgl") || canvas.getContext("experimental-webgl") || canvas.getContext("webgl2"))
      );
    } catch {
      webglSupported = false;
    }

    const workerSupported = typeof Worker !== "undefined";
    const offscreenCanvasSupported = typeof OffscreenCanvas !== "undefined";
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const mlSupported = webglSupported && workerSupported;

    // Pick recommended
    let recommendedEngine: ScannerEngineType = "autocapture";
    if (!webglSupported || !workerSupported) {
      recommendedEngine = "jscanify";
    }

    this.capabilities = {
      webglSupported,
      workerSupported,
      offscreenCanvasSupported,
      mlSupported,
      recommendedEngine,
    };

    return this.capabilities;
  }

  async initialize(
    video: HTMLVideoElement,
    config?: Partial<ScannerEngineConfig>,
    preferredEngine: ScannerEngineType | "auto" = "auto"
  ): Promise<boolean> {
    this.videoElement = video;
    this.preferredEngineType = preferredEngine;
    if (config) {
      this.currentConfig = { ...this.currentConfig, ...config };
    }

    const caps = await this.detectCapabilities();

    if (preferredEngine !== "auto") {
      this.fallbackChain = [preferredEngine, "scanic", "jscanify"].filter(
        (val, idx, self) => self.indexOf(val) === idx
      ) as ScannerEngineType[];
    } else {
      this.fallbackChain = ["autocapture", "scanic", "jscanify"];
    }

    this.currentChainIndex = 0;
    return await this.tryBootEngineAtIndex(0);
  }

  private async tryBootEngineAtIndex(index: number): Promise<boolean> {
    if (index >= this.fallbackChain.length) {
      console.error("[ScannerEngineManager] All engines failed in fallback chain!");
      this.emit("error", new Error("Không thể khởi động bất kỳ engine nhận diện nào."));
      return false;
    }

    const targetType = this.fallbackChain[index];
    this.currentChainIndex = index;

    // Clean up current engine
    if (this.activeEngine) {
      this.unsubs.forEach((u) => u());
      this.unsubs = [];
      await this.activeEngine.destroy();
      this.activeEngine = null;
    }

    let engine: IDocumentScannerEngine;
    if (targetType === "autocapture") {
      engine = new AutocaptureEngine();
    } else if (targetType === "scanic") {
      engine = new ScanicEngine();
    } else {
      engine = new JscanifyEngine();
    }

    if (!this.videoElement) return false;

    console.log(`[ScannerEngineManager] Initializing engine: ${engine.displayName} (${targetType})...`);

    try {
      const ok = await engine.initialize(this.videoElement, this.currentConfig);
      if (!ok) {
        throw new Error(`Engine ${targetType} returned false on initialize`);
      }

      this.activeEngine = engine;
      this.bindActiveEngineEvents();
      this.emit("fallback", {
        engine: targetType,
        displayName: engine.displayName,
        isFallback: index > 0,
      });

      return true;
    } catch (err) {
      console.warn(`[ScannerEngineManager] Engine ${targetType} failed. Trying next fallback...`, err);
      return await this.tryBootEngineAtIndex(index + 1);
    }
  }

  private bindActiveEngineEvents(): void {
    if (!this.activeEngine) return;

    this.unsubs.forEach((u) => u());
    this.unsubs = [];

    const unDet = this.activeEngine.on("detection", (res: EngineDetectionResult) => {
      this.emit("detection", res);
    });
    this.unsubs.push(unDet);

    const unGuidance = this.activeEngine.on("guidance", (res: any) => {
      this.emit("guidance", res);
    });
    this.unsubs.push(unGuidance);

    const unCap = this.activeEngine.on("capture", (res: EngineCaptureResult) => {
      this.emit("capture", res);
    });
    this.unsubs.push(unCap);

    const unWarn = this.activeEngine.on("warning", (res: any) => {
      this.emit("warning", res);
    });
    this.unsubs.push(unWarn);

    const unErr = this.activeEngine.on("error", async (err: any) => {
      console.warn("[ScannerEngineManager] Active engine encountered error. Falling back...", err);
      await this.tryBootEngineAtIndex(this.currentChainIndex + 1);
    });
    this.unsubs.push(unErr);
  }

  async start(): Promise<void> {
    if (this.activeEngine) {
      await this.activeEngine.start();
    }
  }

  async stop(): Promise<void> {
    if (this.activeEngine) {
      await this.activeEngine.stop();
    }
  }

  async captureManual(): Promise<EngineCaptureResult | null> {
    if (this.activeEngine) {
      return await this.activeEngine.captureManual();
    }
    return null;
  }

  updateConfig(config: Partial<ScannerEngineConfig>): void {
    this.currentConfig = { ...this.currentConfig, ...config };
    if (this.activeEngine) {
      this.activeEngine.updateConfig(this.currentConfig);
    }
  }

  async switchEngine(engineType: ScannerEngineType | "auto"): Promise<boolean> {
    this.preferredEngineType = engineType;
    if (!this.videoElement) return false;
    return await this.initialize(this.videoElement, this.currentConfig, engineType);
  }

  getActiveEngineType(): ScannerEngineType | null {
    return this.activeEngine?.engineType || null;
  }

  getActiveEngineName(): string {
    return this.activeEngine?.displayName || "Đang tải...";
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
          console.error(`[ScannerEngineManager] Error in ${event} handler:`, err);
        }
      });
    }
  }

  async destroy(): Promise<void> {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    if (this.activeEngine) {
      await this.activeEngine.destroy();
      this.activeEngine = null;
    }
    this.listeners.clear();
  }
}
