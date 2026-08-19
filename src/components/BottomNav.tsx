import React from "react";
import { Home, Camera, Folder, Settings, Sparkles } from "lucide-react";

interface BottomNavProps {
  activeTab: "home" | "documents" | "settings";
  onChangeTab: (tab: "home" | "documents" | "settings") => void;
  onOpenQuickScan: () => void;
  documentsCount: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onChangeTab,
  onOpenQuickScan,
  documentsCount,
}) => {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 flex items-center justify-around px-4 py-2 bg-slate-900/95 backdrop-blur-lg border-t border-slate-800 select-none max-w-4xl mx-auto">
      {/* Home Tab */}
      <button
        id="nav-tab-home"
        onClick={() => onChangeTab("home")}
        className={`flex flex-col items-center gap-1 p-2 rounded-xl transition active:scale-95 ${
          activeTab === "home" ? "text-blue-500 font-semibold" : "text-slate-400 hover:text-slate-200"
        }`}
      >
        <Home className="w-5 h-5" />
        <span className="text-[10px]">Trang chủ</span>
      </button>

      {/* Elevated Center Scan Action Button */}
      <div className="-mt-6">
        <button
          id="nav-center-scan-btn"
          onClick={onOpenQuickScan}
          className="group relative flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 text-white shadow-xl shadow-blue-600/40 border-4 border-slate-950 active:scale-90 transition transform"
          title="Mở camera quét tài liệu"
        >
          <Camera className="w-6 h-6 group-hover:scale-110 transition duration-200" />
        </button>
      </div>

      {/* Documents Library Tab */}
      <button
        id="nav-tab-documents"
        onClick={() => onChangeTab("documents")}
        className={`relative flex flex-col items-center gap-1 p-2 rounded-xl transition active:scale-95 ${
          activeTab === "documents" ? "text-blue-500 font-semibold" : "text-slate-400 hover:text-slate-200"
        }`}
      >
        <div className="relative">
          <Folder className="w-5 h-5" />
          {documentsCount > 0 && (
            <span className="absolute -top-1 -right-2 px-1.5 py-0.2 rounded-full bg-blue-600 text-white text-[9px] font-bold">
              {documentsCount}
            </span>
          )}
        </div>
        <span className="text-[10px]">Tài liệu</span>
      </button>

      {/* Settings Tab */}
      <button
        id="nav-tab-settings"
        onClick={() => onChangeTab("settings")}
        className={`flex flex-col items-center gap-1 p-2 rounded-xl transition active:scale-95 ${
          activeTab === "settings" ? "text-blue-500 font-semibold" : "text-slate-400 hover:text-slate-200"
        }`}
      >
        <Settings className="w-5 h-5" />
        <span className="text-[10px]">Cài đặt</span>
      </button>
    </div>
  );
};
