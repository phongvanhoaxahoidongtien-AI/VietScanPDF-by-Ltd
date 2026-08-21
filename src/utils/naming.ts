/**
 * Centralized File Naming Utility for VietScan_by_Ltd
 * Format: VietScan_by_Ltd_tai_lieu_DD_MM_YY.pdf
 * With duplicate index: VietScan_by_Ltd_tai_lieu_DD_MM_YY_01.pdf
 */

import { ScanMode } from "../types";

export interface FileNameOptions {
  date?: Date | number;
  suffixIndex?: number;
  extension?: "pdf" | "jpg" | "txt";
  category?: ScanMode;
}

/**
 * Generates the standardized document file name according to VietScan_by_Ltd rules.
 * Uses local device date (Vietnam timezone / local date).
 */
export function generateDocumentFileName(options?: FileNameOptions): string {
  const d = options?.date ? new Date(options.date) : new Date();

  // Local device date DD_MM_YY
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2); // 2-digit year, e.g. "26"

  const catLabel = options?.category === "cccd" ? "cccd" : options?.category === "driver_license" ? "gplx" : "tai_lieu";
  const base = `VietScan_by_Ltd_${catLabel}_${day}_${month}_${year}`;
  const ext = options?.extension || "pdf";

  if (options?.suffixIndex && options.suffixIndex > 0) {
    const num = String(options.suffixIndex).padStart(2, "0");
    return `${base}_${num}.${ext}`;
  }

  return `${base}.${ext}`;
}

/**
 * Generates standard document title for display and initial document creation
 */
export function generateDefaultDocumentTitle(categoryOrDate?: ScanMode | Date | number, dateInput?: Date | number): string {
  let category: ScanMode = "document";
  let dateVal: Date | number | undefined = undefined;

  if (typeof categoryOrDate === "string") {
    category = categoryOrDate as ScanMode;
    dateVal = dateInput;
  } else {
    dateVal = categoryOrDate;
  }

  const d = dateVal ? new Date(dateVal) : new Date();
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2);

  const catLabel = category === "cccd" ? "cccd" : category === "driver_license" ? "gplx" : "tai_lieu";
  return `VietScan_by_Ltd_${catLabel}_${day}_${month}_${year}`;
}
