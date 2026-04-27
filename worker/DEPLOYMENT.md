# Worker Deployment Guide

Coinbot worker, VPS/cloud üzerinde sürekli çalışan bir Node.js prosesidir.
Vercel'de çalışmaz (serverless timeout limiti nedeniyle).

---

## Ön koşullar

Başlamadan önce aşağıdakiler hazır olmalı:

1. Supabase projesinde migration'lar uygulandı
   (`supabase/migrations/manual_apply_0003_0005_combined.sql`)
2. Vercel'e env değerleri eklendi ve deploy tamamlandı
3. `worker/.env` dosyası oluşturuldu (`cp worker/.env.example worker/.env`)
4. Zorunlu env değerleri dolduruldu (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
   CREDENTIAL_ENCRYPTION_KEY, WORKER_ID, HARD_LIVE_TRADING_ALLOWED=false)

---

## Seçenek A — Docker (önerilen)

### Gerekli env

```
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
CREDENTIAL_ENCRYPTION_KEY
WORKER_ID
HARD_LIVE_TRADING_ALLOWED=false
DEFAULT_EXCHANGE=binance
DEFAULT_ACTIVE_EXCHANGE=binance
DEFAULT_TRADING_MODE=paper
BINANCE_FUTURES_BASE_URL=https://fapi.binance.com
BINANCE_FUTURES_WS_URL=wss://fstream.binance.com
```

### Env dosyası oluştur

```bash
cp worker/.env.example worker/.env
```

`worker/.env` dosyasını aç ve boş değerleri doldur:
- `NEXT_PUBLIC_SUPABASE_URL=` → Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY=` → Supabase service role key
- `CREDENTIAL_ENCRYPTION_KEY=` → Vercel'deki ile aynı değer
- `WORKER_ID=` → ör. `vps-prod-1`

### Build

```bash
docker build -f worker/Dockerfile -t coinbot-worker .
```

### Başlat

```bash
docker run -d \
  --name coinbot-worker \
  --restart unless-stopped \
  --env-file worker/.env \
  -e NODE_ENV=production \
  --log-opt max-size=50m \
  --log-opt max-file=5 \
  coinbot-worker
```

### Log kontrol

```bash
docker logs -f coinbot-worker
docker logs --tail 100 coinbot-worker
```

### Restart

```bash
docker restart coinbot-worker
```

### Stop

```bash
docker stop coinbot-worker
```

### Yeni sürüm güncelle

```bash
git pull
docker build -f worker/Dockerfile -t coinbot-worker .
docker stop coinbot-worker && docker rm coinbot-worker
docker run -d \
  --name coinbot-worker \
  --restart unless-stopped \
  --env-file worker/.env \
  -e NODE_ENV=production \
  --log-opt max-size=50m \
  --log-opt max-file=5 \
  coinbot-worker
```

### Health / heartbeat kontrol

```bash
docker logs --tail 20 coinbot-worker
# Başarılı log satırı örneği:
# 2026-04-27T11:30:00.000Z ✅ [paper] tick | universe=450 prefilter=47 scanned=47 ...
```

Dashboard'da Worker Online göstergesi ≤ 30 saniyede yeşile döner.

---

## Seçenek B — PM2

### Gerekli env

Seçenek A ile aynı (bkz. yukarıdaki liste).

### Kurulum

```bash
npm install -g pm2
npm install -g tsx
```

### Env dosyası oluştur

```bash
cp worker/.env.example worker/.env
# worker/.env dosyasını aç ve değerleri doldur
```

### Başlat

```bash
pm2 start worker/index.ts \
  --name coinbot-worker \
  --interpreter tsx \
  --restart-delay 5000 \
  --max-restarts 10
```

PM2 env dosyasını okutmak için (eğer .env.local kullanmıyorsan):

```bash
# Önce env'leri export et, sonra başlat
set -a && source worker/.env && set +a
pm2 start worker/index.ts \
  --name coinbot-worker \
  --interpreter tsx \
  --restart-delay 5000 \
  --max-restarts 10
```

### Boot'ta otomatik başlat

```bash
pm2 save
pm2 startup
# Ekranda çıkan sudo komutunu çalıştır
```

### Log kontrol

```bash
pm2 logs coinbot-worker
pm2 logs coinbot-worker --lines 100
```

### Restart

```bash
pm2 restart coinbot-worker
```

### Stop

```bash
pm2 stop coinbot-worker
```

### Yeni sürüm güncelle

```bash
git pull
pm2 restart coinbot-worker
```

### Health / heartbeat kontrol

```bash
pm2 status
pm2 logs coinbot-worker --lines 20
```

---

## Seçenek C — systemd (VPS)

### Gerekli env

Seçenek A ile aynı (bkz. yukarıdaki liste).

### Kullanıcı ve dizin oluştur

```bash
sudo useradd -r -s /bin/false coinbot
sudo mkdir -p /opt/coinbot
sudo chown coinbot:coinbot /opt/coinbot
```

### Kodu kopyala

```bash
# Repo'yu /opt/coinbot'a klonla veya kopyala
sudo -u coinbot git clone https://github.com/YOUR/coinbot.git /opt/coinbot
cd /opt/coinbot
sudo -u coinbot npm install
sudo npm install -g tsx
```

### Env dosyası oluştur

```bash
sudo cp worker/.env.example /opt/coinbot/worker.env
sudo chown coinbot:coinbot /opt/coinbot/worker.env
sudo chmod 600 /opt/coinbot/worker.env
# Değerleri doldur:
sudo nano /opt/coinbot/worker.env
```

### Service dosyası oluştur

```bash
sudo tee /etc/systemd/system/coinbot-worker.service << 'EOF'
[Unit]
Description=Coinbot Trading Worker
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=coinbot
WorkingDirectory=/opt/coinbot
EnvironmentFile=/opt/coinbot/worker.env
ExecStart=/usr/bin/npx tsx worker/index.ts
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

### Aktif et ve başlat

```bash
sudo systemctl daemon-reload
sudo systemctl enable coinbot-worker
sudo systemctl start coinbot-worker
```

### Log kontrol

```bash
sudo journalctl -u coinbot-worker -f
sudo journalctl -u coinbot-worker --since "1 hour ago"
```

### Restart

```bash
sudo systemctl restart coinbot-worker
```

### Stop

```bash
sudo systemctl stop coinbot-worker
```

### Yeni sürüm güncelle

```bash
cd /opt/coinbot
sudo -u coinbot git pull
sudo -u coinbot npm install
sudo systemctl restart coinbot-worker
```

### Health / heartbeat kontrol

```bash
sudo systemctl status coinbot-worker
sudo journalctl -u coinbot-worker --lines 20
```

---

## Worker çalışıyor mu? (doğrulama)

Worker başladıktan sonra **30 saniye içinde** dashboard'da kontrol et:

1. **Worker Online** göstergesi → yeşil
2. **Last Heartbeat** → < 60 saniye önce
3. **Bot Status** → `stopped` (henüz Paper Başlat yapılmadıysa)

Paper Başlat'a bastıktan sonra **60 saniye içinde**:

4. **Bot Status** → `running_paper`
5. **Last Tick At** → dolu
6. **Scanner** → semboller görünüyor

---

## Triple gate özeti

Worker gerçek Binance emri gönderebilmek için 3 koşulun aynı anda sağlanması gerekir:

| Koşul | Kontrol noktası |
|---|---|
| `HARD_LIVE_TRADING_ALLOWED=true` | worker env (restart gerekir) |
| `bot_settings.trading_mode='live'` | DB — dashboard'dan set edilir |
| `bot_settings.enable_live_trading=true` | DB — dashboard'dan set edilir |

**100 paper trade tamamlanmadan `HARD_LIVE_TRADING_ALLOWED` değiştirilmemeli.**

---

## Sorun giderme

| Belirti | Kontrol |
|---|---|
| Worker Online değil | Logs'a bak, NEXT_PUBLIC_SUPABASE_URL doğru mu? |
| Last Heartbeat stale (>60s) | Worker çalışıyor ama Supabase'e yazamıyor — service role key kontrol |
| Tick çalışıyor ama trade yok | Sinyal üretilemiyor, scanner loglarına bak |
| Strategy health blocked | Score < 60 ve trade sayısı >= 10 — strategy sayfasına bak |
| Supabase bağlantı hatası | Migration uygulandı mı? `verify_bot_schema.sql` çalıştır |
