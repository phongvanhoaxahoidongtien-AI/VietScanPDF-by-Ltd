import {
  FilterMode,
  Point,
  QuadPoints,
  DocumentQualityCheck,
  CardSideAnalysis,
} from "../types";
import { DocumentTracker } from "./documentTracker";

/**
 * Computer Vision & Image Processing Engine for VietScan
 * Multi-stage Document Detection, Sub-pixel Line Intersection Corner Refinement,
 * Adaptive Thresholding, Blur/Glare/Exposure Quality Gating, CCCD Front/Back Classification,
 * and Perceptual Hashing Anti-Duplicate System.
 *
 * Runs 100% locally on Client Canvas / Web Worker (0 latency, 100% private).
 */

export interface DetectedQuadResult {
  quad: QuadPoints;
  confidence: number;
  isClear: boolean;
  isRealQuad: boolean;
  score: number;
  quality?: DocumentQualityCheck;
  cardSide?: CardSideAnalysis;
}

export class CVEngine {
  /**
   * STAGE 1 & 2: Multi-Stage Document & Card Detection with Adaptive Edge Analysis
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

    // Process on a downscaled canvas (320px width) for real-time 60fps execution (<5ms per frame)
    const targetWorkWidth = 320;
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

    // 1. Grayscale & Luma distribution statistics
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

    // 2. 3x3 Gaussian Blur to remove paper texture and ink grain
    const blurred = new Uint8Array(workW * workH);
    for (let y = 1; y < workH - 1; y++) {
      const rowPrev = (y - 1) * workW;
      const rowCurr = y * workW;
      const rowNext = (y + 1) * workW;
      for (let x = 1; x < workW - 1; x++) {
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

    // 3. Dual Edge Detection: Combined Directional Sobel Gradient & Local Adaptive Threshold
    const edges = new Uint8Array(workW * workH);
    const gradMagnitudes = new Uint8Array(workW * workH);
    const edgeThreshold = Math.max(16, Math.min(46, lumaRange * 0.20));

    // Compute integral image for fast local adaptive thresholding
    const integral = new Int32Array((workW + 1) * (workH + 1));
    for (let y = 0; y < workH; y++) {
      let sum = 0;
      const intRowCurr = (y + 1) * (workW + 1);
      const intRowPrev = y * (workW + 1);
      const grayRow = y * workW;
      for (let x = 0; x < workW; x++) {
        sum += blurred[grayRow + x];
        integral[intRowCurr + x + 1] = integral[intRowPrev + x + 1] + sum;
      }
    }

    // Adaptive window radius (around 1/16th of frame width)
    const sRadius = Math.max(4, Math.round(workW / 18));
    const adaptC = 7;

    for (let y = 1; y < workH - 1; y++) {
      const rowPrev = (y - 1) * workW;
      const rowCurr = y * workW;
      const rowNext = (y + 1) * workW;

      const y0 = Math.max(0, y - sRadius);
      const y1 = Math.min(workH - 1, y + sRadius);

      for (let x = 1; x < workW - 1; x++) {
        // Sobel Gradient
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

        // Local Adaptive Threshold Check
        const x0 = Math.max(0, x - sRadius);
        const x1 = Math.min(workW - 1, x + sRadius);
        const area = (x1 - x0 + 1) * (y1 - y0 + 1);
        const localSum =
          integral[(y1 + 1) * (workW + 1) + (x1 + 1)] -
          integral[y0 * (workW + 1) + (x1 + 1)] -
          integral[(y1 + 1) * (workW + 1) + x0] +
          integral[y0 * (workW + 1) + x0];
        const localMean = localSum / area;

        const isAdaptiveEdge = blurred[rowCurr + x] < localMean - adaptC && mag > 10;

        if (mag > edgeThreshold || isAdaptiveEdge) {
          edges[rowCurr + x] = 255;
        }
      }
    }

    // 4. Directional Morphological Closing to bridge faint document borders
    const dilatedEdges = new Uint8Array(workW * workH);
    for (let y = 1; y < workH - 1; y++) {
      for (let x = 1; x < workW - 1; x++) {
        const idx = y * workW + x;
        if (
          edges[idx] === 255 ||
          edges[idx - 1] === 255 ||
          edges[idx + 1] === 255 ||
          edges[idx - workW] === 255 ||
          edges[idx + workW] === 255 ||
          edges[idx - workW - 1] === 255 ||
          edges[idx + workW + 1] === 255
        ) {
          dilatedEdges[idx] = 255;
        }
      }
    }

    // 5. Connected Component BFS Contour Extraction
    const visited = new Uint8Array(workW * workH);
    const contours: Point[][] = [];
    const minContourPoints = 20;

    const marginX = Math.round(workW * 0.02);
    const marginY = Math.round(workH * 0.02);

    for (let y = marginY; y < workH - marginY; y += 2) {
      for (let x = marginX; x < workW - marginX; x += 2) {
        const idx = y * workW + x;
        if (dilatedEdges[idx] === 255 && visited[idx] === 0) {
          const contour: Point[] = [];
          const queue: number[] = [idx];
          visited[idx] = 1;

          while (queue.length > 0 && contour.length < 1800) {
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

    // 6. Multi-Factor Candidate Scoring & Sub-Pixel Line-Intersection Refinement
    let bestQuad: QuadPoints | null = null;
    let bestScore = 0;
    const totalArea = workW * workH;

    for (const contour of contours) {
      const hull = this.convexHull(contour);
      if (hull.length < 4) continue;

      const hullArea = this.polygonArea(hull);
      const areaRatio = hullArea / totalArea;

      // Filter contours by plausible document area ratio (12% to 94%)
      if (areaRatio < 0.12 || areaRatio > 0.94) continue;

      const perimeter = this.polygonPerimeter(hull);

      // Try multiple RDP approximation tolerances to find cleanest polygon
      const epsilons = [perimeter * 0.025, perimeter * 0.038, perimeter * 0.052];
      let candidatePts: Point[] | null = null;

      for (const eps of epsilons) {
        const approx = this.ramerDouglasPeucker(hull, Math.max(1.8, eps));
        if (approx.length === 4) {
          candidatePts = approx;
          break;
        } else if (approx.length >= 5 && approx.length <= 8 && !candidatePts) {
          candidatePts = this.reduceTo4Corners(approx);
        }
      }

      if (!candidatePts) {
        candidatePts = this.extractExtremeCorners(hull);
      }

      if (candidatePts && candidatePts.length === 4) {
        // High-Precision Corner Refinement via Sub-Pixel Line Intersections
        const rawOrdered = this.orderQuadPoints(candidatePts);
        const refinedQuad = this.refineCornersByLineFitting(rawOrdered, gradMagnitudes, workW, workH);
        const sortedQuad = this.orderQuadPoints([
          refinedQuad.topLeft,
          refinedQuad.topRight,
          refinedQuad.bottomRight,
          refinedQuad.bottomLeft,
        ]);

        if (this.isValidConvexQuad(sortedQuad, workW, workH)) {
          const qArea = this.quadArea(sortedQuad);
          const qAreaRatio = qArea / totalArea;

          // 1. Area Score (Optimal is 25% - 82%)
          const areaScore =
            qAreaRatio >= 0.25 && qAreaRatio <= 0.82
              ? 1.0
              : qAreaRatio < 0.25
              ? Math.max(0, qAreaRatio / 0.25)
              : Math.max(0, 1 - (qAreaRatio - 0.82) * 4);

          // 2. Orthogonality Score (Angles close to 90°)
          const orthoScore = this.calculateOrthogonalityScore(sortedQuad);

          // 3. Parallelism Score
          const parallelScore = this.calculateParallelismScore(sortedQuad);

          // 4. Edge Gradient Energy along the 4 quadrilateral lines
          const edgeScore = this.evaluateEdgeGradientQuality(sortedQuad, gradMagnitudes, workW, workH);

          // 5. Foreground vs Background Border Contrast
          const contrastScore = this.evaluateBorderContrast(sortedQuad, blurred, workW, workH);

          // 6. Aspect Ratio Score
          const wTop = Math.hypot(
            sortedQuad.topRight.x - sortedQuad.topLeft.x,
            sortedQuad.topRight.y - sortedQuad.topLeft.y
          );
          const wBot = Math.hypot(
            sortedQuad.bottomRight.x - sortedQuad.bottomLeft.x,
            sortedQuad.bottomRight.y - sortedQuad.bottomLeft.y
          );
          const hLeft = Math.hypot(
            sortedQuad.bottomLeft.x - sortedQuad.topLeft.x,
            sortedQuad.bottomLeft.y - sortedQuad.topLeft.y
          );
          const hRight = Math.hypot(
            sortedQuad.bottomRight.x - sortedQuad.topRight.x,
            sortedQuad.bottomRight.y - sortedQuad.topRight.y
          );
          const avgW = (wTop + wBot) / 2;
          const avgH = (hLeft + hRight) / 2;
          const aspect = Math.max(avgW, avgH) / Math.max(1, Math.min(avgW, avgH));
          const targetRatio = targetAspect === "card" ? 1.586 : 1.414;
          const aspectDiff = Math.abs(aspect - targetRatio);
          const aspectScore = Math.max(0, 1 - aspectDiff * 0.7);

          // Composite Weighted Candidate Score
          const compositeScore =
            orthoScore * 0.25 +
            edgeScore * 0.25 +
            contrastScore * 0.20 +
            parallelScore * 0.15 +
            areaScore * 0.10 +
            aspectScore * 0.05;

          if (compositeScore > bestScore) {
            bestScore = compositeScore;
            bestQuad = sortedQuad;
          }
        }
      }
    }

    // 7. Bright/Dark Background Threshold Fallback
    if (!bestQuad || bestScore < 0.35) {
      const brightQuad = this.findBrightDocumentRegionQuad(blurred, workW, workH, avgLuma);
      if (brightQuad) {
        const sortedBright = this.orderQuadPoints([
          brightQuad.topLeft,
          brightQuad.topRight,
          brightQuad.bottomRight,
          brightQuad.bottomLeft,
        ]);
        if (this.isValidConvexQuad(sortedBright, workW, workH)) {
          bestQuad = sortedBright;
          bestScore = Math.max(bestScore, 0.48);
        }
      }
    }

    // 8. Map coordinates back to full resolution
    const invScale = 1 / scale;
    if (bestQuad && bestScore >= 0.26) {
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

      const confidence = Math.min(0.98, Math.max(0.40, bestScore));

      // Quality and Card Side Analysis
      const quality = this.checkDocumentQuality(
        sourceCanvas,
        normalizedFullQuad,
        srcWidth,
        srcHeight,
        targetAspect
      );

      let cardSide: CardSideAnalysis | undefined = undefined;
      if (targetAspect === "card") {
        cardSide = this.analyzeCardSide(sourceCanvas, normalizedFullQuad);
      }

      return {
        quad: normalizedFullQuad,
        confidence,
        isClear: quality.isSharp && quality.isWellExposed && quality.hasNoGlare,
        isRealQuad: true,
        score: bestScore,
        quality,
        cardSide,
      };
    }

    // Fallback default quad
    const defaultQuad = this.getDefaultQuad(srcWidth, srcHeight, targetAspect);
    const defaultQuality = this.checkDocumentQuality(
      sourceCanvas,
      defaultQuad,
      srcWidth,
      srcHeight,
      targetAspect
    );

    return {
      quad: defaultQuad,
      confidence: 0.18,
      isClear: false,
      isRealQuad: false,
      score: 0,
      quality: defaultQuality,
    };
  }

  /**
   * STAGE 3: Sub-Pixel Line Fitting & Intersection Corner Refinement
   * For each of the 4 edges, samples normal search profiles to find gradient peaks,
   * fits linear regression lines (L0, L1, L2, L3), and intersects them to find exact corners.
   */
  private static refineCornersByLineFitting(
    q: QuadPoints,
    gradMag: Uint8Array,
    w: number,
    h: number
  ): QuadPoints {
    const edges = [
      { p1: q.topLeft, p2: q.topRight },       // Top
      { p1: q.topRight, p2: q.bottomRight },   // Right
      { p1: q.bottomRight, p2: q.bottomLeft }, // Bottom
      { p1: q.bottomLeft, p2: q.topLeft },     // Left
    ];

    const fittedLines: { a: number; b: number; c: number }[] = [];
    const samplesPerEdge = 14;
    const searchRadius = 7;

    for (const edge of edges) {
      const dx = edge.p2.x - edge.p1.x;
      const dy = edge.p2.y - edge.p1.y;
      const edgeLen = Math.hypot(dx, dy);
      if (edgeLen === 0) {
        fittedLines.push({ a: 0, b: 1, c: -edge.p1.y });
        continue;
      }

      // Unit normal vector perpendicular to edge
      const nx = -dy / edgeLen;
      const ny = dx / edgeLen;

      const edgePeaks: Point[] = [];

      for (let s = 1; s <= samplesPerEdge; s++) {
        const t = s / (samplesPerEdge + 1);
        const bx = edge.p1.x + dx * t;
        const by = edge.p1.y + dy * t;

        let maxGrad = 0;
        let bestOffset = 0;

        for (let r = -searchRadius; r <= searchRadius; r++) {
          const px = Math.round(bx + nx * r);
          const py = Math.round(by + ny * r);
          if (px >= 0 && px < w && py >= 0 && py < h) {
            const mag = gradMag[py * w + px];
            if (mag > maxGrad) {
              maxGrad = mag;
              bestOffset = r;
            }
          }
        }

        if (maxGrad > 15) {
          edgePeaks.push({
            x: bx + nx * bestOffset,
            y: by + ny * bestOffset,
          });
        }
      }

      // Fit 2D line: a*x + b*y + c = 0 using robust Linear Regression
      if (edgePeaks.length >= 4) {
        fittedLines.push(this.fitLine2D(edgePeaks));
      } else {
        // Fallback to original line segment
        const a = dy;
        const b = -dx;
        const c = -(a * edge.p1.x + b * edge.p1.y);
        fittedLines.push({ a, b, c });
      }
    }

    // Intersect adjacent line pairs
    const intersect = (
      l1: { a: number; b: number; c: number },
      l2: { a: number; b: number; c: number }
    ): Point | null => {
      const det = l1.a * l2.b - l2.a * l1.b;
      if (Math.abs(det) < 1e-5) return null;
      const x = (l1.b * l2.c - l2.b * l1.c) / det;
      const y = (l2.a * l1.c - l1.a * l2.c) / det;
      return { x, y };
    };

    const tl = intersect(fittedLines[3], fittedLines[0]) || q.topLeft;
    const tr = intersect(fittedLines[0], fittedLines[1]) || q.topRight;
    const br = intersect(fittedLines[1], fittedLines[2]) || q.bottomRight;
    const bl = intersect(fittedLines[2], fittedLines[3]) || q.bottomLeft;

    // Constrain refined corners to not deviate wildly from initial contour
    const clampDist = (pt: Point, original: Point, maxDev: number): Point => {
      const d = Math.hypot(pt.x - original.x, pt.y - original.y);
      if (d > maxDev) {
        const ratio = maxDev / d;
        return {
          x: original.x + (pt.x - original.x) * ratio,
          y: original.y + (pt.y - original.y) * ratio,
        };
      }
      return pt;
    };

    const maxDev = Math.min(w, h) * 0.08;
    return {
      topLeft: clampDist(tl, q.topLeft, maxDev),
      topRight: clampDist(tr, q.topRight, maxDev),
      bottomRight: clampDist(br, q.bottomRight, maxDev),
      bottomLeft: clampDist(bl, q.bottomLeft, maxDev),
    };
  }

  /**
   * Fit 2D line a*x + b*y + c = 0 through points using Least Squares
   */
  private static fitLine2D(points: Point[]): { a: number; b: number; c: number } {
    const n = points.length;
    let mx = 0,
      my = 0;
    for (const p of points) {
      mx += p.x;
      my += p.y;
    }
    mx /= n;
    my /= n;

    let sxx = 0,
      syy = 0,
      sxy = 0;
    for (const p of points) {
      const dx = p.x - mx;
      const dy = p.y - my;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }

    if (Math.abs(sxy) < 1e-5) {
      if (sxx > syy) {
        return { a: 0, b: 1, c: -my };
      } else {
        return { a: 1, b: 0, c: -mx };
      }
    }

    // Principal component angle
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const a = -Math.sin(angle);
    const b = Math.cos(angle);
    const c = -(a * mx + b * my);

    return { a, b, c };
  }

  /**
   * STAGE 4: Quality Checks (Blur, Glare, Brightness, Size, Skew)
   */
  static checkDocumentQuality(
    sourceCanvas: HTMLCanvasElement | HTMLVideoElement | CanvasImageSource,
    quad: QuadPoints,
    frameW: number,
    frameH: number,
    mode: "document" | "card" = "document"
  ): DocumentQualityCheck {
    const totalFrameArea = frameW * frameH;
    const qArea = this.quadArea(quad);
    const sizeRatio = qArea / Math.max(1, totalFrameArea);

    // 1. Skew / Orthogonality check
    const orthoScore = this.calculateOrthogonalityScore(quad);
    const skewScore = Math.round(orthoScore * 100);
    const isWellAligned = orthoScore >= 0.45;

    // 2. Size Check
    const minSize = mode === "card" ? 0.12 : 0.14;
    const isGoodSize = sizeRatio >= minSize && sizeRatio <= 0.95;

    // Sample interior region on small preview canvas to evaluate Blur & Glare
    const sampleW = 120;
    const sampleH = 80;
    const canvas = document.createElement("canvas");
    canvas.width = sampleW;
    canvas.height = sampleH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    if (!ctx) {
      return {
        sharpness: 75,
        brightness: 130,
        glarePercent: 0,
        sizeRatio,
        skewScore,
        isSharp: true,
        isWellExposed: true,
        hasNoGlare: true,
        isGoodSize,
        isWellAligned,
        isReadyForCapture: isGoodSize && isWellAligned,
        guidanceCode: isGoodSize ? "READY" : "TOO_SMALL",
        guidanceText: isGoodSize ? "Đang chụp..." : "Đưa điện thoại gần tài liệu hơn",
      };
    }

    // Warp sample interior
    const warped = this.warpPerspective(sourceCanvas as any, quad, sampleW, sampleH);
    ctx.drawImage(warped, 0, 0, sampleW, sampleH);
    const imgData = ctx.getImageData(0, 0, sampleW, sampleH);
    const data = imgData.data;

    let totalLuma = 0;
    let glareCount = 0;
    const gray = new Uint8Array(sampleW * sampleH);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luma = (r * 77 + g * 150 + b * 29) >> 8;
      gray[i / 4] = luma;
      totalLuma += luma;

      // Glare detection: Near maximum saturation white
      if (luma > 248 && Math.abs(r - g) < 12 && Math.abs(g - b) < 12) {
        glareCount++;
      }
    }

    const brightness = Math.round(totalLuma / (sampleW * sampleH));
    const glarePercent = (glareCount / (sampleW * sampleH)) * 100;

    // 3. Sharpness / Blur via Modified Laplacian Variance
    let lapSum = 0;
    let lapSqSum = 0;
    let lapCount = 0;

    for (let y = 1; y < sampleH - 1; y++) {
      const rowPrev = (y - 1) * sampleW;
      const rowCurr = y * sampleW;
      const rowNext = (y + 1) * sampleW;
      for (let x = 1; x < sampleW - 1; x++) {
        const lap =
          gray[rowPrev + x] +
          gray[rowNext + x] +
          gray[rowCurr + x - 1] +
          gray[rowCurr + x + 1] -
          4 * gray[rowCurr + x];
        lapSum += lap;
        lapSqSum += lap * lap;
        lapCount++;
      }
    }

    const lapMean = lapSum / Math.max(1, lapCount);
    const lapVar = lapSqSum / Math.max(1, lapCount) - lapMean * lapMean;
    const sharpness = Math.min(100, Math.round(Math.sqrt(Math.max(0, lapVar)) * 3.5));

    const isSharp = sharpness >= 12;
    const isWellExposed = brightness >= 25 && brightness <= 245;
    const hasNoGlare = glarePercent <= 25.0;

    // Determine smart guidance code
    let guidanceCode: DocumentQualityCheck["guidanceCode"] = "READY";
    let guidanceText = "Đang tự động chụp...";

    if (sizeRatio < minSize) {
      guidanceCode = "TOO_SMALL";
      guidanceText = "Đưa điện thoại gần tài liệu hơn";
    } else if (sizeRatio > 0.95) {
      guidanceCode = "TOO_LARGE";
      guidanceText = "Đưa điện thoại ra xa một chút";
    } else if (!isWellAligned) {
      guidanceCode = "TOO_SKEWED";
      guidanceText = "Căn thẳng góc với tài liệu";
    } else if (!isWellExposed && brightness < 25) {
      guidanceCode = "TOO_DARK";
      guidanceText = "Tăng ánh sáng để ảnh rõ hơn";
    } else if (!hasNoGlare) {
      guidanceCode = "GLARE";
      guidanceText = "Nghiêng nhẹ máy tránh bóng lóa sáng";
    } else if (!isSharp) {
      guidanceCode = "TOO_BLURRY";
      guidanceText = "Giữ điện thoại ổn định để lấy nét";
    }

    const isReadyForCapture = isGoodSize && isWellAligned && isSharp;

    return {
      sharpness,
      brightness,
      glarePercent,
      sizeRatio,
      skewScore,
      isSharp,
      isWellExposed,
      hasNoGlare,
      isGoodSize,
      isWellAligned,
      isReadyForCapture,
      guidanceCode,
      guidanceText,
    };
  }

  /**
   * STAGE 5: CCCD / ID Card Front vs Back Visual Layout Classifier
   * Analyzes photo box & national emblem on front vs bottom MRZ text lines & chip on back.
   */
  static analyzeCardSide(
    sourceCanvas: HTMLCanvasElement | HTMLVideoElement | CanvasImageSource,
    quad: QuadPoints
  ): CardSideAnalysis {
    const cardW = 320;
    const cardH = 200;
    const canvas = document.createElement("canvas");
    canvas.width = cardW;
    canvas.height = cardH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    if (!ctx) {
      return {
        predictedSide: "unknown",
        frontConfidence: 0.5,
        backConfidence: 0.5,
        hasPhotoOrEmblem: false,
        hasMRZOrChip: false,
      };
    }

    // Warp perspective into standard card layout
    const warped = this.warpPerspective(sourceCanvas as any, quad, cardW, cardH);
    ctx.drawImage(warped, 0, 0, cardW, cardH);
    const imgData = ctx.getImageData(0, 0, cardW, cardH);
    const data = imgData.data;

    // Feature 1: Left Half vs Right Half Contrast Asymmetry (Front has portrait photo on left)
    let leftLumaSum = 0,
      rightLumaSum = 0;
    let leftVarSum = 0,
      rightVarSum = 0;
    const halfW = cardW / 2;

    for (let y = 30; y < cardH - 30; y++) {
      for (let x = 15; x < cardW - 15; x++) {
        const idx = (y * cardW + x) * 4;
        const luma = (data[idx] * 77 + data[idx + 1] * 150 + data[idx + 2] * 29) >> 8;
        if (x < halfW) {
          leftLumaSum += luma;
        } else {
          rightLumaSum += luma;
        }
      }
    }

    const halfPixels = (cardH - 60) * (halfW - 15);
    const leftMean = leftLumaSum / halfPixels;
    const rightMean = rightLumaSum / halfPixels;

    for (let y = 30; y < cardH - 30; y++) {
      for (let x = 15; x < cardW - 15; x++) {
        const idx = (y * cardW + x) * 4;
        const luma = (data[idx] * 77 + data[idx + 1] * 150 + data[idx + 2] * 29) >> 8;
        if (x < halfW) {
          leftVarSum += (luma - leftMean) * (luma - leftMean);
        } else {
          rightVarSum += (luma - rightMean) * (luma - rightMean);
        }
      }
    }

    const leftStd = Math.sqrt(leftVarSum / halfPixels);
    const rightStd = Math.sqrt(rightVarSum / halfPixels);

    // Feature 2: Bottom 25% MRZ High Frequency Text Stripes (Characteristic of CCCD Back)
    let bottomHorizTransitions = 0;
    const bottomStartY = Math.round(cardH * 0.72);

    for (let y = bottomStartY; y < cardH - 10; y += 3) {
      for (let x = 20; x < cardW - 20; x++) {
        const idx0 = (y * cardW + x) * 4;
        const idx1 = (y * cardW + x + 1) * 4;
        const l0 = (data[idx0] * 77 + data[idx0 + 1] * 150 + data[idx0 + 2] * 29) >> 8;
        const l1 = (data[idx1] * 77 + data[idx1 + 1] * 150 + data[idx1 + 2] * 29) >> 8;
        if (Math.abs(l0 - l1) > 28) {
          bottomHorizTransitions++;
        }
      }
    }

    // Compute Perceptual Hash
    const pHash = this.computePerceptualHashFromCanvas(canvas);

    // Front indicators: Left photo box has high texture variance (hair/face) & darker mean
    const hasPhotoOrEmblem = leftStd > rightStd * 1.15 || leftMean < rightMean - 12;

    // Back indicators: Bottom MRZ text lines have high horizontal transition count
    const hasMRZOrChip = bottomHorizTransitions > 240 || (rightStd > leftStd * 1.10);

    let frontConfidence = 0.5;
    let backConfidence = 0.5;

    if (hasPhotoOrEmblem && !hasMRZOrChip) {
      frontConfidence = 0.85;
      backConfidence = 0.15;
    } else if (hasMRZOrChip && !hasPhotoOrEmblem) {
      frontConfidence = 0.15;
      backConfidence = 0.85;
    } else if (hasPhotoOrEmblem) {
      frontConfidence = 0.70;
      backConfidence = 0.30;
    }

    const predictedSide: "front" | "back" | "unknown" =
      frontConfidence > 0.65 ? "front" : backConfidence > 0.65 ? "back" : "unknown";

    return {
      predictedSide,
      frontConfidence,
      backConfidence,
      hasPhotoOrEmblem,
      hasMRZOrChip,
      perceptualHash: pHash,
    };
  }

  /**
   * STAGE 6: Perceptual Difference Hash (dHash) for Anti-Duplicate Locking
   */
  static computePerceptualHashFromCanvas(canvas: HTMLCanvasElement): string {
    const thumb = document.createElement("canvas");
    thumb.width = 9;
    thumb.height = 8;
    const ctx = thumb.getContext("2d", { willReadFrequently: true });
    if (!ctx) return "0000000000000000";

    ctx.drawImage(canvas, 0, 0, 9, 8);
    const imgData = ctx.getImageData(0, 0, 9, 8);
    const data = imgData.data;

    let hash = "";
    for (let y = 0; y < 8; y++) {
      let rowByte = 0;
      for (let x = 0; x < 8; x++) {
        const idx1 = (y * 9 + x) * 4;
        const idx2 = (y * 9 + x + 1) * 4;
        const luma1 = (data[idx1] * 77 + data[idx1 + 1] * 150 + data[idx1 + 2] * 29) >> 8;
        const luma2 = (data[idx2] * 77 + data[idx2 + 1] * 150 + data[idx2 + 2] * 29) >> 8;
        if (luma1 > luma2) {
          rowByte |= 1 << (7 - x);
        }
      }
      hash += rowByte.toString(16).padStart(2, "0");
    }

    return hash;
  }

  /**
   * Compare similarity between two perceptual hashes (0.0 to 1.0)
   */
  static compareHashSimilarity(hash1?: string, hash2?: string): number {
    if (!hash1 || !hash2 || hash1.length !== hash2.length) return 0;

    let matches = 0;
    const totalBits = hash1.length * 4;

    for (let i = 0; i < hash1.length; i++) {
      const v1 = parseInt(hash1[i], 16);
      const v2 = parseInt(hash2[i], 16);
      const xor = v1 ^ v2;
      // Count matching bits
      let diff = 0;
      for (let b = 0; b < 4; b++) {
        if ((xor >> b) & 1) diff++;
      }
      matches += 4 - diff;
    }

    return matches / totalBits;
  }

  /**
   * Evaluate background vs foreground luminance contrast across the 4 quad borders
   */
  private static evaluateBorderContrast(
    q: QuadPoints,
    blurred: Uint8Array,
    w: number,
    h: number
  ): number {
    const edges = [
      { p1: q.topLeft, p2: q.topRight },
      { p1: q.topRight, p2: q.bottomRight },
      { p1: q.bottomRight, p2: q.bottomLeft },
      { p1: q.bottomLeft, p2: q.topLeft },
    ];

    let totalContrast = 0;
    const samples = 8;
    const delta = 4; // Sample 4px inside vs 4px outside

    for (const edge of edges) {
      const dx = edge.p2.x - edge.p1.x;
      const dy = edge.p2.y - edge.p1.y;
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;

      const nx = -dy / len;
      const ny = dx / len;

      let edgeDiff = 0;
      for (let s = 1; s <= samples; s++) {
        const t = s / (samples + 1);
        const cx = edge.p1.x + dx * t;
        const cy = edge.p1.y + dy * t;

        const inX = Math.round(cx - nx * delta);
        const inY = Math.round(cy - ny * delta);
        const outX = Math.round(cx + nx * delta);
        const outY = Math.round(cy + ny * delta);

        if (inX >= 0 && inX < w && inY >= 0 && inY < h && outX >= 0 && outX < w && outY >= 0 && outY < h) {
          const lumaIn = blurred[inY * w + inX];
          const lumaOut = blurred[outY * w + outX];
          edgeDiff += Math.abs(lumaIn - lumaOut);
        }
      }
      totalContrast += edgeDiff / samples;
    }

    const avgContrast = totalContrast / 4;
    return Math.min(1, avgContrast / 35);
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
    const samplesPerEdge = 14;

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
    return Math.min(1, avgEdgeMag / 42);
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
      const angleScore = Math.max(0, 1 - cosTheta * 1.5);
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
    const threshold = Math.min(210, Math.max(90, avgLuma * 1.12));
    let minX = w,
      maxX = 0,
      minY = h,
      maxY = 0;
    let count = 0;

    const marginX = Math.round(w * 0.04);
    const marginY = Math.round(h * 0.04);

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

    if (ratio > 0.14 && ratio < 0.92 && count > 120) {
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
   * Validate that 4 points form a valid convex quad
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

    if (topW / botW < 0.38 || topW / botW > 2.6) return false;
    if (leftH / rightH < 0.38 || leftH / rightH > 2.6) return false;

    // Convexity check via cross product signs
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

    // Bilinear interpolation warp
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
   * Apply clean, professional document filters
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
   * Stitch multiple scanned pages vertically into a single continuous long image
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
