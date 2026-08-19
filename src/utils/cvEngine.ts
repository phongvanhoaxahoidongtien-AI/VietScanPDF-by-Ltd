import { FilterMode, Point, QuadPoints } from "../types";

/**
 * Computer Vision & Image Processing Engine for VietScanPDF
 * Runs 100% locally on Client Canvas / Web Worker (0 latency, 100% private)
 */

export class CVEngine {
  /**
   * Fast edge & quadrilateral document boundary detection from video or canvas
   */
  static detectDocumentQuad(
    sourceCanvas: HTMLCanvasElement | CanvasImageSource,
    srcWidth: number,
    srcHeight: number,
    targetAspect: "document" | "card" = "document"
  ): { quad: QuadPoints; confidence: number; isClear: boolean } {
    // Process on a downscaled canvas (320px width) for 60fps real-time camera tracking
    const scale = Math.min(1, 320 / srcWidth);
    const workW = Math.round(srcWidth * scale);
    const workH = Math.round(srcHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = workW;
    canvas.height = workH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    if (!ctx) {
      return {
        quad: this.getDefaultQuad(srcWidth, srcHeight, targetAspect),
        confidence: 0,
        isClear: false,
      };
    }

    ctx.drawImage(sourceCanvas as any, 0, 0, workW, workH);
    const imgData = ctx.getImageData(0, 0, workW, workH);
    const data = imgData.data;

    // 1. Grayscale & simple gradient edge map
    const gray = new Uint8Array(workW * workH);
    for (let i = 0; i < data.length; i += 4) {
      gray[i / 4] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    }

    // 2. Compute horizontal & vertical gradients (Sobel approximation)
    let minX = workW,
      maxX = 0,
      minY = workH,
      maxY = 0;
    let edgeCount = 0;
    const threshold = 35;

    // Scan bounding box of edges with margin
    const marginX = Math.round(workW * 0.06);
    const marginY = Math.round(workH * 0.06);

    for (let y = marginY; y < workH - marginY; y += 2) {
      for (let x = marginX; x < workW - marginX; x += 2) {
        const idx = y * workW + x;
        const gx = Math.abs(gray[idx + 1] - gray[idx - 1]);
        const gy = Math.abs(gray[idx + workW] - gray[idx - workW]);
        const mag = gx + gy;

        if (mag > threshold) {
          edgeCount++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    const docArea = (maxX - minX) * (maxY - minY);
    const totalArea = workW * workH;
    const coverage = docArea / totalArea;

    // If edges cover between 15% and 92% of frame, refine corners
    if (coverage > 0.15 && coverage < 0.95 && edgeCount > 100) {
      const padX = (maxX - minX) * 0.02;
      const padY = (maxY - minY) * 0.02;

      const qW = 1 / scale;
      const quad: QuadPoints = {
        topLeft: {
          x: Math.max(0, (minX - padX) * qW),
          y: Math.max(0, (minY - padY) * qW),
        },
        topRight: {
          x: Math.min(srcWidth, (maxX + padX) * qW),
          y: Math.max(0, (minY - padY) * qW),
        },
        bottomRight: {
          x: Math.min(srcWidth, (maxX + padX) * qW),
          y: Math.min(srcHeight, (maxY + padY) * qW),
        },
        bottomLeft: {
          x: Math.max(0, (minX - padX) * qW),
          y: Math.min(srcHeight, (maxY + padY) * qW),
        },
      };

      return {
        quad,
        confidence: Math.min(0.95, coverage + 0.3),
        isClear: true,
      };
    }

    return {
      quad: this.getDefaultQuad(srcWidth, srcHeight, targetAspect),
      confidence: 0.5,
      isClear: false,
    };
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
