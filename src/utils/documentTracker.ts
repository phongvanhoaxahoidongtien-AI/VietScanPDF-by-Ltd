import { Point, QuadPoints, DocumentTrackingState } from "../types";

export interface TrackerConfig {
  historySize: number;
  minConfidenceHigh: number; // Hysteresis high threshold to enter detected state
  minConfidenceLow: number;  // Hysteresis low threshold to exit detected state
  minStabilityScoreForCapture: number;
  minConfidenceForCapture: number;
  requiredStableFrames: number;
  maxCornerDriftRatio: number; // as ratio of frame width
}

export const DEFAULT_TRACKER_CONFIG: TrackerConfig = {
  historySize: 8,
  minConfidenceHigh: 0.62,
  minConfidenceLow: 0.35,
  minStabilityScoreForCapture: 78,
  minConfidenceForCapture: 0.68,
  requiredStableFrames: 6,
  maxCornerDriftRatio: 0.035, // 3.5% of frame width
};

/**
 * Real-time Document Tracker & Temporal Stability Filter
 * Manages 4-corner normalization, exponential smoothing, jitter suppression,
 * hysteresis state machine, and stable auto-capture gating.
 */
export class DocumentTracker {
  private config: TrackerConfig;
  private isDetectedState: boolean = false;
  private smoothedQuad: QuadPoints | null = null;
  private lastValidRawQuad: QuadPoints | null = null;
  private history: QuadPoints[] = [];
  private stableFrames: number = 0;
  private lastConfidence: number = 0;
  private lastStabilityScore: number = 0;
  private lostFramesCount: number = 0;

  constructor(config: Partial<TrackerConfig> = {}) {
    this.config = { ...DEFAULT_TRACKER_CONFIG, ...config };
  }

  /**
   * Reset tracker state (e.g. when changing scan mode or after capture)
   */
  reset(): void {
    this.isDetectedState = false;
    this.smoothedQuad = null;
    this.lastValidRawQuad = null;
    this.history = [];
    this.stableFrames = 0;
    this.lastConfidence = 0;
    this.lastStabilityScore = 0;
    this.lostFramesCount = 0;
  }

  /**
   * Normalize 4 corners into deterministic order [TL, TR, BR, BL]
   * Uses centroid polar angle coordinates and distance to origin to prevent
   * any corner flipping or index swapping across frames.
   */
  static normalize4Corners(points: Point[]): QuadPoints {
    if (points.length !== 4) {
      throw new Error("normalize4Corners requires exactly 4 points");
    }

    // 1. Calculate centroid
    const cx = (points[0].x + points[1].x + points[2].x + points[3].x) / 4;
    const cy = (points[0].y + points[1].y + points[2].y + points[3].y) / 4;

    // 2. Sort all 4 points clockwise by polar angle relative to centroid
    const clockwise = points.slice().sort((a, b) => {
      const angleA = Math.atan2(a.y - cy, a.x - cx);
      const angleB = Math.atan2(b.y - cy, b.x - cx);
      return angleA - angleB;
    });

    // 3. Find the Top-Left corner: the point with smallest (x + y) or closest to (-3*PI/4)
    let bestTlIdx = 0;
    let minSum = Infinity;

    for (let i = 0; i < 4; i++) {
      const p = clockwise[i];
      // Weighted sum giving preference to top and left
      const score = p.x * 1.0 + p.y * 1.2;
      if (score < minSum) {
        minSum = score;
        bestTlIdx = i;
      }
    }

    // 4. Reorder array so index 0 = TL, index 1 = TR, index 2 = BR, index 3 = BL
    const tl = clockwise[bestTlIdx];
    const tr = clockwise[(bestTlIdx + 1) % 4];
    const br = clockwise[(bestTlIdx + 2) % 4];
    const bl = clockwise[(bestTlIdx + 3) % 4];

    return {
      topLeft: { x: tl.x, y: tl.y },
      topRight: { x: tr.x, y: tr.y },
      bottomRight: { x: br.x, y: br.y },
      bottomLeft: { x: bl.x, y: bl.y },
    };
  }

  /**
   * Distance between two 2D points
   */
  private static dist(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /**
   * Linear interpolation between two points
   */
  private static lerpPoint(a: Point, b: Point, t: number): Point {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    };
  }

  /**
   * Calculate polygon area of quad
   */
  private static calcQuadArea(q: QuadPoints): number {
    const pts = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft];
    let area = 0;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return Math.abs(area) / 2;
  }

  /**
   * Main frame update step: Processes raw detection, applies temporal smoothing,
   * evaluates stability, and updates hysteresis state.
   */
  update(
    rawQuad: QuadPoints | null,
    rawConfidence: number,
    frameWidth: number,
    frameHeight: number
  ): DocumentTrackingState {
    const fw = frameWidth || 1280;
    const fh = frameHeight || 720;
    const driftThreshold = fw * this.config.maxCornerDriftRatio;

    let currentNormQuad: QuadPoints | null = null;
    let confidence = rawConfidence;

    if (rawQuad) {
      currentNormQuad = DocumentTracker.normalize4Corners([
        rawQuad.topLeft,
        rawQuad.topRight,
        rawQuad.bottomRight,
        rawQuad.bottomLeft,
      ]);
    }

    // 1. Hysteresis State Management
    if (!this.isDetectedState) {
      if (currentNormQuad && confidence >= this.config.minConfidenceHigh) {
        this.isDetectedState = true;
        this.lostFramesCount = 0;
      }
    } else {
      if (!currentNormQuad || confidence < this.config.minConfidenceLow) {
        this.lostFramesCount++;
        if (this.lostFramesCount >= 4) {
          this.isDetectedState = false;
          this.smoothedQuad = null;
          this.history = [];
          this.stableFrames = 0;
        }
      } else {
        this.lostFramesCount = 0;
      }
    }

    // 2. Outlier Rejection & Temporal Smoothing
    if (this.isDetectedState && currentNormQuad) {
      let isOutlier = false;

      if (this.smoothedQuad) {
        const d0 = DocumentTracker.dist(currentNormQuad.topLeft, this.smoothedQuad.topLeft);
        const d1 = DocumentTracker.dist(currentNormQuad.topRight, this.smoothedQuad.topRight);
        const d2 = DocumentTracker.dist(currentNormQuad.bottomRight, this.smoothedQuad.bottomRight);
        const d3 = DocumentTracker.dist(currentNormQuad.bottomLeft, this.smoothedQuad.bottomLeft);
        const maxJump = Math.max(d0, d1, d2, d3);

        // If sudden jump > 22% of screen width and confidence is modest, reject as transient jitter
        if (maxJump > fw * 0.22 && confidence < 0.85) {
          isOutlier = true;
        }
      }

      if (!isOutlier) {
        this.lastValidRawQuad = currentNormQuad;

        if (!this.smoothedQuad) {
          this.smoothedQuad = currentNormQuad;
        } else {
          // Adaptive Alpha:
          // If movement is very small (<1.5%), use heavy smoothing (alpha ~0.18) for rock-solid stability.
          // If movement is larger (>4%), increase alpha (~0.48) so the polygon smoothly follows the hand.
          const d0 = DocumentTracker.dist(currentNormQuad.topLeft, this.smoothedQuad.topLeft);
          const d1 = DocumentTracker.dist(currentNormQuad.topRight, this.smoothedQuad.topRight);
          const d2 = DocumentTracker.dist(currentNormQuad.bottomRight, this.smoothedQuad.bottomRight);
          const d3 = DocumentTracker.dist(currentNormQuad.bottomLeft, this.smoothedQuad.bottomLeft);
          const avgDrift = (d0 + d1 + d2 + d3) / 4;
          const driftRatio = avgDrift / fw;

          let alpha = 0.22;
          if (driftRatio > 0.04) {
            alpha = 0.48;
          } else if (driftRatio > 0.02) {
            alpha = 0.32;
          }

          this.smoothedQuad = {
            topLeft: DocumentTracker.lerpPoint(this.smoothedQuad.topLeft, currentNormQuad.topLeft, alpha),
            topRight: DocumentTracker.lerpPoint(this.smoothedQuad.topRight, currentNormQuad.topRight, alpha),
            bottomRight: DocumentTracker.lerpPoint(
              this.smoothedQuad.bottomRight,
              currentNormQuad.bottomRight,
              alpha
            ),
            bottomLeft: DocumentTracker.lerpPoint(
              this.smoothedQuad.bottomLeft,
              currentNormQuad.bottomLeft,
              alpha
            ),
          };
        }

        // Add to stability history
        this.history.push(currentNormQuad);
        if (this.history.length > this.config.historySize) {
          this.history.shift();
        }
      }
    }

    // 3. Multi-frame Stability Calculation (0 to 100)
    let stabilityScore = 0;
    if (this.isDetectedState && this.history.length >= 4 && this.smoothedQuad) {
      const cur = this.smoothedQuad;
      let maxHistoryDrift = 0;

      for (let i = 0; i < this.history.length - 1; i++) {
        const h = this.history[i];
        const d0 = DocumentTracker.dist(h.topLeft, cur.topLeft);
        const d1 = DocumentTracker.dist(h.topRight, cur.topRight);
        const d2 = DocumentTracker.dist(h.bottomRight, cur.bottomRight);
        const d3 = DocumentTracker.dist(h.bottomLeft, cur.bottomLeft);
        const m = Math.max(d0, d1, d2, d3);
        if (m > maxHistoryDrift) maxHistoryDrift = m;
      }

      // Check area stability
      const curArea = DocumentTracker.calcQuadArea(cur);
      const prevArea = DocumentTracker.calcQuadArea(this.history[0]);
      const areaDeltaPct = Math.abs(curArea - prevArea) / Math.max(1, curArea);

      // Stability formula
      const driftScore = Math.max(0, 100 - (maxHistoryDrift / driftThreshold) * 75);
      const areaScore = Math.max(0, 100 - areaDeltaPct * 250);

      stabilityScore = Math.round(driftScore * 0.7 + areaScore * 0.3);
      stabilityScore = Math.max(0, Math.min(100, stabilityScore));
    }

    this.lastStabilityScore = stabilityScore;
    this.lastConfidence = confidence;

    // 4. Stable Frames Counter for Auto-Capture Gating
    const isStableThisFrame =
      this.isDetectedState &&
      confidence >= this.config.minConfidenceForCapture &&
      stabilityScore >= this.config.minStabilityScoreForCapture;

    if (isStableThisFrame) {
      this.stableFrames++;
    } else {
      this.stableFrames = Math.max(0, this.stableFrames - 1);
    }

    const isReadyForCapture = this.stableFrames >= this.config.requiredStableFrames;

    // 5. User-friendly guidance message
    let guidance = "Đưa tài liệu vào khung hình";
    if (isReadyForCapture) {
      guidance = "Đã sẵn sàng - Giữ yên để chụp...";
    } else if (this.isDetectedState) {
      if (stabilityScore < 60) {
        guidance = "Giữ điện thoại ổn định...";
      } else {
        const progressPct = Math.round(
          Math.min(100, (this.stableFrames / this.config.requiredStableFrames) * 100)
        );
        guidance = `Đang căn nét (${progressPct}%)...`;
      }
    }

    return {
      isDetected: this.isDetectedState,
      rawQuad: this.lastValidRawQuad,
      smoothedQuad: this.smoothedQuad,
      confidence,
      stabilityScore,
      stableFrames: this.stableFrames,
      isReadyForCapture,
      guidance,
    };
  }
}
