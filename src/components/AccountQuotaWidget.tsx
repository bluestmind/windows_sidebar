import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Cpu,
  ChevronDown,
  ChevronRight,
  Clock,
  Plus,
  Trash2,
  CheckCircle2,
  RotateCcw,
  KeyRound,
  LogIn,
  Copy,
  SlidersHorizontal,
  ExternalLink,
  X,
  Loader2,
} from "lucide-react";
import type {
  GoogleAccountQuota,
  GoogleUserProfile,
  ModelQuotaInfo,
  OAuthConfigStatus,
} from "../types";
import LiveAgyUsage from "./LiveAgyUsage";

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
      name: acc.name ?? null,
      avatar_url: acc.avatar_url ?? null,
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
  const [showOAuthSetup, setShowOAuthSetup] = useState(false);
  const [checkingAccountId, setCheckingAccountId] = useState<string | null>(null);

  // Google OAuth state
  const [oauthStatus, setOauthStatus] = useState<OAuthConfigStatus | null>(null);
  const [clientIdInput, setClientIdInput] = useState("");
  const [clientSecretInput, setClientSecretInput] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);

  // Manual form state
  const [emailInput, setEmailInput] = useState("");
  const [tierInput, setTierInput] = useState<"PRO" | "ULTRA" | "FREE">("PRO");
  const [modelPreset, setModelPreset] = useState(PRESET_MODELS[0]);
  const [customModel, setCustomModel] = useState("");
  const [percentInput, setPercentInput] = useState(0);
  const [resetHours, setResetHours] = useState("5");
  const [resetMins, setResetMins] = useState("0");

  // Modal custom model state
  const [modalNewModel, setModalNewModel] = useState("");

  const refreshOAuthStatus = useCallback(async () => {
    try {
      const status = await invoke<OAuthConfigStatus>("get_google_oauth_config");
      setOauthStatus(status);
    } catch {}
  }, []);

  useEffect(() => {
    refreshOAuthStatus();
  }, [refreshOAuthStatus]);

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

  const handleGoogleSignIn = async () => {
    if (!oauthStatus?.has_client_id) {
      setShowOAuthSetup(true);
      setShowAddForm(false);
      if (isCollapsed) toggleCollapse();
      return;
    }

    setIsSigningIn(true);
    try {
      const profile = await invoke<GoogleUserProfile>("google_oauth_login");
      const existingIdx = accounts.findIndex(
        (a) => a.email.toLowerCase() === profile.email.toLowerCase()
      );

      let next: GoogleAccountQuota[];
      let openedId = profile.id;
      if (existingIdx >= 0) {
        openedId = accounts[existingIdx].id;
        next = accounts.map((acc, idx) =>
          idx === existingIdx
            ? {
                ...acc,
                name: profile.name || acc.name,
                avatar_url: profile.avatar_url || acc.avatar_url,
                last_updated: Date.now(),
              }
            : acc
        );
      } else {
        const created: GoogleAccountQuota = {
          id: profile.id,
          email: profile.email,
          name: profile.name,
          avatar_url: profile.avatar_url,
          subscription_tier: "PRO",
          is_active: accounts.length === 0,
          models: [],
          last_updated: Date.now(),
        };
        next = [...accounts, created];
      }

      persist(next);
      setCheckingAccountId(openedId);
      onNotify?.(`Signed in: ${profile.email}`);
    } catch (err) {
      onNotify?.(`${err}`);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSaveOAuthCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const status = await invoke<OAuthConfigStatus>("save_google_oauth_config", {
        clientId: clientIdInput,
        clientSecret: clientSecretInput.trim() || null,
      });
      setOauthStatus(status);
      setClientIdInput("");
      setClientSecretInput("");
      setShowOAuthSetup(false);
      onNotify?.("Google OAuth Client saved");
    } catch (err) {
      onNotify?.(`${err}`);
    }
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

  const handleUpdateAccountTier = (
    accountId: string,
    tier: "PRO" | "ULTRA" | "FREE"
  ) => {
    const next = accounts.map((a) =>
      a.id === accountId ? { ...a, subscription_tier: tier } : a
    );
    persist(next);
  };

  const handleUpdateModel = (
    accountId: string,
    modelId: string,
    patch: Partial<ModelQuotaInfo>
  ) => {
    const next = accounts.map((acc) => {
      if (acc.id !== accountId) return acc;
      return {
        ...acc,
        last_updated: Date.now(),
        models: acc.models.map((m) => (m.id === modelId ? { ...m, ...patch } : m)),
      };
    });
    persist(next);
  };

  const handleSetCooldownHours = (
    accountId: string,
    modelId: string,
    hours: number
  ) => {
    const resetAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
    handleUpdateModel(accountId, modelId, { percentage: 0, reset_time: resetAt });
  };

  const handleQuickReset = (accountId: string, modelId: string) => {
    handleUpdateModel(accountId, modelId, { percentage: 100, reset_time: null });
  };

  const handleAddModelInModal = (accountId: string, e: React.FormEvent) => {
    e.preventDefault();
    const label = modalNewModel.trim();
    if (!label) return;
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const next = accounts.map((acc) => {
      if (acc.id !== accountId) return acc;
      if (acc.models.some((m) => m.id === id)) return acc;
      return {
        ...acc,
        last_updated: Date.now(),
        models: [
          ...acc.models,
          { id, display_name: label, percentage: 100, reset_time: null },
        ],
      };
    });
    persist(next);
    setModalNewModel("");
  };

  const handleDeleteModel = (accountId: string, modelId: string) => {
    const next = accounts.map((acc) => {
      if (acc.id !== accountId) return acc;
      return {
        ...acc,
        models: acc.models.filter((m) => m.id !== modelId),
      };
    });
    persist(next);
  };

  const handleDeleteAccount = (accountId: string) => {
    if (checkingAccountId === accountId) {
      setCheckingAccountId(null);
    }
    const remaining = accounts.filter((a) => a.id !== accountId);
    if (remaining.length > 0 && !remaining.some((a) => a.is_active)) {
      remaining[0] = { ...remaining[0], is_active: true };
    }
    persist(remaining);
  };

  const handleCopyUsageCmd = async () => {
    try {
      await navigator.clipboard.writeText("/usage");
      onNotify?.("Copied /usage (paste in Antigravity CLI/IDE to check live)");
    } catch {}
  };

  const modalAccount =
    checkingAccountId ? accounts.find((a) => a.id === checkingAccountId) || null : null;

  return (
    <>
      <div className="mx-2.5 mb-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.08] shadow-sm transition-colors overflow-hidden shrink-0">
        {/* Header Bar */}
        <div
          onClick={toggleCollapse}
          className="px-2.5 py-1.5 flex items-center justify-between cursor-pointer select-none border-b border-white/[0.04]"
        >
          <div className="flex items-center space-x-1.5 min-w-0">
            <Cpu className="w-3 h-3 text-cyan-400 shrink-0" />
            <span className="text-[10px] font-semibold tracking-wider uppercase text-white/75 truncate">
              Accounts & Quotas
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
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isSigningIn}
              title="Sign in with Google Account"
              className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[9px] font-medium text-white/85 flex items-center space-x-1 transition-colors disabled:opacity-50"
            >
              {isSigningIn ? (
                <Loader2 className="w-2.5 h-2.5 animate-spin text-cyan-300" />
              ) : (
                <LogIn className="w-2.5 h-2.5 text-cyan-300" />
              )}
              <span>Google</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowOAuthSetup(!showOAuthSetup);
                setShowAddForm(false);
                if (isCollapsed) toggleCollapse();
              }}
              title="Google OAuth Client Settings"
              className={`p-0.5 rounded hover:bg-white/15 transition-colors ${
                oauthStatus?.has_client_id ? "text-emerald-400/80" : "text-white/45 hover:text-white"
              }`}
            >
              <KeyRound className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(!showAddForm);
                setShowOAuthSetup(false);
                if (isCollapsed) toggleCollapse();
              }}
              title="Add Account / Model Cooldown Manually"
              className="p-0.5 rounded hover:bg-white/15 text-white/50 hover:text-white transition-colors"
            >
              <Plus className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={toggleCollapse}
              title={isCollapsed ? "Expand Accounts" : "Collapse Accounts"}
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
          <div className="p-1.5 space-y-1.5 max-h-[340px] overflow-y-auto">
            {/* Real quota for the account signed into the official agy CLI */}
            <LiveAgyUsage onNotify={onNotify} />
            {/* Google OAuth Desktop Client Setup */}
            {showOAuthSetup && (
              <form
                onSubmit={handleSaveOAuthCredentials}
                className="p-2 rounded-lg bg-black/45 border border-blue-400/30 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[9.5px] font-semibold text-blue-300">
                    Google Login Setup (PKCE)
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowOAuthSetup(false)}
                    className="text-white/40 hover:text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>

                {oauthStatus?.has_client_id && (
                  <div className="text-[9px] text-emerald-300/90 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-1 font-mono truncate">
                    Configured: {oauthStatus.client_id_preview}
                  </div>
                )}

                <p className="text-[9px] text-white/55 leading-snug">
                  Create a <b>Desktop app</b> OAuth Client ID in Google Cloud Console, paste it below, then click <b>Google</b> to sign into any Google account.
                </p>

                <button
                  type="button"
                  onClick={() =>
                    openUrl("https://console.cloud.google.com/apis/credentials").catch(() => {})
                  }
                  className="text-[9px] text-blue-400 hover:text-blue-300 flex items-center space-x-1"
                >
                  <span>Open Google Cloud Credentials</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </button>

                <input
                  type="text"
                  placeholder="123456-abc....apps.googleusercontent.com"
                  value={clientIdInput}
                  onChange={(e) => setClientIdInput(e.target.value)}
                  required
                  className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] text-white placeholder-white/30 outline-none focus:border-blue-400/50"
                />
                <input
                  type="password"
                  placeholder="Client Secret (optional for Desktop PKCE)"
                  value={clientSecretInput}
                  onChange={(e) => setClientSecretInput(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] text-white placeholder-white/30 outline-none focus:border-blue-400/50"
                />
                <button
                  type="submit"
                  className="w-full py-1 rounded bg-blue-600/80 hover:bg-blue-500 text-[10px] font-semibold text-white transition-colors"
                >
                  Save OAuth Client
                </button>
              </form>
            )}

            {/* Manual Add Cooldown Form */}
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
                    placeholder="Model name"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    required
                    className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] text-white placeholder-white/30 outline-none focus:border-cyan-400/50"
                  />
                )}

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
                    title={acc.is_active ? "Active account" : "Click to set active"}
                    className="flex items-center space-x-1.5 min-w-0 text-left flex-1"
                  >
                    {acc.avatar_url ? (
                      <img
                        src={acc.avatar_url}
                        alt={acc.email}
                        className={`w-4 h-4 rounded-full shrink-0 ring-1 ${
                          acc.is_active ? "ring-emerald-400" : "ring-white/20"
                        }`}
                      />
                    ) : (
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          acc.is_active
                            ? "bg-emerald-400 shadow-sm shadow-emerald-400/50"
                            : "bg-white/25 hover:bg-white/50"
                        }`}
                      />
                    )}
                    <span
                      className="text-[10.5px] font-medium text-white/90 truncate"
                      title={acc.name ? `${acc.name} (${acc.email})` : acc.email}
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
                      onClick={() => setCheckingAccountId(acc.id)}
                      title="Open Account Check Modal"
                      className="px-1.5 py-0.5 rounded bg-cyan-500/15 hover:bg-cyan-500/30 text-[8.5px] font-medium text-cyan-200 border border-cyan-400/25 flex items-center space-x-0.5 transition-colors"
                    >
                      <SlidersHorizontal className="w-2.5 h-2.5" />
                      <span>Check</span>
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

                {/* Compact Model Bars */}
                <div className="space-y-1">
                  {acc.models.map((model) => {
                    const pct = Math.round(model.percentage);
                    const reset = formatResetCountdown(model.reset_time, pct, nowMs);

                    return (
                      <div key={model.id} className="group/row space-y-0.5">
                        <div className="flex items-center justify-between text-[9.5px]">
                          <span
                            className="text-white/75 truncate max-w-[95px]"
                            title={model.display_name}
                          >
                            {model.display_name}
                          </span>

                          <div className="flex items-center space-x-1 shrink-0 font-mono">
                            <div className="opacity-0 group-hover/row:opacity-100 flex items-center space-x-0.5 transition-opacity">
                              <button
                                type="button"
                                onClick={() => handleSetCooldownHours(acc.id, model.id, 5)}
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
                            </div>

                            <span
                              className={`flex items-center space-x-0.5 text-[8.5px] ${
                                reset.isReady
                                  ? "text-emerald-400/85"
                                  : reset.isUrgent
                                  ? "text-rose-300 font-semibold"
                                  : "text-white/55"
                              }`}
                              title={reset.exactTime ? `Resets at ${reset.exactTime}` : undefined}
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

            {/* Empty State */}
            {accounts.length === 0 && !showAddForm && !showOAuthSetup && (
              <div className="p-2 rounded-lg bg-black/25 border border-white/[0.06] text-center space-y-1.5">
                <p className="text-[9.5px] text-white/50 leading-snug">
                  Other accounts: sign in with Google or add one manually to log cooldowns.
                </p>
                <div className="flex items-center justify-center space-x-1.5">
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={isSigningIn}
                    className="px-2 py-1 rounded-md bg-blue-500/20 hover:bg-blue-500/30 border border-blue-400/30 text-[9.5px] font-medium text-blue-200 flex items-center space-x-1 transition-colors"
                  >
                    <LogIn className="w-2.5 h-2.5" />
                    <span>Google Login</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddForm(true)}
                    className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/15 border border-white/10 text-[9.5px] font-medium text-white/80 flex items-center space-x-1 transition-colors"
                  >
                    <Plus className="w-2.5 h-2.5" />
                    <span>Manual</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Account Check & Quota Modal */}
      {modalAccount && (
        <div className="fixed inset-0 bg-black/65 z-50 flex items-center justify-center p-2.5">
          <div className="w-full max-h-[90vh] macos-menu-glass rounded-2xl border border-white/20 p-3 flex flex-col space-y-2.5 shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-2 shrink-0">
              <div className="flex items-center space-x-2 min-w-0">
                {modalAccount.avatar_url ? (
                  <img
                    src={modalAccount.avatar_url}
                    alt={modalAccount.email}
                    className="w-7 h-7 rounded-full ring-1 ring-white/25 shrink-0"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-cyan-500/20 border border-cyan-400/30 flex items-center justify-center text-xs font-bold text-cyan-200 shrink-0">
                    {modalAccount.email[0]?.toUpperCase() || "G"}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-[11.5px] font-semibold text-white truncate">
                    {modalAccount.name || modalAccount.email}
                  </div>
                  <div className="text-[9.5px] text-white/50 truncate">
                    {modalAccount.email}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setCheckingAccountId(null)}
                className="p-1 rounded-md hover:bg-white/10 text-white/50 hover:text-white shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Tier & Active Controls */}
            <div className="flex items-center justify-between gap-1.5 shrink-0">
              <div className="flex items-center space-x-1">
                {(["PRO", "ULTRA", "FREE"] as const).map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => handleUpdateAccountTier(modalAccount.id, tier)}
                    className={`px-2 py-0.5 rounded text-[9px] font-bold border transition-colors ${
                      modalAccount.subscription_tier === tier
                        ? getTierBadgeStyle(tier)
                        : "bg-white/5 border-white/10 text-white/40 hover:text-white/80"
                    }`}
                  >
                    {tier}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={handleCopyUsageCmd}
                title="Copy /usage command for Antigravity CLI"
                className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/15 border border-white/10 text-[9.5px] text-white/80 flex items-center space-x-1"
              >
                <Copy className="w-2.5 h-2.5 text-cyan-300" />
                <span>Copy /usage</span>
              </button>
            </div>

            {/* Model Sliders & Cooldown Buttons */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
              {modalAccount.models.map((model) => {
                const pct = Math.round(model.percentage);
                const reset = formatResetCountdown(model.reset_time, pct, nowMs);

                return (
                  <div
                    key={model.id}
                    className="p-2 rounded-xl bg-black/30 border border-white/[0.08] space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-white/90 truncate">
                        {model.display_name}
                      </span>
                      <div className="flex items-center space-x-1.5 shrink-0">
                        <span className={`text-[10.5px] font-mono font-bold ${getTextColor(pct)}`}>
                          {pct}%
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeleteModel(modalAccount.id, model.id)}
                          title="Remove model"
                          className="text-white/30 hover:text-rose-400"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>

                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={pct}
                      onChange={(e) =>
                        handleUpdateModel(modalAccount.id, model.id, {
                          percentage: Number(e.target.value),
                        })
                      }
                      className="w-full accent-cyan-400 cursor-pointer h-1.5"
                    />

                    <div className="flex items-center justify-between text-[9px]">
                      <span className="font-mono text-white/55 flex items-center space-x-1">
                        <Clock className="w-2.5 h-2.5" />
                        <span>
                          {reset.text}
                          {reset.exactTime && !reset.isReady ? ` (${reset.exactTime})` : ""}
                        </span>
                      </span>

                      <div className="flex items-center space-x-1">
                        {[
                          { label: "5h", hrs: 5 },
                          { label: "2d", hrs: 48 },
                          { label: "7d", hrs: 168 },
                        ].map((p) => (
                          <button
                            key={p.label}
                            type="button"
                            onClick={() =>
                              handleSetCooldownHours(modalAccount.id, model.id, p.hrs)
                            }
                            className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-rose-500/30 font-mono text-[8.5px] text-white/80"
                          >
                            {p.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => handleQuickReset(modalAccount.id, model.id)}
                          className="px-1.5 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/35 font-mono text-[8.5px] text-emerald-300"
                        >
                          100%
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Add Model Row */}
              <form
                onSubmit={(e) => handleAddModelInModal(modalAccount.id, e)}
                className="flex items-center space-x-1.5 pt-0.5"
              >
                <input
                  type="text"
                  placeholder="Add model (e.g. Gemini 4)..."
                  value={modalNewModel}
                  onChange={(e) => setModalNewModel(e.target.value)}
                  className="flex-1 bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-white placeholder-white/30 outline-none focus:border-cyan-400/50"
                />
                <button
                  type="submit"
                  className="px-2 py-1 rounded-lg bg-cyan-600/75 hover:bg-cyan-500 text-[10px] font-medium text-white"
                >
                  Add
                </button>
              </form>
            </div>

            <p className="text-[8.5px] text-white/40 leading-snug shrink-0">
              Google Login verifies your Google profile cleanly via PKCE. Use{" "}
              <code className="text-white/60">/usage</code> inside Antigravity CLI/IDE to check live server limits and slide percentages or tap 5h/2d/7d above.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
