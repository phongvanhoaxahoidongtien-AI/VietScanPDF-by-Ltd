import { createWorker } from "tesseract.js";
import { OCRResult } from "../types";

export class OCREngine {
  private static worker: any = null;
  private static workerLang: string = "";

  /**
   * Run local in-browser OCR using Tesseract.js
   */
  static async runLocalOCR(
    imageSrc: string,
    lang: "vie" | "eng" = "vie",
    onProgress?: (progress: number, status: string) => void
  ): Promise<OCRResult> {
    try {
      if (onProgress) onProgress(10, "Khởi động mô hình OCR...");

      // Reuse worker if same language
      if (!this.worker || this.workerLang !== lang) {
        if (this.worker) {
          await this.worker.terminate();
        }
        this.worker = await createWorker(lang);
        this.workerLang = lang;
      }

      if (onProgress) onProgress(40, "Đang nhận diện ký tự tiếng Việt...");

      const ret = await this.worker.recognize(imageSrc);

      if (onProgress) onProgress(100, "Hoàn tất nhận diện!");

      return {
        text: ret.data.text.trim(),
        confidence: ret.data.confidence,
        language: lang,
        isAiEnhanced: false,
      };
    } catch (err: any) {
      console.error("Local OCR error:", err);
      throw new Error("Không thể xử lý OCR cục bộ: " + (err.message || "Lỗi không xác định"));
    }
  }

  /**
   * Run Server-Side Gemini AI OCR (High precision for Vietnamese Administrative docs & structured fields)
   */
  static async runAiOCR(
    imageSrc: string,
    mode: "document" | "id_card" | "driver_license" = "document"
  ): Promise<OCRResult> {
    try {
      const response = await fetch("/api/ai-ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: imageSrc, mode }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || "AI OCR không phản hồi");
      }

      const data = await response.json();
      const text = data.text || "";

      // Parse structured key-values if CCCD or Driver License
      const structuredFields: Record<string, string> = {};
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.includes(":")) {
          const [k, ...v] = line.split(":");
          if (k && v.length) {
            structuredFields[k.trim().replace(/^[-*•\s]+/, "")] = v.join(":").trim();
          }
        }
      }

      return {
        text: text,
        confidence: 99,
        language: "vie",
        isAiEnhanced: true,
        structuredFields: Object.keys(structuredFields).length > 0 ? structuredFields : undefined,
      };
    } catch (err: any) {
      console.warn("AI OCR fallback error, switching to local OCR:", err);
      // Graceful fallback to local OCR
      return this.runLocalOCR(imageSrc, "vie");
    }
  }

  /**
   * Suggest smart file name based on extracted text
   */
  static async suggestFileName(sampleText: string): Promise<string> {
    if (!sampleText || sampleText.trim().length === 0) {
      const dateStr = new Date().toLocaleDateString("vi-VN").replace(/\//g, "-");
      return `Tai_lieu_scan_${dateStr}`;
    }

    try {
      const response = await fetch("/api/ai-auto-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ textSample: sampleText }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.title) return data.title;
      }
    } catch (e) {
      // ignore
    }

    // Local heuristic
    const firstLine = sampleText
      .split("\n")
      .find((l) => l.trim().length > 3)
      ?.trim() || "";
    
    if (firstLine) {
      const sanitized = firstLine
        .slice(0, 30)
        .replace(/[^a-zA-Z0-9\u00C0-\u1EF9\s_-]/g, "")
        .trim()
        .replace(/\s+/g, "_");
      if (sanitized.length > 3) return sanitized;
    }

    return `Tai_lieu_scan_${Date.now()}`;
  }
}
