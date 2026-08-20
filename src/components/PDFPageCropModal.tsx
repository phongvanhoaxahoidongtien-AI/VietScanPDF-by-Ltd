import React, { useRef, useState, useEffect, useCallback } from "react";
import { ArrowLeft, Check, RotateCw, Sparkles, Maximize2, RefreshCw } from "lucide-react";
import { Point, QuadPoints } from "../types";
import { CVEngine } from "../utils/cvEngine";

interface PDFPageCropModalProps {
  imageSrc: string;
  initialQuad?: QuadPoints;
  pageNumber?: number;
  onComplete: (newImageSrc: string) => void;
  onCancel: () => void;
}

export const PDFPageCropModal: React.FC<PDFPageCropModalProps> = ({
  imageSrc,
  initialQuad,
  pageNumber,
  onComplete,
  onCancel,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);

  const [currentImageSrc, setCurrentImageSrc] = useState<string>(imageSrc);
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);
  const [quad, setQuad] = useState<QuadPoints | null>(null);
  const [activeCorner, setActiveCorner] = useState<keyof QuadPoints | null>(null);
  const [scale, setScale] = useState<{ scaleX: number; scaleY: number; offsetX: number; offsetY: number }>({
    scaleX: 1,
    scaleY: 1,
    offsetX: 0,
    offsetY: 0,
  });
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Load image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setImgElement(img);
      const defaultQ =
        initialQuad || {
          topLeft: { x: 0, y: 0 },
          topRight: { x: img.naturalWidth, y: 0 },
          bottomRight: { x: img.naturalWidth, y: img.naturalHeight },
          bottomLeft: { x: 0, y: img.naturalHeight },
        };
      setQuad(defaultQ);
    };
    img.src = currentImageSrc;
  }, [currentImageSrc, initialQuad]);

  // Redraw canvas with crop polygon & handles
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !imgElement || !quad) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cWidth = container.clientWidth;
    const cHeight = container.clientHeight;
    canvas.width = cWidth;
    canvas.height = cHeight;

    const imgAspect = imgElement.naturalWidth / imgElement.naturalHeight;
    const containerAspect = cWidth / cHeight;

    let drawW = cWidth;
    let drawH = cHeight;
    let offX = 0;
    let offY = 0;

    if (imgAspect > containerAspect) {
      drawW = cWidth;
      drawH = cWidth / imgAspect;
      offY = (cHeight - drawH) / 2;
    } else {
      drawH = cHeight;
      drawW = cHeight * imgAspect;
      offX = (cWidth - drawW) / 2;
    }

    const sX = drawW / imgElement.naturalWidth;
    const sY = drawH / imgElement.naturalHeight;

    setScale({ scaleX: sX, scaleY: sY, offsetX: offX, offsetY: offY });

    // Draw background image
    ctx.clearRect(0, 0, cWidth, cHeight);
    ctx.drawImage(imgElement, offX, offY, drawW, drawH);

    // Coordinate mapping helper
    const toScreen = (p: Point): Point => ({
      x: offX + p.x * sX,
      y: offY + p.y * sY,
    });

    const p0 = toScreen(quad.topLeft);
    const p1 = toScreen(quad.topRight);
    const p2 = toScreen(quad.bottomRight);
    const p3 = toScreen(quad.bottomLeft);

    // Darken mask outside quad
    ctx.save();
    ctx.fillStyle = "rgba(15, 23, 42, 0.65)";
    ctx.fillRect(0, 0, cWidth, cHeight);

    // Cut out quad
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Redraw illuminated region
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(imgElement, offX, offY, drawW, drawH);
    ctx.restore();

    // Border lines
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#3b82f6";
    ctx.stroke();

    // Guidelines
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    ctx.setLineDash([4, 4]);
    for (let r = 1; r <= 2; r++) {
      const u = r / 3;
      const lx = p0.x + (p3.x - p0.x) * u;
      const ly = p0.y + (p3.y - p0.y) * u;
      const rx = p1.x + (p2.x - p1.x) * u;
      const ry = p1.y + (p2.y - p1.y) * u;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(rx, ry);
      ctx.stroke();
    }
    for (let c = 1; c <= 2; c++) {
      const v = c / 3;
      const tx = p0.x + (p1.x - p0.x) * v;
      const ty = p0.y + (p1.y - p0.y) * v;
      const bx = p3.x + (p2.x - p3.x) * v;
      const by = p3.y + (p2.y - p3.y) * v;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.restore();

    // Corner handles
    const corners: { point: Point; name: keyof QuadPoints }[] = [
      { point: p0, name: "topLeft" },
      { point: p1, name: "topRight" },
      { point: p2, name: "bottomRight" },
      { point: p3, name: "bottomLeft" },
    ];

    corners.forEach(({ point, name }) => {
      const isActive = activeCorner === name;

      ctx.beginPath();
      ctx.arc(point.x, point.y, isActive ? 22 : 18, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? "rgba(59, 130, 246, 0.45)" : "rgba(255, 255, 255, 0.9)";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(point.x, point.y, isActive ? 12 : 9, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? "#2563eb" : "#3b82f6";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    });
  }, [imgElement, quad, activeCorner]);

  useEffect(() => {
    redraw();
    window.addEventListener("resize", redraw);
    return () => window.removeEventListener("resize", redraw);
  }, [redraw]);

  // Pointer event handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!quad || !imgElement) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const touchX = e.clientX - rect.left;
    const touchY = e.clientY - rect.top;

    const toScreen = (p: Point): Point => ({
      x: scale.offsetX + p.x * scale.scaleX,
      y: scale.offsetY + p.y * scale.scaleY,
    });

    const corners: { name: keyof QuadPoints; p: Point }[] = [
      { name: "topLeft", p: toScreen(quad.topLeft) },
      { name: "topRight", p: toScreen(quad.topRight) },
      { name: "bottomRight", p: toScreen(quad.bottomRight) },
      { name: "bottomLeft", p: toScreen(quad.bottomLeft) },
    ];

    let closestCorner: keyof QuadPoints | null = null;
    let minDist = 48;

    for (const c of corners) {
      const dist = Math.hypot(touchX - c.p.x, touchY - c.p.y);
      if (dist < minDist) {
        minDist = dist;
        closestCorner = c.name;
      }
    }

    if (closestCorner) {
      setActiveCorner(closestCorner);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeCorner || !quad || !imgElement) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const touchX = e.clientX - rect.left;
    const touchY = e.clientY - rect.top;

    const imgX = Math.max(0, Math.min(imgElement.naturalWidth, (touchX - scale.offsetX) / scale.scaleX));
    const imgY = Math.max(0, Math.min(imgElement.naturalHeight, (touchY - scale.offsetY) / scale.scaleY));

    setQuad((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [activeCorner]: { x: imgX, y: imgY },
      };
    });

    drawLoupe(imgX, imgY);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activeCorner) {
      setActiveCorner(null);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (err) {
        // ignore
      }
    }
  };

  const drawLoupe = (imgX: number, imgY: number) => {
    const loupe = loupeCanvasRef.current;
    if (!loupe || !imgElement) return;
    const ctx = loupe.getContext("2d");
    if (!ctx) return;

    const zoom = 2.4;
    const size = 120;
    loupe.width = size;
    loupe.height = size;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.drawImage(
      imgElement,
      imgX - size / 2 / zoom,
      imgY - size / 2 / zoom,
      size / zoom,
      size / zoom,
      0,
      0,
      size,
      size
    );

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#ef4444";
    ctx.beginPath();
    ctx.moveTo(size / 2 - 12, size / 2);
    ctx.lineTo(size / 2 + 12, size / 2);
    ctx.moveTo(size / 2, size / 2 - 12);
    ctx.lineTo(size / 2, size / 2 + 12);
    ctx.stroke();

    ctx.restore();
  };

  // Auto-detect document quad
  const handleAutoFit = () => {
    if (!imgElement) return;
    const { quad: detected } = CVEngine.detectDocumentQuad(
      imgElement,
      imgElement.naturalWidth,
      imgElement.naturalHeight,
      "document"
    );
    setQuad(detected);
  };

  // Reset to full frame
  const handleResetFull = () => {
    if (!imgElement) return;
    setQuad({
      topLeft: { x: 0, y: 0 },
      topRight: { x: imgElement.naturalWidth, y: 0 },
      bottomRight: { x: imgElement.naturalWidth, y: imgElement.naturalHeight },
      bottomLeft: { x: 0, y: imgElement.naturalHeight },
    });
  };

  // Rotate 90 degrees clockwise
  const handleRotate = () => {
    if (!imgElement) return;
    const canvas = document.createElement("canvas");
    canvas.width = imgElement.naturalHeight;
    canvas.height = imgElement.naturalWidth;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((90 * Math.PI) / 180);
    ctx.drawImage(imgElement, -imgElement.naturalWidth / 2, -imgElement.naturalHeight / 2);

    const rotatedUrl = canvas.toDataURL("image/jpeg", 0.94);
    setCurrentImageSrc(rotatedUrl);
  };

  // Confirm and warp
  const handleConfirm = () => {
    if (!imgElement || !quad) return;
    setIsProcessing(true);

    setTimeout(() => {
      const warped = CVEngine.warpPerspective(imgElement, quad);
      const outputUrl = warped.toDataURL("image/jpeg", 0.94);
      onComplete(outputUrl);
      setIsProcessing(false);
    }, 50);
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950 text-white select-none overflow-hidden">
      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center justify-between px-4 pt-safe-top pb-3 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 shrink-0">
        <button
          id="btn-pdf-page-crop-back"
          onClick={onCancel}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 active:bg-slate-700 border border-slate-700/80 text-slate-100 hover:text-white active:scale-95 transition text-xs font-semibold shadow-sm"
        >
          <ArrowLeft className="w-4 h-4 text-blue-400" />
          <span>Quay lại</span>
        </button>

        <div className="text-center">
          <h3 className="text-sm font-bold text-white">
            Cắt & Căn chỉnh {pageNumber ? `Trang ${pageNumber}` : "Trang"}
          </h3>
          <p className="text-[11px] text-slate-400">Kéo 4 góc vào mép tài liệu muốn giữ lại</p>
        </div>

        <button
          onClick={handleConfirm}
          disabled={isProcessing}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md transition active:scale-95 disabled:opacity-50"
        >
          {isProcessing ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <Check className="w-4 h-4" />
              <span>Áp dụng</span>
            </>
          )}
        </button>
      </div>

      {/* Main Interactive Canvas Area */}
      <div ref={containerRef} className="relative flex-1 w-full h-full overflow-hidden touch-none bg-slate-950">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="w-full h-full cursor-crosshair"
        />

        {activeCorner && (
          <div className="absolute top-4 right-4 pointer-events-none rounded-full border-2 border-white shadow-2xl bg-black overflow-hidden">
            <canvas ref={loupeCanvasRef} className="w-[120px] h-[120px]" />
          </div>
        )}
      </div>

      {/* Bottom Tool Bar */}
      <div className="flex items-center justify-around px-4 py-3 bg-slate-900 border-t border-slate-800 shrink-0">
        <button
          onClick={handleRotate}
          className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-semibold transition border border-slate-700/60"
        >
          <RotateCw className="w-4 h-4 text-emerald-400" />
          <span>Xoay 90°</span>
        </button>

        <button
          onClick={handleAutoFit}
          className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-semibold transition border border-slate-700/60"
        >
          <Sparkles className="w-4 h-4 text-blue-400" />
          <span>Tự căn mép</span>
        </button>

        <button
          onClick={handleResetFull}
          className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-semibold transition border border-slate-700/60"
        >
          <Maximize2 className="w-4 h-4 text-amber-400" />
          <span>Toàn khung</span>
        </button>
      </div>
    </div>
  );
};
