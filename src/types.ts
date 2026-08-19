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
