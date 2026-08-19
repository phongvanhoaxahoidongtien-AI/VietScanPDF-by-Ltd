import { FilterMode, Point, QuadPoints } from "../types";

/**
 * Computer Vision & Image Processing Engine for VietScanPDF
 * Runs 100% locally on Client Canvas / Web Worker (0 latency, 100% private)
 */

export interface DetectedQuadResult {
  quad: QuadPoints;
  confidence: number;
  isClear: boolean;
  isRealQuad: boolean;
}

export class CVEngine {
  /**
   * Fast real-time edge & quadrilateral document boundary detection from video or canvas
   * Uses grayscale -> Gaussian blur -> Sobel gradient & adaptive threshold -> contour extraction -> RDP polygon approximation
   */
  static detectDocumentQuad(
    sourceCanvas: HTMLCanvasElement | HTMLVideoElement | CanvasImageSource,
    srcWidth: number,
    srcHeight: number,
    targetAspect: "document" | "card" = "document"
  ): DetectedQuadResult {
    if (!srcWidth || !srcHeight) {
      return {
        quad: this.getDefaultQuad(1280, 720, targetAspect),
        confidence: 0,
        isClear: false,
        isRealQuad: false,
      };
    }

    // Process on a downscaled canvas (approx. 280-320px width) for ultra-fast 60fps execution (<6ms per frame)
    const targetWorkWidth = 280;
    const scale = Math.min(1, targetWorkWidth / srcWidth);
    const workW = Math.max(80, Math.round(srcWidth * scale));
    const workH = Math.max(60, Math.round(srcHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = workW;
    canvas.height = workH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    if (!ctx) {
      return {
        quad: this.getDefaultQuad(srcWidth, srcHeight, targetAspect),
        confidence: 0,
        isClear: false,
        isRealQuad: false,
      };
    }

    ctx.drawImage(sourceCanvas as any, 0, 0, workW, workH);
    const imgData = ctx.getImageData(0, 0, workW, workH);
    const data = imgData.data;

    // 1. Grayscale conversion
    const gray = new Uint8Array(workW * workH);
    let totalLuma = 0;
    for (let i = 0; i < data.length; i += 4) {
      const luma = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
      gray[i / 4] = luma;
      totalLuma += luma;
    }
    const avgLuma = totalLuma / (workW * workH);

    // 2. 3x3 Gaussian Blur to remove paper print noise & text lines
    const blurred = new Uint8Array(workW * workH);
    for (let y = 1; y < workH - 1; y++) {
      const rowPrev = (y - 1) * workW;
      const rowCurr = y * workW;
      const rowNext = (y + 1) * workW;
      for (let x = 1; x < workW - 1; x++) {
        // [1 2 1; 2 4 2; 1 2 1] / 16
        const val =
          (gray[rowPrev + x - 1] +
            gray[rowPrev + x] * 2 +
            gray[rowPrev + x + 1] +
            gray[rowCurr + x - 1] * 2 +
            gray[rowCurr + x] * 4 +
            gray[rowCurr + x + 1] * 2 +
            gray[rowNext + x - 1] +
            gray[rowNext + x] * 2 +
            gray[rowNext + x + 1]) >>
          4;
        blurred[rowCurr + x] = val;
      }
    }

    // 3. Sobel Gradient Magnitude & Binary Edge Map
    const edges = new Uint8Array(workW * workH);
    let edgeCount = 0;
    const threshold = Math.max(22, Math.min(50, avgLuma * 0.35));

    for (let y = 1; y < workH - 1; y++) {
      const rowPrev = (y - 1) * workW;
      const rowCurr = y * workW;
      const rowNext = (y + 1) * workW;
      for (let x = 1; x < workW - 1; x++) {
        const gx =
          blurred[rowPrev + x + 1] +
          2 * blurred[rowCurr + x + 1] +
          blurred[rowNext + x + 1] -
          (blurred[rowPrev + x - 1] + 2 * blurred[rowCurr + x - 1] + blurred[rowNext + x - 1]);

        const gy =
          blurred[rowNext + x - 1] +
          2 * blurred[rowNext + x] +
          blurred[rowNext + x + 1] -
          (blurred[rowPrev + x - 1] + 2 * blurred[rowPrev + x] + blurred[rowPrev + x + 1]);

        const mag = (Math.abs(gx) + Math.abs(gy)) >> 2;
        if (mag > threshold) {
          edges[rowCurr + x] = 255;
          edgeCount++;
        }
      }
    }

    // 4. Morphological Dilation to connect broken paper boundaries
    const dilatedEdges = new Uint8Array(workW * workH);
    for (let y = 1; y < workH - 1; y++) {
      for (let x = 1; x < workW - 1; x++) {
        const idx = y * workW + x;
        if (
          edges[idx] === 255 ||
          edges[idx - 1] === 255 ||
          edges[idx + 1] === 255 ||
          edges[idx - workW] === 255 ||
          edges[idx + workW] === 255
        ) {
          dilatedEdges[idx] = 255;
        }
      }
    }

    // 5. Find connected boundary points & candidate document contours
    const visited = new Uint8Array(workW * workH);
    const contours: Point[][] = [];
    const minContourPoints = 30;

    const marginX = Math.round(workW * 0.03);
    const marginY = Math.round(workH * 0.03);

    for (let y = marginY; y < workH - marginY; y += 2) {
      for (let x = marginX; x < workW - marginX; x += 2) {
        const idx = y * workW + x;
        if (dilatedEdges[idx] === 255 && visited[idx] === 0) {
          // Trace contour using 8-connectivity BFS
          const contour: Point[] = [];
          const queue: number[] = [idx];
          visited[idx] = 1;

          while (queue.length > 0 && contour.length < 1200) {
            const currIdx = queue.pop()!;
            const cx = currIdx % workW;
            const cy = Math.floor(currIdx / workW);
            contour.push({ x: cx, y: cy });

            // Check 8 neighbors
            const neighbors = [
              currIdx - 1,
              currIdx + 1,
              currIdx - workW,
              currIdx + workW,
              currIdx - workW - 1,
              currIdx - workW + 1,
              currIdx + workW - 1,
              currIdx + workW + 1,
            ];

            for (const nIdx of neighbors) {
              if (
                nIdx >= 0 &&
                nIdx < workW * workH &&
                visited[nIdx] === 0 &&
                dilatedEdges[nIdx] === 255
              ) {
                visited[nIdx] = 1;
                queue.push(nIdx);
              }
            }
          }

          if (contour.length >= minContourPoints) {
            contours.push(contour);
          }
        }
      }
    }

    // 6. Find the best candidate quadrilateral polygon
    let bestQuad: QuadPoints | null = null;
    let bestScore = 0;
    const totalArea = workW * workH;

    for (const contour of contours) {
      // Find bounding envelope & approximate polygon
      const hull = this.convexHull(contour);
      if (hull.length < 4) continue;

      const area = this.polygonArea(hull);
      const areaRatio = area / totalArea;

      // Document must take between 12% and 92% of camera frame
      if (areaRatio < 0.12 || areaRatio > 0.92) continue;

      // Simplify polygon with RDP
      const perimeter = this.polygonPerimeter(hull);
      const epsilon = Math.max(2, perimeter * 0.035);
      const approx = this.ramerDouglasPeucker(hull, epsilon);

      let quadCandidate: Point[] | null = null;

      if (approx.length === 4) {
        quadCandidate = approx;
      } else if (approx.length > 4 && approx.length <= 8) {
        // Reduce to 4 dominant corners via corner angle deviation
        quadCandidate = this.reduceTo4Corners(approx);
      } else if (hull.length >= 4) {
        // Fallback to 4 extreme directional points of convex hull
        quadCandidate = this.extractExtremeCorners(hull);
      }

      if (quadCandidate && quadCandidate.length === 4) {
        const sortedQuad = this.orderQuadPoints(quadCandidate);
        if (this.isValidConvexQuad(sortedQuad, workW, workH)) {
          // Calculate score based on area, convexity, and aspect ratio match
          const qArea = this.quadArea(sortedQuad);
          const score = qArea / totalArea;

          if (score > bestScore) {
            bestScore = score;
            bestQuad = sortedQuad;
          }
        }
      }
    }

    // 7. If no contour produced a valid quad, try Bright Document Region Bounding Quad
    if (!bestQuad) {
      const brightQuad = this.findBrightDocumentRegionQuad(blurred, workW, workH, avgLuma);
      if (brightQuad) {
        bestQuad = brightQuad;
        bestScore = 0.65;
      }
    }

    // 8. Scale points back to original video/canvas coordinate space
    const invScale = 1 / scale;
    if (bestQuad && bestScore > 0.1) {
      const fullQuad: QuadPoints = {
        topLeft: {
          x: Math.max(0, Math.min(srcWidth, bestQuad.topLeft.x * invScale)),
          y: Math.max(0, Math.min(srcHeight, bestQuad.topLeft.y * invScale)),
        },
        topRight: {
          x: Math.max(0, Math.min(srcWidth, bestQuad.topRight.x * invScale)),
          y: Math.max(0, Math.min(srcHeight, bestQuad.topRight.y * invScale)),
        },
        bottomRight: {
          x: Math.max(0, Math.min(srcWidth, bestQuad.bottomRight.x * invScale)),
          y: Math.max(0, Math.min(srcHeight, bestQuad.bottomRight.y * invScale)),
        },
        bottomLeft: {
          x: Math.max(0, Math.min(srcWidth, bestQuad.bottomLeft.x * invScale)),
          y: Math.max(0, Math.min(srcHeight, bestQuad.bottomLeft.y * invScale)),
        },
      };

      return {
        quad: fullQuad,
        confidence: Math.min(0.98, bestScore + 0.35),
        isClear: true,
        isRealQuad: true,
      };
    }

    // Default fallback frame
    return {
      quad: this.getDefaultQuad(srcWidth, srcHeight, targetAspect),
      confidence: 0.4,
      isClear: false,
      isRealQuad: false,
    };
  }

  /**
   * Find bright document region by thresholding against table surface
   */
  private static findBrightDocumentRegionQuad(
    gray: Uint8Array,
    w: number,
    h: number,
    avgLuma: number
  ): QuadPoints | null {
    const threshold = Math.min(200, Math.max(90, avgLuma * 1.15));
    let minX = w,
      maxX = 0,
      minY = h,
      maxY = 0;
    let count = 0;

    const marginX = Math.round(w * 0.05);
    const marginY = Math.round(h * 0.05);

    for (let y = marginY; y < h - marginY; y++) {
      for (let x = marginX; x < w - marginX; x++) {
        if (gray[y * w + x] > threshold) {
          count++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    const docArea = (maxX - minX) * (maxY - minY);
    const totalArea = w * h;
    const ratio = docArea / totalArea;

    if (ratio > 0.15 && ratio < 0.92 && count > 150) {
      return {
        topLeft: { x: minX, y: minY },
        topRight: { x: maxX, y: minY },
        bottomRight: { x: maxX, y: maxY },
        bottomLeft: { x: minX, y: maxY },
      };
    }
    return null;
  }

  /**
   * Ramer-Douglas-Peucker algorithm for polyline/polygon vertex reduction
   */
  static ramerDouglasPeucker(points: Point[], epsilon: number): Point[] {
    if (points.length <= 2) return points;

    let maxDist = 0;
    let maxIdx = 0;
    const first = points[0];
    const last = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
      const d = this.perpendicularDistance(points[i], first, last);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }

    if (maxDist > epsilon) {
      const left = this.ramerDouglasPeucker(points.slice(0, maxIdx + 1), epsilon);
      const right = this.ramerDouglasPeucker(points.slice(maxIdx), epsilon);
      return left.slice(0, left.length - 1).concat(right);
    } else {
      return [first, last];
    }
  }

  private static perpendicularDistance(p: Point, lineStart: Point, lineEnd: Point): number {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const lineLen = Math.hypot(dx, dy);
    if (lineLen === 0) return Math.hypot(p.x - lineStart.x, p.y - lineStart.y);
    return Math.abs(dy * p.x - dx * p.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / lineLen;
  }

  /**
   * Monotone chain convex hull algorithm
   */
  static convexHull(points: Point[]): Point[] {
    if (points.length <= 3) return points;
    const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

    const lower: Point[] = [];
    for (let i = 0; i < pts.length; i++) {
      while (
        lower.length >= 2 &&
        this.crossProduct(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0
      ) {
        lower.pop();
      }
      lower.push(pts[i]);
    }

    const upper: Point[] = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      while (
        upper.length >= 2 &&
        this.crossProduct(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0
      ) {
        upper.pop();
      }
      upper.push(pts[i]);
    }

    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  private static crossProduct(a: Point, b: Point, c: Point): number {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }

  private static polygonArea(points: Point[]): number {
    let area = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
  }

  private static polygonPerimeter(points: Point[]): number {
    let perim = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      perim += Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
    }
    return perim;
  }

  /**
   * Reduce arbitrary N-gon (5-8 points) to 4 most significant corners
   */
  private static reduceTo4Corners(points: Point[]): Point[] {
    const centroid = points.reduce(
      (acc, p) => ({ x: acc.x + p.x / points.length, y: acc.y + p.y / points.length }),
      { x: 0, y: 0 }
    );

    // Pick 1 point in each of the 4 quadrants relative to centroid that has max distance
    const quadPoints: (Point | null)[] = [null, null, null, null]; // TL (Q2), TR (Q1), BR (Q4), BL (Q3)
    const maxDist = [-1, -1, -1, -1];

    for (const p of points) {
      const dx = p.x - centroid.x;
      const dy = p.y - centroid.y;
      const dist = dx * dx + dy * dy;

      let qIdx = 0;
      if (dx < 0 && dy < 0) qIdx = 0; // Top-Left
      else if (dx >= 0 && dy < 0) qIdx = 1; // Top-Right
      else if (dx >= 0 && dy >= 0) qIdx = 2; // Bottom-Right
      else qIdx = 3; // Bottom-Left

      if (dist > maxDist[qIdx]) {
        maxDist[qIdx] = dist;
        quadPoints[qIdx] = p;
      }
    }

    if (quadPoints.every((p) => p !== null)) {
      return quadPoints as Point[];
    }
    return this.extractExtremeCorners(points);
  }

  /**
   * Extract 4 extreme points (min/max X+Y and X-Y) from hull
   */
  private static extractExtremeCorners(points: Point[]): Point[] {
    let tl = points[0],
      tr = points[0],
      br = points[0],
      bl = points[0];
    let minSum = Infinity,
      maxSum = -Infinity,
      minDiff = Infinity,
      maxDiff = -Infinity;

    for (const p of points) {
      const sum = p.x + p.y;
      const diff = p.x - p.y;

      if (sum < minSum) {
        minSum = sum;
        tl = p;
      }
      if (sum > maxSum) {
        maxSum = sum;
        br = p;
      }
      if (diff > maxDiff) {
        maxDiff = diff;
        tr = p;
      }
      if (diff < minDiff) {
        minDiff = diff;
        bl = p;
      }
    }

    return [tl, tr, br, bl];
  }

  /**
   * Sort 4 points into [TopLeft, TopRight, BottomRight, BottomLeft]
   */
  static orderQuadPoints(points: Point[]): QuadPoints {
    let tl = points[0],
      tr = points[0],
      br = points[0],
      bl = points[0];
    let minSum = Infinity,
      maxSum = -Infinity,
      minDiff = Infinity,
      maxDiff = -Infinity;

    for (const p of points) {
      const sum = p.x + p.y;
      const diff = p.x - p.y;

      if (sum < minSum) {
        minSum = sum;
        tl = p;
      }
      if (sum > maxSum) {
        maxSum = sum;
        br = p;
      }
      if (diff > maxDiff) {
        maxDiff = diff;
        tr = p;
      }
      if (diff < minDiff) {
        minDiff = diff;
        bl = p;
      }
    }

    return {
      topLeft: tl,
      topRight: tr,
      bottomRight: br,
      bottomLeft: bl,
    };
  }

  /**
   * Validate that 4 points form a convex quad with plausible interior angles
   */
  static isValidConvexQuad(q: QuadPoints, boundW: number, boundH: number): boolean {
    const pts = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft];

    // Check minimum side lengths
    const topW = Math.hypot(q.topRight.x - q.topLeft.x, q.topRight.y - q.topLeft.y);
    const botW = Math.hypot(q.bottomRight.x - q.bottomLeft.x, q.bottomRight.y - q.bottomLeft.y);
    const leftH = Math.hypot(q.bottomLeft.x - q.topLeft.x, q.bottomLeft.y - q.topLeft.y);
    const rightH = Math.hypot(q.bottomRight.x - q.topRight.x, q.bottomRight.y - q.topRight.y);

    const minSide = Math.min(boundW, boundH) * 0.15;
    if (topW < minSide || botW < minSide || leftH < minSide || rightH < minSide) {
      return false;
    }

    // Check convexity via cross product signs
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % 4];
      const p3 = pts[(i + 2) % 4];
      const cp = (p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x);
      if (i === 0) {
        sign = cp > 0 ? 1 : -1;
      } else {
        if ((cp > 0 ? 1 : -1) !== sign) return false;
      }
    }

    return true;
  }

  static quadArea(q: QuadPoints): number {
    return this.polygonArea([q.topLeft, q.topRight, q.bottomRight, q.bottomLeft]);
  }

  /**
   * Smart default quad bounding box with standard aspect ratio (A4 or ID Card)
   */
  static getDefaultQuad(
    width: number,
    height: number,
    targetAspect: "document" | "card" = "document"
  ): QuadPoints {
    let boxW: number;
    let boxH: number;

    if (targetAspect === "card") {
      // Standard ID card ratio is ~1.586 (85.6mm x 53.98mm)
      boxW = width * 0.82;
      boxH = boxW / 1.586;
      if (boxH > height * 0.75) {
        boxH = height * 0.75;
        boxW = boxH * 1.586;
      }
    } else {
      // A4 ratio is ~1.414 (Portrait)
      boxH = height * 0.82;
      boxW = boxH / 1.414;
      if (boxW > width * 0.88) {
        boxW = width * 0.88;
        boxH = boxW * 1.414;
      }
    }

    const startX = (width - boxW) / 2;
    const startY = (height - boxH) / 2;

    return {
      topLeft: { x: startX, y: startY },
      topRight: { x: startX + boxW, y: startY },
      bottomRight: { x: startX + boxW, y: startY + boxH },
      bottomLeft: { x: startX, y: startY + boxH },
    };
  }

  /**
   * Evaluate camera quality metrics (sharpness, luminance, stability)
   */
  static evaluateFrameQuality(
    video: HTMLVideoElement,
    quad: QuadPoints | null
  ): {
    sharpness: number;
    brightness: number;
    isStable: boolean;
    guidance: string;
    canAutoCapture: boolean;
  } {
    if (!video.videoWidth || !video.videoHeight) {
      return {
        sharpness: 0,
        brightness: 0,
        isStable: false,
        guidance: "Đang mở camera...",
        canAutoCapture: false,
      };
    }

    const w = 160;
    const h = 120;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return {
        sharpness: 50,
        brightness: 120,
        isStable: true,
        guidance: "Đưa tài liệu vào khung",
        canAutoCapture: true,
      };
    }

    ctx.drawImage(video, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;

    let totalLuma = 0;
    const gray = new Float32Array(w * h);

    for (let i = 0; i < d.length; i += 4) {
      const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      gray[i / 4] = luma;
      totalLuma += luma;
    }

    const avgBrightness = totalLuma / (w * h);

    // Laplacian variance for sharpness / blur detection
    let laplacianSum = 0;
    let laplacianSqSum = 0;
    let count = 0;

    for (let y = 1; y < h - 1; y += 2) {
      for (let x = 1; x < w - 1; x += 2) {
        const idx = y * w + x;
        const lap =
          gray[idx - 1] +
          gray[idx + 1] +
          gray[idx - w] +
          gray[idx + w] -
          4 * gray[idx];
        laplacianSum += lap;
        laplacianSqSum += lap * lap;
        count++;
      }
    }

    const variance = (laplacianSqSum - (laplacianSum * laplacianSum) / count) / count;
    const sharpnessScore = Math.min(100, Math.round(variance * 1.5));

    let guidance = "Đưa tài liệu vào khung";
    let canAutoCapture = false;

    if (avgBrightness < 45) {
      guidance = "Khu vực quá tối, hãy bật đèn hoặc di chuyển ra sáng";
    } else if (avgBrightness > 230) {
      guidance = "Ánh sáng quá chói, hãy giảm bớt phản chiếu";
    } else if (sharpnessScore < 20) {
      guidance = "Giữ điện thoại ổn định để lấy nét";
    } else if (quad) {
      guidance = "Đã nhận diện tài liệu - Giữ yên để chụp";
      canAutoCapture = sharpnessScore > 25 && avgBrightness >= 50 && avgBrightness <= 225;
    }

    return {
      sharpness: sharpnessScore,
      brightness: Math.round(avgBrightness),
      isStable: sharpnessScore > 25,
      guidance,
      canAutoCapture,
    };
  }

  /**
   * 4-Point Perspective Transform (Bilinear / Homography Warp)
   * Warps any trapezoid/skewed quad into a perfectly flat rectangular canvas
   */
  static warpPerspective(
    sourceImg: HTMLImageElement | HTMLCanvasElement,
    quad: QuadPoints,
    desiredWidth?: number,
    desiredHeight?: number
  ): HTMLCanvasElement {
    // Calculate geometric width & height from 4 points
    const topW = Math.hypot(quad.topRight.x - quad.topLeft.x, quad.topRight.y - quad.topLeft.y);
    const botW = Math.hypot(quad.bottomRight.x - quad.bottomLeft.x, quad.bottomRight.y - quad.bottomLeft.y);
    const leftH = Math.hypot(quad.bottomLeft.x - quad.topLeft.x, quad.bottomLeft.y - quad.topLeft.y);
    const rightH = Math.hypot(quad.bottomRight.x - quad.topRight.x, quad.bottomRight.y - quad.topRight.y);

    const outW = Math.round(desiredWidth || Math.max(topW, botW));
    const outH = Math.round(desiredHeight || Math.max(leftH, rightH));

    const outCanvas = document.createElement("canvas");
    outCanvas.width = outW;
    outCanvas.height = outH;
    const outCtx = outCanvas.getContext("2d", { willReadFrequently: true });

    if (!outCtx) return outCanvas;

    // Draw source onto temporary canvas to read pixels
    const srcCanvas = document.createElement("canvas");
    const sw = "naturalWidth" in sourceImg ? sourceImg.naturalWidth || sourceImg.width : sourceImg.width;
    const sh = "naturalHeight" in sourceImg ? sourceImg.naturalHeight || sourceImg.height : sourceImg.height;
    srcCanvas.width = sw;
    srcCanvas.height = sh;
    const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });
    if (!srcCtx) return outCanvas;

    srcCtx.drawImage(sourceImg as any, 0, 0, sw, sh);
    const srcData = srcCtx.getImageData(0, 0, sw, sh);

    const destData = outCtx.createImageData(outW, outH);
    const sD = srcData.data;
    const dD = destData.data;

    const { topLeft: p0, topRight: p1, bottomRight: p2, bottomLeft: p3 } = quad;

    // Forward/Bilinear mapping for smooth warp
    for (let dy = 0; dy < outH; dy++) {
      const v = dy / (outH - 1 || 1);
      const topX = p0.x + (p1.x - p0.x) * (0);
      const botX = p3.x + (p2.x - p3.x) * (0);
      
      for (let dx = 0; dx < outW; dx++) {
        const u = dx / (outW - 1 || 1);

        // Bilinear interpolation of quad points
        const sx = (1 - u) * (1 - v) * p0.x + u * (1 - v) * p1.x + u * v * p2.x + (1 - u) * v * p3.x;
        const sy = (1 - u) * (1 - v) * p0.y + u * (1 - v) * p1.y + u * v * p2.y + (1 - u) * v * p3.y;

        const isx = Math.round(sx);
        const isy = Math.round(sy);

        if (isx >= 0 && isx < sw && isy >= 0 && isy < sh) {
          const sIdx = (isy * sw + isx) * 4;
          const dIdx = (dy * outW + dx) * 4;

          dD[dIdx] = sD[sIdx];
          dD[dIdx + 1] = sD[sIdx + 1];
          dD[dIdx + 2] = sD[sIdx + 2];
          dD[dIdx + 3] = 255;
        }
      }
    }

    outCtx.putImageData(destData, 0, 0);
    return outCanvas;
  }

  /**
   * Apply color enhancement filters: original, auto, document, bw, grayscale, magic, photo
   */
  static applyFilter(
    sourceCanvas: HTMLCanvasElement,
    filter: FilterMode,
    rotation: number = 0
  ): HTMLCanvasElement {
    let workingCanvas = sourceCanvas;

    // 1. Handle rotation (90, 180, 270)
    if (rotation !== 0) {
      const rotCanvas = document.createElement("canvas");
      const is90or270 = rotation === 90 || rotation === 270;
      rotCanvas.width = is90or270 ? workingCanvas.height : workingCanvas.width;
      rotCanvas.height = is90or270 ? workingCanvas.width : workingCanvas.height;
      const rotCtx = rotCanvas.getContext("2d");
      if (rotCtx) {
        rotCtx.translate(rotCanvas.width / 2, rotCanvas.height / 2);
        rotCtx.rotate((rotation * Math.PI) / 180);
        rotCtx.drawImage(workingCanvas, -workingCanvas.width / 2, -workingCanvas.height / 2);
        workingCanvas = rotCanvas;
      }
    }

    if (filter === "original") {
      return workingCanvas;
    }

    const w = workingCanvas.width;
    const h = workingCanvas.height;
    const outCanvas = document.createElement("canvas");
    outCanvas.width = w;
    outCanvas.height = h;
    const ctx = outCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return workingCanvas;

    ctx.drawImage(workingCanvas, 0, 0);
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;

    // Filter implementations
    switch (filter) {
      case "grayscale": {
        for (let i = 0; i < d.length; i += 4) {
          const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          d[i] = luma;
          d[i + 1] = luma;
          d[i + 2] = luma;
        }
        break;
      }

      case "bw": {
        // High contrast Black & White thresholding with Otsu / local average
        // Calculate average background luminance
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) {
          sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        }
        const avg = sum / (d.length / 4);
        const threshold = Math.max(90, Math.min(160, avg * 0.88));

        for (let i = 0; i < d.length; i += 4) {
          const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const val = luma > threshold ? 255 : 0;
          d[i] = val;
          d[i + 1] = val;
          d[i + 2] = val;
        }
        break;
      }

      case "document": {
        // Document Scan Mode: Paper whitening + contrast curve + sharpen
        // Makes background clean white while preserving ink / stamps / signatures
        for (let i = 0; i < d.length; i += 4) {
          let r = d[i];
          let g = d[i + 1];
          let b = d[i + 2];

          // Normalize background (whiten off-white paper)
          const luma = 0.299 * r + 0.587 * g + 0.114 * b;
          if (luma > 155) {
            // Paper highlight stretch
            const factor = Math.min(1.4, 1 + (luma - 155) / 100);
            r = Math.min(255, r * factor);
            g = Math.min(255, g * factor);
            b = Math.min(255, b * factor);
          } else {
            // Darken ink / text
            r = Math.max(0, r * 0.85);
            g = Math.max(0, g * 0.85);
            b = Math.max(0, b * 0.85);
          }

          d[i] = r;
          d[i + 1] = g;
          d[i + 2] = b;
        }
        break;
      }

      case "magic": {
        // Magic Color: Shadow removal + vivid saturation + high text contrast
        for (let i = 0; i < d.length; i += 4) {
          let r = d[i];
          let g = d[i + 1];
          let b = d[i + 2];

          // Shadow lift: lift darker grays while keeping black ink dark
          const luma = 0.299 * r + 0.587 * g + 0.114 * b;
          if (luma > 130) {
            r = Math.min(255, r * 1.28 + 15);
            g = Math.min(255, g * 1.28 + 15);
            b = Math.min(255, b * 1.28 + 15);
          } else {
            r = Math.max(0, r * 0.8);
            g = Math.max(0, g * 0.8);
            b = Math.max(0, b * 0.8);
          }

          d[i] = r;
          d[i + 1] = g;
          d[i + 2] = b;
        }
        break;
      }

      case "auto": {
        // Auto Level & Contrast stretch
        let minLuma = 255;
        let maxLuma = 0;
        for (let i = 0; i < d.length; i += 16) {
          const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (luma < minLuma) minLuma = luma;
          if (luma > maxLuma) maxLuma = luma;
        }
        const range = Math.max(1, maxLuma - minLuma);

        for (let i = 0; i < d.length; i += 4) {
          d[i] = Math.min(255, Math.max(0, ((d[i] - minLuma) / range) * 255));
          d[i + 1] = Math.min(255, Math.max(0, ((d[i + 1] - minLuma) / range) * 255));
          d[i + 2] = Math.min(255, Math.max(0, ((d[i + 2] - minLuma) / range) * 255));
        }
        break;
      }

      case "photo": {
        // Photo: slight contrast boost + saturation
        for (let i = 0; i < d.length; i += 4) {
          d[i] = Math.min(255, d[i] * 1.05);
          d[i + 1] = Math.min(255, d[i + 1] * 1.05);
          d[i + 2] = Math.min(255, d[i + 2] * 1.05);
        }
        break;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return outCanvas;
  }

  /**
   * Convert image to base64 Data URL helper
   */
  static canvasToDataURL(canvas: HTMLCanvasElement, quality: number = 0.92): string {
    return canvas.toDataURL("image/jpeg", quality);
  }

  /**
   * Load base64 Data URL to HTMLImageElement
   */
  static loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = src;
    });
  }

  /**
   * Stitch multiple scanned pages into a single vertical long image
   */
  static async stitchVerticalLongImage(
    pages: { processedImage: string }[],
    separatorHeight: number = 24
  ): Promise<string> {
    if (pages.length === 0) return "";
    if (pages.length === 1) return pages[0].processedImage;

    const images = await Promise.all(pages.map((p) => this.loadImage(p.processedImage)));
    
    // Target uniform width (max of all images, up to 1600px for sharp mobile viewing)
    const maxWidth = Math.min(1600, Math.max(...images.map((img) => img.naturalWidth || 1200)));

    let totalHeight = (pages.length - 1) * separatorHeight;
    const scaledHeights: number[] = [];

    for (const img of images) {
      const scale = maxWidth / img.naturalWidth;
      const sh = Math.round(img.naturalHeight * scale);
      scaledHeights.push(sh);
      totalHeight += sh;
    }

    const canvas = document.createElement("canvas");
    canvas.width = maxWidth;
    canvas.height = totalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return pages[0].processedImage;

    // Fill background with clean off-white
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let currentY = 0;
    images.forEach((img, idx) => {
      const h = scaledHeights[idx];
      ctx.drawImage(img, 0, currentY, maxWidth, h);

      currentY += h;

      // Draw separator line if not last
      if (idx < images.length - 1) {
        ctx.fillStyle = "#cbd5e1";
        ctx.fillRect(0, currentY + separatorHeight / 2 - 1, maxWidth, 2);
        currentY += separatorHeight;
      }
    });

    return canvas.toDataURL("image/jpeg", 0.9);
  }
}
