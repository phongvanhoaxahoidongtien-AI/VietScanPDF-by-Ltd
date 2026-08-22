import React, { useState, useEffect, useRef } from "react";
import { ScannedDocument, ScannedPage, ScanMode } from "./types";
import { StorageService } from "./utils/storage";
import { CVEngine } from "./utils/cvEngine";
import { generateDefaultDocumentTitle } from "./utils/naming";
import { HomeScreen } from "./components/HomeScreen";
import { BottomNav } from "./components/BottomNav";
import { CameraScanner } from "./components/CameraScanner";
import { PageEditor } from "./components/PageEditor";
import { DocumentList } from "./components/DocumentList";
import { SettingsModal } from "./components/SettingsModal";
import { PDFPreviewModal } from "./components/PDFPreviewModal";
import { LongImageModal } from "./components/LongImageModal";
import { OCRViewerModal } from "./components/OCRViewerModal";
import { PDFMergeModal } from "./components/PDFMergeModal";
import { PDFSplitModal } from "./components/PDFSplitModal";
import { PDFHighlightModal } from "./components/PDFHighlightModal";
import { PDFToJPEGModal } from "./components/PDFToJPEGModal";
import { QRGeneratorModal } from "./components/QRGeneratorModal";
import { QRScannerModal } from "./components/QRScannerModal";
import { ImportTypeModal, ImportTypeChoice } from "./components/ImportTypeModal";

export default function App() {
  // Navigation & View States
  const [activeTab, setActiveTab] = useState<"home" | "documents" | "settings">("home");
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanMode, setScanMode] = useState<ScanMode>("document");

  // Document & Session State
  const [allDocuments, setAllDocuments] = useState<ScannedDocument[]>([]);
  const [activeDocument, setActiveDocument] = useState<ScannedDocument | null>(null);

  // Sub-modal states
  const [isPDFPreviewOpen, setIsPDFPreviewOpen] = useState<boolean>(false);
  const [isLongImageOpen, setIsLongImageOpen] = useState<boolean>(false);
  const [activeOCRPage, setActiveOCRPage] = useState<ScannedPage | null>(null);

  // PDF Tools Modals
  const [isPDFMergeOpen, setIsPDFMergeOpen] = useState<boolean>(false);
  const [isPDFSplitOpen, setIsPDFSplitOpen] = useState<boolean>(false);
  const [isPDFHighlightOpen, setIsPDFHighlightOpen] = useState<boolean>(false);
  const [isPDFToJPEGOpen, setIsPDFToJPEGOpen] = useState<boolean>(false);

  // QR Code Modals
  const [isQRGeneratorOpen, setIsQRGeneratorOpen] = useState<boolean>(false);
  const [isQRScannerOpen, setIsQRScannerOpen] = useState<boolean>(false);

  // Import Type Modal
  const [isImportTypeModalOpen, setIsImportTypeModalOpen] = useState<boolean>(false);
  const [activeImportType, setActiveImportType] = useState<ImportTypeChoice>("document");

  const hiddenFileInputRef = useRef<HTMLInputElement>(null);

  // Load saved documents on startup
  useEffect(() => {
    const loadDocs = async () => {
      try {
        const docs = await StorageService.getAllDocuments();
        setAllDocuments(docs);
      } catch (err) {
        console.error("Failed to load documents:", err);
      }
    };
    loadDocs();
  }, []);

  // Start a new Scan session
  const handleStartScan = (mode: ScanMode = "document") => {
    setScanMode(mode);

    // Standardized title format
    const defaultTitle = generateDefaultDocumentTitle();

    const newDoc: ScannedDocument = {
      id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      title: defaultTitle,
      category: mode,
      pages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      thumbnail: "",
    };

    setActiveDocument(newDoc);
    setIsScanning(true);
  };

  // Add captured page to current active document
  const handleCapturePage = async (page: ScannedPage, isLastPage: boolean = false) => {
    if (!activeDocument) return;

    const updatedPages = [...activeDocument.pages, page];
    const updatedDoc: ScannedDocument = {
      ...activeDocument,
      pages: updatedPages,
      thumbnail: updatedPages[0].processedImage,
      updatedAt: Date.now(),
    };

    setActiveDocument(updatedDoc);
    await StorageService.saveDocument(updatedDoc);

    // Update list
    setAllDocuments((prev) => {
      const idx = prev.findIndex((d) => d.id === updatedDoc.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = updatedDoc;
        return copy;
      }
      return [updatedDoc, ...prev];
    });

    if (isLastPage) {
      setIsScanning(false);
    }
  };

  // Finish scanning and move to Editor
  const handleFinishedScanning = () => {
    setIsScanning(false);
  };

  // Update existing document (from PageEditor)
  const handleUpdateDocument = async (doc: ScannedDocument) => {
    setActiveDocument(doc);
    await StorageService.saveDocument(doc);
    setAllDocuments((prev) => prev.map((d) => (d.id === doc.id ? doc : d)));
  };

  // Delete document
  const handleDeleteDocument = async (docId: string) => {
    await StorageService.deleteDocument(docId);
    setAllDocuments((prev) => prev.filter((d) => d.id !== docId));
    if (activeDocument?.id === docId) {
      setActiveDocument(null);
    }
  };

  // Import images from device storage - prompt choice between Document vs CCCD/GPLX
  const handleImportPhotosFromHome = () => {
    setIsImportTypeModalOpen(true);
  };

  const handleSelectImportType = (type: ImportTypeChoice) => {
    setActiveImportType(type);
    setIsImportTypeModalOpen(false);
    setTimeout(() => {
      hiddenFileInputRef.current?.click();
    }, 100);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList: File[] = Array.from(files);
    let loadedCount = 0;
    const newPages: ScannedPage[] = [];
    const isCardMode = activeImportType === "cccd";

    fileList.forEach((file: File, index: number) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        const img = new Image();
        img.onload = () => {
          let selectedQuad: any;

          if (isCardMode) {
            // For CCCD/GPLX: Crop centered ~70% region (15% margin on each side) instead of 100% outer corners
            const marginX = img.naturalWidth * 0.15;
            const marginY = img.naturalHeight * 0.15;
            selectedQuad = {
              topLeft: { x: marginX, y: marginY },
              topRight: { x: img.naturalWidth - marginX, y: marginY },
              bottomRight: { x: img.naturalWidth - marginX, y: img.naturalHeight - marginY },
              bottomLeft: { x: marginX, y: img.naturalHeight - marginY },
            };
          } else {
            // For Document: 4 outer corners
            selectedQuad = {
              topLeft: { x: 0, y: 0 },
              topRight: { x: img.naturalWidth, y: 0 },
              bottomRight: { x: img.naturalWidth, y: img.naturalHeight },
              bottomLeft: { x: 0, y: img.naturalHeight },
            };
          }

          const warped = CVEngine.warpPerspective(img, selectedQuad);
          const processedCanvas = CVEngine.applyFilter(warped, "document", 0);
          const processedUrl = processedCanvas.toDataURL("image/jpeg", 0.92);
          const pHash = CVEngine.computePerceptualHashFromCanvas(warped);

          newPages.push({
            id: `page_${Date.now()}_${Math.random().toString(36).substr(2, 5)}_${index}`,
            originalImage: dataUrl,
            processedImage: processedUrl,
            quad: selectedQuad,
            filter: "document",
            rotation: 0,
            createdAt: Date.now(),
            width: processedCanvas.width,
            height: processedCanvas.height,
            perceptualHash: pHash,
            detectedSide: isCardMode ? (index === 0 ? "front" : "back") : undefined,
          });

          loadedCount++;
          if (loadedCount === fileList.length) {
            // Sort to maintain original selection order
            const sortedPages = [...newPages].sort((a, b) => a.createdAt - b.createdAt);
            const category: ScanMode = isCardMode ? "cccd" : "document";

            const newDoc: ScannedDocument = {
              id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              title: generateDefaultDocumentTitle(category),
              category: category,
              pages: sortedPages,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              thumbnail: sortedPages[0].processedImage,
            };

            setActiveDocument(newDoc);
            StorageService.saveDocument(newDoc);
            setAllDocuments((prev) => [newDoc, ...prev]);
          }
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });

    if (hiddenFileInputRef.current) hiddenFileInputRef.current.value = "";
  };

  return (
    <div className="relative flex flex-col min-h-screen w-full bg-slate-950 text-slate-100 font-sans antialiased overflow-x-hidden">
      {/* Hidden file input for home import */}
      <input
        ref={hiddenFileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Main Content Router */}
      {isScanning ? (
        <CameraScanner
          initialMode={scanMode}
          onCapturePage={handleCapturePage}
          onFinishedScanning={handleFinishedScanning}
          onClose={() => setIsScanning(false)}
          scannedPagesCount={activeDocument?.pages.length || 0}
        />
      ) : activeDocument && activeDocument.pages.length > 0 ? (
        <PageEditor
          document={activeDocument}
          onUpdateDocument={handleUpdateDocument}
          onAddMorePages={() => setIsScanning(true)}
          onOpenPDFPreview={() => setIsPDFPreviewOpen(true)}
          onOpenLongImage={() => setIsLongImageOpen(true)}
          onOpenOCR={(page) => setActiveOCRPage(page)}
          onBack={() => setActiveDocument(null)}
        />
      ) : (
        <>
          {activeTab === "home" && (
            <HomeScreen
              onStartScan={handleStartScan}
              onImportPhotos={handleImportPhotosFromHome}
              onOpenPDFMerge={() => setIsPDFMergeOpen(true)}
              onOpenPDFSplit={() => setIsPDFSplitOpen(true)}
              onOpenPDFHighlight={() => setIsPDFHighlightOpen(true)}
              onOpenPDFToJPEG={() => setIsPDFToJPEGOpen(true)}
              onOpenQRGenerator={() => setIsQRGeneratorOpen(true)}
              onOpenQRScanner={() => setIsQRScannerOpen(true)}
              recentDocuments={allDocuments}
              onSelectDocument={(doc) => setActiveDocument(doc)}
              onViewAllDocuments={() => setActiveTab("documents")}
            />
          )}

          {activeTab === "documents" && (
            <DocumentList
              documents={allDocuments}
              onSelectDocument={(doc) => setActiveDocument(doc)}
              onDeleteDocument={handleDeleteDocument}
              onStartNewScan={handleStartScan}
            />
          )}

          {activeTab === "settings" && (
            <SettingsModal
              onClose={() => setActiveTab("home")}
              onClearAll={() => setAllDocuments([])}
            />
          )}

          {/* Bottom Navigation */}
          <BottomNav
            activeTab={activeTab}
            onChangeTab={(tab) => setActiveTab(tab)}
            onOpenQuickScan={() => handleStartScan("document")}
            documentsCount={allDocuments.length}
          />
        </>
      )}

      {/* Secondary Modals */}
      {isPDFPreviewOpen && activeDocument && (
        <PDFPreviewModal
          document={activeDocument}
          onClose={() => setIsPDFPreviewOpen(false)}
        />
      )}

      {isLongImageOpen && activeDocument && (
        <LongImageModal
          document={activeDocument}
          onClose={() => setIsLongImageOpen(false)}
        />
      )}

      {activeOCRPage && (
        <OCRViewerModal
          page={activeOCRPage}
          category={activeDocument?.category}
          onClose={() => setActiveOCRPage(null)}
        />
      )}

      {/* PDF Tools Modals */}
      {isPDFMergeOpen && (
        <PDFMergeModal onClose={() => setIsPDFMergeOpen(false)} />
      )}

      {isPDFSplitOpen && (
        <PDFSplitModal onClose={() => setIsPDFSplitOpen(false)} />
      )}

      {isPDFHighlightOpen && (
        <PDFHighlightModal onClose={() => setIsPDFHighlightOpen(false)} />
      )}

      {/* PDF to JPEG Modal */}
      {isPDFToJPEGOpen && (
        <PDFToJPEGModal
          onClose={() => setIsPDFToJPEGOpen(false)}
          availableSavedDocs={allDocuments}
          onSavedToDocuments={(newDoc) => {
            setAllDocuments((prev) => [newDoc, ...prev.filter((d) => d.id !== newDoc.id)]);
          }}
        />
      )}

      {/* QR Code Modals */}
      {isQRGeneratorOpen && (
        <QRGeneratorModal onClose={() => setIsQRGeneratorOpen(false)} />
      )}

      {isQRScannerOpen && (
        <QRScannerModal onClose={() => setIsQRScannerOpen(false)} />
      )}
      {/* Import Type Picker Modal */}
      <ImportTypeModal
        isOpen={isImportTypeModalOpen}
        onClose={() => setIsImportTypeModalOpen(false)}
        onSelectType={handleSelectImportType}
      />
    </div>
  );
}
