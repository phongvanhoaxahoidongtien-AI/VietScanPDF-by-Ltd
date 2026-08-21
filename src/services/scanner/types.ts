import { QuadPoints, Point, DocumentQualityCheck, CardSideAnalysis, ScanMode } from "../../types";

export type ScannerEngineType = "autocapture" | "scanic" | "jscanify" | "cvengine";

export interface EngineCapabilities {
  webglSupported: boolean;
  workerSupported: boolean;
  offscreenCanvasSupported: boolean;
  mlSupported: boolean;
  recommendedEngine: ScannerEngineType;
}

export type EngineGuidanceCode =
  | "DOCUMENT_NOT_FOUND"
  | "TOO_DARK_OR_BRIGHT"
  | "REDUCE_GLARE"
  | "TOO_BLURRY"
  | "HOLD_STEADY"
  | "MOVE_CLOSER"
  | "READY"
  | "TOO_SKEWED"
  | "WRONG_SIDE";

export interface EngineDetectionResult {
  quad: QuadPoints | null;
  smoothedQuad: QuadPoints | null;
  isDetected: boolean;
  confidence: number; // 0 to 1
  stabilityScore: number; // 0 to 100
  stableFrames: number;
  isReadyForCapture: boolean;
  guidanceCode: EngineGuidanceCode;
  guidanceText: string;
  quality?: DocumentQualityCheck;
  cardSide?: CardSideAnalysis;
  engineUsed: ScannerEngineType;
}

export interface EngineCaptureResult {
  blob?: Blob;
  dataUrl: string;
  width: number;
  height: number;
  quad: QuadPoints;
  warpedDataUrl?: string;
  engineUsed: ScannerEngineType;
}

export interface ScannerEngineConfig {
  autoCapture: boolean;
  mode: ScanMode;
  cardSide?: "front" | "back";
  qualityPreset: "fast" | "balanced" | "high";
  debug?: boolean;
}

export type EngineEventName =
  | "detection"
  | "guidance"
  | "capture"
  | "warning"
  | "error"
  | "fallback"
  | "ready";

export interface IDocumentScannerEngine {
  readonly engineType: ScannerEngineType;
  readonly displayName: string;
  
  initialize(video: HTMLVideoElement, config?: Partial<ScannerEngineConfig>): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
  captureManual(): Promise<EngineCaptureResult | null>;
  updateConfig(config: Partial<ScannerEngineConfig>): void;
  on(event: EngineEventName, handler: (payload: any) => void): () => void;
  destroy(): Promise<void>;
}
