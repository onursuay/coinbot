# Worker Auto-Deploy

GitHub Actions ile VPS worker otomatik deploy sistemi.

---

## Nasıl çalışır?

1. `main` branch'e her push'ta GitHub Actions tetiklenir.
2. Actions, VPS'e SSH ile bağlanır.
3. Repo güncellenir (`git reset --hard origin/main`).
4. `scripts/deploy-worker.sh` çalışır:
   - Safety kontrolleri (`.env` var mı? `HARD_LIVE_TRADING_ALLOWED=false` mı?)
   - Docker image build
   - Eski container 30 saniyelik grace period ile durdurulur
   - Yeni container `--restart always` ile başlatılır
   - Health check (container Up mu?)
   - Başarısız olursa previous image'a rollback
5. (Opsiyonel) Heartbeat API kontrolü `https://coin.onursuay.com/api/bot/heartbeat`: `workerOnline=true`, `trading_mode=paper`, `hard_live_gate=false`

---

## Tetikleme

| Yöntem | Nasıl? |
|--------|--------|
| Otomatik | `main` branch'e push |
| Manuel | GitHub → Actions → "Deploy Worker" → Run workflow |
| Force rebuild | Manuel çalıştırmada `force_rebuild=true` seç |

---

## GitHub'da Ayarlanması Gereken Secrets

GitHub repo → Settings → Secrets and variables → Actions → **Secrets** (New repository secret):

| Secret adı | Değer |
|------------|-------|
| `VPS_HOST` | VPS IP adresi (ör. `123.45.67.89`) |
| `VPS_USER` | SSH kullanıcısı (ör. `root`) |
| `VPS_SSH_PRIVATE_KEY` | Deploy SSH key'inin **private** yarısı (tüm içerik, `-----BEGIN...END-----` dahil) |
| `VPS_PORT` | SSH portu, varsayılan `22` — değiştirmediysen boş bırakabilirsin |

**Variable** (Secret değil) olarak ekle — Actions → Variables:

| Variable adı | Değer |
|--------------|-------|
| `VERCEL_APP_URL` | `https://coin.onursuay.com` — production domain, heartbeat check için |

### Kesinlikle GitHub'a konulmayacak secretler

Bu değerler sadece **VPS üzerindeki `worker/.env`** içinde yaşar:

- `SUPABASE_SERVICE_ROLE_KEY`
- `BINANCE_API_SECRET`
- `CREDENTIAL_ENCRYPTION_KEY`
- `SMTP_PASS`

---

## Tek Seferlik Manuel Adımlar

VPS zaten çalışıyor (`72.62.146.159`), `/opt/coinbot` ve `worker/.env` mevcut. Yapılacak tek şey GitHub Actions secrets eklemek ve deploy SSH key'ini VPS'e tanıtmak.

### 1. Deploy SSH key oluştur (yerel makinede)

```bash
ssh-keygen -t ed25519 -C "coinbot-deploy" -f ~/.ssh/coinbot_deploy -N ""
```

Bu komut iki dosya oluşturur:
- `~/.ssh/coinbot_deploy` — private key (GitHub Secret'a gidecek)
- `~/.ssh/coinbot_deploy.pub` — public key (VPS'e eklenecek)

### 2. Public key'i VPS'e ekle

Mevcut SSH erişiminle VPS'e bağlan ve public key'i ekle:

```bash
# Yerel makineden tek komutla:
ssh root@72.62.146.159 "cat >> /root/.ssh/authorized_keys" < ~/.ssh/coinbot_deploy.pub
```

### 3. Bağlantıyı test et

```bash
ssh -i ~/.ssh/coinbot_deploy -p 22 root@72.62.146.159 "echo OK"
```

`OK` çıktısı alıyorsan devam et.

### 4. GitHub Actions Secrets ekle

GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret adı | Değer |
|------------|-------|
| `VPS_HOST` | `72.62.146.159` |
| `VPS_USER` | `root` |
| `VPS_PORT` | `22` |
| `VPS_SSH_PRIVATE_KEY` | `cat ~/.ssh/coinbot_deploy` çıktısının tamamı (`-----BEGIN...END-----` dahil) |

**Variable** olarak ekle → **Actions → Variables → New repository variable**:

| Variable | Değer |
|----------|-------|
| `VERCEL_APP_URL` | `https://coin.onursuay.com` |

Bu 4 adımdan sonra bir sonraki `main` push'u worker'ı otomatik deploy eder.

---

## Deploy Başarısız Olursa

### GitHub Actions loglarına bak

GitHub → Actions → başarısız olan workflow → adım logları

### VPS'te container durumunu kontrol et

```bash
docker ps -a
docker logs coinbot-worker --tail 50
```

### Rollback oldu mu?

`deploy-worker.sh` başarısız build sonrası otomatik olarak önceki imaja döner (`coinbot-worker:previous` tag'i). Log çıktısında `ROLLBACK SUCCEEDED` yazar.

### Manuel rollback

```bash
docker stop coinbot-worker
docker rm coinbot-worker
docker run -d \
  --name coinbot-worker \
  --restart always \
  --env-file /opt/coinbot/worker/.env \
  -e NODE_ENV=production \
  coinbot-worker:previous
```

---

## Canlı Trading Kapısı

`HARD_LIVE_TRADING_ALLOWED=false` deploy script tarafından **kontrol edilir**. Bu değer `true` ise deploy tamamen iptal olur. Gerçek Binance emri asla gönderilmez.

Bu kural `worker/.env` içinde yaşar ve GitHub Actions'a aktarılmaz.

---

## PC Kapalı Olduğunda

Sistem tamamen bağımsız çalışır:
- Worker container VPS'te `--restart always` ile çalışır
- VPS reboot'ta container otomatik başlar
- Dashboard Vercel'de host edilir, PC gerektirmez
- GitHub Actions kendi runner'larında çalışır, yerel makine gerektirmez

---

## Ne Zaman Manuel Terminal Gerekir?

Kod değişikliklerinde asla terminal gerekmez. Sadece şu durumlarda:

| Durum | Ne yapılır? |
|-------|-------------|
| `worker/.env` güncelleme | Supabase key değişti, yeni env var eklendi vb. |
| Docker Engine güncelleme | VPS bakımı |
| Disk doldu / kritik hata | Manuel müdahale |

Kod değişikliklerinde terminal gerekmez — her push otomatik deploy eder.

---

## worker/.env Güncellendiğinde

Sadece env değişti, kod değişmedi:

```bash
# VPS'te:
nano /opt/coinbot/worker/.env
# Kaydet, ardından:
docker compose -f /opt/coinbot/docker-compose.worker.yml up -d
```

Container yeniden başlar, yeni env değerlerini alır. Build gerekmez.
