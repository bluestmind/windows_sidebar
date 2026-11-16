import { useState, useEffect } from "react";
import {
  StickyNote,
  Plus,
  Copy,
  Check,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { SidebarNote } from "../types";

const NOTES_STORAGE_KEY = "sidebar_notes_v1";
const NOTES_ACTIVE_KEY = "sidebar_notes_active_v1";

const NOTE_COLORS: Record<
  SidebarNote["color"],
  { dot: string; border: string; pill: string; tint: string }
> = {
  amber: {
    dot: "bg-amber-400",
    border: "border-amber-400/25",
    pill: "bg-amber-500/20 text-amber-200 border-amber-400/35",
    tint: "bg-amber-500/[0.04]",
  },
  blue: {
    dot: "bg-blue-400",
    border: "border-blue-400/25",
    pill: "bg-blue-500/20 text-blue-200 border-blue-400/35",
    tint: "bg-blue-500/[0.04]",
  },
  emerald: {
    dot: "bg-emerald-400",
    border: "border-emerald-400/25",
    pill: "bg-emerald-500/20 text-emerald-200 border-emerald-400/35",
    tint: "bg-emerald-500/[0.04]",
  },
  purple: {
    dot: "bg-purple-400",
    border: "border-purple-400/25",
    pill: "bg-purple-500/20 text-purple-200 border-purple-400/35",
    tint: "bg-purple-500/[0.04]",
  },
  rose: {
    dot: "bg-rose-400",
    border: "border-rose-400/25",
    pill: "bg-rose-500/20 text-rose-200 border-rose-400/35",
    tint: "bg-rose-500/[0.04]",
  },
};

const COLOR_ORDER: SidebarNote["color"][] = [
  "amber",
  "blue",
  "emerald",
  "purple",
  "rose",
];

function createDefaultNote(index = 1): SidebarNote {
  return {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: `Note ${index}`,
    content: "",
    color: COLOR_ORDER[(index - 1) % COLOR_ORDER.length],
    updatedAt: Date.now(),
  };
}

function loadNotes(): SidebarNote[] {
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    if (!raw) return [createDefaultNote(1)];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {}
  return [createDefaultNote(1)];
}

interface NotesWidgetProps {
  onNotify?: (msg: string) => void;
}

export default function NotesWidget({ onNotify }: NotesWidgetProps) {
  const [notes, setNotes] = useState<SidebarNote[]>(() => loadNotes());
  const [activeId, setActiveId] = useState<string>(() => {
    const saved = localStorage.getItem(NOTES_ACTIVE_KEY);
    const list = loadNotes();
    if (saved && list.some((n) => n.id === saved)) return saved;
    return list[0].id;
  });
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    return localStorage.getItem("sidebar_notes_collapsed") === "true";
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
    } catch {}
  }, [notes]);

  useEffect(() => {
    try {
      localStorage.setItem(NOTES_ACTIVE_KEY, activeId);
    } catch {}
  }, [activeId]);

  const activeNote = notes.find((n) => n.id === activeId) || notes[0];
  const colorStyle = NOTE_COLORS[activeNote.color] || NOTE_COLORS.amber;

  const toggleCollapse = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    localStorage.setItem("sidebar_notes_collapsed", String(next));
  };

  const handleAddNote = () => {
    const nextNote = createDefaultNote(notes.length + 1);
    setNotes((prev) => [...prev, nextNote]);
    setActiveId(nextNote.id);
    if (isCollapsed) toggleCollapse();
  };

  const handleUpdateNote = (patch: Partial<SidebarNote>) => {
    setNotes((prev) =>
      prev.map((n) =>
        n.id === activeNote.id ? { ...n, ...patch, updatedAt: Date.now() } : n
      )
    );
  };

  const handleCycleColor = () => {
    const idx = COLOR_ORDER.indexOf(activeNote.color);
    const nextColor = COLOR_ORDER[(idx + 1) % COLOR_ORDER.length];
    handleUpdateNote({ color: nextColor });
  };

  const handleDeleteNote = (id: string) => {
    if (notes.length <= 1) {
      handleUpdateNote({ title: "Note 1", content: "" });
      onNotify?.("Note cleared");
      return;
    }
    const remaining = notes.filter((n) => n.id !== id);
    setNotes(remaining);
    if (activeId === id) {
      setActiveId(remaining[0].id);
    }
    onNotify?.("Note deleted");
  };

  const handleCopy = async () => {
    if (!activeNote.content) return;
    try {
      await navigator.clipboard.writeText(activeNote.content);
      setCopied(true);
      onNotify?.("Copied note to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="mx-2.5 mb-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.08] shadow-sm transition-colors overflow-hidden shrink-0">
      {/* Header */}
      <div
        onClick={toggleCollapse}
        className="px-2.5 py-1.5 flex items-center justify-between cursor-pointer select-none border-b border-white/[0.04]"
      >
        <div className="flex items-center space-x-1.5 min-w-0">
          <StickyNote className="w-3 h-3 text-amber-400 shrink-0" />
          <span className="text-[10px] font-semibold tracking-wider uppercase text-white/75 truncate">
            Quick Notes
          </span>
          <span className="text-[8.5px] font-mono px-1.5 py-0.2 rounded-full bg-white/[0.08] text-white/55">
            {notes.length}
          </span>
        </div>

        <div
          className="flex items-center space-x-0.5 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={handleAddNote}
            title="New Note"
            className="p-0.5 rounded hover:bg-white/15 text-white/50 hover:text-white transition-colors"
          >
            <Plus className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={toggleCollapse}
            title={isCollapsed ? "Expand Notes" : "Collapse Notes"}
            className="p-0.5 rounded hover:bg-white/15 text-white/50 hover:text-white transition-colors"
          >
            {isCollapsed ? (
              <ChevronRight className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>

      {/* Collapsible Body */}
      {!isCollapsed && (
        <div className="p-1.5 space-y-1.5">
          {/* Note Tabs */}
          {notes.length > 1 && (
            <div className="flex items-center space-x-1 overflow-x-auto pb-0.5">
              {notes.map((n) => {
                const isActive = n.id === activeNote.id;
                const style = NOTE_COLORS[n.color] || NOTE_COLORS.amber;
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => setActiveId(n.id)}
                    className={`flex items-center space-x-1 px-2 py-0.5 rounded-md text-[9.5px] border shrink-0 transition-colors ${
                      isActive
                        ? style.pill
                        : "bg-black/25 border-white/[0.06] text-white/50 hover:text-white/80"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                    <span className="max-w-[72px] truncate">{n.title || "Note"}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Active Note Card */}
          <div
            className={`rounded-lg border p-1.5 space-y-1 ${colorStyle.border} ${colorStyle.tint}`}
          >
            {/* Title + Actions */}
            <div className="flex items-center justify-between space-x-1.5">
              <div className="flex items-center space-x-1.5 min-w-0 flex-1">
                <button
                  type="button"
                  onClick={handleCycleColor}
                  title="Change note color"
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorStyle.dot} ring-1 ring-white/25`}
                />
                <input
                  type="text"
                  value={activeNote.title}
                  onChange={(e) => handleUpdateNote({ title: e.target.value })}
                  placeholder="Note title..."
                  className="w-full bg-transparent text-[10.5px] font-semibold text-white/90 placeholder-white/30 outline-none"
                />
              </div>

              <div className="flex items-center space-x-1 shrink-0">
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={!activeNote.content}
                  title="Copy note content"
                  className="p-0.5 rounded hover:bg-white/10 text-white/45 hover:text-white disabled:opacity-30 transition-colors"
                >
                  {copied ? (
                    <Check className="w-2.5 h-2.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-2.5 h-2.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteNote(activeNote.id)}
                  title={notes.length > 1 ? "Delete note" : "Clear note"}
                  className="p-0.5 rounded hover:bg-rose-500/20 text-white/40 hover:text-rose-300 transition-colors"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>

            {/* Note Content Textarea */}
            <textarea
              value={activeNote.content}
              onChange={(e) => handleUpdateNote({ content: e.target.value })}
              placeholder="Write a quick note, snippet, or reminder..."
              rows={3}
              className="w-full bg-black/25 focus:bg-black/35 border border-white/[0.06] focus:border-white/15 rounded-md px-2 py-1.5 text-[11px] leading-relaxed text-white/90 placeholder-white/30 outline-none resize-none select-text"
            />

            {/* Footer Meta */}
            <div className="flex items-center justify-between text-[8.5px] font-mono text-white/35 px-0.5">
              <span>{activeNote.content.length} chars</span>
              <span>Auto-saved</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
