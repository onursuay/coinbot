# CoinBot — Project Instructions

## Her işlem sonrasında otomatik yapılacaklar

**Her görev tamamlandığında** (kod değişikliği içersin ya da içermesin),
kullanıcı ayrıca istemese bile şu adımları sırayla uygula:

1. **Commit** — değişen dosyaları stage et, anlamlı bir commit mesajı yaz.
2. **Push + GitHub Actions tetikle** — `git push origin main`.
   Push, GitHub Actions `Deploy Worker` workflow'unu otomatik tetikler;
   VPS'te worker yeniden deploy edilir.
3. **VPS deploy doğrulaması** — `gh run watch <run-id> --exit-status` ile
   workflow'u sonuna kadar izle, başarılı bittiğini ve heartbeat verification
   adımının `online:true, status:running_paper` döndüğünü doğrula.

### Atlanacak durumlar
- Sadece dokümantasyon/yorum değişikliği (kod davranışını etkilemiyorsa) → push
  yine yapılır ama deploy izlemeye gerek yok.
- Değişiklikler test/build'i kıracaksa → commit/push yapma, önce sorunu çöz.
- Kullanıcı açıkça "henüz commit etme" / "lokal kalsın" dediyse → atla.

### Workflow detayları
- Auto-deploy workflow: `.github/workflows/deploy-worker.yml`
- Push to `main` → SSH to VPS → `git reset --hard origin/main` → `bash scripts/deploy-worker.sh`
- Heartbeat check: `https://coin.onursuay.com/api/bot/heartbeat`
- Bilinen false-positive: workflow log'unda "WARNING: workerOnline is not true"
  görünür çünkü grep `workerOnline:true` arıyor ama endpoint `online:true`
  döndürüyor. Response içinde `"online":true` ve `"status":"running_paper"`
  varsa deploy başarılıdır.

## Güvenlik kuralları (asla değiştirme)
- `HARD_LIVE_TRADING_ALLOWED=false` — canlı trading kapalı kalmalı.
- `MIN_SIGNAL_CONFIDENCE=70` — sinyal eşiği düşürülmemeli.
- BTC trend filtresi açık kalmalı.
- Worker lock mekanizması bozulmamalı (duplicate worker önlenmeli).
- Risk ayarları gevşetilmemeli.
