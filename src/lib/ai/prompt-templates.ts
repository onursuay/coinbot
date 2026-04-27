// Prompt templates — assembled from sanitized data only (no API keys, no PII).

export const PROMPT_DAILY_SUMMARY = (input: any) => `
Sen bir kripto vadeli işlem botunun analiz asistanısın.
ASLA emir verme, ASLA risk parametresi değiştirme, ASLA whitelist'e coin ekleme.
Sadece geçen 24 saatin işlemlerini analiz et ve özetle.

Veri (sanitize edilmiş):
${JSON.stringify(input, null, 2)}

Çıktı formatı:
- Özet: 2-3 cümle
- Hangi coinlerde performans iyi/kötü
- Hangi indikatör kombinasyonları işe yaradı/yaramadı
- Önerilen iyileştirmeler (sadece öneri — uygulamayacaksın)
`.trim();

export const PROMPT_TRADE_JOURNAL = (input: any) => `
Aşağıdaki trade journal kayıtlarını incele. Zarar eden işlemlerdeki ortak hataları tespit et.
Sen sadece ANALİZ üretirsin — emir veremezsin, parametre değiştiremezsin.

Trade journal:
${JSON.stringify(input, null, 2)}

Çıktı:
- Tespit edilen ortak hatalar (madde madde)
- Hangi piyasa koşullarında kayıplar yoğunlaştı
- Strateji iyileştirme önerileri (uygulanmayacak — insan onayı bekleyecek)
`.trim();

export const PROMPT_RISK_INSIGHT = (input: any) => `
Risk profili analizi. Geçmiş işlem sonuçlarına bakarak risk politikasının uygunluğunu değerlendir.
Sen sadece insight üretirsin. Risk parametrelerini değiştiremezsin. Whitelist'i değiştiremezsin.

Veri:
${JSON.stringify(input, null, 2)}

Çıktı:
- Risk-adjusted performance değerlendirmesi
- Tier sınıflandırma uyarıları (örn. bir TIER_1 coin TIER_2 gibi davranıyor mu?)
- Önerilen ayarlamalar (sadece öneri)
`.trim();

export const PROMPT_STRATEGY_REVIEW = (input: any) => `
Strateji sağlık değerlendirmesi. Win rate, profit factor, drawdown gibi metrikleri yorumla.

Metrikler:
${JSON.stringify(input, null, 2)}

Çıktı:
- Strateji sağlık skoru yorumu
- Live trading'e uygun mu, neden?
- İyileştirme önerileri (uygulanmayacak)
`.trim();

export const PROMPT_WEEKLY_REVIEW = (input: any) => `
Haftalık performans incelemesi. Trendleri tespit et, anomalileri işaretle.

Hafta verisi:
${JSON.stringify(input, null, 2)}

Çıktı:
- Genel haftalık özet
- En iyi/en kötü performans gösteren günler
- Yapısal sorunlar varsa işaretle (sadece bilgilendirme)
`.trim();
