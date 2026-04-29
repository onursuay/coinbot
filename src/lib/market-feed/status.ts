// Faz 18 — Public market feed skeleton + status singleton.
//
// GUARDRAILS:
//   • Bu modül **gerçek** Binance WS bağlantısı kurmaz (Faz 18).
//   • User data stream / private listenKey kesinlikle YOK.
//   • Sahte "connected" üretilmez. Bağlantı yoksa "disconnected".
//
// Skeleton pattern: createPublicMarketFeed() açıldığında bir
// mock/skeleton feed döner. subscribe/unsubscribe state'i takip eder
// ama fiziksel bir socket açılmaz. İleride gerçek WS adapter'ı bu
// arayüzün arkasına yerleştirilebilir.

import {
  DEFAULT_FEED_STATUS,
  MARKET_FEED_STALE_SEC,
  type MarketFeedStatus,
  type WebsocketStatus,
  type FeedMode,
} from "./types";

let _status: MarketFeedStatus = { ...DEFAULT_FEED_STATUS };

export function getMarketFeedStatus(): MarketFeedStatus {
  let stale = true;
  let staleAgeSec: number | null = null;
  if (_status.lastMessageAt) {
    const ageSec = (Date.now() - new Date(_status.lastMessageAt).getTime()) / 1000;
    if (Number.isFinite(ageSec)) {
      staleAgeSec = Math.round(ageSec);
      stale = staleAgeSec > MARKET_FEED_STALE_SEC;
    }
  }
  return {
    ..._status,
    stale,
    staleAgeSec,
    symbolsSubscribed: [..._status.symbolsSubscribed],
  };
}

export function setMarketFeedStatus(patch: Partial<MarketFeedStatus>): MarketFeedStatus {
  _status = { ..._status, ...patch };
  return getMarketFeedStatus();
}

export function resetMarketFeedStatus(): MarketFeedStatus {
  _status = { ...DEFAULT_FEED_STATUS };
  return getMarketFeedStatus();
}

export interface PublicMarketFeed {
  subscribeSymbols(symbols: string[]): void;
  unsubscribeSymbols(symbols: string[]): void;
  getStatus(): MarketFeedStatus;
  close(): void;
}

export interface CreatePublicMarketFeedOptions {
  // Skeleton mode: when true, no socket is opened; status starts as disconnected
  // and only updates if the caller manually transitions it. Default: true.
  skeletonOnly?: boolean;
}

export function createPublicMarketFeed(
  opts: CreatePublicMarketFeedOptions = {},
): PublicMarketFeed {
  const skeletonOnly = opts.skeletonOnly ?? true;

  if (skeletonOnly) {
    setMarketFeedStatus({
      websocketStatus: "disconnected",
      feedMode: "none",
      disconnectReason: "skeleton_only_no_socket_opened",
    });
  }

  return {
    subscribeSymbols(symbols: string[]) {
      const set = new Set(_status.symbolsSubscribed);
      for (const s of symbols) set.add(s);
      setMarketFeedStatus({ symbolsSubscribed: Array.from(set) });
    },
    unsubscribeSymbols(symbols: string[]) {
      const drop = new Set(symbols);
      setMarketFeedStatus({
        symbolsSubscribed: _status.symbolsSubscribed.filter((s) => !drop.has(s)),
      });
    },
    getStatus() {
      return getMarketFeedStatus();
    },
    close() {
      setMarketFeedStatus({
        websocketStatus: "disconnected",
        feedMode: "none",
        disconnectReason: "feed_closed_by_caller",
      });
    },
  };
}

// Heartbeat-friendly status enum mapper. Keeps backward compatibility with
// the old heartbeat field which only knew connected/disconnected/reconnecting.
export function toHeartbeatWebsocketStatus(s: WebsocketStatus): "connected" | "disconnected" | "reconnecting" {
  if (s === "connected") return "connected";
  if (s === "connecting") return "reconnecting";
  if (s === "degraded") return "reconnecting";
  return "disconnected";
}

export type { WebsocketStatus, FeedMode, MarketFeedStatus };
