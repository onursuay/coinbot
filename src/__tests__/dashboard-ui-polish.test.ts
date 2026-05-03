import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { mapExitReasonLabel, mapExitReasonTone } from "@/lib/dashboard/exit-reasons";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

const CARDS = read("src/components/dashboard/Cards.tsx");
const AI_ACTION = read("src/components/dashboard/AIActionCenterCard.tsx");
const SECTION_TITLE = read("src/components/dashboard/SectionTitle.tsx");
const SIDEBAR = read("src/components/Sidebar.tsx");
const PAPER_TRADES = read("src/app/paper-trades/page.tsx");
const GLOBALS = read("src/app/globals.css");
const AI_ACTION_PAGE = read("src/app/ai-actions/page.tsx");

describe("dashboard UI polish", () => {
  it("visible dashboard navigation label is Genel Bakış while route stays /", () => {
    expect(SIDEBAR).toMatch(/href:\s*'\/',\s*label:\s*'Genel Bakış'/);
    expect(SIDEBAR).not.toMatch(/href:\s*'\/',\s*label:\s*'Panel'/);
  });

  it("AI actions return link uses Genel Bakış", () => {
    expect(AI_ACTION_PAGE).toMatch(/Genel Bakış/);
    expect(AI_ACTION_PAGE).not.toMatch(/Panel&apos;e dön/);
  });

  it("shared brush title component is used by key dashboard cards", () => {
    expect(SECTION_TITLE).toMatch(/dashboard-section-title/);
    expect(GLOBALS).toMatch(/\.dashboard-section-title::before/);
    expect(CARDS).toMatch(/DashboardSectionTitle icon=\{Bot\} title="BOT DURUMU"/);
    expect(CARDS).toMatch(/DashboardSectionTitle icon=\{Activity\} title="PİYASA NABZI"/);
    expect(CARDS).toMatch(/DashboardSectionTitle icon=\{BarChart3\} title="PERFORMANS KARAR ÖZETİ"/);
    expect(AI_ACTION).toMatch(/DashboardSectionTitle icon=\{Sparkles\} title="AI AKSİYON MERKEZİ"/);
  });

  it("opportunity radar has sweep, dots, and reduced-motion handling", () => {
    expect(CARDS).toMatch(/radar-disc/);
    expect(CARDS).toMatch(/radar-sweep/);
    expect(CARDS.match(/radar-dot/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(GLOBALS).toMatch(/@keyframes radar-sweep/);
    expect(GLOBALS).toMatch(/prefers-reduced-motion: reduce/);
  });
});

describe("positions page table polish", () => {
  it("closed trades date filter options exist and default is all", () => {
    expect(PAPER_TRADES).toMatch(/useState<ClosedDateFilter>\("all"\)/);
    for (const label of ["Bugün", "Son 7 Gün", "Son 30 Gün", "Tümü"]) {
      expect(PAPER_TRADES).toContain(label);
    }
    expect(PAPER_TRADES).toMatch(/closedTradeMatchesFilter/);
  });

  it("open positions headers are compact and forced to one line", () => {
    for (const label of ["Stop", "Likidasyon", "R/R", "Aksiyon"]) {
      expect(PAPER_TRADES).toContain(`>${label}</th>`);
    }
    expect(PAPER_TRADES.match(/whitespace-nowrap/g)?.length ?? 0).toBeGreaterThan(10);
  });

  it("closed trades total/footer row was removed from positions page", () => {
    expect(PAPER_TRADES).not.toMatch(/<tfoot>/);
    expect(PAPER_TRADES).not.toMatch(/Toplam \(/);
    expect(PAPER_TRADES).not.toMatch(/Panel KPI ile birebir aynıdır/);
    expect(PAPER_TRADES).not.toMatch(/canonical paper-stats helper/);
  });
});

describe("exit reason labels", () => {
  it("maps canonical exit reasons to user-facing Turkish labels", () => {
    expect(mapExitReasonLabel("take_profit")).toBe("KÂR AL");
    expect(mapExitReasonLabel("stop_loss")).toBe("ZARAR DURDUR");
    expect(mapExitReasonLabel("manual")).toBe("MANUEL KAPATMA");
    expect(mapExitReasonLabel("manual_profit_close")).toBe("KÂRDA KAPATILDI");
    expect(mapExitReasonLabel("manual_loss_close")).toBe("ZARARDA KAPATILDI");
    expect(mapExitReasonLabel("manual_break_even_close")).toBe("BAŞABAŞ KAPATILDI");
    expect(mapExitReasonLabel("manual_stale_profit_close")).toBe("SÜRE AŞIMI · KÂRDA KAPATILDI");
    expect(mapExitReasonLabel("manual_stale_loss_close")).toBe("SÜRE AŞIMI · ZARARDA KAPATILDI");
    expect(mapExitReasonLabel("manual_stale_break_even_close")).toBe("SÜRE AŞIMI · BAŞABAŞ KAPATILDI");
    expect(mapExitReasonLabel("unexpected_raw_value")).toBe("BİLİNMİYOR");
  });

  it("uses muted semantic tones for reason badges", () => {
    expect(mapExitReasonTone("take_profit")).toBe("success");
    expect(mapExitReasonTone("manual_profit_close")).toBe("success");
    expect(mapExitReasonTone("stop_loss")).toBe("danger");
    expect(mapExitReasonTone("manual_loss_close")).toBe("danger");
    expect(mapExitReasonTone("manual")).toBe("neutral");
    expect(PAPER_TRADES).toMatch(/mapExitReasonLabel\(t\.exit_reason\)/);
  });
});
