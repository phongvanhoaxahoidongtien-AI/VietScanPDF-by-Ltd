export type ScanMode = "document" | "cccd" | "driver_license" | "certificate" | "photo";

export type FilterMode = "original" | "auto" | "document" | "bw" | "grayscale" | "magic" | "photo";

export interface Point {
  x: number;
  y: number;
}

export interface QuadPoints {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

export interface DocumentQualityCheck {
  sharpness: number; // 0 to 100 (Laplacian variance)
  brightness: number; // 0 to 255 (average luma)
  glarePercent: number; // 0 to 100 (% of saturated pixels)
  sizeRatio: number; // 0 to 1.0 (quad area / frame area)
  skewScore: number; // 0 to 100 (perspective orthogonality)
  isSharp: boolean;
  isWellExposed: boolean;
  hasNoGlare: boolean;
  isGoodSize: boolean;
  isWellAligned: boolean;
  isReadyForCapture: boolean;
  guidanceCode?:
    | "TOO_SMALL"
    | "TOO_LARGE"
    | "TOO_SKEWED"
    | "TOO_BLURRY"
    | "TOO_DARK"
    | "GLARE"
    | "HOLD_STEADY"
    | "WRONG_SIDE"
    | "READY";
  guidanceText: string;
}

export interface CardSideAnalysis {
  predictedSide: "front" | "back" | "unknown";
  frontConfidence: number; // 0 to 1
  backConfidence: number;  // 0 to 1
  hasPhotoOrEmblem: boolean;
  hasMRZOrChip: boolean;
  perceptualHash?: string;
}

export interface ScannedPage {
  id: string;
  originalImage: string; // Base64 data URL of raw capture
  processedImage: string; // Base64 data URL after perspective warp & filter
  quad: QuadPoints;
  filter: FilterMode;
  rotation: number; // 0, 90, 180, 270
  aspectRatio?: number;
  ocrText?: string;
  createdAt: number;
  width: number;
  height: number;
  perceptualHash?: string;
  detectedSide?: "front" | "back";
}

export interface ScannedDocument {
  id: string;
  title: string;
  category: ScanMode;
  pages: ScannedPage[];
  createdAt: number;
  updatedAt: number;
  thumbnail: string;
  fileSizeEstimate?: string;
  ocrExtractedText?: string;
  notes?: string;
  // Specific for 2-sided card modes
  twoSidedConfig?: {
    frontPageId: string;
    backPageId?: string;
    layout: "stacked" | "side_by_side"; // stacked = front top, back bottom on A4
    paperSize: "a4" | "a5";
    orientation: "portrait" | "landscape";
  };
}

export interface CameraQualityMetrics {
  sharpness: number; // 0 to 100
  brightness: number; // 0 to 255
  isStable: boolean;
  quadDetected: boolean;
  detectedQuad: QuadPoints | null;
  guidanceText: string;
  canAutoCapture: boolean;
  confidence?: number;
  stabilityScore?: number;
  quality?: DocumentQualityCheck;
  cardSide?: CardSideAnalysis;
}

export interface DocumentTrackingState {
  isDetected: boolean;
  rawQuad: QuadPoints | null;
  smoothedQuad: QuadPoints | null;
  confidence: number; // 0.0 to 1.0
  stabilityScore: number; // 0 to 100
  stableFrames: number;
  isReadyForCapture: boolean;
  guidance: string;
  quality?: DocumentQualityCheck;
  cardSide?: CardSideAnalysis;
}

export interface PDFExportOptions {
  paperSize: "a4" | "a5" | "letter";
  orientation: "portrait" | "landscape" | "auto";
  marginMm: number;
  quality: number; // 0.6 to 1.0
  twoSidedMode?: boolean;
}

export interface OCRResult {
  text: string;
  confidence?: number;
  language?: string;
  isAiEnhanced?: boolean;
  structuredFields?: Record<string, string>;
}
