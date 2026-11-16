import { useState, useRef } from "react";
import {
  RotateCcw,
  Maximize2,
  Minimize2,
  Home,
  Wrench,
} from "lucide-react";

interface ITToolsViewerProps {
  onToggleExpand?: (expanded: boolean) => void;
  isExpanded?: boolean;
}

export default function ITToolsViewer({
  onToggleExpand,
  isExpanded = false,
}: ITToolsViewerProps) {
  const [currentUrl, setCurrentUrl] = useState("/it-tools/index.html");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const handleRefresh = () => {
    if (iframeRef.current) {
      iframeRef.current.src = currentUrl;
    }
  };

  const handleGoHome = () => {
    if (iframeRef.current) {
      iframeRef.current.src = "/it-tools/index.html#/";
      setCurrentUrl("/it-tools/index.html#/");
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden select-none bg-[#0f172a]/95">
      {/* Top IT-Tools Action Toolbar */}
      <div className="px-3 py-1.5 border-b border-white/[0.08] bg-black/40 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-1.5 min-w-0">
          <Wrench className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="text-[11px] font-semibold text-white/90 truncate">
            IT-Tools Developer Suite
          </span>
          <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            70+ Tools
          </span>
        </div>

        <div className="flex items-center space-x-1 shrink-0">
          <button
            onClick={handleGoHome}
            title="All Tools"
            className="p-1 rounded-md hover:bg-white/10 active:bg-white/20 text-white/60 hover:text-white transition-colors"
          >
            <Home className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleRefresh}
            title="Reload Tool"
            className="p-1 rounded-md hover:bg-white/10 active:bg-white/20 text-white/60 hover:text-white transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          {onToggleExpand && (
            <button
              onClick={() => onToggleExpand(!isExpanded)}
              title={isExpanded ? "Collapse Sidebar Width" : "Widen Sidebar for IT-Tools"}
              className="p-1 rounded-md hover:bg-white/10 active:bg-white/20 text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              {isExpanded ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Embedded IT-Tools Webview Frame */}
      <div className="flex-1 w-full h-full relative overflow-hidden bg-[#0f172a]">
        <iframe
          ref={iframeRef}
          src="/it-tools/index.html"
          title="IT Tools"
          className="w-full h-full border-0 absolute inset-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
        />
      </div>
    </div>
  );
}
