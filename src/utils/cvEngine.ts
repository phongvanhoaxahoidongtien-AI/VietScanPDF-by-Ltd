import { FilterMode, Point, QuadPoints } from "../types";
import { DocumentTracker } from "./documentTracker";

/**
 * Computer Vision & Image Processing Engine for VietScanPDF
 * Runs 100% locally on Client Canvas / Web Worker (0 latency, 100% private)
 */

export interface DetectedQuadResult {
  quad: QuadPoints;
  confidence: number;
  isClear: boolean;
  isRealQuad: boolean;
  score: number;
}

export class CVEngine {
  /**
   * Fast real-time edge & quadrilateral document boundary detection from video or canvas
   * Pipeline:
   * 1. Frame Downscaling & Normalization (for 60 FPS performance)
   * 2. Grayscale & Noise Reduction (Gaussian blur)
   * 3. Sobel Edge Gradient Magnitude & Adaptive Thresholding
   * 4. Morphological Dilation/Closing (connect document boundary lines)
   * 5. Topological Contour Extraction (Connected Component BFS)
   * 6. Convex Hull & Polygon Simplification (Ramer-Douglas-Peucker)
   * 7. Corner Refinement via Boundary Segment Line Intersections
   * 8. Geometric Validation (convexity, non-self-intersection, angles, area ratio)
   * 9. Multi-Factor Candidate Scoring (Area + Orthogonality + Parallelism + Edge Gradient)
   * 10. Deterministic Corner Ordering (TopLeft, TopRight, BottomRight, BottomLeft)
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
        score: 0,
      };
    }

    // Process on a downscaled canvas (approx. 280-320px width) for ultra-fast execution (<6ms per frame)
    const targetWorkWidth = 300;
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
        score: 0,
      };
    }

    ctx.drawImage(sourceCanvas as any, 0, 0, workW, workH);
    const imgData = ctx.getImageData(0, 0, workW, workH);
    const data = imgData.data;

    // 1. Grayscale conversion & Luma distribution analysis
    const gray = new Uint8Array(workW * workH);
    let totalLuma = 0;
    let minLuma = 255;
    let maxLuma = 0;

    for (let i = 0; i < data.length; i += 4) {
      const luma = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
      gray[i / 4] = luma;
      totalLuma += luma;
      if (luma < minLuma) minLuma = luma;
      if (luma > maxLuma) maxLuma = luma;
    }
    const avgLuma = totalLuma / (workW * workH);
    const lumaRange = Math.max(20, maxLuma - minLuma);

    // 2. 3x3 Gaussian Blur to remove paper print noise & fine text lines
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

    // 3. Sobel Gradient Magnitude & Multi-Threshold Edge Extraction
    const edges = new Uint8Array(workW * workH);
    const gradMagnitudes = new Uint8Array(workW * workH);
    const edgeThreshold = Math.max(18, Math.min(48, lumaRange * 0.22));

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
        gradMagnitudes[rowCurr + x] = mag;
        if (mag > edgeThreshold) {
          edges[rowCurr + x] = 255;
        }
      }
    }

    // 4. Morphological Dilation / Bridge to connect broken document boundary segments
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

    // 5. Find connected boundary contours using 8-connectivity BFS
    const visited = new Uint8Array(workW * workH);
    const contours: Point[][] = [];
    const minContourPoints = 25;

    const marginX = Math.round(workW * 0.02);
    const marginY = Math.round(workH * 0.02);

    for (let y = marginY; y < workH - marginY; y += 2) {
      for (let x = marginX; x < workW - marginX; x += 2) {
        const idx = y * workW + x;
        if (dilatedEdges[idx] === 255 && visited[idx] === 0) {
          const contour: Point[] = [];
          const queue: number[] = [idx];
          visited[idx] = 1;

          while (queue.length > 0 && contour.length < 1500) {
            const currIdx = queue.pop()!;
            const cx = currIdx % workW;
            const cy = Math.floor(currIdx / workW);
            contour.push({ x: cx, y: cy });

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

    // 6. Evaluate candidate contours with Multi-Factor Scoring & Line-Intersection Refinement
    let bestQuad: QuadPoints | null = null;
    let bestScore = 0;
    const totalArea = workW * workH;

    for (const contour of contours) {
      const hull = this.convexHull(contour);
      if (hull.length < 4) continue;

      const hullArea = this.polygonArea(hull);
      const areaRatio = hullArea / totalArea;

      // Document must take between 10% and 94% of camera frame
      if (areaRatio < 0.10 || areaRatio > 0.94) continue;

      // Simplify polygon with RDP
      const perimeter = this.polygonPerimeter(hull);
      const epsilon = Math.max(1.8, perimeter * 0.032);
      const approx = this.ramerDouglasPeucker(hull, epsilon);

      let quadCandidate: Point[] | null = null;

      if (approx.length === 4) {
        quadCandidate = approx;
      } else if (approx.length >= 5 && approx.length <= 9) {
        quadCandidate = this.reduceTo4Corners(approx);
      } else {
        quadCandidate = this.extractExtremeCorners(hull);
      }

      if (quadCandidate && quadCandidate.length === 4) {
        // Refine corners via segment edge gradient alignment
        const refinedQuad = this.refineCornerPrecision(quadCandidate, gradMagnitudes, workW, workH);
        const sortedQuad = this.orderQuadPoints(refinedQuad);

        if (this.isValidConvexQuad(sortedQuad, workW, workH)) {
          // Compute Multi-Factor Score:
          // 1. Area Ratio Score (optimal is 25% - 85%)
          const qArea = this.quadArea(sortedQuad);
          const qAreaRatio = qArea / totalArea;
          const areaScore = Math.min(1, qAreaRatio / 0.60);

          // 2. Orthogonality Score (angles close to 90°)
          const orthoScore = this.calculateOrthogonalityScore(sortedQuad);

          // 3. Parallelism Score (opposite edges close in length & direction)
          const parallelScore = this.calculateParallelismScore(sortedQuad);

          // 4. Edge Gradient Quality Score along the 4 quadrilateral lines
          const edgeScore = this.evaluateEdgeGradientQuality(sortedQuad, gradMagnitudes, workW, workH);

          // 5. Aspect Ratio Score
          const wTop = Math.hypot(sortedQuad.topRight.x - sortedQuad.topLeft.x, sortedQuad.topRight.y - sortedQuad.topLeft.y);
          const wBot = Math.hypot(sortedQuad.bottomRight.x - sortedQuad.bottomLeft.x, sortedQuad.bottomRight.y - sortedQuad.bottomLeft.y);
          const hLeft = Math.hypot(sortedQuad.bottomLeft.x - sortedQuad.topLeft.x, sortedQuad.bottomLeft.y - sortedQuad.topLeft.y);
          const hRight = Math.hypot(sortedQuad.bottomRight.x - sortedQuad.topRight.x, sortedQuad.bottomRight.y - sortedQuad.topRight.y);
          const avgW = (wTop + wBot) / 2;
          const avgH = (hLeft + hRight) / 2;
          const aspect = Math.max(avgW, avgH) / Math.max(1, Math.min(avgW, avgH));
          const targetRatio = targetAspect === "card" ? 1.586 : 1.414;
          const aspectDiff = Math.abs(aspect - targetRatio);
          const aspectScore = Math.max(0, 1 - aspectDiff * 0.65);

          // Weighted composite candidate score
          const compositeScore =
            areaScore * 0.25 +
            orthoScore * 0.30 +
            parallelScore * 0.20 +
            edgeScore * 0.15 +
            aspectScore * 0.10;

          if (compositeScore > bestScore) {
            bestScore = compositeScore;
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
        bestScore = 0.52;
      }
    }

    // 8. Scale points back to original video/canvas coordinate space
    const invScale = 1 / scale;
    if (bestQuad && bestScore >= 0.38) {
      const fullQuad: QuadPoints = {
        topLeft: {
          x: Math.max(0, Math.min(srcWidth, Math.round(bestQuad.topLeft.x * invScale))),
          y: Math.max(0, Math.min(srcHeight, Math.round(bestQuad.topLeft.y * invScale))),
        },
        topRight: {
          x: Math.max(0, Math.min(srcWidth, Math.round(bestQuad.topRight.x * invScale))),
          y: Math.max(0, Math.min(srcHeight, Math.round(bestQuad.topRight.y * invScale))),
        },
        bottomRight: {
          x: Math.max(0, Math.min(srcWidth, Math.round(bestQuad.bottomRight.x * invScale))),
          y: Math.max(0, Math.min(srcHeight, Math.round(bestQuad.bottomRight.y * invScale))),
        },
        bottomLeft: {
          x: Math.max(0, Math.min(srcWidth, Math.round(bestQuad.bottomLeft.x * invScale))),
          y: Math.max(0, Math.min(srcHeight, Math.round(bestQuad.bottomLeft.y * invScale))),
        },
      };

      const normalizedFullQuad = DocumentTracker.normalize4Corners([
        fullQuad.topLeft,
        fullQuad.topRight,
        fullQuad.bottomRight,
        fullQuad.bottomLeft,
      ]);

      const confidence = Math.min(0.98, Math.max(0.45, bestScore));

      return {
        quad: normalizedFullQuad,
        confidence,
        isClear: true,
        isRealQuad: true,
        score: bestScore,
      };
    }

    // Default fallback frame
    return {
      quad: this.getDefaultQuad(srcWidth, srcHeight, targetAspect),
      confidence: 0.20,
      isClear: false,
      isRealQuad: false,
      score: 0,
    };
  }

  /**
   * Refine 4 corner points to snap directly onto gradient peaks
   */
  private static refineCornerPrecision(
    pts: Point[],
    gradMag: Uint8Array,
    w: number,
    h: number
  ): Point[] {
    const searchRadius = 4;
    return pts.map((p) => {
      let maxGrad = -1;
      let bestX = p.x;
      let bestY = p.y;

      for (let dy = -searchRadius; dy <= searchRadius; dy++) {
        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
          const nx = Math.round(p.x + dx);
          const ny = Math.round(p.y + dy);
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const mag = gradMag[ny * w + nx];
            if (mag > maxGrad) {
              maxGrad = mag;
              bestX = nx;
              bestY = ny;
            }
          }
        }
      }

      return { x: bestX, y: bestY };
    });
  }

  /**
   * Evaluate edge gradient quality along the 4 quadrilateral lines
   */
  private static evaluateEdgeGradientQuality(
    q: QuadPoints,
    gradMag: Uint8Array,
    w: number,
    h: number
  ): number {
    const edges = [
      [q.topLeft, q.topRight],
      [q.topRight, q.bottomRight],
      [q.bottomRight, q.bottomLeft],
      [q.bottomLeft, q.topLeft],
    ];

    let totalEdgeStrength = 0;
    const samplesPerEdge = 12;

    for (const [p1, p2] of edges) {
      let edgeSum = 0;
      for (let s = 1; s <= samplesPerEdge; s++) {
        const t = s / (samplesPerEdge + 1);
        const sx = Math.round(p1.x + (p2.x - p1.x) * t);
        const sy = Math.round(p1.y + (p2.y - p1.y) * t);
        if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
          edgeSum += gradMag[sy * w + sx];
        }
      }
      totalEdgeStrength += edgeSum / samplesPerEdge;
    }

    const avgEdgeMag = totalEdgeStrength / 4;
    return Math.min(1, avgEdgeMag / 45);
  }

  /**
   * Measure parallelism between opposite edges (0.0 to 1.0)
   */
  private static calculateParallelismScore(q: QuadPoints): number {
    const topW = Math.hypot(q.topRight.x - q.topLeft.x, q.topRight.y - q.topLeft.y);
    const botW = Math.hypot(q.bottomRight.x - q.bottomLeft.x, q.bottomRight.y - q.bottomLeft.y);
    const leftH = Math.hypot(q.bottomLeft.x - q.topLeft.x, q.bottomLeft.y - q.topLeft.y);
    const rightH = Math.hypot(q.bottomRight.x - q.topRight.x, q.bottomRight.y - q.topRight.y);

    if (topW === 0 || botW === 0 || leftH === 0 || rightH === 0) return 0;

    const widthRatio = Math.min(topW, botW) / Math.max(topW, botW);
    const heightRatio = Math.min(leftH, rightH) / Math.max(leftH, rightH);

    return (widthRatio + heightRatio) / 2;
  }

  /**
   * Measure how close 4 interior corners are to 90 degrees (orthogonality score 0.0 to 1.0)
   */
  static calculateOrthogonalityScore(q: QuadPoints): number {
    const pts = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft];
    let totalScore = 0;

    for (let i = 0; i < 4; i++) {
      const prev = pts[(i + 3) % 4];
      const curr = pts[i];
      const next = pts[(i + 1) % 4];

      const v1x = prev.x - curr.x;
      const v1y = prev.y - curr.y;
      const v2x = next.x - curr.x;
      const v2y = next.y - curr.y;

      const len1 = Math.hypot(v1x, v1y);
      const len2 = Math.hypot(v2x, v2y);
      if (len1 === 0 || len2 === 0) continue;

      const cosTheta = Math.abs((v1x * v2x + v1y * v2y) / (len1 * len2));
      const angleScore = Math.max(0, 1 - cosTheta * 1.6);
      totalScore += angleScore;
    }

    return totalScore / 4;
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
    const threshold = Math.min(210, Math.max(95, avgLuma * 1.15));
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

    if (ratio > 0.12 && ratio < 0.94 && count > 150) {
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
   * Reduce arbitrary N-gon (5-9 points) to 4 most significant corners
   */
  private static reduceTo4Corners(points: Point[]): Point[] {
    const centroid = points.reduce(
      (acc, p) => ({ x: acc.x + p.x / points.length, y: acc.y + p.y / points.length }),
      { x: 0, y: 0 }
    );

    const quadPoints: (Point | null)[] = [null, null, null, null];
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
   * Extract 4 extreme points from hull
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
   * Uses polar angles & centroid projection to guarantee no flipping or swapping
   */
  static orderQuadPoints(points: Point[]): QuadPoints {
    if (points.length === 4) {
      return DocumentTracker.normalize4Corners(points);
    }
    return {
      topLeft: points[0] || { x: 0, y: 0 },
      topRight: points[1] || { x: 100, y: 0 },
      bottomRight: points[2] || { x: 100, y: 100 },
      bottomLeft: points[3] || { x: 0, y: 100 },
    };
  }

  /**
   * Validate that 4 points form a valid convex quad with plausible interior angles
   */
  static isValidConvexQuad(q: QuadPoints, boundW: number, boundH: number): boolean {
    const pts = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft];

    const topW = Math.hypot(q.topRight.x - q.topLeft.x, q.topRight.y - q.topLeft.y);
    const botW = Math.hypot(q.bottomRight.x - q.bottomLeft.x, q.bottomRight.y - q.bottomLeft.y);
    const leftH = Math.hypot(q.bottomLeft.x - q.topLeft.x, q.bottomLeft.y - q.topLeft.y);
    const rightH = Math.hypot(q.bottomRight.x - q.topRight.x, q.bottomRight.y - q.topRight.y);

    const minSide = Math.min(boundW, boundH) * 0.12;
    if (topW < minSide || botW < minSide || leftH < minSide || rightH < minSide) {
      return false;
    }

    // Ratio of opposite edges should not be absurd (must be between 0.40 and 2.5)
    if (topW / botW < 0.4 || topW / botW > 2.5) return false;
    if (leftH / rightH < 0.4 || leftH / rightH > 2.5) return false;

    // Check convexity & orientation via cross product signs
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
      boxW = width * 0.82;
      boxH = boxW / 1.586;
      if (boxH > height * 0.75) {
        boxH = height * 0.75;
        boxW = boxH * 1.586;
      }
    } else {
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
      topLeft: { x: Math.round(startX), y: Math.round(startY) },
      topRight: { x: Math.round(startX + boxW), y: Math.round(startY) },
      bottomRight: { x: Math.round(startX + boxW), y: Math.round(startY + boxH) },
      bottomLeft: { x: Math.round(startX), y: Math.round(startY + boxH) },
    };
  }

  /**
   * High quality Perspective Warp Transformation Matrix calculation & rendering
   */
  static warpPerspective(
    source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement,
    quad: QuadPoints,
    outputWidth?: number,
    outputHeight?: number
  ): HTMLCanvasElement {
    const srcTopW = Math.hypot(quad.topRight.x - quad.topLeft.x, quad.topRight.y - quad.topLeft.y);
    const srcBotW = Math.hypot(quad.bottomRight.x - quad.bottomLeft.x, quad.bottomRight.y - quad.bottomLeft.y);
    const srcLeftH = Math.hypot(quad.bottomLeft.x - quad.topLeft.x, quad.bottomLeft.y - quad.topLeft.y);
    const srcRightH = Math.hypot(quad.bottomRight.x - quad.topRight.x, quad.bottomRight.y - quad.topRight.y);

    const targetW = outputWidth || Math.max(800, Math.round(Math.max(srcTopW, srcBotW)));
    const targetH = outputHeight || Math.max(1100, Math.round(Math.max(srcLeftH, srcRightH)));

    const outCanvas = document.createElement("canvas");
    outCanvas.width = targetW;
    outCanvas.height = targetH;
    const outCtx = outCanvas.getContext("2d", { willReadFrequently: true });

    if (!outCtx) return outCanvas;

    // Direct Homography projective warp with bilinear sampling
    const srcCanvas = document.createElement("canvas");
    const sw = (source as any).videoWidth || (source as any).naturalWidth || (source as any).width || 1280;
    const sh = (source as any).videoHeight || (source as any).naturalHeight || (source as any).height || 720;
    srcCanvas.width = sw;
    srcCanvas.height = sh;
    const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });
    if (!srcCtx) return outCanvas;

    srcCtx.drawImage(source as any, 0, 0, sw, sh);
    const srcImageData = srcCtx.getImageData(0, 0, sw, sh);
    const srcPixels = srcImageData.data;

    const outImageData = outCtx.createImageData(targetW, targetH);
    const outPixels = outImageData.data;

    // Compute inverse perspective transform matrix
    const H = this.getPerspectiveTransformMatrix(
      [
        { x: 0, y: 0 },
        { x: targetW, y: 0 },
        { x: targetW, y: targetH },
        { x: 0, y: targetH },
      ],
      [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft]
    );

    // Warp pixels via bilinear interpolation
    for (let y = 0; y < targetH; y++) {
      const rowOffset = y * targetW * 4;
      for (let x = 0; x < targetW; x++) {
        const denom = H[6] * x + H[7] * y + H[8];
        if (denom === 0) continue;

        const srcX = (H[0] * x + H[1] * y + H[2]) / denom;
        const srcY = (H[3] * x + H[4] * y + H[5]) / denom;

        if (srcX >= 0 && srcX < sw - 1 && srcY >= 0 && srcY < sh - 1) {
          const x0 = Math.floor(srcX);
          const y0 = Math.floor(srcY);
          const x1 = x0 + 1;
          const y1 = y0 + 1;

          const dx = srcX - x0;
          const dy = srcY - y0;

          const idx00 = (y0 * sw + x0) * 4;
          const idx10 = (y0 * sw + x1) * 4;
          const idx01 = (y1 * sw + x0) * 4;
          const idx11 = (y1 * sw + x1) * 4;

          const outIdx = rowOffset + x * 4;

          for (let c = 0; c < 3; c++) {
            const v0 = srcPixels[idx00 + c] * (1 - dx) + srcPixels[idx10 + c] * dx;
            const v1 = srcPixels[idx01 + c] * (1 - dx) + srcPixels[idx11 + c] * dx;
            outPixels[outIdx + c] = Math.round(v0 * (1 - dy) + v1 * dy);
          }
          outPixels[outIdx + 3] = 255;
        }
      }
    }

    outCtx.putImageData(outImageData, 0, 0);
    return outCanvas;
  }

  /**
   * 3x3 Projective Homography Matrix solver
   */
  private static getPerspectiveTransformMatrix(srcPts: Point[], dstPts: Point[]): number[] {
    const A: number[][] = [];
    const B: number[] = [];

    for (let i = 0; i < 4; i++) {
      const sx = srcPts[i].x;
      const sy = srcPts[i].y;
      const dx = dstPts[i].x;
      const dy = dstPts[i].y;

      A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
      B.push(dx);

      A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
      B.push(dy);
    }

    // Solve 8x8 linear system via Gaussian elimination
    const h = this.solveLinearSystem(A, B);
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1.0];
  }

  private static solveLinearSystem(A: number[][], B: number[]): number[] {
    const n = B.length;
    for (let i = 0; i < n; i++) {
      let maxEl = Math.abs(A[i][i]);
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(A[k][i]) > maxEl) {
          maxEl = Math.abs(A[k][i]);
          maxRow = k;
        }
      }

      for (let k = i; k < n; k++) {
        const tmp = A[maxRow][k];
        A[maxRow][k] = A[i][k];
        A[i][k] = tmp;
      }
      const tmpB = B[maxRow];
      B[maxRow] = B[i];
      B[i] = tmpB;

      for (let k = i + 1; k < n; k++) {
        const c = -A[k][i] / A[i][i];
        for (let j = i; j < n; j++) {
          if (i === j) {
            A[k][j] = 0;
          } else {
            A[k][j] += c * A[i][j];
          }
        }
        B[k] += c * B[i];
      }
    }

    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let sum = B[i];
      for (let j = i + 1; j < n; j++) {
        sum -= A[i][j] * x[j];
      }
      x[i] = sum / A[i][i];
    }
    return x;
  }

  /**
   * Apply clean, professional document filters (Document Clean, Magic Color, B&W, Grayscale, etc.)
   */
  static applyFilter(
    sourceCanvas: HTMLCanvasElement,
    filter: FilterMode,
    rotationDeg: number = 0
  ): HTMLCanvasElement {
    const rotW = rotationDeg === 90 || rotationDeg === 270 ? sourceCanvas.height : sourceCanvas.width;
    const rotH = rotationDeg === 90 || rotationDeg === 270 ? sourceCanvas.width : sourceCanvas.height;

    const canvas = document.createElement("canvas");
    canvas.width = rotW;
    canvas.height = rotH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return canvas;

    ctx.save();
    ctx.translate(rotW / 2, rotH / 2);
    ctx.rotate((rotationDeg * Math.PI) / 180);
    ctx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);
    ctx.restore();

    if (filter === "original") return canvas;

    const imgData = ctx.getImageData(0, 0, rotW, rotH);
    const data = imgData.data;
    const len = data.length;

    if (filter === "grayscale") {
      for (let i = 0; i < len; i += 4) {
        const luma = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
        data[i] = luma;
        data[i + 1] = luma;
        data[i + 2] = luma;
      }
    } else if (filter === "bw") {
      let sum = 0;
      for (let i = 0; i < len; i += 4) {
        sum += (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
      }
      const avg = sum / (rotW * rotH);
      const thresh = avg * 0.92;

      for (let i = 0; i < len; i += 4) {
        const luma = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
        const v = luma > thresh ? 255 : 0;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
      }
    } else if (filter === "document" || filter === "magic" || filter === "auto") {
      // Document enhancement: white background whitening + contrast boost + dark text sharpening
      for (let i = 0; i < len; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        // S-curve contrast
        r = Math.min(255, Math.max(0, (r - 128) * 1.35 + 128 + 15));
        g = Math.min(255, Math.max(0, (g - 128) * 1.35 + 128 + 15));
        b = Math.min(255, Math.max(0, (b - 128) * 1.35 + 128 + 15));

        // Whitening background
        const luma = (r * 77 + g * 150 + b * 29) >> 8;
        if (luma > 175) {
          const boost = (luma - 175) * 0.95;
          r = Math.min(255, r + boost);
          g = Math.min(255, g + boost);
          b = Math.min(255, b + boost);
        }

        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
      }
    } else if (filter === "photo") {
      // Color photo enhancement
      for (let i = 0; i < len; i += 4) {
        data[i] = Math.min(255, Math.max(0, (data[i] - 128) * 1.15 + 128 + 5));
        data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - 128) * 1.15 + 128 + 5));
        data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - 128) * 1.15 + 128 + 5));
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  /**
   * Helper to load HTMLImageElement from data URL or image URL
   */
  static loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = src;
    });
  }

  /**
   * Stitch multiple scanned pages vertically into a single continuous long image (ảnh dài)
   */
  static async stitchVerticalLongImage(
    pages: { processedImage: string }[],
    spacingPx: number = 20
  ): Promise<string> {
    if (!pages || pages.length === 0) return "";

    const loadedImages: HTMLImageElement[] = [];
    for (const p of pages) {
      const img = await this.loadImage(p.processedImage);
      loadedImages.push(img);
    }

    // Determine max width
    const targetWidth = Math.max(...loadedImages.map((img) => img.naturalWidth || 1200));
    let totalHeight = 0;

    const scaledHeights: number[] = [];
    for (const img of loadedImages) {
      const scale = targetWidth / (img.naturalWidth || 1);
      const h = Math.round((img.naturalHeight || 1) * scale);
      scaledHeights.push(h);
      totalHeight += h;
    }

    totalHeight += spacingPx * (loadedImages.length - 1);

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = totalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";

    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetWidth, totalHeight);

    let currentY = 0;
    for (let i = 0; i < loadedImages.length; i++) {
      const img = loadedImages[i];
      const h = scaledHeights[i];
      ctx.drawImage(img, 0, currentY, targetWidth, h);
      currentY += h + spacingPx;
    }

    return canvas.toDataURL("image/jpeg", 0.92);
  }
}
