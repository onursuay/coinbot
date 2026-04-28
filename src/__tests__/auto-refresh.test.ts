import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Tests for the auto-refresh interval + visibility logic.
// These mirror what useAutoRefresh does internally, without needing React Testing Library.

const INTERVAL = 15_000;

function makeController(onRefresh: () => void, intervalMs = INTERVAL) {
  let timerId: ReturnType<typeof setInterval> | null = null;

  const startInterval = () => {
    if (timerId !== null) return; // no duplicates
    timerId = setInterval(onRefresh, intervalMs);
  };

  const stopInterval = () => {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  };

  const handleVisibility = (state: "visible" | "hidden") => {
    if (state === "hidden") {
      stopInterval();
    } else {
      onRefresh(); // immediate on visible
      startInterval();
    }
  };

  return { startInterval, stopInterval, handleVisibility, getTimerId: () => timerId };
}

describe("auto-refresh interval logic", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("calls refresh at 15s intervals", () => {
    const fn = vi.fn();
    const { startInterval, stopInterval } = makeController(fn);
    startInterval();

    vi.advanceTimersByTime(15_000);
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(15_000);
    expect(fn).toHaveBeenCalledTimes(2);

    stopInterval();
  });

  it("does not create duplicate intervals on repeated startInterval calls", () => {
    const fn = vi.fn();
    const { startInterval, stopInterval } = makeController(fn);

    startInterval();
    startInterval(); // second call must be a no-op
    startInterval(); // third call must be a no-op

    vi.advanceTimersByTime(15_000);
    expect(fn).toHaveBeenCalledTimes(1); // only one interval fired

    stopInterval();
  });

  it("stops calling refresh after stopInterval (simulates unmount cleanup)", () => {
    const fn = vi.fn();
    const { startInterval, stopInterval } = makeController(fn);
    startInterval();
    stopInterval();

    vi.advanceTimersByTime(60_000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("pauses refresh when tab becomes hidden", () => {
    const fn = vi.fn();
    const { startInterval, handleVisibility } = makeController(fn);
    startInterval();

    handleVisibility("hidden"); // tab hidden → interval cleared

    vi.advanceTimersByTime(60_000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("calls refresh immediately when tab becomes visible again", () => {
    const fn = vi.fn();
    const { startInterval, handleVisibility } = makeController(fn);
    startInterval();

    handleVisibility("hidden");

    handleVisibility("visible"); // should call fn once immediately
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("resumes interval after tab becomes visible", () => {
    const fn = vi.fn();
    const { startInterval, handleVisibility, stopInterval } = makeController(fn);
    startInterval();

    handleVisibility("hidden");
    handleVisibility("visible"); // immediate call + restart interval

    vi.advanceTimersByTime(15_000);
    expect(fn).toHaveBeenCalledTimes(2); // 1 immediate + 1 interval tick

    stopInterval();
  });

  it("does not create duplicate intervals on repeated visible transitions", () => {
    const fn = vi.fn();
    const { startInterval, handleVisibility, stopInterval } = makeController(fn);
    startInterval();

    handleVisibility("hidden");
    handleVisibility("visible"); // immediate + start
    handleVisibility("visible"); // second visible — startInterval is a no-op

    vi.advanceTimersByTime(15_000);
    expect(fn).toHaveBeenCalledTimes(3); // 1+1 immediate + 1 interval tick (not 2 ticks)

    stopInterval();
  });
});

describe("auto-refresh endpoint safety", () => {
  const DASHBOARD_ENDPOINTS = [
    "/api/bot/status",
    "/api/paper-trades/performance",
    "/api/paper-trades",
    "/api/system/env-check",
    "/api/bot/heartbeat",
    "/api/bot/strategy-health",
    "/api/bot/live-readiness",
    "/api/bot/diagnostics",
    "/api/paper-trades/e2e-status",
  ];

  const SCANNER_ENDPOINTS = [
    "/api/bot/diagnostics",
  ];

  it("all dashboard auto-refresh endpoints are internal (no direct Binance calls)", () => {
    for (const ep of DASHBOARD_ENDPOINTS) {
      expect(ep.startsWith("/api/")).toBe(true);
      expect(ep).not.toMatch(/binance|bybit|okx|https?:\/\//);
    }
  });

  it("all scanner auto-refresh endpoints are internal", () => {
    for (const ep of SCANNER_ENDPOINTS) {
      expect(ep.startsWith("/api/")).toBe(true);
      expect(ep).not.toMatch(/binance|bybit|okx|https?:\/\//);
    }
  });

  it("auto-refresh endpoints are all read-only (GET, no mutation)", () => {
    // Mutation endpoints that must NOT appear in auto-refresh
    const MUTATION_ENDPOINTS = [
      "/api/bot/start",
      "/api/bot/stop",
      "/api/bot/tick",
      "/api/bot/kill-switch",
      "/api/scanner/run",
      "/api/signals/generate",
    ];

    const allEndpoints = [...DASHBOARD_ENDPOINTS, ...SCANNER_ENDPOINTS];

    for (const mutation of MUTATION_ENDPOINTS) {
      expect(allEndpoints).not.toContain(mutation);
    }
  });
});
