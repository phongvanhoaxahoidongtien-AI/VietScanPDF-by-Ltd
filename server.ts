import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", app: "VietScanPDF" });
  });

  // AI OCR & Smart Title Extraction (Optional advanced feature, graceful fallback when no key)
  app.post("/api/ai-ocr", async (req, res) => {
    try {
      const { imageBase64, mode = "document" } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ error: "Missing imageBase64 in request body" });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "GEMINI_API_KEY is not configured. Using client-side local OCR engine.",
          isLocalFallback: true,
        });
      }

      const ai = new GoogleGenAI({ apiKey });
      
      // Clean base64 header if present
      const cleanBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");

      let prompt = "Hãy đọc và trích xuất toàn bộ văn bản tiếng Việt/tiếng Anh trong bức ảnh tài liệu này một cách chính xác nhất. Giữ nguyên cấu trúc xuống dòng, đề mục, ngày tháng, số hiệu văn bản.";
      if (mode === "id_card") {
        prompt = "Hãy trích xuất thông tin Căn cước công dân / Thẻ căn cước: Số CCCD, Họ và tên, Ngày sinh, Giới tính, Quốc tịch, Quê quán, Nơi thường trú, Ngày cấp, Giá trị đến...";
      } else if (mode === "driver_license") {
        prompt = "Hãy trích xuất thông tin Giấy phép lái xe: Số GPLX, Họ tên, Ngày sinh, Hạng GPLX, Nơi cư trú, Ngày trúng tuyển, Có giá trị đến...";
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: prompt,
              },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: cleanBase64,
                },
              },
            ],
          },
        ],
      });

      const extractedText = response.text || "";
      return res.json({ text: extractedText, model: "gemini-2.5-flash" });
    } catch (err: any) {
      console.error("Gemini AI OCR error:", err);
      return res.status(500).json({ error: err.message || "Failed to process AI OCR" });
    }
  });

  // AI Auto-naming helper
  app.post("/api/ai-auto-title", async (req, res) => {
    try {
      const { textSample } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || !textSample) {
        return res.json({ title: "Tài liệu scan " + new Date().toLocaleDateString("vi-VN").replace(/\//g, "-") });
      }

      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Dựa vào nội dung tài liệu scan sau, hãy đặt một tên file ngắn gọn, súc tích (dưới 6 từ, tiếng Việt không dấu hoặc có dấu gọn gàng, ví dụ: 'Hop_dong_thue_nha', 'Cong_van_123_UBND', 'CCCD_Nguyen_Van_A', 'Hoa_don_dien'):\n\n${textSample.slice(0, 1000)}`,
              },
            ],
          },
        ],
      });

      const raw = response.text?.trim() || "";
      const cleanTitle = raw.replace(/["'`\n]/g, "").slice(0, 40);
      return res.json({ title: cleanTitle || "Tai_lieu_scan" });
    } catch (err) {
      return res.json({ title: "Tai_lieu_scan_" + Date.now() });
    }
  });

  // Vite middleware for development vs static build in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`VietScanPDF server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
