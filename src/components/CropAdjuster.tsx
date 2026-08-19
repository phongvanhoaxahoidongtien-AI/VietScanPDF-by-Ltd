import React, { useRef, useState, useEffect, useCallback } from "react";
import { ArrowLeft, Check, RefreshCw, Maximize2, Sparkles } from "lucide-react";
import { Point, QuadPoints } from "../types";
import { CVEngine } from "../utils/cvEngine";

interface CropAdjusterProps {
  imageSrc: string;
  initialQuad?: QuadPoints;
  aspectMode?: "document" | "card";
  onComplete: (warpedCanvas: HTMLCanvasElement, adjustedQuad: QuadPoints) => void;
  onCancel: () => void;
}

export const CropAdjuster: React.FC<CropAdjusterProps> = ({
  imageSrc,
  initialQuad,
  aspectMode = "document",
  onComplete,
  onCancel,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);

  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);
  const [quad, setQuad] = useState<QuadPoints | null>(null);
  const [activeCorner, setActiveCorner] = useState<keyof QuadPoints | null>(null);
  const [scale, setScale] = useState<{ scaleX: number; scaleY: number; offsetX: number; offsetY: number }>({
    scaleX: 1,
    scaleY: 1,
    offsetX: 0,
    offsetY: 0,
  });
  const [isProcessing, setIsProcessing] = useState(false);

  // Load image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setImgElement(img);
      const targetAspect = aspectMode === "card" ? "card" : "document";
      const defaultQ = initialQuad || CVEngine.getDefaultQuad(img.naturalWidth, img.naturalHeight, targetAspect);
      setQuad(defaultQ);
    };
    img.src = imageSrc;
  }, [imageSrc, initialQuad, aspectMode]);

  // Compute container dimensions & redraw
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

    // Draw darkened mask outside polygon
    ctx.save();
    ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
    ctx.fillRect(0, 0, cWidth, cHeight);

    // Cut out the selected quad
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Redraw the illuminated quad area
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

    // Draw border lines
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#3b82f6";
    ctx.stroke();

    // Draw Grid guidelines inside quad
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.setLineDash([4, 4]);
    // Horizontal 1/3 and 2/3
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
    // Vertical 1/3 and 2/3
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

    // Draw Corner handles
    const corners: { point: Point; name: keyof QuadPoints }[] = [
      { point: p0, name: "topLeft" },
      { point: p1, name: "topRight" },
      { point: p2, name: "bottomRight" },
      { point: p3, name: "bottomLeft" },
    ];

    corners.forEach(({ point, name }) => {
      const isActive = activeCorner === name;

      // Outer glow/ring
      ctx.beginPath();
      ctx.arc(point.x, point.y, isActive ? 22 : 18, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? "rgba(59, 130, 246, 0.4)" : "rgba(255, 255, 255, 0.85)";
      ctx.fill();

      // Inner solid dot
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

  // Touch / Pointer Event Handlers
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

    // Check hit radius (44px for easy mobile touch)
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

    // Convert screen coordinates back to image natural coordinates
    const imgX = Math.max(0, Math.min(imgElement.naturalWidth, (touchX - scale.offsetX) / scale.scaleX));
    const imgY = Math.max(0, Math.min(imgElement.naturalHeight, (touchY - scale.offsetY) / scale.scaleY));

    setQuad((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [activeCorner]: { x: imgX, y: imgY },
      };
    });

    // Update Loupe Magnifier
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

  // Draw magnifying loupe
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
      imgX - (size / 2) / zoom,
      imgY - (size / 2) / zoom,
      size / zoom,
      size / zoom,
      0,
      0,
      size,
      size
    );

    // Crosshair in center of loupe
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

  // Auto-detect Quad again
  const handleAutoFit = () => {
    if (!imgElement) return;
    const targetAspect = aspectMode === "card" ? "card" : "document";
    const { quad: detected } = CVEngine.detectDocumentQuad(
      imgElement,
      imgElement.naturalWidth,
      imgElement.naturalHeight,
      targetAspect
    );
    setQuad(detected);
  };

  // Reset to full image
  const handleResetFull = () => {
    if (!imgElement) return;
    setQuad({
      topLeft: { x: 0, y: 0 },
      topRight: { x: imgElement.naturalWidth, y: 0 },
      bottomRight: { x: imgElement.naturalWidth, y: imgElement.naturalHeight },
      bottomLeft: { x: 0, y: imgElement.naturalHeight },
    });
  };

  // Confirm and warp
  const handleConfirm = () => {
    if (!imgElement || !quad) return;
    setIsProcessing(true);

    setTimeout(() => {
      const warped = CVEngine.warpPerspective(imgElement, quad);
      onComplete(warped, quad);
      setIsProcessing(false);
    }, 50);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white select-none">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900/90 backdrop-blur border-b border-slate-800">
        <button
          id="btn-crop-back"
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition active:scale-95 text-sm font-medium"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Hủy</span>
        </button>

        <div className="text-center">
          <h2 className="text-base font-semibold text-white">Căn chỉnh 4 góc mép giấy</h2>
          <p className="text-xs text-slate-400">Kéo các điểm tròn vào 4 góc tài liệu</p>
        </div>

        <button
          id="btn-crop-confirm"
          onClick={handleConfirm}
          disabled={isProcessing}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-sm font-semibold shadow-md transition disabled:opacity-50"
        >
          {isProcessing ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <Check className="w-4 h-4" />
              <span>Xong</span>
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

        {/* Loupe Magnifier overlay (top right) */}
        {activeCorner && (
          <div className="absolute top-4 right-4 pointer-events-none rounded-full border-2 border-white shadow-2xl bg-black overflow-hidden animate-in fade-in zoom-in-75 duration-150">
            <canvas ref={loupeCanvasRef} className="w-[120px] h-[120px]" />
          </div>
        )}
      </div>

      {/* Bottom Control Bar */}
      <div className="flex items-center justify-around px-4 py-3.5 bg-slate-900 border-t border-slate-800">
        <button
          id="btn-crop-auto"
          onClick={handleAutoFit}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-medium transition"
        >
          <Sparkles className="w-4 h-4 text-blue-400" />
          <span>Tự căn góc</span>
        </button>

        <button
          id="btn-crop-reset"
          onClick={handleResetFull}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-medium transition"
        >
          <Maximize2 className="w-4 h-4 text-slate-400" />
          <span>Toàn bộ ảnh</span>
        </button>
      </div>
    </div>
  );
};
