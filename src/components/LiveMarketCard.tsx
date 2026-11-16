import { useState, useEffect, useRef } from "react";
import {
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Gem,
} from "lucide-react";

interface AssetData {
  id: "btc" | "eth" | "gold" | "ton";
  symbol: string;
  name: string;
  subLabel: string;
  price: number;
  change24h: number;
  high24h?: number;
  low24h?: number;
  unit?: string;
}

const INITIAL_DATA: Record<string, AssetData> = {
  btc: {
    id: "btc",
    symbol: "BTC",
    name: "Bitcoin",
    subLabel: "BTC",
    price: 62937.33,
    change24h: -7.79,
  },
  eth: {
    id: "eth",
    symbol: "ETH",
    name: "Ethereum",
    subLabel: "ETH",
    price: 1737.6,
    change24h: -9.92,
  },
  gold: {
    id: "gold",
    symbol: "Gold",
    name: "Gold (XAU)",
    subLabel: "Troy Oz",
    price: 3804.12,
    change24h: -1.89,
    unit: "/oz",
  },
  ton: {
    id: "ton",
    symbol: "Gram",
    name: "Gram (TON)",
    subLabel: "Toncoin",
    price: 1.6,
    change24h: -0.19,
  },
};

function formatPrice(val: number): string {
  if (val >= 1000) {
    return "$" + Math.round(val).toLocaleString("en-US");
  } else if (val >= 1) {
    return "$" + val.toFixed(2);
  } else {
    return "$" + val.toFixed(4);
  }
}

export default function LiveMarketCard() {
  const [data, setData] = useState<Record<string, AssetData>>(INITIAL_DATA);
  const [ticks, setTicks] = useState<Record<string, "up" | "down" | null>>({});
  const [isLive, setIsLive] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // 1. Initial immediate snapshot from REST API
  useEffect(() => {
    fetch(
      'https://api.binance.com/api/v3/ticker/24hr?symbols=["BTCUSDT","ETHUSDT","TONUSDT","PAXGUSDT"]'
    )
      .then((res) => res.json())
      .then((items: Array<{ symbol: string; lastPrice: string; priceChangePercent: string }>) => {
        setData((prev) => {
          const next = { ...prev };
          for (const item of items) {
            let key = "";
            if (item.symbol === "BTCUSDT") key = "btc";
            if (item.symbol === "ETHUSDT") key = "eth";
            if (item.symbol === "PAXGUSDT") key = "gold";
            if (item.symbol === "TONUSDT") key = "ton";
            if (key && next[key]) {
              next[key] = {
                ...next[key],
                price: parseFloat(item.lastPrice),
                change24h: parseFloat(item.priceChangePercent),
              };
            }
          }
          return next;
        });
      })
      .catch(() => {});
  }, []);

  // 2. Real-time Live WebSocket streaming
  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connectWs() {
      try {
        const ws = new WebSocket(
          "wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/ethusdt@ticker/tonusdt@ticker/paxgusdt@ticker"
        );
        wsRef.current = ws;

        ws.onopen = () => {
          setIsLive(true);
        };

        ws.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data);
            const stream = parsed.stream;
            const ticker = parsed.data;
            if (!stream || !ticker) return;

            let key = "";
            if (stream.startsWith("btcusdt")) key = "btc";
            if (stream.startsWith("ethusdt")) key = "eth";
            if (stream.startsWith("paxgusdt")) key = "gold";
            if (stream.startsWith("tonusdt")) key = "ton";

            if (!key) return;

            const newPrice = parseFloat(ticker.c);
            const newChange = parseFloat(ticker.P);

            setData((prev) => {
              const current = prev[key];
              if (!current) return prev;

              // Determine tick direction for subtle live flash
              if (newPrice > current.price) {
                setTicks((t) => ({ ...t, [key]: "up" }));
                setTimeout(() => setTicks((t) => ({ ...t, [key]: null })), 800);
              } else if (newPrice < current.price) {
                setTicks((t) => ({ ...t, [key]: "down" }));
                setTimeout(() => setTicks((t) => ({ ...t, [key]: null })), 800);
              }

              return {
                ...prev,
                [key]: {
                  ...current,
                  price: newPrice,
                  change24h: newChange,
                  high24h: parseFloat(ticker.h),
                  low24h: parseFloat(ticker.l),
                },
              };
            });
          } catch {}
        };

        ws.onerror = () => {
          setIsLive(false);
        };

        ws.onclose = () => {
          setIsLive(false);
          reconnectTimer = setTimeout(connectWs, 3000);
        };
      } catch {
        reconnectTimer = setTimeout(connectWs, 5000);
      }
    }

    connectWs();

    return () => {
      clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const renderBadge = (id: string) => {
    switch (id) {
      case "btc":
        return (
          <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 font-bold text-[9px] flex items-center justify-center shrink-0 border border-amber-500/30">
            ₿
          </span>
        );
      case "eth":
        return (
          <span className="w-4 h-4 rounded-full bg-indigo-500/20 text-indigo-300 font-bold text-[9px] flex items-center justify-center shrink-0 border border-indigo-500/30">
            Ξ
          </span>
        );
      case "gold":
        return (
          <span className="w-4 h-4 rounded-full bg-yellow-500/20 text-yellow-300 text-[9px] flex items-center justify-center shrink-0 border border-yellow-500/30">
            <Sparkles className="w-2.5 h-2.5 fill-yellow-400 text-yellow-400" />
          </span>
        );
      case "ton":
        return (
          <span className="w-4 h-4 rounded-full bg-cyan-500/20 text-cyan-300 text-[9px] flex items-center justify-center shrink-0 border border-cyan-500/30">
            <Gem className="w-2.5 h-2.5 text-cyan-400" />
          </span>
        );
      default:
        return null;
    }
  };

  const assetKeys: Array<"btc" | "eth" | "gold" | "ton"> = ["btc", "eth", "gold", "ton"];

  return (
    <div className="mx-2.5 mb-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.08] shadow-sm backdrop-blur-sm transition-all overflow-hidden">
      {/* Header Bar */}
      <div
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="px-2.5 py-1.5 flex items-center justify-between cursor-pointer select-none border-b border-white/[0.04]"
      >
        <div className="flex items-center space-x-1.5 min-w-0">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              isLive ? "bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/50" : "bg-amber-400"
            }`}
          />
          <span className="text-[10px] font-semibold tracking-wider uppercase text-white/70">
            Live Prices
          </span>
          <span className="text-[8.5px] font-mono px-1 py-0.2 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
            LIVE
          </span>
        </div>

        <button
          className="text-white/40 hover:text-white p-0.5 rounded transition-colors"
          title={isCollapsed ? "Expand live prices" : "Collapse live prices"}
        >
          {isCollapsed ? (
            <ChevronRight className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
        </button>
      </div>

      {/* 2x2 Live Grid */}
      {!isCollapsed && (
        <div className="p-1.5 grid grid-cols-2 gap-1.5">
          {assetKeys.map((key) => {
            const asset = data[key];
            const tick = ticks[key];
            const isUp = asset.change24h >= 0;

            return (
              <div
                key={asset.id}
                className={`p-1.5 rounded-lg border transition-all duration-300 flex flex-col justify-between ${
                  tick === "up"
                    ? "bg-emerald-500/15 border-emerald-400/40 shadow-sm"
                    : tick === "down"
                    ? "bg-rose-500/15 border-rose-400/40 shadow-sm"
                    : "bg-black/25 hover:bg-black/35 border-white/[0.05]"
                }`}
              >
                {/* Top Row: Symbol + Badge + 24h % */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1 min-w-0">
                    {renderBadge(asset.id)}
                    <span className="text-[10px] font-bold text-white/90 truncate">
                      {asset.symbol}
                    </span>
                  </div>

                  <span
                    className={`text-[8.5px] font-mono font-medium flex items-center space-x-0.5 ${
                      isUp ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {isUp ? (
                      <TrendingUp className="w-2.5 h-2.5" />
                    ) : (
                      <TrendingDown className="w-2.5 h-2.5" />
                    )}
                    <span>
                      {isUp ? "+" : ""}
                      {asset.change24h.toFixed(1)}%
                    </span>
                  </span>
                </div>

                {/* Bottom Row: Live Price + Subtitle */}
                <div className="mt-1 flex items-baseline justify-between">
                  <span
                    className={`text-[11.5px] font-bold font-mono tracking-tight transition-colors duration-200 ${
                      tick === "up"
                        ? "text-emerald-300"
                        : tick === "down"
                        ? "text-rose-300"
                        : "text-white"
                    }`}
                  >
                    {formatPrice(asset.price)}
                    {asset.unit && (
                      <span className="text-[8px] font-normal text-white/40 ml-0.5">
                        {asset.unit}
                      </span>
                    )}
                  </span>

                  <span className="text-[8px] text-white/35 font-mono">
                    {asset.subLabel}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
