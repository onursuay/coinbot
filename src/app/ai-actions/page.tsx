// AI Aksiyon Merkezi — Faz 1.0 mimari iskelet.
//
// Bu sayfa şu an SADECE statik bilgi gösterir. Aksiyon Merkezi'nin
// uzun vadeli kapsamı, yetki modeli, ana kaynak akışı ve Faz 2+
// planı kullanıcıya net şekilde anlatılır.
//
// SAFETY:
// - Hiçbir AI çağrısı yapılmaz (Faz 2'de eklenecek).
// - Hiçbir trade kararı, signal-engine eşiği veya canlı trading kapısı
//   bu sayfadan etkilenmez.
// - GitHub / Vercel / VPS API çağrısı yoktur; statik proje bilgisi.

import Link from "next/link";

export const dynamic = "force-static";

type StatusTone = "success" | "warning" | "danger" | "muted" | "accent";

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  muted: "text-muted",
  accent: "text-accent",
};

const TONE_BORDER: Record<StatusTone, string> = {
  success: "border-success/30 bg-success/10",
  warning: "border-warning/30 bg-warning/10",
  danger: "border-rose-500/30 bg-bg-soft",
  muted: "border-border bg-bg-soft",
  accent: "border-accent/30 bg-accent/10",
};

export default function AIActionCenterPage() {
  return (
    <div className="space-y-4">
      {/* Sayfa başlığı */}
      <div className="card">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-accent">AI Aksiyon Merkezi</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-300">
              CoinBot verilerini analiz eder, karar üretir ve onaylı
              aksiyonları GitHub ana kaynak, Vercel deploy ve VPS worker
              doğrulama akışına hazırlar.
            </p>
          </div>
          <span className="self-start rounded-full border border-warning/30 bg-warning/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-warning">
            Faz 1.0 · Hazırlık Aşaması
          </span>
        </div>
      </div>

      {/* A) Merkez Durum Kartları */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatusTile
          label="Sistem Durumu"
          value="Hazırlık Aşaması"
          hint="Faz 1.0 mimari iskelet"
          tone="warning"
        />
        <StatusTile
          label="Yetki Modu"
          value="Prompt Only"
          hint="Sadece prompt üretir, uygulamaz"
          tone="accent"
        />
        <StatusTile
          label="Canlı İşlem"
          value="Kapalı"
          hint="HARD_LIVE_TRADING_ALLOWED=false"
          tone="success"
        />
        <StatusTile
          label="Ana Kaynak"
          value="GitHub"
          hint="onursuay/coinbot"
          tone="accent"
        />
      </div>

      {/* B) Proje Kaynakları */}
      <section className="card">
        <SectionHeader
          eyebrow="B · Proje Kaynakları"
          title="Aksiyonlar bu kaynaklar üzerinde yürür"
          subtitle="Bu fazda kartlar yalnızca statik bilgi gösterir; GitHub / Vercel / SSH bağlantısı yapılmaz."
        />
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <ResourceCard
            code="GH"
            label="GitHub"
            statusLabel="Ana Kaynak"
            statusTone="success"
            rows={[
              { k: "Repo", v: "onursuay/coinbot" },
              { k: "URL", v: "https://github.com/onursuay/coinbot" },
              { k: "Branch", v: "main" },
            ]}
            futureRole="Branch / commit / PR aksiyon akışı (Faz 3)"
          />
          <ResourceCard
            code="VC"
            label="Vercel"
            statusLabel="Deploy Kaynağı"
            statusTone="accent"
            rows={[
              { k: "Canlı URL", v: "https://coin.onursuay.com" },
              { k: "Trigger", v: "GitHub main push" },
              { k: "Kapsam", v: "Dashboard + API routes" },
            ]}
            futureRole="Deploy takibi ve doğrulama (Faz 5)"
          />
          <ResourceCard
            code="VPS"
            label="VPS Worker"
            statusLabel="Worker Runtime"
            statusTone="warning"
            rows={[
              { k: "Sağlayıcı", v: "Hostinger VPS" },
              { k: "Yol", v: "/opt/coinbot" },
              { k: "Runtime", v: "Docker · Node.js" },
            ]}
            futureRole="Worker deploy / heartbeat / log doğrulama (Faz 5-6)"
          />
          <ResourceCard
            code="LP"
            label="Lokal Proje"
            statusLabel="Senkron Ortam"
            statusTone="muted"
            rows={[
              { k: "Yol", v: "/Users/onursuay/Desktop/Onur Suay/Web Siteleri/coinbot" },
              { k: "Senkron", v: "git pull origin main" },
              { k: "Rol", v: "Geliştirme / inceleme" },
            ]}
            futureRole="GitHub'dan git pull ile senkron kalır"
          />
        </div>
      </section>

      {/* C) Karar Akışı */}
      <section className="card">
        <SectionHeader
          eyebrow="C · Karar Akışı"
          title="Veriden aksiyona giden 6 adım"
          subtitle="Adımların hepsi kullanıcı tetikler; otomatik uygulama yoktur."
        />
        <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <FlowStep n={1} title="Veriler toplanır" detail="paper trades · risk · scanner · readiness" />
          <FlowStep n={2} title="AI analiz eder" detail="Çoklu model bağımsız değerlendirme" />
          <FlowStep n={3} title="Hakem karar çıkarır" detail="Sentez · risk · onay gereksinimi" />
          <FlowStep n={4} title="Aksiyon hazır" detail="confidence ≥ eşik · plan dolu" />
          <FlowStep n={5} title="Kullanıcı aksiyon başlatır" detail="Prompt / branch / PR" />
          <FlowStep n={6} title="GitHub → Vercel → VPS" detail="Deploy izlenir, doğrulanır" />
        </ol>
      </section>

      {/* D) Yetki Modeli */}
      <section className="card">
        <SectionHeader
          eyebrow="D · Yetki Modeli"
          title="Her aksiyon bir yetki seviyesinde çalışır"
          subtitle="Aktif faz: Prompt Only. Diğer seviyeler ileriki fazlarda devreye girer."
        />
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <AuthorityCard
            level="observe_only"
            title="Sadece Analiz"
            tone="muted"
            active={false}
            scope="Karar üretir, prompt üretmez. Performans raporu, gözlem önerisi."
          />
          <AuthorityCard
            level="prompt_only"
            title="Prompt Üretir"
            tone="accent"
            active={true}
            scope="Claude Code / GitHub promptu üretir. Kullanıcı manuel uygular."
          />
          <AuthorityCard
            level="approval_required"
            title="Onay Gerekir"
            tone="warning"
            active={false}
            scope="Riskli değişiklikler için kullanıcı onayı şart. Worker / risk / engine."
          />
          <AuthorityCard
            level="blocked"
            title="Engellendi"
            tone="danger"
            active={false}
            scope="Live trading açma, MIN_SIGNAL_CONFIDENCE düşürme, BTC trend kapatma."
          />
        </div>
      </section>

      {/* E) MVP Kapsam */}
      <section className="card">
        <SectionHeader
          eyebrow="E · MVP Kapsam"
          title="İlk sürümde olacaklar / olmayacaklar"
        />
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <ScopeColumn
            title="Olacaklar"
            tone="success"
            items={[
              "Performans analizi",
              "Kâr/Zarar kök neden analizi",
              "Scanner engel analizi",
              "Risk öneri kartları",
              "Claude Code prompt üretimi",
              "Aksiyon geçmişi",
            ]}
          />
          <ScopeColumn
            title="Olmayacaklar"
            tone="danger"
            items={[
              "Otomatik kod değiştirme",
              "Otomatik GitHub commit",
              "Otomatik Vercel deploy",
              "Otomatik VPS deploy",
              "Live trading değişikliği",
              "Onaysız risk parametre değişikliği",
            ]}
          />
        </div>
      </section>

      {/* F) Aktif Aksiyon Alanı */}
      <section className="card">
        <SectionHeader
          eyebrow="F · Aktif Aksiyonlar"
          title="Üretilen kararlar burada listelenecek"
        />
        <div className="mt-3 rounded-lg border border-dashed border-border bg-bg-soft px-4 py-8 text-center">
          <p className="text-sm font-medium text-slate-200">
            Henüz aktif aksiyon yok.
          </p>
          <p className="mt-1 text-xs text-muted">
            Faz 2&apos;de karar kartları burada görünecek. Her kart ayrı
            analiz, hakem kararı ve &ldquo;Aksiyon&rdquo; butonu ile gelir.
          </p>
        </div>
      </section>

      {/* Geri linki */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Link
          href="/"
          className="rounded-lg border border-border bg-bg-soft px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-accent/40 hover:text-accent"
        >
          ← Panel&apos;e dön
        </Link>
      </div>
    </div>
  );
}

// ─── Sub components ───────────────────────────────────────────────────────────

function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-accent">
        {eyebrow}
      </div>
      <div className="text-sm font-semibold text-slate-100">{title}</div>
      {subtitle && <div className="text-xs text-muted">{subtitle}</div>}
    </div>
  );
}

function StatusTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: StatusTone;
}) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${TONE_BORDER[tone]}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </div>
      <div className={`mt-1 text-sm font-semibold ${TONE_CLASSES[tone]}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-muted">{hint}</div>
    </div>
  );
}

function ResourceCard({
  code,
  label,
  statusLabel,
  statusTone,
  rows,
  futureRole,
}: {
  code: string;
  label: string;
  statusLabel: string;
  statusTone: StatusTone;
  rows: { k: string; v: string }[];
  futureRole: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-soft px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-6 w-9 items-center justify-center rounded border border-border bg-bg-card text-[10px] font-black tracking-wider text-slate-300">
            {code}
          </span>
          <span className="truncate text-sm font-semibold text-slate-100">
            {label}
          </span>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${TONE_BORDER[statusTone]} ${TONE_CLASSES[statusTone]}`}
        >
          {statusLabel}
        </span>
      </div>
      <dl className="mt-2.5 space-y-1">
        {rows.map((row) => (
          <div
            key={row.k}
            className="flex items-start justify-between gap-3 text-[11px]"
          >
            <dt className="shrink-0 uppercase tracking-wider text-muted">
              {row.k}
            </dt>
            <dd className="truncate text-right font-mono text-slate-300">
              {row.v}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 rounded-md border border-border/70 bg-bg-card/50 px-2.5 py-1.5 text-[11px] text-muted">
        <span className="font-semibold text-slate-300">Gelecek rol: </span>
        {futureRole}
      </div>
    </div>
  );
}

function FlowStep({
  n,
  title,
  detail,
}: {
  n: number;
  title: string;
  detail: string;
}) {
  return (
    <li className="rounded-lg border border-border bg-bg-soft px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-accent/40 bg-accent/10 text-[11px] font-bold text-accent">
          {n}
        </span>
        <span className="text-sm font-semibold text-slate-100">{title}</span>
      </div>
      <p className="mt-1.5 pl-8 text-[11px] text-muted">{detail}</p>
    </li>
  );
}

function AuthorityCard({
  level,
  title,
  tone,
  active,
  scope,
}: {
  level: string;
  title: string;
  tone: StatusTone;
  active: boolean;
  scope: string;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${
        active ? TONE_BORDER[tone] : "border-border bg-bg-soft"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`text-sm font-semibold ${TONE_CLASSES[tone]}`}>
          {title}
        </span>
        {active ? (
          <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
            Aktif
          </span>
        ) : (
          <span className="rounded-full border border-border bg-bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Planlandı
          </span>
        )}
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted">
        {level}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-300">{scope}</p>
    </div>
  );
}

function ScopeColumn({
  title,
  tone,
  items,
}: {
  title: string;
  tone: StatusTone;
  items: string[];
}) {
  const symbol = tone === "success" ? "✓" : "✕";
  return (
    <div className={`rounded-lg border px-3 py-3 ${TONE_BORDER[tone]}`}>
      <div className={`text-[11px] font-semibold uppercase tracking-wider ${TONE_CLASSES[tone]}`}>
        {title}
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li
            key={item}
            className="flex items-start gap-2 text-[12px] text-slate-200"
          >
            <span className={`mt-0.5 font-bold ${TONE_CLASSES[tone]}`}>
              {symbol}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
