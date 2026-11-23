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
  KeyRound,
  LogIn,
  SlidersHorizontal,
  ExternalLink,
  X,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type {
  ManagedAccount,
  ModelQuotaInfo,
  OAuthConfigStatus,
  GoogleUserProfile,
} from "../types";

const PRESET_MODELS = [
  "Gemini Pro High",
  "Gemini Flash",
  "Claude Sonnet",
  "Gemini Image",
];

function formatResetCountdown(
  resetTime: string | null | undefined,
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
    return { text: "Ready", exactTime: null, isUrgent: false, isReady: true };
  }

  const targetMs = Date.parse(resetTime);
  if (isNaN(targetMs)) {
    return { text: "-", exactTime: null, isUrgent: false, isReady: false };
  }

  const d = new Date(targetMs);
  const sameDay = d.toDateString() === new Date(nowMs).toDateString();
  const exactTime = sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString([], {
        weekday: "short",
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

  let text = "";
  if (days > 0) {
    text = `${days}d ${hours}h`;
  } else if (hours > 0) {
    text = `${hours}h ${mins}m`;
  } else {
    text = `${Math.max(1, mins)}m`;
  }

  return {
    text,
    exactTime,
    isUrgent: percentage <= 20,
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

function windowLabel(window: string, name: string): string {
  if (window === "5h") return "5h limit";
  if (window === "weekly") return "Weekly";
  return name;
}

interface AccountQuotaWidgetProps {
  onNotify?: (msg: string) => void;
}

export default function AccountQuotaWidget({ onNotify }: AccountQuotaWidgetProps) {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    return localStorage.getItem("sidebar_quota_collapsed") === "true";
  });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());

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

  const refreshAccounts = useCallback(async () => {
    try {
      const list = await invoke<ManagedAccount[]>("get_managed_accounts");
      setAccounts(list);
    } catch (err) {
      console.error("Failed loading managed accounts:", err);
    }
  }, []);

  const refreshOAuthStatus = useCallback(async () => {
    try {
      const status = await invoke<OAuthConfigStatus>("get_google_oauth_config");
      setOauthStatus(status);
    } catch {}
  }, []);

  useEffect(() => {
    refreshAccounts();
    refreshOAuthStatus();
  }, [refreshAccounts, refreshOAuthStatus]);

  // Periodic auto-refresh every 5 minutes
  useEffect(() => {
    const timer = setInterval(() => {
      refreshAccounts();
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [refreshAccounts]);

  // 1-second live countdown ticker
  useEffect(() => {
    const ticker = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(ticker);
  }, []);

  const toggleCollapse = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    localStorage.setItem("sidebar_quota_collapsed", String(next));
  };

  const handleSyncAll = async () => {
    setIsSyncingAll(true);
    try {
      const updated = await invoke<ManagedAccount[]>("refresh_all_accounts_quota");
      setAccounts(updated);
      onNotify?.("All account quotas synchronized");
    } catch (err) {
      onNotify?.(`Sync failed: ${err}`);
    } finally {
      setIsSyncingAll(false);
    }
  };

  const handleRefreshSingle = async (accountId: string) => {
    setSyncingIds((prev) => new Set(prev).add(accountId));
    try {
      const updatedAcc = await invoke<ManagedAccount>("refresh_account_quota", {
        accountId,
      });
      setAccounts((prev) =>
        prev.map((a) => (a.id === accountId ? updatedAcc : a))
      );
      onNotify?.(`Quotas updated for ${updatedAcc.email}`);
    } catch (err) {
      onNotify?.(`Quota refresh failed: ${err}`);
    } finally {
      setSyncingIds((prev) => {
        const next = new Set(prev);
        next.delete(accountId);
        return next;
      });
    }
  };

  const handleSwitchActive = async (accountId: string) => {
    try {
      const next = await invoke<ManagedAccount[]>("switch_active_account", {
        accountId,
      });
      setAccounts(next);
      const active = next.find((a) => a.id === accountId);
      onNotify?.(`Active Antigravity account switched to ${active?.email || accountId}`);
    } catch (err) {
      onNotify?.(`Switch account failed: ${err}`);
    }
  };

  const handleImportAntigravity = async () => {
    try {
      const imported = await invoke<ManagedAccount>("import_active_antigravity_account");
      await refreshAccounts();
      onNotify?.(`Imported active account: ${imported.email}`);
    } catch (err) {
      onNotify?.(`Import failed: ${err}`);
    }
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
      await refreshAccounts();
      setCheckingAccountId(profile.id);
      onNotify?.(`Connected Google account: ${profile.email}`);
    } catch (err) {
      onNotify?.(`Google sign-in error: ${err}`);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSaveOAuthCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const status = await invoke<OAuthConfigStatus>("save_google_oauth_config", {
        clientId: clientIdInput,
        clientSecret: clientSecretInput.trim() ? clientSecretInput.trim() : null,
      });
      setOauthStatus(status);
      setShowOAuthSetup(false);
      setClientIdInput("");
      setClientSecretInput("");
      onNotify?.("Google OAuth client saved");
    } catch (err) {
      onNotify?.(`Error saving OAuth config: ${err}`);
    }
  };

  const handleDeleteAccount = async (accountId: string) => {
    try {
      const next = await invoke<ManagedAccount[]>("delete_managed_account", {
        accountId,
      });
      setAccounts(next);
      if (checkingAccountId === accountId) setCheckingAccountId(null);
      onNotify?.("Account removed");
    } catch (err) {
      onNotify?.(`Delete failed: ${err}`);
    }
  };

  const handleSaveManualAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = emailInput.trim();
    if (!cleanEmail) return;

    const chosenModelName =
      modelPreset === "__custom__" ? customModel.trim() : modelPreset;
    if (!chosenModelName) return;

    let reset_time: string | null = null;
    const hrs = parseFloat(resetHours) || 0;
    const mins = parseFloat(resetMins) || 0;
    const totalMs = (hrs * 60 + mins) * 60 * 1000;
    if (totalMs > 0 && percentInput < 100) {
      reset_time = new Date(Date.now() + totalMs).toISOString();
    }

    const newModel: ModelQuotaInfo = {
      id: chosenModelName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      display_name: chosenModelName,
      percentage: Math.max(0, Math.min(100, percentInput)),
      reset_time,
    };

    const newAcc: ManagedAccount = {
      id: `manual-${Date.now()}`,
      email: cleanEmail,
      name: null,
      avatar_url: null,
      subscription_tier: tierInput,
      is_active: accounts.length === 0,
      access_token: null,
      refresh_token: null,
      raw_cred_json: null,
      report: null,
      manual_models: [newModel],
      last_synced_ms: Date.now(),
    };

    try {
      const next = await invoke<ManagedAccount[]>("save_managed_account", {
        account: newAcc,
      });
      setAccounts(next);
      setShowAddForm(false);
      setEmailInput("");
      setCustomModel("");
      setPercentInput(0);
      onNotify?.(`Added account ${cleanEmail}`);
    } catch (err) {
      onNotify?.(`Error saving account: ${err}`);
    }
  };

  const modalAccount = accounts.find((a) => a.id === checkingAccountId);

  return (
    <>
      <div className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-md overflow-hidden transition-all">
        {/* Header */}
        <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center space-x-1.5 min-w-0">
            <Cpu className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
            <span className="text-[11px] font-semibold text-white/90 truncate">
              Accounts & Quotas
            </span>
            <span className="text-[9px] font-mono font-medium px-1.5 py-0.2 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-400/20">
              {accounts.length}
            </span>
          </div>

          <div className="flex items-center space-x-0.5">
            {/* Sync All Button */}
            <button
              type="button"
              onClick={handleSyncAll}
              disabled={isSyncingAll}
              title="Sync quotas for all accounts"
              className="p-1 rounded hover:bg-white/15 text-white/50 hover:text-white disabled:opacity-40 transition-colors"
            >
              <RefreshCw
                className={`w-3 h-3 ${isSyncingAll ? "animate-spin text-cyan-300" : ""}`}
              />
            </button>

            {/* Import Active Antigravity */}
            <button
              type="button"
              onClick={handleImportAntigravity}
              title="Import active account from Antigravity"
              className="p-1 rounded hover:bg-white/15 text-white/50 hover:text-white transition-colors"
            >
              <Sparkles className="w-3 h-3 text-amber-300" />
            </button>

            {/* Google OAuth Button */}
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isSigningIn}
              title={
                oauthStatus?.has_client_id
                  ? "Connect Google Account via OAuth"
                  : "Configure Google OAuth Client"
              }
              className="px-1.5 py-0.5 rounded bg-blue-500/20 hover:bg-blue-500/35 border border-blue-400/30 text-[9px] font-semibold text-blue-200 flex items-center space-x-1 transition-colors disabled:opacity-50"
            >
              {isSigningIn ? (
                <Loader2 className="w-2.5 h-2.5 animate-spin text-cyan-300" />
              ) : (
                <LogIn className="w-2.5 h-2.5 text-cyan-300" />
              )}
              <span>Google</span>
            </button>

            {/* OAuth Client Key Settings */}
            <button
              type="button"
              onClick={() => {
                setShowOAuthSetup(!showOAuthSetup);
                setShowAddForm(false);
                if (isCollapsed) toggleCollapse();
              }}
              title="Google OAuth Client Settings"
              className={`p-1 rounded hover:bg-white/15 transition-colors ${
                oauthStatus?.has_client_id
                  ? "text-emerald-400/80"
                  : "text-white/45 hover:text-white"
              }`}
            >
              <KeyRound className="w-3 h-3" />
            </button>

            {/* Manual Add Button */}
            <button
              type="button"
              onClick={() => {
                setShowAddForm(!showAddForm);
                setShowOAuthSetup(false);
                if (isCollapsed) toggleCollapse();
              }}
              title="Add Account Manually"
              className="p-1 rounded hover:bg-white/15 text-white/50 hover:text-white transition-colors"
            >
              <Plus className="w-3 h-3" />
            </button>

            {/* Collapse / Expand */}
            <button
              type="button"
              onClick={toggleCollapse}
              title={isCollapsed ? "Expand Accounts" : "Collapse Accounts"}
              className="p-1 rounded hover:bg-white/15 text-white/50 hover:text-white transition-colors"
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
          <div className="p-1.5 space-y-2 max-h-[380px] overflow-y-auto">
            {/* Google OAuth Setup Form */}
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

            {/* Manual Account Add Form */}
            {showAddForm && (
              <form
                onSubmit={handleSaveManualAccount}
                className="p-2 rounded-lg bg-black/40 border border-cyan-500/25 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[9.5px] font-semibold text-cyan-300">
                    Add Account / Cooldown Tracker
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
                  Save Account
                </button>
              </form>
            )}

            {/* ALL ACCOUNTS SHOWN SIMULTANEOUSLY */}
            {accounts.map((acc) => {
              const isSyncing = syncingIds.has(acc.id);
              const hasReportGroups = acc.report?.groups && acc.report.groups.length > 0;
              const hasManualModels = acc.manual_models && acc.manual_models.length > 0;

              return (
                <div
                  key={acc.id}
                  className={`p-2 rounded-lg border transition-all ${
                    acc.is_active
                      ? "bg-black/45 border-cyan-400/40 shadow-sm shadow-cyan-500/10"
                      : "bg-black/30 border-white/[0.08] hover:border-white/[0.16]"
                  }`}
                >
                  {/* Account Header */}
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center space-x-1.5 min-w-0 flex-1">
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
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            acc.is_active
                              ? "bg-emerald-400 shadow-sm shadow-emerald-400/50"
                              : "bg-white/25"
                          }`}
                        />
                      )}
                      <span
                        className="text-[10px] font-semibold text-white/90 truncate"
                        title={acc.name ? `${acc.name} (${acc.email})` : acc.email}
                      >
                        {acc.email}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1 shrink-0 ml-1">
                      {acc.is_active ? (
                        <span className="text-[7.5px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 uppercase tracking-wider">
                          ACTIVE
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSwitchActive(acc.id)}
                          title="Switch Antigravity to use this account"
                          className="px-1.5 py-0.2 rounded bg-white/10 hover:bg-emerald-500/25 text-[7.5px] font-semibold text-white/70 hover:text-emerald-300 border border-white/15 transition-colors"
                        >
                          Set Active
                        </button>
                      )}

                      <span
                        className={`text-[7.5px] font-bold px-1.5 py-0.2 rounded border uppercase ${getTierBadgeStyle(
                          acc.subscription_tier
                        )}`}
                      >
                        {acc.subscription_tier}
                      </span>

                      <button
                        type="button"
                        onClick={() => handleRefreshSingle(acc.id)}
                        disabled={isSyncing}
                        title="Sync live quota"
                        className="p-0.5 rounded hover:bg-white/15 text-white/50 hover:text-white transition-colors disabled:opacity-40"
                      >
                        <RefreshCw
                          className={`w-2.5 h-2.5 ${isSyncing ? "animate-spin text-cyan-300" : ""}`}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => setCheckingAccountId(acc.id)}
                        title="Open account details modal"
                        className="p-0.5 rounded hover:bg-white/15 text-white/50 hover:text-white transition-colors"
                      >
                        <SlidersHorizontal className="w-2.5 h-2.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteAccount(acc.id)}
                        title="Remove account"
                        className="p-0.5 rounded hover:bg-rose-500/20 text-white/35 hover:text-rose-400 transition-colors"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </div>

                  {/* Quota Data Render: Live Groups (Gemini, Claude, GPT) */}
                  {hasReportGroups && (
                    <div className="space-y-1.5 pt-0.5">
                      {acc.report!.groups.map((g) => (
                        <div key={g.name} className="space-y-1">
                          <div className="text-[9px] font-medium text-white/60 truncate">
                            {g.name}
                          </div>
                          {g.buckets.map((b) => {
                            const pct = Math.round(b.remaining_percent);
                            const cd = formatResetCountdown(b.reset_time, pct, nowMs);

                            return (
                              <div key={b.id || b.name} className="space-y-0.5">
                                <div className="flex items-center justify-between text-[8.5px]">
                                  <span className="text-white/50 truncate max-w-[100px]">
                                    {windowLabel(b.window, b.name)}
                                  </span>
                                  <div className="flex items-center space-x-1.5 font-mono">
                                    <span
                                      className={`flex items-center space-x-0.5 ${
                                        cd.isReady
                                          ? "text-emerald-400/80"
                                          : cd.isUrgent
                                          ? "text-rose-300 font-semibold"
                                          : "text-white/50"
                                      }`}
                                      title={cd.exactTime ? `Resets at ${cd.exactTime}` : undefined}
                                    >
                                      {cd.isReady ? (
                                        <CheckCircle2 className="w-2 h-2 opacity-80" />
                                      ) : (
                                        <Clock className="w-2 h-2 opacity-70" />
                                      )}
                                      <span>
                                        {cd.text}
                                        {cd.exactTime && !cd.isReady ? ` · ${cd.exactTime}` : ""}
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
                      ))}
                    </div>
                  )}

                  {/* Manual Models Fallback */}
                  {!hasReportGroups && hasManualModels && (
                    <div className="space-y-1 pt-0.5">
                      {acc.manual_models.map((m) => {
                        const pct = Math.round(m.percentage);
                        const cd = formatResetCountdown(m.reset_time, pct, nowMs);
                        return (
                          <div key={m.id} className="space-y-0.5">
                            <div className="flex items-center justify-between text-[8.5px]">
                              <span className="text-white/60 truncate max-w-[100px]">
                                {m.display_name}
                              </span>
                              <div className="flex items-center space-x-1.5 font-mono">
                                <span className="text-white/50 text-[8px] flex items-center space-x-0.5">
                                  <Clock className="w-2 h-2 opacity-70" />
                                  <span>{cd.text}</span>
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
                  )}

                  {/* Empty state for this specific account */}
                  {!hasReportGroups && !hasManualModels && (
                    <div className="py-1 px-1.5 rounded bg-white/[0.03] text-[8.5px] text-white/40 flex items-center justify-between">
                      <span>No quota data loaded yet</span>
                      <button
                        type="button"
                        onClick={() => handleRefreshSingle(acc.id)}
                        className="text-cyan-300 hover:underline"
                      >
                        Sync Now
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Global Empty State */}
            {accounts.length === 0 && !showAddForm && !showOAuthSetup && (
              <div className="p-3 rounded-lg bg-black/25 border border-white/[0.06] text-center space-y-2">
                <p className="text-[10px] text-white/60 leading-snug">
                  No accounts linked yet. Import from Antigravity or sign in with Google to see real-time model quotas.
                </p>
                <div className="flex items-center justify-center space-x-1.5">
                  <button
                    type="button"
                    onClick={handleImportAntigravity}
                    className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/30 text-[9.5px] font-medium text-amber-200 flex items-center space-x-1 transition-colors"
                  >
                    <Sparkles className="w-2.5 h-2.5" />
                    <span>Import Antigravity</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={isSigningIn}
                    className="px-2 py-1 rounded bg-blue-500/20 hover:bg-blue-500/30 border border-blue-400/30 text-[9.5px] font-medium text-blue-200 flex items-center space-x-1 transition-colors"
                  >
                    <LogIn className="w-2.5 h-2.5" />
                    <span>Google Login</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Account Details & Diagnostic Modal */}
      {modalAccount && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-3">
          <div className="w-full max-h-[85vh] macos-menu-glass rounded-2xl border border-white/20 p-3.5 flex flex-col space-y-2.5 shadow-2xl overflow-hidden">
            {/* Header */}
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

            {/* Actions Bar */}
            <div className="flex items-center justify-between gap-1.5 shrink-0">
              <div className="flex items-center space-x-1">
                {modalAccount.is_active ? (
                  <span className="text-[8.5px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase">
                    Active Antigravity Account
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSwitchActive(modalAccount.id)}
                    className="px-2 py-0.5 rounded bg-emerald-600/70 hover:bg-emerald-500 text-[8.5px] font-semibold text-white transition-colors"
                  >
                    Set as Active
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => handleRefreshSingle(modalAccount.id)}
                className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/15 border border-white/10 text-[9px] text-white/80 flex items-center space-x-1"
              >
                <RefreshCw className="w-2.5 h-2.5 text-cyan-300" />
                <span>Refresh Quotas</span>
              </button>
            </div>

            {/* Content Scroll */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
              {modalAccount.report?.groups && modalAccount.report.groups.length > 0 ? (
                <div className="space-y-2">
                  {modalAccount.report.groups.map((g) => (
                    <div
                      key={g.name}
                      className="p-2.5 rounded-xl bg-black/35 border border-white/[0.08] space-y-1.5"
                    >
                      <div className="text-[11px] font-semibold text-white/90">
                        {g.name}
                      </div>
                      {g.description && (
                        <div className="text-[8.5px] text-white/40 leading-snug">
                          {g.description}
                        </div>
                      )}
                      <div className="space-y-1.5 pt-1">
                        {g.buckets.map((b) => {
                          const pct = Math.round(b.remaining_percent);
                          const cd = formatResetCountdown(b.reset_time, pct, nowMs);
                          return (
                            <div key={b.id || b.name} className="space-y-1">
                              <div className="flex items-center justify-between text-[9.5px]">
                                <span className="text-white/70 font-medium">
                                  {b.name || windowLabel(b.window, "")} ({b.window})
                                </span>
                                <div className="flex items-center space-x-1.5 font-mono">
                                  <span className="text-white/50 text-[9px]">
                                    {cd.text} {cd.exactTime ? `· ${cd.exactTime}` : ""}
                                  </span>
                                  <span className={`font-bold ${getTextColor(pct)}`}>
                                    {pct}%
                                  </span>
                                </div>
                              </div>
                              <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${getBarColor(pct)}`}
                                  style={{ width: `${Math.max(2, pct)}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 text-center text-[10px] text-white/50 bg-black/20 rounded-xl">
                  No live quota groups recorded. Click "Refresh Quotas" above.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
