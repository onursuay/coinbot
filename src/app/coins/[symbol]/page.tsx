// Coin Detail Disable Patch
//
// Bu sayfa, piyasa/mum/sinyal verisi güvenilir şekilde dolmadığı için
// geçici olarak devre dışı bırakıldı. Hiçbir veri fetch'i yapılmaz;
// bozuk HTTP hatası veya boş veri kullanıcıya yansımaz.
//
// Coin bazlı takip için Piyasa Tarayıcı kullanılmalıdır — kaynak, yön,
// kalite, fırsat, skor, karar, sebep alanları orada gösterilir.
//
// SAFETY: Trade engine, signal engine, risk engine, canlı trading
// gate, Binance API çağrıları bu değişiklikten etkilenmez.

import Link from "next/link";

export default function CoinDetailDisabled() {
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
