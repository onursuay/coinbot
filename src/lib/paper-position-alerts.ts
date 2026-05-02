export const PAPER_POSITION_ALERT_SOUND_URL = "/sounds/hedef.mp3";
export const PAPER_POSITION_ALERT_ROUTE = "/paper-trades";
export const PAPER_POSITION_ALERT_STORAGE_KEY = "notifiedTradeIds:paper";
export const MAX_NOTIFIED_PAPER_POSITION_IDS = 500;

export type PaperNotificationPermissionState =
  | NotificationPermission
  | "unsupported";

export interface PaperPositionAlertTrade {
  id: string;
  symbol: string;
  direction: string;
  signalScore: number | null;
}

export interface PaperPositionAlertDetection {
  currentIds: string[];
  nextNotifiedIds: Set<string>;
  newTrades: PaperPositionAlertTrade[];
}

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizePaperPositionAlertTrade(
  value: unknown,
): PaperPositionAlertTrade | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.id === undefined || row.id === null) return null;

  return {
    id: String(row.id),
    symbol: String(row.symbol ?? "UNKNOWN"),
    direction: String(row.direction ?? "UNKNOWN").toUpperCase(),
    signalScore: toFiniteNumber(row.signal_score ?? row.signalScore ?? row.score),
  };
}

export function normalizePaperPositionAlertTrades(
  values: unknown[],
): PaperPositionAlertTrade[] {
  return values
    .map((value) => normalizePaperPositionAlertTrade(value))
    .filter((value): value is PaperPositionAlertTrade => value !== null);
}

export function trimPaperPositionAlertIds(
  ids: Iterable<string>,
  max = MAX_NOTIFIED_PAPER_POSITION_IDS,
): string[] {
  const unique = Array.from(new Set(Array.from(ids).map(String)));
  return unique.slice(Math.max(0, unique.length - max));
}

export function detectNewPaperPositionAlerts(params: {
  openTrades: unknown[];
  notifiedIds: Set<string>;
  firstSync: boolean;
}): PaperPositionAlertDetection {
  const trades = normalizePaperPositionAlertTrades(params.openTrades);
  const nextNotifiedIds = new Set(params.notifiedIds);
  const newTrades: PaperPositionAlertTrade[] = [];

  for (const trade of trades) {
    if (nextNotifiedIds.has(trade.id)) continue;
    if (!params.firstSync) newTrades.push(trade);
    nextNotifiedIds.add(trade.id);
  }

  return {
    currentIds: trades.map((trade) => trade.id).sort(),
    nextNotifiedIds,
    newTrades,
  };
}

export function shouldPlayPaperPositionSound(params: {
  soundEnabled: boolean;
  newTradeCount: number;
}): boolean {
  return params.soundEnabled && params.newTradeCount > 0;
}

export function formatPaperPositionNotificationBody(
  trade: PaperPositionAlertTrade,
): string {
  const score =
    trade.signalScore === null ? "?" : String(Math.round(trade.signalScore));
  return `${trade.symbol} - ${trade.direction} - Skor: ${score}`;
}

export function getPaperNotificationPermissionState(
  permission?: NotificationPermission,
  supported = typeof window !== "undefined" && "Notification" in window,
): PaperNotificationPermissionState {
  if (!supported) return "unsupported";
  return permission ?? Notification.permission;
}

export function canShowPaperDesktopNotification(
  permission: PaperNotificationPermissionState,
): boolean {
  return permission === "granted";
}

export function readNotifiedPaperPositionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(PAPER_POSITION_ALERT_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map(String));
  } catch {
    return new Set();
  }
}

export function saveNotifiedPaperPositionIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      PAPER_POSITION_ALERT_STORAGE_KEY,
      JSON.stringify(trimPaperPositionAlertIds(ids)),
    );
  } catch {
    /* ignore */
  }
}

export function readPaperNotificationPermission():
  PaperNotificationPermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

export async function requestPaperNotificationPermission():
  Promise<PaperNotificationPermissionState> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  const permission = await Notification.requestPermission();
  window.dispatchEvent(new Event("coinbot:paper-notification-permission"));
  return permission;
}

export function showPaperPositionDesktopNotification(
  trade: PaperPositionAlertTrade,
) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const notification = new Notification("CoinBot yeni paper pozisyon açtı", {
    body: formatPaperPositionNotificationBody(trade),
  });

  notification.onclick = () => {
    window.focus();
    window.location.href = PAPER_POSITION_ALERT_ROUTE;
    notification.close();
  };
}
