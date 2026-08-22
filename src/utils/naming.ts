/**
 * Centralized File Naming Utility for VietScan_by_Ltd
 * Format: VietScan_by_Ltd_dd_mm_yy_hh_mm_ss
 * Example: VietScan_by_Ltd_21_08_26_15_30_45.pdf
 */

import { ScanMode } from "../types";

export interface FileNameOptions {
  date?: Date | number;
  suffixIndex?: number;
  extension?: "pdf" | "jpg" | "txt";
  category?: ScanMode;
}

/**
 * Generates the standardized document file name according to VietScan_by_Ltd rules:
 * VietScan_by_Ltd_dd_mm_yy_hh_mm_ss (system time from user device)
 */
export function generateDocumentFileName(options?: FileNameOptions): string {
  const d = options?.date ? new Date(options.date) : new Date();

  // Local device date and time dd_mm_yy_hh_mm_ss
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2); // 2-digit year
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");

  const base = `VietScan_by_Ltd_${day}_${month}_${year}_${hours}_${minutes}_${seconds}`;
  const ext = options?.extension || "pdf";

  if (options?.suffixIndex && options.suffixIndex > 0) {
    const num = String(options.suffixIndex).padStart(2, "0");
    return `${base}_${num}.${ext}`;
  }

  return `${base}.${ext}`;
}

/**
 * Generates standard document title for display and initial document creation:
 * VietScan_by_Ltd_dd_mm_yy_hh_mm_ss
 */
export function generateDefaultDocumentTitle(categoryOrDate?: ScanMode | Date | number, dateInput?: Date | number): string {
  let dateVal: Date | number | undefined = undefined;

  if (typeof categoryOrDate === "string") {
    dateVal = dateInput;
  } else {
    dateVal = categoryOrDate;
  }

  const d = dateVal ? new Date(dateVal) : new Date();
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2);
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");

  return `VietScan_by_Ltd_${day}_${month}_${year}_${hours}_${minutes}_${seconds}`;
}

/**
 * Generates file name for PDF to JPEG export:
 * VietScan_PDF_to_JPEG_trang_X_dd_mm_yy_hh_mm_ss.jpg
 */
export function generatePdfToJpegFileName(pageNumber: number, extension: "jpg" | "jpeg" | "png" = "jpg", date?: Date | number): string {
  const d = date ? new Date(date) : new Date();
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2);
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");

  const ext = extension === "jpeg" ? "jpg" : extension;
  return `VietScan_PDF_to_JPEG_trang_${pageNumber}_${day}_${month}_${year}_${hours}_${minutes}_${seconds}.${ext}`;
}
