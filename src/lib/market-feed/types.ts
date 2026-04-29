// Faz 18 — WebSocket / market feed status tipleri.
// Sahte "ok" üretilmez. Bağlantı yoksa DISCONNECTED + reason döner.

export type WebsocketStatus = "connected" | "connecting" | "disconnected" | "degraded";
export type FeedMode = "none" | "public_market" | "user_data";

export interface MarketFeedStatus {
  websocketStatus: WebsocketStatus;
  feedMode: FeedMode;
  lastConnectedAt: string | null;
  lastMessageAt: string | null;
  disconnectReason: string | null;
  symbolsSubscribed: string[];
  stale: boolean;
  staleAgeSec: number | null;
}

export const DEFAULT_FEED_STATUS: MarketFeedStatus = {
  websocketStatus: "disconnected",
  feedMode: "none",
  lastConnectedAt: null,
  lastMessageAt: null,
  disconnectReason: "market_feed_not_started",
  symbolsSubscribed: [],
  stale: true,
  staleAgeSec: null,
};

export const MARKET_FEED_STALE_SEC = 60;
