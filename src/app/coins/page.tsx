// Coin Detail Disable Patch — index sayfası da devre dışı.
//
// Hiçbir veri fetch'i yapılmaz. Coin listesi yerine kullanıcı Piyasa
// Tarayıcı'ya yönlendirilir.

import Link from "next/link";

export default function CoinsIndexDisabled() {
  return (
    <div className="space-y-4">
      <div className="card">
        <h1 className="text-lg font-semibold tracking-wide mb-2">
          Coin Detay geçici olarak devre dışı
        </h1>
        <p className="text-sm text-muted leading-relaxed">
          Bu alan, piyasa verisi ve mum verisi güvenilir şekilde sağlanana
          kadar kapatıldı. Coin bazlı takip için Piyasa Tarayıcı
          kullanılmalıdır.
        </p>
        <div className="mt-4">
          <Link href="/scanner" className="btn-primary text-sm px-4 py-1.5 inline-block">
            Piyasa Tarayıcıya dön
          </Link>
        </div>
      </div>
    </div>
  );
}
