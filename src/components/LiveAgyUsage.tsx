import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Activity, RefreshCw, Clock, AlertTriangle } from "lucide-react";
import type { AgyUsageReport } from "../types";

const CACHE_KEY = "sidebar_agy_usage_cache_v1";
const AUTO_REFRESH_MS = 5 * 60 * 1000;

function loadCache(): AgyUsageReport | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as AgyUsageReport) : null;
  } catch {
    return null;
  }
}

function formatCountdown(resetTime: string | null, nowMs: number): {
  text: string;
  exact: string | null;
} {
  if (!resetTime) return { text: "-", exact: null };
  const target = Date.parse(resetTime);
  if (isNaN(target)) return { text: "-", exact: null };

  const d = new Date(target);
  const sameDay = d.toDateString() === new Date(nowMs).toDateString();
  const exact = sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString([], {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      });

  const diff = target - nowMs;
  if (diff <= 0) return { text: "Refreshed", exact };

  const totalMins = Math.floor(diff / 60000);
  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;

  let text: string;
  if (days > 0) text = `${days}d ${hours}h`;
  else if (hours > 0) text = `${hours}h ${mins}m`;
  else text = `${Math.max(1, mins)}m`;
  return { text, exact };
}

function barColor(pct: number): string {
  if (pct >= 60) return "bg-emerald-400";
  if (pct >= 25) return "bg-amber-400";
  return "bg-rose-500";
}

function textColor(pct: number): string {
  if (pct >= 60) return "text-emerald-400";
  if (pct >= 25) return "text-amber-300";
  return "text-rose-400";
}

function windowLabel(window: string, name: string): string {
  if (window === "5h") return "5-hour";
  if (window === "weekly") return "Weekly";
  return name;
}

interface LiveAgyUsageProps {
  onNotify?: (msg: string) => void;
}

/**
 * Live Antigravity quota for the account signed into the official `agy` CLI.
 * Data comes from `agy -p "/usage" --output-format json` (no model turn).
 */
export default function LiveAgyUsage({ onNotify }: LiveAgyUsageProps) {
  const [report, setReport] = useState<AgyUsageReport | null>(() => loadCache());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const refresh = useCallback(
    async (manual = false) => {
      setLoading(true);
      try {
        const res = await invoke<AgyUsageReport>("get_agy_usage");
        setReport(res);
        setError(null);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(res));
        } catch {}
        if (manual) onNotify?.("Antigravity usage updated");
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [onNotify]
  );

  useEffect(() => {
    refresh(false);
    const poll = setInterval(() => refresh(false), AUTO_REFRESH_MS);
    return () => clearInterval(poll);
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // When a reset time passes, fetch fresh numbers instead of guessing.
  useEffect(() => {
    if (!report || loading) return;
    const passed = report.groups.some((g) =>
      g.buckets.some((b) => {
        if (!b.reset_time) return false;
        const t = Date.parse(b.reset_time);
        return !isNaN(t) && t <= nowMs && t > report.fetched_at_ms;
      })
    );
    if (passed) refresh(false);
  }, [nowMs, report, loading, refresh]);

  const updatedAgo = report
    ? Math.max(0, Math.round((nowMs - report.fetched_at_ms) / 60000))
    : null;

  return (
    <div className="p-2 rounded-lg bg-black/35 border border-cyan-400/25 space-y-1.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-1.5 min-w-0">
          <Activity className="w-3 h-3 text-cyan-300 shrink-0" />
          <span className="text-[10px] font-semibold text-white/90 truncate">
            Antigravity Live Usage
          </span>
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              error && !report
                ? "bg-rose-500"
                : loading
                ? "bg-amber-400 animate-pulse"
                : "bg-emerald-400"
            }`}
          />
        </div>
        <div className="flex items-center space-x-1 shrink-0">
          {updatedAgo !== null && (
            <span className="text-[8.5px] font-mono text-white/35">
              {updatedAgo === 0 ? "now" : `${updatedAgo}m ago`}
            </span>
          )}
          <button
            type="button"
            onClick={() => refresh(true)}
            disabled={loading}
            title="Refresh from Antigravity CLI"
            className="p-0.5 rounded hover:bg-white/15 text-white/50 hover:text-white disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={`w-2.5 h-2.5 ${loading ? "animate-spin text-cyan-300" : ""}`} />
          </button>
        </div>
      </div>

      {/* Error (shown even with cached data so stale numbers are obvious) */}
      {error && (
        <div className="flex items-start space-x-1 px-1.5 py-1 rounded bg-rose-500/10 border border-rose-500/25 text-[9px] text-rose-200 leading-snug">
          <AlertTriangle className="w-2.5 h-2.5 shrink-0 mt-[1px]" />
          <span className="break-words">
            {report ? "Showing last known values. " : ""}
            {error}
          </span>
        </div>
      )}

      {!report && loading && (
        <div className="text-[9.5px] text-white/45 py-1">Reading quota from agy...</div>
      )}

      {/* Groups */}
      {report?.groups.map((group) => (
        <div key={group.name} className="space-y-1" title={group.description}>
          <div className="text-[9.5px] font-medium text-white/70 truncate">{group.name}</div>
          {group.buckets.map((b) => {
            const pct = Math.round(b.remaining_percent);
            const cd = formatCountdown(b.reset_time, nowMs);
            return (
              <div key={b.id || b.name} className="space-y-0.5" title={b.description}>
                <div className="flex items-center justify-between text-[9px]">
                  <span className="text-white/50">{windowLabel(b.window, b.name)}</span>
                  <div className="flex items-center space-x-1.5 font-mono">
                    <span
                      className="flex items-center space-x-0.5 text-white/50"
                      title={cd.exact ? `Refreshes ${cd.exact}` : undefined}
                    >
                      <Clock className="w-2.5 h-2.5 opacity-70" />
                      <span>
                        {cd.text}
                        {cd.exact && cd.text !== "Refreshed" ? ` · ${cd.exact}` : ""}
                      </span>
                    </span>
                    <span className={`font-semibold w-[28px] text-right ${textColor(pct)}`}>
                      {pct}%
                    </span>
                  </div>
                </div>
                <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${barColor(pct)}`}
                    style={{ width: `${Math.max(2, pct)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ))}

      <p className="text-[8px] text-white/30 leading-snug">
        Account signed into the Antigravity CLI. Auto-refreshes every 5 min.
      </p>
    </div>
  );
}
