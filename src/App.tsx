import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  Search,
  Plus,
  Settings,
  X,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Shield,
  Play,
  Trash2,
  Sliders,
  Sparkles,
  Check,
  LayoutList,
  LayoutGrid,
  Music,
  Wrench,
} from "lucide-react";
import MusicPlayer from "./components/MusicPlayer";
import LiveMarketCard from "./components/LiveMarketCard";
import AccountQuotaWidget from "./components/AccountQuotaWidget";
import ITToolsViewer from "./components/ITToolsViewer";

interface AppItem {
  id: string;
  name: string;
  path: string;
  icon_base64?: string;
  args?: string;
  category_id: string;
}

interface AppGroup {
  id: string;
  name: string;
  color: string;
  is_collapsed: boolean;
  items: AppItem[];
}

interface SidebarSettings {
  dock_edge: string; // "right" | "left"
  width: number;
  is_appbar: boolean;
  always_on_top: boolean;
  auto_hide: boolean;
}

interface AppConfig {
  settings: SidebarSettings;
  groups: AppGroup[];
}

const PRESET_COLORS = [
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#ef4444", // Red
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#6b7280", // Gray
];

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [activeTab, setActiveTab] = useState<"apps" | "music" | "tools">("apps");
  const [isToolsExpanded, setIsToolsExpanded] = useState(false);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [activeContextMenu, setActiveContextMenu] = useState<{
    x: number;
    y: number;
    item: AppItem;
    groupId: string;
  } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState(PRESET_COLORS[0]);
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Load configuration on mount
  useEffect(() => {
    loadConfig();

    // Listen to native file drops from Windows Explorer if supported
    let unlisten: (() => void) | undefined;
    try {
      getCurrentWebview()
        .onDragDropEvent(async (event) => {
          if (event.payload.type === "drop" && event.payload.paths) {
            for (const filePath of event.payload.paths) {
              await handleAddDroppedFile(filePath);
            }
          }
        })
        .then((unsub) => {
          unlisten = unsub;
        })
        .catch(() => {});
    } catch {}

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Close context menu on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setActiveContextMenu(null);
      }
    };
    window.addEventListener("mousedown", handleOutsideClick);
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 2500);
  };

  const loadConfig = async () => {
    try {
      const conf: AppConfig = await invoke("get_config");
      setConfig(conf);
      try {
        await invoke("dock_window", {
          edge: conf.settings.dock_edge,
          width: conf.settings.width,
          isAppbar: conf.settings.is_appbar,
        });
      } catch (dockErr) {
        console.error("Docking error:", dockErr);
      }
    } catch (err) {
      console.error("Failed to load config:", err);
    }
  };

  const saveConfig = async (newConfig: AppConfig) => {
    setConfig(newConfig);
    try {
      await invoke("save_config", { config: newConfig });
    } catch (err) {
      console.error("Failed to save config:", err);
    }
  };

  const handleLaunch = async (item: AppItem, runAsAdmin = false) => {
    setActiveContextMenu(null);
    try {
      await invoke("launch_app", {
        path: item.path,
        args: item.args || null,
        runAsAdmin,
      });
      showToast(`Launched ${item.name}`);
    } catch (err) {
      showToast(`Error: ${err}`);
    }
  };

  const handleOpenFolder = async (item: AppItem) => {
    setActiveContextMenu(null);
    try {
      await invoke("open_in_folder", { path: item.path });
    } catch (err) {
      showToast(`Error opening folder: ${err}`);
    }
  };

  const handlePickFile = async (groupId: string) => {
    try {
      const newItem: AppItem | null = await invoke("pick_app_file", {
        categoryId: groupId,
      });
      if (newItem && config) {
        const updatedGroups = config.groups.map((g) => {
          if (g.id === groupId) {
            return { ...g, items: [...g.items, newItem] };
          }
          return g;
        });
        await saveConfig({ ...config, groups: updatedGroups });
        showToast(`Added ${newItem.name}`);
      }
    } catch (err) {
      showToast(`Failed to add application: ${err}`);
    }
  };

  const handleAddDroppedFile = async (filePath: string) => {
    if (!config || config.groups.length === 0) return;
    const targetGroupId = hoveredGroupId || config.groups[0].id;

    try {
      const newItem: AppItem = await invoke("resolve_and_add_path", {
        path: filePath,
        categoryId: targetGroupId,
      });

      const updatedGroups = config.groups.map((g) => {
        if (g.id === targetGroupId) {
          return { ...g, items: [...g.items, newItem] };
        }
        return g;
      });
      await saveConfig({ ...config, groups: updatedGroups });
      showToast(`Added ${newItem.name}`);
    } catch (err) {
      showToast(`Failed to add dropped file: ${err}`);
    }
  };

  const handleDeleteItem = async (groupId: string, itemId: string) => {
    if (!config) return;
    setActiveContextMenu(null);
    const updatedGroups = config.groups.map((g) => {
      if (g.id === groupId) {
        return { ...g, items: g.items.filter((i) => i.id !== itemId) };
      }
      return g;
    });
    await saveConfig({ ...config, groups: updatedGroups });
    showToast("Application removed");
  };

  const handleToggleCollapse = async (groupId: string) => {
    if (!config) return;
    const updatedGroups = config.groups.map((g) => {
      if (g.id === groupId) {
        return { ...g, is_collapsed: !g.is_collapsed };
      }
      return g;
    });
    await saveConfig({ ...config, groups: updatedGroups });
  };

  const handleCreateGroup = async () => {
    if (!config || !newGroupName.trim()) return;
    const newGroup: AppGroup = {
      id: `group-${Date.now()}`,
      name: newGroupName.trim(),
      color: newGroupColor,
      is_collapsed: false,
      items: [],
    };
    await saveConfig({ ...config, groups: [...config.groups, newGroup] });
    setNewGroupName("");
    setShowNewGroupModal(false);
    showToast(`Created "${newGroup.name}"`);
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!config) return;
    const updatedGroups = config.groups.filter((g) => g.id !== groupId);
    await saveConfig({ ...config, groups: updatedGroups });
    showToast("Group deleted");
  };

  const handleUpdateDockSettings = async (
    edge: string,
    width: number,
    isAppbar: boolean
  ) => {
    if (!config) return;
    const newSettings = {
      ...config.settings,
      dock_edge: edge,
      width,
      is_appbar: isAppbar,
    };
    await saveConfig({ ...config, settings: newSettings });
    try {
      await invoke("dock_window", {
        edge,
        width,
        isAppbar,
      });
    } catch (err) {
      console.error("Failed to update window docking:", err);
    }
  };

  const handleToggleToolsExpand = async (expanded: boolean) => {
    setIsToolsExpanded(expanded);
    if (!config) return;
    const targetWidth = expanded ? 480 : (config.settings.width || 260);
    try {
      await invoke("dock_window", {
        edge: config.settings.dock_edge,
        width: targetWidth,
        isAppbar: config.settings.is_appbar,
      });
    } catch (err) {
      console.error("Failed to resize window:", err);
    }
  };

  const handleTabChange = async (tab: "apps" | "music" | "tools") => {
    setActiveTab(tab);
    if (!config) return;
    if (tab !== "tools" && isToolsExpanded) {
      setIsToolsExpanded(false);
      try {
        await invoke("dock_window", {
          edge: config.settings.dock_edge,
          width: config.settings.width || 260,
          isAppbar: config.settings.is_appbar,
        });
      } catch {}
    }
  };

  const handleClose = async () => {
    try {
      await invoke("close_sidebar");
    } catch (err) {
      console.error(err);
    }
  };

  if (!config) {
    return (
      <div className="h-screen w-screen p-2 flex items-center justify-center">
        <div className="macos-glass-panel rounded-2xl p-6 flex items-center space-x-3 text-zinc-300">
          <Sparkles className="w-5 h-5 animate-spin text-blue-400" />
          <span className="text-xs font-medium">Opening macOS Glass Sidebar...</span>
        </div>
      </div>
    );
  }

  // Filter items based on search query
  const filteredGroups = config.groups.map((group) => {
    if (!searchQuery.trim()) return group;
    const q = searchQuery.toLowerCase();
    const matchedItems = group.items.filter((item) =>
      item.name.toLowerCase().includes(q)
    );
    return {
      ...group,
      items: matchedItems,
      is_collapsed: matchedItems.length === 0,
    };
  });

  return (
    <div className="h-screen w-screen macos-glass-panel flex flex-col overflow-hidden relative select-none rounded-l-2xl">
      {/* macOS Style Traffic Lights Window Bar */}
      <div
        data-tauri-drag-region
        className="px-3.5 pt-3 pb-2 flex items-center justify-between border-b border-white/[0.08] bg-white/[0.02] cursor-grab active:cursor-grabbing"
      >
          {/* Traffic Lights */}
          <div className="flex items-center space-x-1.5 traffic-container">
            <button
              onClick={handleClose}
              title="Close Sidebar"
              className="traffic-dot traffic-close group"
            >
              <X className="w-2 h-2 text-[#4d0000] stroke-[3]" />
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              title="Sidebar Settings"
              className="traffic-dot traffic-minimize group"
            >
              <span className="w-1.5 h-0.5 bg-[#6b4700] rounded-full" />
            </button>
            <button
              onClick={() => setShowNewGroupModal(true)}
              title="Create New Group"
              className="traffic-dot traffic-expand group"
            >
              <Plus className="w-2 h-2 text-[#004d1a] stroke-[3]" />
            </button>
          </div>

          {/* Centered / Header Title -> macOS Segmented Switcher */}
          <div className="flex items-center bg-black/40 p-0.5 rounded-lg border border-white/10 shadow-inner">
            <button
              onClick={() => handleTabChange("apps")}
              className={`flex items-center space-x-1 px-2.5 py-0.5 rounded-md text-[10.5px] font-medium transition-all ${
                activeTab === "apps"
                  ? "bg-white/20 text-white shadow-sm font-semibold"
                  : "text-white/50 hover:text-white/80"
              }`}
            >
              <span>Apps</span>
            </button>
            <button
              onClick={() => handleTabChange("music")}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium transition-all ${
                activeTab === "music"
                  ? "bg-gradient-to-r from-blue-600/40 to-purple-600/40 text-white border border-blue-400/30 shadow-sm font-semibold"
                  : "text-white/50 hover:text-white/80"
              }`}
            >
              <Music className="w-2.5 h-2.5 text-blue-400" />
              <span>Music</span>
              {isMusicPlaying && (
                <span className="flex space-x-0.5 items-end h-2 ml-0.5">
                  <span className="w-0.5 h-1.5 bg-emerald-400 animate-pulse rounded-full" />
                  <span className="w-0.5 h-2.5 bg-emerald-400 animate-pulse delay-75 rounded-full" />
                  <span className="w-0.5 h-1 bg-emerald-400 animate-pulse delay-150 rounded-full" />
                </span>
              )}
            </button>
            <button
              onClick={() => handleTabChange("tools")}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium transition-all ${
                activeTab === "tools"
                  ? "bg-gradient-to-r from-emerald-600/40 to-teal-600/40 text-white border border-emerald-400/30 shadow-sm font-semibold"
                  : "text-white/50 hover:text-white/80"
              }`}
            >
              <Wrench className="w-2.5 h-2.5 text-emerald-400" />
              <span>IT-Tools</span>
            </button>
          </div>

          {/* View Mode & Extra Controls */}
          <div className="flex items-center space-x-1">
            {activeTab === "apps" && (
              <button
                onClick={() => setViewMode(viewMode === "list" ? "grid" : "list")}
                title={viewMode === "list" ? "Switch to 2-Column Grid" : "Switch to List"}
                className="p-1 rounded-md hover:bg-white/10 active:bg-white/20 text-white/60 hover:text-white transition-colors"
              >
                {viewMode === "list" ? (
                  <LayoutGrid className="w-3.5 h-3.5" />
                ) : (
                  <LayoutList className="w-3.5 h-3.5" />
                )}
              </button>
            )}
            <button
              onClick={() => setShowSettings(!showSettings)}
              title="Settings"
              className={`p-1 rounded-md transition-colors ${
                showSettings
                  ? "bg-white/20 text-blue-400"
                  : "hover:bg-white/10 text-white/60 hover:text-white"
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Tab 1: Apps Content */}
        <div
          className={`flex-1 flex flex-col overflow-hidden ${
            activeTab === "apps" ? "" : "hidden"
          }`}
        >
          {/* macOS Search Bar */}
          <div className="px-3 pt-2.5 pb-2 shrink-0">
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 absolute left-2.5 text-white/40 pointer-events-none" />
              <input
                type="text"
                placeholder="Search apps..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-black/25 hover:bg-black/35 focus:bg-black/45 border border-white/10 focus:border-white/25 rounded-xl pl-8 pr-7 py-1 text-[11.5px] text-white placeholder-white/35 outline-none transition-all shadow-inner"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 text-white/40 hover:text-white/80"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Real-time Live Market Rates (BTC, ETH, Gold, Gram) */}
          <LiveMarketCard />

          {/* Standalone Account Cooldown & Token Reset Tracker */}
          <AccountQuotaWidget onNotify={showToast} />

          {/* Groups Scroll Container */}
          <main className="flex-1 overflow-y-auto px-2.5 pb-3 space-y-2.5">
          {filteredGroups.map((group) => {
            const itemCount = group.items.length;
            return (
              <section
                key={group.id}
                onMouseEnter={() => setHoveredGroupId(group.id)}
                className="macos-group-card rounded-xl overflow-hidden transition-all duration-200"
              >
                {/* macOS Category Header */}
                <div
                  onClick={() => handleToggleCollapse(group.id)}
                  className="px-2.5 py-1.5 flex items-center justify-between cursor-pointer hover:bg-white/[0.04] active:bg-white/[0.08] transition-colors"
                >
                  <div className="flex items-center space-x-1.5 min-w-0">
                    <span
                      className="w-2 h-2 rounded-full shrink-0 shadow-sm"
                      style={{ backgroundColor: group.color }}
                    />
                    <span className="text-[11px] font-semibold tracking-wide text-white/70 uppercase truncate">
                      {group.name}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-white/[0.08] text-white/40 font-mono">
                      {itemCount}
                    </span>
                  </div>

                  <div
                    className="flex items-center space-x-0.5 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => handlePickFile(group.id)}
                      title="Add Application"
                      className="p-1 rounded-md hover:bg-white/15 text-white/40 hover:text-white transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleToggleCollapse(group.id)}
                      className="p-1 rounded-md hover:bg-white/15 text-white/40 hover:text-white transition-colors"
                    >
                      {group.is_collapsed ? (
                        <ChevronRight className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Group Content */}
                {!group.is_collapsed && (
                  <div className="px-1.5 pb-1.5 pt-0.5">
                    {group.items.length === 0 ? (
                      <div
                        onClick={() => handlePickFile(group.id)}
                        className="border border-dashed border-white/10 hover:border-white/25 rounded-lg py-2.5 px-2 text-center cursor-pointer hover:bg-white/[0.04] transition-all text-white/40 hover:text-white/70"
                      >
                        <Plus className="w-3.5 h-3.5 mx-auto mb-1 opacity-60" />
                        <p className="text-[10px]">Add shortcut or drag here</p>
                      </div>
                    ) : viewMode === "list" ? (
                      /* Narrow macOS List View */
                      <div className="space-y-0.5">
                        {group.items.map((item) => (
                          <div
                            key={item.id}
                            onClick={() => handleLaunch(item)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setActiveContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                item,
                                groupId: group.id,
                              });
                            }}
                            className="macos-item-row group flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer text-left"
                            title={`${item.name}\n${item.path}`}
                          >
                            <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                              {/* High-res App Icon */}
                              <div className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md bg-white/[0.04] p-0.5 ring-1 ring-white/10 shadow-sm">
                                {item.icon_base64 ? (
                                  <img
                                    src={item.icon_base64}
                                    alt={item.name}
                                    className="w-6 h-6 object-contain pointer-events-none"
                                  />
                                ) : (
                                  <Play className="w-3.5 h-3.5 text-white/70" />
                                )}
                              </div>

                              {/* App Label */}
                              <span className="text-[11.5px] font-medium text-white/85 group-hover:text-white truncate">
                                {item.name}
                              </span>
                            </div>

                            {/* Hover Quick Action */}
                            <div className="opacity-0 group-hover:opacity-100 flex items-center transition-opacity shrink-0 ml-1">
                              <span className="w-5 h-5 rounded-md bg-white/10 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/20">
                                <Play className="w-2.5 h-2.5 fill-current" />
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      /* 2-Column Compact Grid View */
                      <div className="grid grid-cols-2 gap-1">
                        {group.items.map((item) => (
                          <div
                            key={item.id}
                            onClick={() => handleLaunch(item)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setActiveContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                item,
                                groupId: group.id,
                              });
                            }}
                            className="macos-item-row group flex flex-col items-center justify-center p-2 rounded-lg cursor-pointer text-center"
                            title={`${item.name}\n${item.path}`}
                          >
                            <div className="w-8 h-8 flex items-center justify-center mb-1 drop-shadow-sm">
                              {item.icon_base64 ? (
                                <img
                                  src={item.icon_base64}
                                  alt={item.name}
                                  className="w-7 h-7 object-contain pointer-events-none"
                                />
                              ) : (
                                <div className="w-7 h-7 rounded-md bg-white/10 flex items-center justify-center text-white/70">
                                  <Play className="w-3 h-3" />
                                </div>
                              )}
                            </div>
                            <span className="text-[10px] leading-tight text-white/80 group-hover:text-white truncate w-full px-0.5">
                              {item.name}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}

          {filteredGroups.length === 0 && (
            <div className="text-center py-8 text-white/40 text-[11px]">
              No applications found.
            </div>
          )}
        </main>
      </div>

      {/* Tab 2: Telegram Music Content */}
      <div
        className={`flex-1 flex flex-col overflow-hidden ${
          activeTab === "music" ? "" : "hidden"
        }`}
      >
        <MusicPlayer onPlayStateChange={setIsMusicPlaying} />
      </div>

      {/* Tab 3: IT-Tools Developer Suite */}
      <div
        className={`flex-1 flex flex-col overflow-hidden ${
          activeTab === "tools" ? "" : "hidden"
        }`}
      >
        <ITToolsViewer
          onToggleExpand={handleToggleToolsExpand}
          isExpanded={isToolsExpanded}
        />
      </div>

        {/* macOS Glass Settings Drawer */}
        {showSettings && (
          <div className="absolute inset-x-0 bottom-0 top-[42px] macos-menu-glass z-40 p-3.5 flex flex-col justify-between border-t border-white/10 animate-in fade-in slide-in-from-bottom duration-200">
            <div className="space-y-3.5 overflow-y-auto pr-1">
              <div className="flex items-center justify-between pb-2 border-b border-white/10">
                <div className="flex items-center space-x-1.5">
                  <Sliders className="w-3.5 h-3.5 text-blue-400" />
                  <h2 className="text-xs font-semibold text-white/90">
                    Sidebar Preferences
                  </h2>
                </div>
                <button
                  onClick={() => setShowSettings(false)}
                  className="text-white/40 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Edge Position */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-white/40 block mb-1">
                  Dock Edge
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() =>
                      handleUpdateDockSettings(
                        "left",
                        config.settings.width,
                        config.settings.is_appbar
                      )
                    }
                    className={`py-1 px-2.5 rounded-lg text-[11px] font-medium border flex items-center justify-center space-x-1.5 transition-all ${
                      config.settings.dock_edge === "left"
                        ? "bg-blue-600/40 border-blue-400/60 text-white"
                        : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                    }`}
                  >
                    <span>Left Edge</span>
                    {config.settings.dock_edge === "left" && (
                      <Check className="w-3 h-3 text-blue-400" />
                    )}
                  </button>
                  <button
                    onClick={() =>
                      handleUpdateDockSettings(
                        "right",
                        config.settings.width,
                        config.settings.is_appbar
                      )
                    }
                    className={`py-1 px-2.5 rounded-lg text-[11px] font-medium border flex items-center justify-center space-x-1.5 transition-all ${
                      config.settings.dock_edge === "right"
                        ? "bg-blue-600/40 border-blue-400/60 text-white"
                        : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                    }`}
                  >
                    <span>Right Edge</span>
                    {config.settings.dock_edge === "right" && (
                      <Check className="w-3 h-3 text-blue-400" />
                    )}
                  </button>
                </div>
              </div>

              {/* Width Slider */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                    Sidebar Width
                  </label>
                  <span className="text-[10px] font-mono text-blue-400">
                    {config.settings.width}px
                  </span>
                </div>
                <input
                  type="range"
                  min="200"
                  max="400"
                  step="10"
                  value={config.settings.width}
                  onChange={(e) =>
                    handleUpdateDockSettings(
                      config.settings.dock_edge,
                      parseInt(e.target.value),
                      config.settings.is_appbar
                    )
                  }
                  className="w-full accent-blue-500 cursor-pointer h-1.5 bg-white/10 rounded-lg"
                />
              </div>

              {/* Reserve Desktop Space (AppBar) */}
              <div className="p-2.5 rounded-xl bg-white/[0.04] border border-white/10">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-medium text-white/90 block">
                      Reserve Screen Space (AppBar)
                    </span>
                    <span className="text-[9.5px] text-white/40 block mt-0.5">
                      Prevents maximized windows from covering sidebar
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.settings.is_appbar}
                    onChange={(e) =>
                      handleUpdateDockSettings(
                        config.settings.dock_edge,
                        config.settings.width,
                        e.target.checked
                      )
                    }
                    className="w-3.5 h-3.5 accent-blue-500 cursor-pointer ml-2"
                  />
                </div>
              </div>

              {/* Groups Management */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-white/40 block mb-1">
                  Groups ({config.groups.length})
                </label>
                <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                  {config.groups.map((g) => (
                    <div
                      key={g.id}
                      className="flex items-center justify-between p-1.5 rounded-lg bg-white/[0.04] border border-white/5 text-[11px]"
                    >
                      <div className="flex items-center space-x-1.5 truncate">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: g.color }}
                        />
                        <span className="truncate text-white/80">{g.name}</span>
                      </div>
                      <button
                        onClick={() => handleDeleteGroup(g.id)}
                        className="text-white/40 hover:text-red-400 p-1"
                        title="Delete Group"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-white/10 flex justify-between items-center text-[10px] text-white/40">
              <span>macOS Glass Edition</span>
              <button
                onClick={() => setShowSettings(false)}
                className="px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* macOS Frosted Modal for Creating Group */}
        {showNewGroupModal && (
          <div className="absolute inset-0 bg-black/40 backdrop-blur-md z-50 flex items-center justify-center p-3">
            <div className="w-full macos-menu-glass rounded-2xl p-3.5 shadow-2xl space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-white/90">
                  New Application Group
                </h3>
                <button
                  onClick={() => setShowNewGroupModal(false)}
                  className="text-white/40 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div>
                <label className="text-[10px] text-white/40 uppercase font-semibold tracking-wider block mb-1">
                  Group Title
                </label>
                <input
                  type="text"
                  placeholder="e.g. 🚀 Quick Launch, 🎨 Design"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleCreateGroup()}
                  className="w-full bg-white/5 border border-white/15 focus:border-blue-400 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] text-white/40 uppercase font-semibold tracking-wider block mb-1">
                  Accent Color
                </label>
                <div className="flex items-center space-x-1.5">
                  {PRESET_COLORS.map((col) => (
                    <button
                      key={col}
                      onClick={() => setNewGroupColor(col)}
                      className={`w-5 h-5 rounded-full transition-transform ${
                        newGroupColor === col
                          ? "scale-125 ring-2 ring-white/80"
                          : "hover:scale-110 opacity-70 hover:opacity-100"
                      }`}
                      style={{ backgroundColor: col }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex justify-end space-x-1.5 pt-2 border-t border-white/10">
                <button
                  onClick={() => setShowNewGroupModal(false)}
                  className="px-2.5 py-1 rounded-lg text-xs text-white/50 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateGroup}
                  disabled={!newGroupName.trim()}
                  className="px-3 py-1 rounded-lg text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-40 transition-colors"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}

        {/* macOS Context Menu */}
        {activeContextMenu && (
          <div
            ref={contextMenuRef}
            style={{
              top: Math.min(activeContextMenu.y, window.innerHeight - 150),
              left: Math.min(activeContextMenu.x, window.innerWidth - 170),
            }}
            className="fixed z-50 w-40 macos-menu-glass rounded-xl shadow-2xl p-1 text-xs text-white/90 select-none animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="px-2 py-1 border-b border-white/10 text-[9.5px] text-white/40 truncate font-semibold uppercase tracking-wider">
              {activeContextMenu.item.name}
            </div>

            <button
              onClick={() => handleLaunch(activeContextMenu.item, false)}
              className="w-full px-2 py-1.5 rounded-md flex items-center space-x-2 hover:bg-[#007aff] hover:text-white transition-colors"
            >
              <Play className="w-3 h-3 text-blue-400 group-hover:text-white" />
              <span>Launch</span>
            </button>

            <button
              onClick={() => handleLaunch(activeContextMenu.item, true)}
              className="w-full px-2 py-1.5 rounded-md flex items-center space-x-2 hover:bg-[#007aff] hover:text-white transition-colors"
            >
              <Shield className="w-3 h-3 text-amber-400 group-hover:text-white" />
              <span>Run as Admin</span>
            </button>

            <button
              onClick={() => handleOpenFolder(activeContextMenu.item)}
              className="w-full px-2 py-1.5 rounded-md flex items-center space-x-2 hover:bg-[#007aff] hover:text-white transition-colors"
            >
              <FolderOpen className="w-3 h-3 text-white/60 group-hover:text-white" />
              <span>Show in Folder</span>
            </button>

            <div className="my-0.5 border-t border-white/10" />

            <button
              onClick={() =>
                handleDeleteItem(
                  activeContextMenu.groupId,
                  activeContextMenu.item.id
                )
              }
              className="w-full px-2 py-1.5 rounded-md flex items-center space-x-2 hover:bg-red-600/80 text-red-400 hover:text-white transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              <span>Remove</span>
            </button>
          </div>
        )}

        {/* Floating Toast Notification */}
        {notification && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-xl border border-white/20 text-white text-[11px] px-3 py-1 rounded-full shadow-lg pointer-events-none transition-all">
            {notification}
          </div>
        )}
    </div>
  );
}
