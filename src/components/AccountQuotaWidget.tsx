import { useState, useEffect } from "react";
import {
  Cpu,
  ChevronDown,
  ChevronRight,
  Clock,
  Plus,
  Trash2,
  CheckCircle2,
  RotateCcw,
  X,
} from "lucide-react";
import type { GoogleAccountQuota, ModelQuotaInfo } from "../types";

const MANUAL_STORAGE_KEY = "sidebar_manual_account_quotas_v1";

const PRESET_MODELS = [
  "Gemini Pro High",
  "Gemini Flash",
  "Claude Sonnet",
  "Gemini Image",
];

function loadAccounts(): GoogleAccountQuota[] {
  try {
    const raw = localStorage.getItem(MANUAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((acc) => ({
      id: acc.id || `acc-${Date.now()}`,
      email: acc.email || "account@gmail.com",
      subscription_tier:
        acc.subscription_tier === "ULTRA" || acc.subscription_tier === "FREE"
          ? acc.subscription_tier
          : "PRO",
      is_active: Boolean(acc.is_active),
      models: Array.isArray(acc.models)
        ? acc.models.map((m: Partial<ModelQuotaInfo> & { name?: string }) => ({
            id: m.id || m.name || `model-${Math.random()}`,
            display_name: m.display_name || m.name || "Model",
            percentage: typeof m.percentage === "number" ? m.percentage : 100,
            reset_time: m.reset_time ?? null,
          }))
        : [],
      last_updated: typeof acc.last_updated === "number" ? acc.last_updated : Date.now(),
    }));
  } catch {
    return [];
  }
}

function saveAccounts(list: GoogleAccountQuota[]) {
  try {
    localStorage.setItem(MANUAL_STORAGE_KEY, JSON.stringify(list));
  } catch {}
}

function formatResetCountdown(
  resetTime: string | null,
  percentage: number,
  nowMs: number
): {
  text: string;
  exactTime: string | null;
  isUrgent: boolean;
  isReady: boolean;
} {
  if (!resetTime) {
    if (percentage >= 99.5) {
      return { text: "Full", exactTime: null, isUrgent: false, isReady: true };
    }
    return { text: "No timer", exactTime: null, isUrgent: false, isReady: false };
  }

  const targetMs = Date.parse(resetTime);
  if (isNaN(targetMs)) {
    return { text: "No timer", exactTime: null, isUrgent: false, isReady: false };
  }

  const exactTime = new Date(targetMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) {
    return {
      text: "Tokens back",
      exactTime,
      isUrgent: false,
      isReady: true,
    };
  }

  const totalSecs = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  let text = "";
  if (days > 0) {
    text = `${days}d ${hours}h`;
  } else if (hours > 0) {
    text = `${hours}h ${mins}m`;
  } else if (mins > 0) {
    text = `${mins}m ${secs < 10 ? "0" : ""}${secs}s`;
  } else {
    text = `${secs}s`;
  }

  return {
    text,
    exactTime,
    isUrgent: percentage <= 15,
    isReady: false,
  };
}

function getTierBadgeStyle(tier: string): string {
  if (tier === "ULTRA") {
    return "bg-purple-500/20 text-purple-300 border-purple-400/30";
  }
  if (tier === "PRO") {
    return "bg-blue-500/20 text-blue-300 border-blue-400/30";
  }
  return "bg-white/10 text-white/60 border-white/15";
}

function getBarColor(pct: number): string {
  if (pct >= 60) return "bg-emerald-400";
  if (pct >= 25) return "bg-amber-400";
  return "bg-rose-500";
}

function getTextColor(pct: number): string {
  if (pct >= 60) return "text-emerald-400";
  if (pct >= 25) return "text-amber-300";
  return "text-rose-400";
}

interface AccountQuotaWidgetProps {
  onNotify?: (msg: string) => void;
}

export default function AccountQuotaWidget({ onNotify }: AccountQuotaWidgetProps) {
  const [accounts, setAccounts] = useState<GoogleAccountQuota[]>(() => loadAccounts());
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    return localStorage.getItem("sidebar_quota_collapsed") === "true";
  });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showAddForm, setShowAddForm] = useState(false);

  // Form state
  const [emailInput, setEmailInput] = useState("");
  const [tierInput, setTierInput] = useState<"PRO" | "ULTRA" | "FREE">("PRO");
  const [modelPreset, setModelPreset] = useState(PRESET_MODELS[0]);
  const [customModel, setCustomModel] = useState("");
  const [percentInput, setPercentInput] = useState(0);
  const [resetHours, setResetHours] = useState("5");
  const [resetMins, setResetMins] = useState("0");

  // 1-second live countdown ticker + auto-restore when cooldown expires
  useEffect(() => {
    const ticker = setInterval(() => {
      const now = Date.now();
      setNowMs(now);

      setAccounts((prev) => {
        let changed = false;
        const restoredNames: string[] = [];

        const next = prev.map((acc) => {
          let accChanged = false;
          const updatedModels = acc.models.map((m) => {
            if (m.reset_time) {
              const target = Date.parse(m.reset_time);
              if (!isNaN(target) && target <= now) {
                changed = true;
                accChanged = true;
                restoredNames.push(`${m.display_name} (${acc.email})`);
                return { ...m, percentage: 100, reset_time: null };
              }
            }
            return m;
          });
          return accChanged ? { ...acc, models: updatedModels, last_updated: now } : acc;
        });

        if (changed) {
          saveAccounts(next);
          if (restoredNames.length > 0) {
            onNotify?.(`Tokens back: ${restoredNames[0]}`);
          }
          return next;
        }
        return prev;
      });
    }, 1000);

    return () => clearInterval(ticker);
  }, [onNotify]);

  const persist = (next: GoogleAccountQuota[]) => {
    setAccounts(next);
    saveAccounts(next);
  };

  const toggleCollapse = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    localStorage.setItem("sidebar_quota_collapsed", String(next));
  };

  const applyCooldownPreset = (hours: number) => {
    setResetHours(String(hours));
    setResetMins("0");
    setPercentInput(0);
  };

  const handleSaveTracker = (e: React.FormEvent) => {
    e.preventDefault();
    const email = emailInput.trim();
    if (!email) return;

    const modelName =
      modelPreset === "__custom__" ? customModel.trim() || "Custom Model" : modelPreset;
    const hrs = Math.max(0, parseFloat(resetHours) || 0);
    const mins = Math.max(0, parseFloat(resetMins) || 0);
    const totalMs = (hrs * 3600 + mins * 60) * 1000;
    const resetTime = totalMs > 0 ? new Date(Date.now() + totalMs).toISOString() : null;

    const entry: ModelQuotaInfo = {
      id: modelName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      display_name: modelName,
      percentage: Math.min(100, Math.max(0, percentInput)),
      reset_time: resetTime,
    };

    const existingIdx = accounts.findIndex(
      (a) => a.email.toLowerCase() === email.toLowerCase()
    );

    let next: GoogleAccountQuota[];
    if (existingIdx >= 0) {
      next = accounts.map((acc, idx) => {
        if (idx !== existingIdx) return acc;
        const filtered = acc.models.filter(
          (m) => m.display_name.toLowerCase() !== entry.display_name.toLowerCase()
        );
        return {
          ...acc,
          subscription_tier: tierInput,
          models: [...filtered, entry],
          last_updated: Date.now(),
        };
      });
    } else {
      const created: GoogleAccountQuota = {
        id: `acc-${Date.now()}`,
        email,
        subscription_tier: tierInput,
        is_active: accounts.length === 0,
        models: [entry],
        last_updated: Date.now(),
      };
      next = [...accounts, created];
    }

    persist(next);
    setEmailInput("");
    setCustomModel("");
    setShowAddForm(false);
    onNotify?.(`Saved timer for ${email}`);
  };

  const handleSetActive = (accountId: string) => {
    const next = accounts.map((a) => ({
      ...a,
      is_active: a.id === accountId,
    }));
    persist(next);
  };

  const handleQuickReset = (accountId: string, modelId: string) => {
    const next = accounts.map((acc) => {
      if (acc.id !== accountId) return acc;
      return {
        ...acc,
        last_updated: Date.now(),
        models: acc.models.map((m) =>
          m.id === modelId ? { ...m, percentage: 100, reset_time: null } : m
        ),
      };
    });
    persist(next);
  };

  const handleQuickCooldown5h = (accountId: string, modelId: string) => {
    const resetAt = new Date(Date.now() + 5 * 3600 * 1000).toISOString();
    const next = accounts.map((acc) => {
      if (acc.id !== accountId) return acc;
      return {
        ...acc,
        last_updated: Date.now(),
        models: acc.models.map((m) =>
          m.id === modelId ? { ...m, percentage: 0, reset_time: resetAt } : m
        ),
      };
    });
    persist(next);
  };

  const handleDeleteModel = (accountId: string, modelId: string) => {
    const next = accounts
      .map((acc) => {
        if (acc.id !== accountId) return acc;
        return {
          ...acc,
          models: acc.models.filter((m) => m.id !== modelId),
        };
      })
      .filter((acc) => acc.models.length > 0);
    persist(next);
  };

  const handleDeleteAccount = (accountId: string) => {
    const remaining = accounts.filter((a) => a.id !== accountId);
    if (remaining.length > 0 && !remaining.some((a) => a.is_active)) {
      remaining[0] = { ...remaining[0], is_active: true };
    }
    persist(remaining);
  };

  const openAddForAccount = (acc: GoogleAccountQuota) => {
    setEmailInput(acc.email);
    setTierInput(acc.subscription_tier);
    setShowAddForm(true);
    if (isCollapsed) toggleCollapse();
  };

  return (
    <div className="mx-2.5 mb-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.08] shadow-sm transition-all overflow-hidden shrink-0">
      {/* Header Bar */}
      <div
        onClick={toggleCollapse}
        className="px-2.5 py-1.5 flex items-center justify-between cursor-pointer select-none border-b border-white/[0.04]"
      >
        <div className="flex items-center space-x-1.5 min-w-0">
          <Cpu className="w-3 h-3 text-cyan-400 shrink-0" />
          <span className="text-[10px] font-semibold tracking-wider uppercase text-white/75 truncate">
            Account Cooldowns
          </span>
          {accounts.length > 0 && (
            <span className="text-[8.5px] font-mono px-1.5 py-0.2 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/25">
              {accounts.length}
            </span>
          )}
        </div>

        <div
          className="flex items-center space-x-0.5 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              setShowAddForm(!showAddForm);
              if (isCollapsed) toggleCollapse();
            }}
            title="Add Account / Model Cooldown"
            className="p-0.5 rounded hover:bg-white/15 text-white/50 hover:text-white transition-colors"
          >
            <Plus className="w-3 h-3" />
          </button>
          <button
            onClick={toggleCollapse}
            title={isCollapsed ? "Expand Cooldowns" : "Collapse Cooldowns"}
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
        <div className="p-1.5 space-y-1.5 max-h-[260px] overflow-y-auto">
          {/* Add / Edit Cooldown Form */}
          {showAddForm && (
            <form
              onSubmit={handleSaveTracker}
              className="p-2 rounded-lg bg-black/40 border border-cyan-500/25 space-y-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[9.5px] font-semibold text-cyan-300">
                  Track Account & Token Reset
                </span>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="text-white/40 hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>

              <input
                type="text"
                placeholder="account@gmail.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                required
                className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-[10.5px] text-white placeholder-white/30 outline-none focus:border-cyan-400/50"
              />

              <div className="grid grid-cols-2 gap-1">
                <select
                  value={modelPreset}
                  onChange={(e) => setModelPreset(e.target.value)}
                  className="bg-[#181b28] border border-white/10 rounded px-1.5 py-1 text-[10px] text-white outline-none"
                >
                  {PRESET_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  <option value="__custom__">Custom...</option>
                </select>
                <select
                  value={tierInput}
                  onChange={(e) =>
                    setTierInput(e.target.value as "PRO" | "ULTRA" | "FREE")
                  }
                  className="bg-[#181b28] border border-white/10 rounded px-1.5 py-1 text-[10px] text-white outline-none"
                >
                  <option value="PRO">PRO</option>
                  <option value="ULTRA">ULTRA</option>
                  <option value="FREE">FREE</option>
                </select>
              </div>

              {modelPreset === "__custom__" && (
                <input
                  type="text"
                  placeholder="Model name (e.g. Gemini 3.8)"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  required
                  className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] text-white placeholder-white/30 outline-none focus:border-cyan-400/50"
                />
              )}

              {/* Quick Reset Presets */}
              <div className="flex items-center space-x-1">
                <span className="text-[8.5px] text-white/40 mr-0.5">Preset:</span>
                {[
                  { label: "5h", hrs: 5 },
                  { label: "2d", hrs: 48 },
                  { label: "7d", hrs: 168 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyCooldownPreset(preset.hrs)}
                    className="px-1.5 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.14] text-[9px] font-mono text-cyan-300 border border-white/10 transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-1 items-center">
                <div>
                  <label className="text-[8.5px] text-white/40 block">Left %</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={percentInput}
                    onChange={(e) => setPercentInput(Number(e.target.value))}
                    className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-white outline-none"
                  />
                </div>
                <div>
                  <label className="text-[8.5px] text-white/40 block">Reset Hrs</label>
                  <input
                    type="number"
                    min="0"
                    max="720"
                    value={resetHours}
                    onChange={(e) => setResetHours(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-white outline-none"
                  />
                </div>
                <div>
                  <label className="text-[8.5px] text-white/40 block">Mins</label>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={resetMins}
                    onChange={(e) => setResetMins(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-white outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-1 rounded bg-cyan-600/80 hover:bg-cyan-500 text-[10px] font-semibold text-white transition-colors"
              >
                Save Cooldown Timer
              </button>
            </form>
          )}

          {/* Account Cards */}
          {accounts.map((acc) => (
            <div
              key={acc.id}
              className={`p-2 rounded-lg border transition-colors ${
                acc.is_active
                  ? "bg-black/35 border-cyan-400/30"
                  : "bg-black/25 border-white/[0.06] hover:border-white/[0.12]"
              }`}
            >
              {/* Account Header */}
              <div className="flex items-center justify-between mb-1.5">
                <button
                  type="button"
                  onClick={() => handleSetActive(acc.id)}
                  title={
                    acc.is_active
                      ? "Active account"
                      : "Click to mark this account as active"
                  }
                  className="flex items-center space-x-1.5 min-w-0 text-left"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      acc.is_active
                        ? "bg-emerald-400 shadow-sm shadow-emerald-400/50"
                        : "bg-white/25 hover:bg-white/50"
                    }`}
                  />
                  <span
                    className="text-[10.5px] font-medium text-white/90 truncate"
                    title={acc.email}
                  >
                    {acc.email}
                  </span>
                </button>

                <div className="flex items-center space-x-1 shrink-0 ml-1">
                  <span
                    className={`text-[8px] font-bold px-1.5 py-0.2 rounded border uppercase ${getTierBadgeStyle(
                      acc.subscription_tier
                    )}`}
                  >
                    {acc.subscription_tier}
                  </span>
                  <button
                    type="button"
                    onClick={() => openAddForAccount(acc)}
                    title="Add or update a model timer for this account"
                    className="text-white/35 hover:text-cyan-300 transition-colors"
                  >
                    <Plus className="w-2.5 h-2.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteAccount(acc.id)}
                    title="Remove account"
                    className="text-white/30 hover:text-rose-400 transition-colors"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>

              {/* Models List */}
              <div className="space-y-1.5">
                {acc.models.map((model) => {
                  const pct = Math.round(model.percentage);
                  const reset = formatResetCountdown(model.reset_time, pct, nowMs);

                  return (
                    <div key={model.id} className="group/row space-y-0.5">
                      <div className="flex items-center justify-between text-[9.5px]">
                        <span
                          className="text-white/75 truncate max-w-[92px]"
                          title={model.display_name}
                        >
                          {model.display_name}
                        </span>

                        <div className="flex items-center space-x-1 shrink-0 font-mono">
                          {/* Hover quick actions */}
                          <div className="opacity-0 group-hover/row:opacity-100 flex items-center space-x-0.5 transition-opacity">
                            <button
                              type="button"
                              onClick={() => handleQuickCooldown5h(acc.id, model.id)}
                              title="Log 5h cooldown (0%)"
                              className="px-1 rounded bg-white/10 hover:bg-rose-500/30 text-[8px] text-white/70 hover:text-rose-200"
                            >
                              5h
                            </button>
                            <button
                              type="button"
                              onClick={() => handleQuickReset(acc.id, model.id)}
                              title="Mark Full (100%)"
                              className="p-0.5 rounded bg-white/10 hover:bg-emerald-500/30 text-white/70 hover:text-emerald-200"
                            >
                              <RotateCcw className="w-2 h-2" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteModel(acc.id, model.id)}
                              title="Remove model"
                              className="p-0.5 rounded hover:bg-rose-500/30 text-white/40 hover:text-rose-300"
                            >
                              <X className="w-2 h-2" />
                            </button>
                          </div>

                          <span
                            className={`flex items-center space-x-0.5 text-[8.5px] ${
                              reset.isReady
                                ? "text-emerald-400/85"
                                : reset.isUrgent
                                ? "text-rose-300 font-semibold"
                                : "text-white/55"
                            }`}
                            title={
                              reset.exactTime
                                ? `Resets at ${reset.exactTime}`
                                : undefined
                            }
                          >
                            {reset.isReady ? (
                              <CheckCircle2 className="w-2.5 h-2.5 opacity-80" />
                            ) : (
                              <Clock className="w-2.5 h-2.5 opacity-70" />
                            )}
                            <span>
                              {reset.text}
                              {reset.exactTime && !reset.isReady
                                ? ` · ${reset.exactTime}`
                                : ""}
                            </span>
                          </span>

                          <span
                            className={`font-semibold w-[26px] text-right ${getTextColor(
                              pct
                            )}`}
                          >
                            {pct}%
                          </span>
                        </div>
                      </div>

                      {/* Usage Progress Bar */}
                      <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${getBarColor(
                            pct
                          )}`}
                          style={{ width: `${Math.max(2, pct)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Clean Empty State */}
          {accounts.length === 0 && !showAddForm && (
            <div className="p-2 rounded-lg bg-black/25 border border-white/[0.06] text-center space-y-1.5">
              <p className="text-[9.5px] text-white/50 leading-snug">
                Track model usage % and token reset countdowns for your Google accounts locally.
              </p>
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="mx-auto px-2.5 py-1 rounded-md bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/30 text-[9.5px] font-medium text-cyan-200 flex items-center space-x-1 transition-colors"
              >
                <Plus className="w-2.5 h-2.5" />
                <span>Add Account Timer</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
