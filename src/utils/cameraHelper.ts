/**
 * Resilient Camera Stream Acquisition with Multi-Tier Fallback
 */

export interface CameraAcquisitionResult {
  stream: MediaStream;
  facingModeUsed: "environment" | "user" | "unknown";
  hasTorch: boolean;
}

export class CameraHelper {
  /**
   * Tries progressively looser constraints to acquire a camera stream
   * avoiding "Requested device not found" (NotFoundError/OverconstrainedError) on devices with only front camera or no environment camera.
   */
  public static async acquireStream(
    preferredFacing: "environment" | "user" = "environment"
  ): Promise<CameraAcquisitionResult> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Trình duyệt không hỗ trợ WebRTC Camera API.");
    }

    const fallbackFacing = preferredFacing === "environment" ? "user" : "environment";
    let stream: MediaStream | null = null;
    let facingModeUsed: "environment" | "user" | "unknown" = "unknown";

    // Tier 1: Ideal 1080p with preferred facing mode (no hard min limits to avoid OverconstrainedError)
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: preferredFacing },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      facingModeUsed = preferredFacing;
    } catch (e1: any) {
      console.warn(`Camera Tier 1 (${preferredFacing} 1080p) failed:`, e1?.message || e1);
    }

    // Tier 2: Standard resolution with preferred facing mode
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: preferredFacing },
          },
          audio: false,
        });
        facingModeUsed = preferredFacing;
      } catch (e2: any) {
        console.warn(`Camera Tier 2 (${preferredFacing} relaxed) failed:`, e2?.message || e2);
      }
    }

    // Tier 3: Alternate facing mode (e.g. front camera if desktop/laptop has no back camera)
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: fallbackFacing },
          },
          audio: false,
        });
        facingModeUsed = fallbackFacing;
      } catch (e3: any) {
        console.warn(`Camera Tier 3 (${fallbackFacing}) failed:`, e3?.message || e3);
      }
    }

    // Tier 4: Plain generic video device (any camera available)
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        facingModeUsed = "unknown";
      } catch (e4: any) {
        console.warn("Camera Tier 4 (video: true) failed:", e4?.message || e4);
        throw CameraHelper.formatError(e4);
      }
    }

    // Check torch capability safely
    let hasTorch = false;
    try {
      const track = stream.getVideoTracks()[0];
      if (track) {
        const capabilities: any = (track as any).getCapabilities ? (track as any).getCapabilities() : {};
        hasTorch = !!capabilities?.torch;
      }
    } catch {
      hasTorch = false;
    }

    return {
      stream,
      facingModeUsed,
      hasTorch,
    };
  }

  /**
   * Safely format DOMException / Camera Error into friendly Vietnamese message
   */
  public static formatError(err: any): Error {
    const name = err?.name || "";
    const msg = err?.message || "";

    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return new Error("Quyền truy cập Camera đã bị từ chối. Hãy mở Cài đặt trình duyệt để cho phép quyền Camera.");
    }
    if (
      name === "NotFoundError" ||
      name === "DevicesNotFoundError" ||
      msg.toLowerCase().includes("not found") ||
      msg.toLowerCase().includes("no device")
    ) {
      return new Error("Không tìm thấy thiết bị máy ảnh trên máy. Bạn có thể chọn ảnh từ thư viện hoặc dán ảnh (Ctrl+V) để quét ngay.");
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return new Error("Máy ảnh đang được ứng dụng khác sử dụng hoặc bị khóa. Vui lòng đóng ứng dụng khác và thử lại.");
    }
    if (name === "OverconstrainedError") {
      return new Error("Độ phân giải máy ảnh yêu cầu không tương thích với thiết bị của bạn.");
    }

    return new Error(msg || "Không thể kết nối với máy ảnh. Vui lòng thử lại.");
  }

  /**
   * Safely stop all tracks of a stream
   */
  public static stopStream(stream: MediaStream | null | undefined): void {
    if (!stream) return;
    try {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }
  }

  /**
   * Generates a sample A4 document data URL for testing in environments without a physical camera
   */
  public static createSampleDocumentDataUrl(): string {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 1600;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";

    // Realistic paper background with subtle desk shadow
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(0, 0, 1200, 1600);

    // Document page in center with slight margin (simulating document on table)
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetX = 6;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(100, 100, 1000, 1400);
    ctx.restore();

    // Document header
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 38px sans-serif";
    ctx.fillText("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", 200, 200);

    ctx.font = "bold 26px sans-serif";
    ctx.fillText("Độc lập - Tự do - Hanh phúc", 400, 245);

    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(420, 260);
    ctx.lineTo(780, 260);
    ctx.stroke();

    // Document Title
    ctx.font = "bold 44px sans-serif";
    ctx.fillStyle = "#1e3a8a";
    ctx.fillText("HỢP ĐỒNG KINH TẾ & DỊCH VỤ", 280, 360);

    ctx.font = "italic 22px sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText("Số: 168/2026/HĐ-VIETSCAN • Ngày 20 tháng 08 năm 2026", 320, 400);

    // Body text lines simulating real document
    ctx.fillStyle = "#334155";
    ctx.font = "24px sans-serif";
    const sampleLines = [
      "Căn cứ Bộ luật Dân sự số 91/2015/QH13 và các văn bản pháp luật hiện hành.",
      "Căn cứ nhu cầu số hóa và chuyển đổi số tài liệu của hai bên.",
      "",
      "BÊN A (BÊN SỬ DỤNG DỊCH VỤ): CÔNG TY TNHH VIETSCAN PRO",
      "• Địa chỉ: Tầng 12, Tòa nhà Văn phòng Tri thức, TP. Hà Nội",
      "• Đại diện pháp luật: Giám đốc Điều hành",
      "• Mã số thuế: 0109887766 • Hotline: 1900 6868",
      "",
      "BÊN B (BÊN CUNG CẤP GIẢI PHÁP): CÔNG TY CÔNG NGHỆ SỐ VIỆT NAM",
      "• Đại diện: Trưởng bộ phận Chuyển đổi số",
      "• Giải pháp: Ứng dụng quét tài liệu VietScan & Trích xuất dữ liệu OCR tiếng Việt",
      "",
      "ĐIỀU 1: NỘI DUNG VÀ TIÊU CHUẨN SỐ HÓA",
      "1. Số hóa tự động chuẩn tài liệu A4, căn chỉnh 4 góc tự động với độ chính xác cao.",
      "2. Nhận diện văn bản OCR tiếng Việt chính xác, xuất file PDF đa trang độ nét cao.",
      "3. Bảo mật dữ liệu tuyệt đối theo tiêu chuẩn mã hóa nội bộ thiết bị.",
    ];

    let currentY = 480;
    for (const line of sampleLines) {
      if (line.startsWith("BÊN") || line.startsWith("ĐIỀU")) {
        ctx.font = "bold 24px sans-serif";
        ctx.fillStyle = "#0f172a";
      } else {
        ctx.font = "22px sans-serif";
        ctx.fillStyle = "#334155";
      }
      ctx.fillText(line, 160, currentY);
      currentY += 46;
    }

    // Seal & Signature area
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 24px sans-serif";
    ctx.fillText("ĐẠI DIỆN BÊN A", 240, 1260);
    ctx.fillText("ĐẠI DIỆN BÊN B", 740, 1260);

    ctx.font = "italic 20px sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("(Ký, ghi rõ họ tên & đóng dấu)", 200, 1300);
    ctx.fillText("(Ký, ghi rõ họ tên & đóng dấu)", 700, 1300);

    // Red Official Seal Simulation
    ctx.save();
    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(840, 1420, 70, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#dc2626";
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("VIETSCAN OFFICIAL", 840, 1415);
    ctx.fillText("★ ĐÃ CHỨNG THỰC ★", 840, 1440);
    ctx.restore();

    return canvas.toDataURL("image/jpeg", 0.92);
  }
}
