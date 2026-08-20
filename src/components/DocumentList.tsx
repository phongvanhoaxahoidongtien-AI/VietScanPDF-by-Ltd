import React, { useState } from "react";
import {
  Search,
  FileText,
  CreditCard,
  IdCard,
  Award,
  Image as ImageIcon,
  MoreVertical,
  Trash2,
  Share2,
  FileDown,
  Calendar,
  Layers,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { ScannedDocument, ScanMode } from "../types";
import { PDFGenerator } from "../utils/pdfGenerator";

interface DocumentListProps {
  documents: ScannedDocument[];
  onSelectDocument: (doc: ScannedDocument) => void;
  onDeleteDocument: (docId: string) => void;
  onStartNewScan: (mode?: ScanMode) => void;
}

export const DocumentList: React.FC<DocumentListProps> = ({
  documents,
  onSelectDocument,
  onDeleteDocument,
  onStartNewScan,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<string>("all");

  const filteredDocs = documents.filter((doc) => {
    const matchesSearch = doc.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = selectedFilter === "all" || doc.category === selectedFilter;
    return matchesSearch && matchesFilter;
  });

  const getCategoryBadge = (category: ScanMode) => {
    switch (category) {
      case "cccd":
        return { label: "CCCD 2 mặt", color: "bg-blue-500/10 text-blue-400 border-blue-500/30" };
      case "driver_license":
        return { label: "Bằng lái", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" };
      case "certificate":
        return { label: "Bằng cấp", color: "bg-purple-500/10 text-purple-400 border-purple-500/30" };
      case "photo":
        return { label: "Ảnh màu", color: "bg-amber-500/10 text-amber-400 border-amber-500/30" };
      default:
        return { label: "Văn bản A4", color: "bg-slate-500/10 text-slate-300 border-slate-700" };
    }
  };

  const handleQuickShare = async (e: React.MouseEvent, doc: ScannedDocument) => {
    e.stopPropagation();
    try {
      const { blob, fileName } = await PDFGenerator.generateDocumentPDF(doc);
      await PDFGenerator.sharePDFOrImage(blob, fileName, doc.title);
    } catch (err) {
      console.warn("Share error:", err);
    }
  };

  const handleQuickDownload = async (e: React.MouseEvent, doc: ScannedDocument) => {
    e.stopPropagation();
    try {
      const { blob, fileName } = await PDFGenerator.generateDocumentPDF(doc);
      PDFGenerator.downloadBlob(blob, fileName);
    } catch (err) {
      console.warn("Download error:", err);
    }
  };

  return (
    <div className="flex flex-col flex-1 w-full max-w-4xl mx-auto px-4 pt-safe-top pb-24 select-none">
      {/* Search and Filter Bar */}
      <div className="flex flex-col gap-3 mb-5">
        <div className="relative w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            id="input-search-docs"
            type="text"
            placeholder="Tìm kiếm tài liệu đã lưu..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-blue-500 focus:outline-none text-white text-sm placeholder:text-slate-500 transition shadow-sm"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
          {[
            { id: "all", label: "Tất cả" },
            { id: "document", label: "Văn bản A4" },
            { id: "cccd", label: "CCCD 2 mặt" },
            { id: "driver_license", label: "Bằng lái" },
            { id: "certificate", label: "Bằng cấp" },
          ].map((tab) => (
            <button
              key={tab.id}
              id={`filter-tab-${tab.id}`}
              onClick={() => setSelectedFilter(tab.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition active:scale-95 ${
                selectedFilter === tab.id
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Document Grid / List */}
      {filteredDocs.length === 0 ? (
        <div className="flex flex-col items-center justify-center my-auto py-16 text-center px-4">
          <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mb-4 text-slate-400">
            <FileText className="w-8 h-8" />
          </div>
          <h3 className="text-base font-semibold text-white mb-1">Chưa có tài liệu nào</h3>
          <p className="text-xs text-slate-400 max-w-xs mb-6">
            Bấm nút quét bên dưới để bắt đầu chụp tài liệu đầu tiên của bạn với độ nét cao
          </p>
          <button
            id="btn-empty-start-scan"
            onClick={() => onStartNewScan()}
            className="flex items-center gap-2 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold shadow-lg shadow-blue-600/20 active:scale-95 transition"
          >
            <Sparkles className="w-4 h-4 text-blue-200" />
            <span>Quét tài liệu ngay</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
          {filteredDocs.map((doc) => {
            const badge = getCategoryBadge(doc.category);
            const dateFormatted = new Date(doc.createdAt).toLocaleDateString("vi-VN", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });

            return (
              <div
                key={doc.id}
                id={`doc-card-${doc.id}`}
                onClick={() => onSelectDocument(doc)}
                className="group relative flex flex-col bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 rounded-2xl overflow-hidden shadow-md transition cursor-pointer active:scale-[0.98]"
              >
                {/* Thumbnail Header */}
                <div className="relative w-full h-44 bg-slate-950 flex items-center justify-center overflow-hidden border-b border-slate-800/80">
                  <img
                    src={doc.thumbnail || doc.pages[0]?.processedImage}
                    alt={doc.title}
                    className="max-h-full max-w-full object-contain p-2 group-hover:scale-105 transition duration-300"
                  />

                  {/* Page count pill */}
                  <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-md text-[10px] font-bold text-white flex items-center gap-1 border border-white/10">
                    <Layers className="w-3 h-3" />
                    <span>{doc.pages.length} trang</span>
                  </div>

                  {/* Category badge */}
                  <div
                    className={`absolute bottom-2.5 left-2.5 px-2 py-0.5 rounded-md text-[10px] font-bold border backdrop-blur-md ${badge.color}`}
                  >
                    {badge.label}
                  </div>
                </div>

                {/* Body Content */}
                <div className="p-3.5 flex flex-col flex-1 justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-white truncate mb-1" title={doc.title}>
                      {doc.title}
                    </h4>
                    <div className="flex items-center gap-1 text-[11px] text-slate-400">
                      <Calendar className="w-3 h-3" />
                      <span>{dateFormatted}</span>
                    </div>
                  </div>

                  {/* Bottom Card Action Icons */}
                  <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-800/80">
                    <div className="flex items-center gap-1">
                      <button
                        id={`btn-share-doc-${doc.id}`}
                        onClick={(e) => handleQuickShare(e, doc)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                        title="Chia sẻ PDF"
                      >
                        <Share2 className="w-4 h-4" />
                      </button>
                      <button
                        id={`btn-download-doc-${doc.id}`}
                        onClick={(e) => handleQuickDownload(e, doc)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                        title="Tải PDF"
                      >
                        <FileDown className="w-4 h-4" />
                      </button>
                    </div>

                    <button
                      id={`btn-delete-doc-${doc.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Bạn có chắc chắn muốn xóa tài liệu "${doc.title}" không?`)) {
                          onDeleteDocument(doc.id);
                        }
                      }}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition"
                      title="Xóa tài liệu"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
