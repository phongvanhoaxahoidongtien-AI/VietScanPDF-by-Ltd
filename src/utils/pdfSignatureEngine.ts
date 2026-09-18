import * as pdfjsLib from "pdfjs-dist";
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, rgb } from "pdf-lib";

// Configure PDF.js worker
if (typeof window !== "undefined") {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  } catch (e) {
    console.warn("PDF worker initialization note:", e);
  }
}

export interface DetectedSignature {
  id: string;
  name: string;
  fieldName?: string;
  pageIndex: number;
  pageNumber: number;
  status: "signed" | "unsigned" | "unknown";
  isErased?: boolean;
  signerName?: string;
  signDate?: string;
  reason?: string;
  location?: string;
  // Precise structural identity in PDF tree:
  fieldObjectNumber?: number; // Unique PDF indirect object number for AcroForm field
  annotObjectNumber?: number; // Unique PDF indirect object number for page annotation widget
  annotIndexOnPage?: number;  // Exact 0-based index in page.node.Annots()
  rect?: {
    x: number;
    y: number;
    w: number;
    h: number;
  }; // In PDF points
  normalizedRect?: {
    x: number; // 0..1 from left
    y: number; // 0..1 from top
    w: number; // 0..1 width
    h: number; // 0..1 height
  };
}

export interface RedactBox {
  id: string;
  pageIndex: number;
  x: number; // 0..1 percentage from left
  y: number; // 0..1 percentage from top
  w: number; // 0..1 percentage width
  h: number; // 0..1 percentage height
  color: "white" | "black" | "gray";
  label?: string;
  type?: "signature" | "manual" | "eraser";
}

export interface SignatureDetectionResult {
  hasSignatures: boolean;
  signatures: DetectedSignature[];
  totalPages: number;
  pagePreviews: Array<{
    pageIndex: number;
    pageNumber: number;
    width: number;
    height: number;
    dataUrl: string;
  }>;
}

/**
 * Safely decodes and cleans PDF strings (handles slash prefix, parens, UTF-16BE BOM)
 */
function cleanPdfString(val: string): string {
  if (!val) return "";
  let s = val.trim();
  if (s.startsWith("/") || s.startsWith("(")) {
    s = s.replace(/^\/|^\(|\)$/g, "");
  }
  if (s.startsWith("\ufeff") || s.startsWith("þÿ")) {
    s = s.slice(1);
  }
  return s.trim();
}

/**
 * Formats PDF date string D:YYYYMMDDHHmmSS to standard dd/mm/yyyy hh:mm:ss
 */
function formatPdfDate(val: string): string {
  if (!val) return "";
  const match = val.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
  if (match) {
    const [, y, m, d, hh = "00", mm = "00", ss = "00"] = match;
    return `${d}/${m}/${y} ${hh}:${mm}:${ss}`;
  }
  return val;
}

/**
 * Safely creates an isolated Uint8Array copy backed by an independent ArrayBuffer.
 * This guarantees that when PDF.js transfers the buffer to its Web Worker,
 * the caller's buffer is NEVER detached, mutated, or corrupted.
 */
export function safeCloneToUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy;
  }
  // ArrayBuffer
  try {
    const view = new Uint8Array(data);
    const copy = new Uint8Array(view.byteLength);
    copy.set(view);
    return copy;
  } catch {
    throw new Error("Không thể sao chép dữ liệu PDF: Bộ đệm (ArrayBuffer) đã bị giải phóng hoặc tách rời.");
  }
}

export class PDFSignatureEngine {
  /**
   * Scans PDF for signature fields (AcroForm /Sig) and renders page previews
   */
  static async detectSignaturesAndRender(
    buffer: ArrayBuffer | Uint8Array,
    scale: number = 1.6
  ): Promise<SignatureDetectionResult> {
    const signatures: DetectedSignature[] = [];
    const pagePreviews: SignatureDetectionResult["pagePreviews"] = [];

    // 1. Comprehensive pass with pdf-lib to inspect AcroForm and Page Annotations
    let pdfLibDoc: PDFDocument | null = null;
    try {
      const safeBufferForPdfLib = safeCloneToUint8Array(buffer);
      pdfLibDoc = await PDFDocument.load(safeBufferForPdfLib, { ignoreEncryption: true });
      const form = pdfLibDoc.getForm();
      const fields = form.getFields();
      const pages = pdfLibDoc.getPages();
      const seenAnnotObjs = new Set<number>();

      // 1A. Inspect AcroForm fields
      fields.forEach((field, fIdx) => {
        const fieldName = field.getName();
        const constructorName = field.constructor?.name || "";
        const isSigField =
          constructorName === "PDFSignature" ||
          (field as any).acroField?.dict?.get(PDFName.of("FT"))?.toString() === "/Sig" ||
          fieldName.toLowerCase().includes("signature") ||
          fieldName.toLowerCase().includes("sig_") ||
          fieldName.toLowerCase().includes("chuky");

        const fieldRef = (field as any).ref;
        const fieldObjNum = fieldRef instanceof PDFRef ? fieldRef.objectNumber : undefined;

        if (isSigField) {
          const widgets = (field as any).acroField?.getWidgets?.() || [];
          if (widgets.length > 0) {
            widgets.forEach((widget: any, wIdx: number) => {
              let pageIdx = 0;
              try {
                const widgetPage = (form as any).findWidgetPage?.(widget);
                if (widgetPage && pdfLibDoc) {
                  const foundIdx = pages.findIndex((p) => p === widgetPage);
                  if (foundIdx >= 0) pageIdx = foundIdx;
                }
              } catch {
                // Keep default 0
              }

              const widgetRef = (widget as any).ref;
              const annotObjNum = widgetRef instanceof PDFRef ? widgetRef.objectNumber : undefined;
              if (annotObjNum) seenAnnotObjs.add(annotObjNum);

              // Find exact index of this annotation in page.node.Annots()
              let annotIndexOnPage: number | undefined;
              if (pageIdx >= 0 && pageIdx < pages.length) {
                const pAnnots = pages[pageIdx].node.Annots();
                if (pAnnots instanceof PDFArray && annotObjNum) {
                  for (let ai = 0; ai < pAnnots.size(); ai++) {
                    const ref = pAnnots.get(ai);
                    if (ref instanceof PDFRef && ref.objectNumber === annotObjNum) {
                      annotIndexOnPage = ai;
                      break;
                    }
                  }
                }
              }

              let rect: { x: number; y: number; w: number; h: number } | undefined;
              let normRect: { x: number; y: number; w: number; h: number } | undefined;

              try {
                const r = widget.getRectangle();
                if (r && r.width > 0 && r.height > 0) {
                  rect = { x: r.x, y: r.y, w: r.width, h: r.height };
                  const p = pages[pageIdx];
                  if (p) {
                    const pw = p.getWidth();
                    const ph = p.getHeight();
                    normRect = {
                      x: Math.max(0, Math.min(1, r.x / pw)),
                      y: Math.max(0, Math.min(1, (ph - r.y - r.height) / ph)),
                      w: Math.max(0.01, Math.min(1, r.width / pw)),
                      h: Math.max(0.01, Math.min(1, r.height / ph)),
                    };
                  }
                }
              } catch {
                // Ignore rect retrieval errors
              }

              // Extract signer info if available
              let signerName: string | undefined;
              let signDate: string | undefined;
              let reason: string | undefined;
              let location: string | undefined;

              try {
                const widgetDict = (widget as any).dict;
                const vItem =
                  widgetDict?.get(PDFName.of("V")) ||
                  (field as any).acroField?.dict?.get(PDFName.of("V"));
                let vDict: PDFDict | null = null;
                if (vItem instanceof PDFRef) {
                  const lookedUp = pdfLibDoc!.context.lookup(vItem);
                  if (lookedUp instanceof PDFDict) vDict = lookedUp;
                } else if (vItem instanceof PDFDict) {
                  vDict = vItem;
                }
                if (vDict) {
                  const n = vDict.get(PDFName.of("Name"))?.toString();
                  if (n) signerName = cleanPdfString(n);
                  const m = vDict.get(PDFName.of("M"))?.toString();
                  if (m) signDate = formatPdfDate(cleanPdfString(m));
                  const re = vDict.get(PDFName.of("Reason"))?.toString();
                  if (re) reason = cleanPdfString(re);
                  const l = vDict.get(PDFName.of("Location"))?.toString();
                  if (l) location = cleanPdfString(l);
                }
              } catch {}

              const displayLabel = signerName
                ? `Chữ ký: ${signerName}`
                : (fieldName && !fieldName.toLowerCase().includes("sig") ? fieldName : `Chữ ký số ${signatures.length + 1}`);

              signatures.push({
                id: `sig_lib_${fIdx}_${wIdx}_${annotObjNum || fIdx}`,
                name: displayLabel,
                fieldName: fieldName || undefined,
                signerName,
                signDate,
                reason,
                location,
                fieldObjectNumber: fieldObjNum,
                annotObjectNumber: annotObjNum,
                annotIndexOnPage,
                pageIndex: pageIdx,
                pageNumber: pageIdx + 1,
                status: "signed",
                rect,
                normalizedRect: normRect,
              });
            });
          } else {
            signatures.push({
              id: `sig_lib_${fIdx}`,
              name: fieldName || `Chữ ký số ${signatures.length + 1}`,
              fieldName: fieldName || undefined,
              fieldObjectNumber: fieldObjNum,
              pageIndex: 0,
              pageNumber: 1,
              status: "signed",
            });
          }
        }
      });

      // 1B. Inspect Page Annots directly for any signature widgets not linked in AcroForm
      pages.forEach((page, pIdx) => {
        const pw = page.getWidth();
        const ph = page.getHeight();
        const pAnnots = page.node.Annots();
        if (pAnnots instanceof PDFArray) {
          for (let aIdx = 0; aIdx < pAnnots.size(); aIdx++) {
            const aRef = pAnnots.get(aIdx);
            if (!(aRef instanceof PDFRef)) continue;
            const objNum = aRef.objectNumber;
            if (seenAnnotObjs.has(objNum)) continue;

            const aDict = pdfLibDoc!.context.lookup(aRef);
            if (!(aDict instanceof PDFDict)) continue;

            const ft = aDict.get(PDFName.of("FT"))?.toString();
            const subtype = aDict.get(PDFName.of("Subtype"))?.toString();
            const hasV = aDict.has(PDFName.of("V"));

            let parentDict: PDFDict | null = null;
            const pRef = aDict.get(PDFName.of("Parent"));
            if (pRef instanceof PDFRef) {
              const lookedUp = pdfLibDoc!.context.lookup(pRef);
              if (lookedUp instanceof PDFDict) parentDict = lookedUp;
            }
            const parentFt = parentDict?.get(PDFName.of("FT"))?.toString();
            const parentHasV = parentDict?.has(PDFName.of("V"));

            const isSig =
              ft === "/Sig" ||
              parentFt === "/Sig" ||
              (subtype === "/Widget" && (hasV || parentHasV));

            if (isSig) {
              seenAnnotObjs.add(objNum);

              const fieldName =
                aDict.get(PDFName.of("T"))?.toString().replace(/^\/|\(|\)/g, "") ||
                parentDict?.get(PDFName.of("T"))?.toString().replace(/^\/|\(|\)/g, "");

              let rect: { x: number; y: number; w: number; h: number } | undefined;
              let normRect: { x: number; y: number; w: number; h: number } | undefined;

              const rArr = aDict.get(PDFName.of("Rect"));
              if (rArr instanceof PDFArray && rArr.size() === 4) {
                try {
                  const x1 = (rArr.get(0) as any)?.asNumber?.() ?? 0;
                  const y1 = (rArr.get(1) as any)?.asNumber?.() ?? 0;
                  const x2 = (rArr.get(2) as any)?.asNumber?.() ?? 0;
                  const y2 = (rArr.get(3) as any)?.asNumber?.() ?? 0;
                  const left = Math.min(x1, x2);
                  const bottom = Math.min(y1, y2);
                  const w = Math.abs(x2 - x1);
                  const h = Math.abs(y2 - y1);
                  if (w > 0 && h > 0) {
                    rect = { x: left, y: bottom, w, h };
                    normRect = {
                      x: Math.max(0, Math.min(1, left / pw)),
                      y: Math.max(0, Math.min(1, (ph - bottom - h) / ph)),
                      w: Math.max(0.01, Math.min(1, w / pw)),
                      h: Math.max(0.01, Math.min(1, h / ph)),
                    };
                  }
                } catch {}
              }

              signatures.push({
                id: `sig_page_${pIdx}_${aIdx}_${objNum}`,
                name: fieldName || `Chữ ký số Trang ${pIdx + 1}`,
                fieldName: fieldName || undefined,
                annotObjectNumber: objNum,
                annotIndexOnPage: aIdx,
                fieldObjectNumber: pRef instanceof PDFRef ? pRef.objectNumber : objNum,
                pageIndex: pIdx,
                pageNumber: pIdx + 1,
                status: "signed",
                rect,
                normalizedRect: normRect,
              });
            }
          }
        }
      });
    } catch (err) {
      console.warn("pdf-lib AcroForm parse note:", err);
    }

    // 2. Render pages and verify annotations with pdfjs-dist
    // CRITICAL: Clone the buffer so PDF.js Web Worker transfer does not detach the original buffer!
    const loadingTask = pdfjsLib.getDocument({
      data: safeCloneToUint8Array(buffer),
      cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
      cMapPacked: true,
    });

    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;

    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });

      // Render page to canvas
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");

      if (ctx) {
        await (page.render as any)({
          canvasContext: ctx,
          canvas,
          viewport,
          annotationMode: (pdfjsLib as any).AnnotationMode?.ENABLE_FORMS ?? 2,
        }).promise;

        const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
        pagePreviews.push({
          pageIndex: i - 1,
          pageNumber: i,
          width: viewport.width,
          height: viewport.height,
          dataUrl,
        });
      }

      // Check annotations for signatures
      try {
        const annotations = await page.getAnnotations();
        annotations.forEach((annot: any, aIdx: number) => {
          const isSig =
            annot.subtype === "Widget" &&
            (annot.fieldType === "Sig" ||
              annot.sigType ||
              (annot.fieldName && annot.fieldName.toLowerCase().includes("sig")));

          if (isSig) {
            const pageView = page.getViewport({ scale: 1.0 });
            let normRect: { x: number; y: number; w: number; h: number } | undefined;
            let pointRect: { x: number; y: number; w: number; h: number } | undefined;

            if (annot.rect && Array.isArray(annot.rect) && annot.rect.length === 4) {
              const [x1, y1, x2, y2] = annot.rect;
              const w = Math.abs(x2 - x1);
              const h = Math.abs(y2 - y1);
              const left = Math.min(x1, x2);
              const top = Math.max(y1, y2);

              pointRect = {
                x: left,
                y: Math.min(y1, y2),
                w,
                h,
              };

              normRect = {
                x: Math.max(0, Math.min(1, left / pageView.width)),
                y: Math.max(0, Math.min(1, (pageView.height - top) / pageView.height)),
                w: Math.max(0.01, Math.min(1, w / pageView.width)),
                h: Math.max(0.01, Math.min(1, h / pageView.height)),
              };
            }

            // Check if already captured by pdf-lib
            const existing = signatures.find(
              (s) => s.pageIndex === i - 1 && (s.name === annot.fieldName || (!s.rect && normRect))
            );

            if (existing) {
              if (!existing.normalizedRect && normRect) {
                existing.normalizedRect = normRect;
              }
              if (annot.fieldName && !existing.name) {
                existing.name = annot.fieldName;
              }
              if (annot.fieldName && !existing.fieldName) {
                existing.fieldName = annot.fieldName;
              }
              if (pointRect && !existing.rect) {
                existing.rect = pointRect;
              }
            } else {
              signatures.push({
                id: `sig_js_${i}_${aIdx}`,
                name: annot.fieldName || `Chữ ký số Trang ${i}`,
                fieldName: annot.fieldName || undefined,
                pageIndex: i - 1,
                pageNumber: i,
                status: "signed",
                rect: pointRect,
                normalizedRect: normRect,
              });
            }
          }
        });
      } catch (annotErr) {
        console.warn(`Error reading annotations on page ${i}:`, annotErr);
      }
    }

    return {
      hasSignatures: signatures.length > 0,
      signatures,
      totalPages,
      pagePreviews,
    };
  }

  /**
   * Selectively detaches/strips chosen digital signatures from the PDF structure
   * WITHOUT drawing any white rectangles, preserving underlying text/tables
   * and preserving any adjacent or overlapping signatures 100% intact.
   */
  static async buildCleanPDFDocument(params: {
    originalBuffer: ArrayBuffer | Uint8Array;
    allSignatures?: DetectedSignature[];
    erasedSignatureIds?: string[];
    stripAllSignatures?: boolean;
    redactBoxes?: RedactBox[];
  }): Promise<{ pdfDoc: PDFDocument; bytes: Uint8Array; blob: Blob }> {
    const {
      originalBuffer,
      allSignatures = [],
      erasedSignatureIds = [],
      stripAllSignatures = false,
      redactBoxes = [],
    } = params;

    const safeData = safeCloneToUint8Array(originalBuffer);
    const pdfDoc = await PDFDocument.load(safeData, { ignoreEncryption: true });

    const erasedSigs = allSignatures.filter((s) =>
      stripAllSignatures ? true : erasedSignatureIds.includes(s.id) || s.isErased
    );

    if (stripAllSignatures || erasedSigs.length > 0) {
      // Build lookup sets for unerased signatures to ensure absolute protection:
      // An unerased signature (even if 99% overlapping or sharing a field) MUST NEVER BE TOUCHED!
      const unerasedSigs = allSignatures.filter((s) => !erasedSignatureIds.includes(s.id));
      const unerasedAnnotObjs = new Set(
        unerasedSigs.map((s) => s.annotObjectNumber).filter((n): n is number => typeof n === "number")
      );
      const unerasedFieldObjs = new Set(
        unerasedSigs.map((s) => s.fieldObjectNumber).filter((n): n is number => typeof n === "number")
      );
      const unerasedFieldNames = new Set(
        unerasedSigs.map((s) => s.fieldName).filter((n): n is string => Boolean(n))
      );

      const erasedAnnotObjs = new Set(
        erasedSigs.map((s) => s.annotObjectNumber).filter((n): n is number => typeof n === "number")
      );
      const erasedFieldObjs = new Set(
        erasedSigs.map((s) => s.fieldObjectNumber).filter((n): n is number => typeof n === "number")
      );
      const erasedFieldNames = new Set(
        erasedSigs.map((s) => s.fieldName).filter((n): n is string => Boolean(n))
      );

      // 1. Remove specific signature fields from AcroForm with STRICT isolated matching
      try {
        const form = pdfDoc.getForm();
        const fields = form.getFields();

        for (const field of fields) {
          const fieldName = field.getName();
          const constructorName = field.constructor?.name || "";
          const isSigField =
            constructorName === "PDFSignature" ||
            (field as any).acroField?.dict?.get(PDFName.of("FT"))?.toString() === "/Sig" ||
            fieldName.toLowerCase().includes("signature") ||
            fieldName.toLowerCase().includes("sig_") ||
            fieldName.toLowerCase().includes("chuky");

          const fieldRef = (field as any).ref;
          const fieldObjNum = fieldRef instanceof PDFRef ? fieldRef.objectNumber : undefined;

          if (isSigField) {
            if (stripAllSignatures) {
              try {
                form.removeField(field);
              } catch {}
            } else {
              // CRITICAL: If any unerased signature shares this field, DO NOT remove the field!
              // Otherwise, removing the parent field would destroy all its associated widgets!
              const sharedWithUnerased =
                (fieldObjNum && unerasedFieldObjs.has(fieldObjNum)) ||
                (fieldName && unerasedFieldNames.has(fieldName));

              if (sharedWithUnerased) {
                continue;
              }

              const matchesErased =
                (fieldObjNum && erasedFieldObjs.has(fieldObjNum)) ||
                (fieldName && erasedFieldNames.has(fieldName));

              if (matchesErased) {
                try {
                  form.removeField(field);
                } catch (err) {
                  console.warn(`Could not remove field ${fieldName}:`, err);
                }
              }
            }
          }
        }
      } catch (formErr) {
        console.warn("Form processing note:", formErr);
      }

      // If all signatures were erased, clean SigFlags from AcroForm
      if (stripAllSignatures || (allSignatures.length > 0 && unerasedSigs.length === 0)) {
        try {
          const acroForm = pdfDoc.catalog.get(PDFName.of("AcroForm"));
          if (acroForm instanceof PDFDict) {
            acroForm.delete(PDFName.of("SigFlags"));
          }
        } catch (acroErr) {
          console.warn("AcroForm cleaning note:", acroErr);
        }
      }

      // 2. Selectively clean /Annots on pages with Surgical Protection for Overlapping Signatures:
      // Even if two signatures overlap 100%, each has a unique annotation reference or geometry.
      try {
        const pages = pdfDoc.getPages();
        pages.forEach((page, pIdx) => {
          const annots = page.node.Annots();
          if (annots instanceof PDFArray) {
            const cleanArray: (PDFRef | PDFDict)[] = [];
            for (let i = 0; i < annots.size(); i++) {
              const annotRef = annots.get(i);
              let shouldKeep = true;

              if (annotRef instanceof PDFRef) {
                const objNum = annotRef.objectNumber;
                const annotDict = pdfDoc.context.lookup(annotRef);
                if (annotDict instanceof PDFDict) {
                  const ft = annotDict.get(PDFName.of("FT"))?.toString();
                  const subtype = annotDict.get(PDFName.of("Subtype"))?.toString();
                  const isWidgetSig =
                    ft === "/Sig" || (subtype === "/Widget" && (ft === "/Sig" || annotDict.has(PDFName.of("V"))));

                  if (isWidgetSig) {
                    if (stripAllSignatures) {
                      shouldKeep = false;
                    } else {
                      // ABSOLUTE RULE 1: If this object belongs to an UNERASED signature, KEEP IT!
                      if (unerasedAnnotObjs.has(objNum)) {
                        shouldKeep = true;
                      }
                      // ABSOLUTE RULE 2: If this object belongs to an ERASED signature, REMOVE IT!
                      else if (erasedAnnotObjs.has(objNum)) {
                        shouldKeep = false;
                      }
                      // RULE 3: Geometry-based fallback for unindexed annotations
                      else {
                        const rArr = annotDict.get(PDFName.of("Rect"));
                        let annotRect: { x: number; y: number; w: number; h: number } | null = null;
                        if (rArr instanceof PDFArray && rArr.size() === 4) {
                          try {
                            const x1 = (rArr.get(0) as any)?.asNumber?.() ?? 0;
                            const y1 = (rArr.get(1) as any)?.asNumber?.() ?? 0;
                            const x2 = (rArr.get(2) as any)?.asNumber?.() ?? 0;
                            const y2 = (rArr.get(3) as any)?.asNumber?.() ?? 0;
                            annotRect = {
                              x: Math.min(x1, x2),
                              y: Math.min(y1, y2),
                              w: Math.abs(x2 - x1),
                              h: Math.abs(y2 - y1),
                            };
                          } catch {}
                        }

                        if (annotRect) {
                          // Protect unerased geometry
                          const matchesUnerasedGeo = unerasedSigs.some((us) => {
                            if (us.pageIndex !== pIdx || !us.rect) return false;
                            const dx = Math.abs(us.rect.x - annotRect!.x);
                            const dy = Math.abs(us.rect.y - annotRect!.y);
                            const dw = Math.abs(us.rect.w - annotRect!.w);
                            const dh = Math.abs(us.rect.h - annotRect!.h);
                            return dx < 3 && dy < 3 && dw < 3 && dh < 3;
                          });

                          if (matchesUnerasedGeo) {
                            shouldKeep = true;
                          } else {
                            // Check if matches erased geometry
                            const matchesErasedGeo = erasedSigs.some((es) => {
                              if (es.pageIndex !== pIdx || !es.rect) return false;
                              const dx = Math.abs(es.rect.x - annotRect!.x);
                              const dy = Math.abs(es.rect.y - annotRect!.y);
                              const dw = Math.abs(es.rect.w - annotRect!.w);
                              const dh = Math.abs(es.rect.h - annotRect!.h);
                              return dx < 3 && dy < 3 && dw < 3 && dh < 3;
                            });

                            if (matchesErasedGeo) {
                              shouldKeep = false;
                            }
                          }
                        }
                      }
                    }

                    // If removing this widget, also delete its Appearance Stream so no ghost image renders
                    if (!shouldKeep) {
                      try {
                        annotDict.delete(PDFName.of("AP"));
                        annotDict.delete(PDFName.of("V"));
                        annotDict.delete(PDFName.of("DV"));
                      } catch {}
                    }
                  }
                }
              }

              if (shouldKeep) {
                cleanArray.push(annotRef as any);
              }
            }

            if (cleanArray.length !== annots.size()) {
              page.node.set(PDFName.of("Annots"), pdfDoc.context.obj(cleanArray));
            }
          }
        });
      } catch (annotCleanErr) {
        console.warn("Selective annotation cleaning note:", annotCleanErr);
      }
    }

    // 3. Manual Redaction boxes ONLY (user-drawn redact boxes, NEVER white boxes for digital signatures!)
    const manualBoxes = redactBoxes.filter(
      (b) => b.type === "manual" || (b.type === "eraser" && !b.id.startsWith("erase_sig_"))
    );

    if (manualBoxes.length > 0) {
      const pages = pdfDoc.getPages();
      manualBoxes.forEach((box) => {
        if (box.pageIndex >= 0 && box.pageIndex < pages.length) {
          const page = pages[box.pageIndex];
          const { width: pWidth, height: pHeight } = page.getSize();

          const rectX = Math.max(0, box.x * pWidth);
          const rectW = Math.max(2, Math.min(pWidth - rectX, box.w * pWidth));
          const rectH = Math.max(2, box.h * pHeight);
          const rectY = Math.max(0, pHeight - box.y * pHeight - rectH);

          let fillColor = rgb(1, 1, 1);
          if (box.color === "black") {
            fillColor = rgb(0, 0, 0);
          } else if (box.color === "gray") {
            fillColor = rgb(0.85, 0.85, 0.85);
          }

          page.drawRectangle({
            x: rectX,
            y: rectY,
            width: rectW,
            height: rectH,
            color: fillColor,
            borderWidth: 0,
            opacity: 1.0,
          });
        }
      });
    }

    const bytes = await pdfDoc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    return { pdfDoc, bytes, blob };
  }

  /**
   * Re-renders a single page preview image directly from the modified/clean PDF
   * where specific signatures are detached, ensuring instant real-time preview
   * with zero white cover boxes.
   */
  static async renderCleanPagePreview(params: {
    originalBuffer: ArrayBuffer;
    allSignatures: DetectedSignature[];
    erasedSignatureIds: string[];
    pageIndex: number;
    scale?: number;
  }): Promise<string> {
    const { originalBuffer, allSignatures, erasedSignatureIds, pageIndex, scale = 1.8 } = params;

    const { bytes } = await PDFSignatureEngine.buildCleanPDFDocument({
      originalBuffer,
      allSignatures,
      erasedSignatureIds,
    });

    const loadingTask = pdfjsLib.getDocument({
      data: safeCloneToUint8Array(bytes),
      cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
      cMapPacked: true,
    });

    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");

    if (!ctx) return "";

    await (page.render as any)({
      canvasContext: ctx,
      canvas,
      viewport,
      annotationMode: (pdfjsLib as any).AnnotationMode?.ENABLE_FORMS ?? 2,
    }).promise;

    return canvas.toDataURL("image/jpeg", 0.92);
  }

  /**
   * Re-renders all pages from clean PDF with specific signatures detached.
   */
  static async renderAllPagesFromCleanPDF(params: {
    originalBuffer: ArrayBuffer | Uint8Array;
    allSignatures: DetectedSignature[];
    erasedSignatureIds: string[];
    scale?: number;
  }): Promise<string[]> {
    const { originalBuffer, allSignatures, erasedSignatureIds, scale = 1.8 } = params;

    const { bytes } = await PDFSignatureEngine.buildCleanPDFDocument({
      originalBuffer,
      allSignatures,
      erasedSignatureIds,
    });

    return await PDFSignatureEngine.renderPagesToImages(bytes, scale);
  }

  /**
   * Strips signature fields and/or applies redaction boxes to the PDF
   */
  static async processAndRedactPDF(params: {
    originalBuffer: ArrayBuffer | Uint8Array;
    allSignatures?: DetectedSignature[];
    erasedSignatureIds?: string[];
    redactBoxes?: RedactBox[];
    stripSignatures?: boolean;
  }): Promise<{ blob: Blob; bytes: Uint8Array }> {
    const {
      originalBuffer,
      allSignatures = [],
      erasedSignatureIds = [],
      redactBoxes = [],
      stripSignatures = false,
    } = params;

    const res = await PDFSignatureEngine.buildCleanPDFDocument({
      originalBuffer,
      allSignatures,
      erasedSignatureIds,
      stripAllSignatures: stripSignatures,
      redactBoxes,
    });

    return { blob: res.blob, bytes: res.bytes };
  }

  /**
   * High-resolution rendering of PDF pages to image Data URLs
   */
  static async renderPagesToImages(
    pdfBuffer: ArrayBuffer | Uint8Array,
    scale: number = 2.0
  ): Promise<string[]> {
    const loadingTask = pdfjsLib.getDocument({
      data: safeCloneToUint8Array(pdfBuffer),
      cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
      cMapPacked: true,
    });

    const pdf = await loadingTask.promise;
    const pageImages: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");

      if (ctx) {
        await (page.render as any)({
          canvasContext: ctx,
          canvas,
          viewport,
        }).promise;
        pageImages.push(canvas.toDataURL("image/jpeg", 0.95));
      }
    }

    return pageImages;
  }

  /**
   * 100% Reliable Direct Print via Dedicated Print Portal and window.print()
   * Pre-loads high-res pages, ensures proper page break rules, and triggers the printer dialog
   * with fallback to an active off-screen iframe.
   */
  static async printDocument(params: {
    pageImages: string[];
    title?: string;
  }): Promise<boolean> {
    const { pageImages, title = "VietScan PDF - In tài liệu" } = params;
    if (!pageImages || pageImages.length === 0) return false;

    return new Promise((resolve) => {
      try {
        // 1. Remove previous print artifacts if any
        document.getElementById("vietscan-print-container")?.remove();
        document.getElementById("vietscan-print-style")?.remove();

        // 2. Inject print container directly onto document.body
        const container = document.createElement("div");
        container.id = "vietscan-print-container";
        container.innerHTML = pageImages
          .map(
            (src, idx) =>
              `<div class="vietscan-print-page" id="vs-page-${idx + 1}"><img src="${src}" alt="Page ${idx + 1}" /></div>`
          )
          .join("");

        // 3. Inject print media stylesheet
        const style = document.createElement("style");
        style.id = "vietscan-print-style";
        style.textContent = `
          @media screen {
            #vietscan-print-container {
              display: none !important;
            }
          }
          @media print {
            @page {
              size: auto;
              margin: 0mm;
            }
            html, body {
              margin: 0 !important;
              padding: 0 !important;
              background: #ffffff !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            body > *:not(#vietscan-print-container) {
              display: none !important;
            }
            #vietscan-print-container {
              display: block !important;
              position: absolute !important;
              top: 0 !important;
              left: 0 !important;
              width: 100% !important;
              margin: 0 !important;
              padding: 0 !important;
              background: #ffffff !important;
              z-index: 2147483647 !important;
            }
            .vietscan-print-page {
              page-break-after: always !important;
              break-after: page !important;
              width: 100% !important;
              min-height: 98vh !important;
              display: flex !important;
              align-items: center !important;
              justify-content: center !important;
              margin: 0 !important;
              padding: 0 !important;
              box-sizing: border-box !important;
            }
            .vietscan-print-page:last-child {
              page-break-after: avoid !important;
              break-after: avoid !important;
            }
            .vietscan-print-page img {
              max-width: 100% !important;
              max-height: 100vh !important;
              width: auto !important;
              height: auto !important;
              object-fit: contain !important;
              display: block !important;
              margin: auto !important;
            }
          }
        `;

        document.head.appendChild(style);
        document.body.appendChild(container);

        const cleanup = () => {
          try {
            container.remove();
            style.remove();
          } catch {}
          window.removeEventListener("afterprint", cleanup);
        };
        window.addEventListener("afterprint", cleanup);

        const triggerNativePrint = () => {
          setTimeout(() => {
            try {
              window.focus();
              window.print();
              resolve(true);
            } catch (err) {
              console.warn("window.print failed, attempting iframe fallback:", err);
              triggerIframeFallback();
            }
          }, 250);
        };

        const triggerIframeFallback = () => {
          try {
            const iframe = document.createElement("iframe");
            iframe.style.position = "fixed";
            iframe.style.top = "0";
            iframe.style.left = "0";
            iframe.style.width = "100vw";
            iframe.style.height = "100vh";
            iframe.style.opacity = "0.01";
            iframe.style.pointerEvents = "none";
            iframe.style.zIndex = "-1";
            document.body.appendChild(iframe);

            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (iframeDoc) {
              iframeDoc.open();
              iframeDoc.write(`
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="utf-8" />
                  <title>${title}</title>
                  <style>
                    @page { size: auto; margin: 0; }
                    body { margin: 0; padding: 0; background: #fff; }
                    .print-page { page-break-after: always; break-after: page; width: 100%; min-height: 98vh; display: flex; align-items: center; justify-content: center; }
                    .print-page:last-child { page-break-after: avoid; break-after: avoid; }
                    img { max-width: 100%; max-height: 100vh; object-fit: contain; }
                  </style>
                </head>
                <body>
                  ${pageImages.map((s, i) => `<div class="print-page"><img src="${s}" alt="Page ${i + 1}" /></div>`).join("")}
                </body>
                </html>
              `);
              iframeDoc.close();
              setTimeout(() => {
                try {
                  iframe.contentWindow?.focus();
                  iframe.contentWindow?.print();
                  resolve(true);
                } catch {
                  resolve(false);
                } finally {
                  setTimeout(() => iframe.remove(), 60000);
                }
              }, 500);
            } else {
              resolve(false);
            }
          } catch {
            resolve(false);
          }
        };

        // Wait for all images in the container to load before triggering print
        const imgs = Array.from(container.querySelectorAll("img"));
        if (imgs.length === 0) {
          triggerNativePrint();
          return;
        }

        let loaded = 0;
        const total = imgs.length;
        const checkDone = () => {
          loaded++;
          if (loaded >= total) {
            triggerNativePrint();
          }
        };

        imgs.forEach((img) => {
          if (img.complete) {
            checkDone();
          } else {
            img.onload = checkDone;
            img.onerror = checkDone;
          }
        });

        // Safety fallback timer
        setTimeout(() => {
          if (loaded < total) {
            triggerNativePrint();
          }
        }, 3000);
      } catch (err) {
        console.error("Direct print error:", err);
        resolve(false);
      }
    });
  }

  /**
   * Helper to print PDF directly via hidden iframe or fallback
   */
  static printPDF(pdfBlob: Blob): void {
    const pdfUrl = URL.createObjectURL(pdfBlob);

    try {
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.style.zIndex = "-9999";
      iframe.src = pdfUrl;

      document.body.appendChild(iframe);

      iframe.onload = () => {
        setTimeout(() => {
          try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
          } catch (e) {
            console.warn("iframe print error, fallback to new tab:", e);
            window.open(pdfUrl, "_blank");
          } finally {
            setTimeout(() => {
              try {
                document.body.removeChild(iframe);
              } catch {}
            }, 60000);
          }
        }, 400);
      };
    } catch {
      window.open(pdfUrl, "_blank");
    }
  }
}
