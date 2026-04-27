# Trading Bot Worker

Long-lived Node.js process that runs the trading bot's tick loop.

**This is intentionally NOT designed for Vercel serverless.**
Vercel hosts only the dashboard + REST API. The worker must run somewhere that supports persistent processes:

- DigitalOcean / Hetzner / AWS EC2 VPS
- Docker container (any provider)
- Railway / Fly.io
- Self-hosted Kubernetes

## Why separate?

- Vercel serverless functions have a max execution time and cannot maintain persistent state.
- The bot must run 24/7 even when the dashboard is not open.
- The bot must run even when your laptop is closed.

---

## Required environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **YES** | — | Supabase project URL (`https://xxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **YES** | — | Service role key (bypasses RLS) |
| `CREDENTIAL_ENCRYPTION_KEY` | **YES** | — | AES encryption key for stored API credentials |
| `WORKER_ID` | **YES** | `worker-<pid>` | Unique name per worker instance |
| `HARD_LIVE_TRADING_ALLOWED` | **YES** | `false` | Keep `false` until 100 paper trades done |
| `DEFAULT_ACTIVE_EXCHANGE` | no | `binance` | Active exchange name |
| `DEFAULT_TRADING_MODE` | no | `paper` | `paper` or `live` |
| `TICK_INTERVAL_SEC` | no | `30` | How often the scanner runs |
| `HEARTBEAT_INTERVAL_SEC` | no | `15` | Dashboard online/offline check interval |
| `BINANCE_API_KEY` | no* | — | *Required only for live trading |
| `BINANCE_API_SECRET` | no* | — | *Required only for live trading |
| `LLM_ENABLED` | no | `false` | AI analysis (analysis only, never trades) |
| `LLM_API_KEY` | no | — | OpenAI/etc key if LLM_ENABLED=true |

> **Note:** The worker reads `NEXT_PUBLIC_SUPABASE_URL`, not `SUPABASE_URL`.
> This matches the env variable name used by the Next.js dashboard.

---

## Option A — Docker (recommended for VPS)

### Step 1: Build

```bash
docker build -f worker/Dockerfile -t coinbot-worker .
```

### Step 2: Create env file

```bash
cp worker/.env.example worker/.env
# Edit worker/.env — fill in real values for:
#   NEXT_PUBLIC_SUPABASE_URL
#   SUPABASE_SERVICE_ROLE_KEY
#   CREDENTIAL_ENCRYPTION_KEY
#   WORKER_ID=vps-prod-1
nano worker/.env
```

### Step 3: Run

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

### Check logs

```bash
docker logs -f coinbot-worker
```

### Stop / restart

```bash
docker stop coinbot-worker
docker start coinbot-worker
docker restart coinbot-worker
```

### Update to new version

```bash
git pull
docker build -f worker/Dockerfile -t coinbot-worker .
docker stop coinbot-worker && docker rm coinbot-worker
docker run -d \
  --name coinbot-worker \
  --restart unless-stopped \
  --env-file worker/.env \
  -e NODE_ENV=production \
  coinbot-worker
```

### docker-compose (alternative)

```bash
# Copy and fill worker/.env first (see above), then:
docker compose -f docker-compose.worker.yml up -d
docker compose -f docker-compose.worker.yml logs -f
```

---

## Option B — PM2 (VPS without Docker)

### Step 1: Install PM2

```bash
npm install -g pm2
npm install -g tsx
```

### Step 2: Create env file

```bash
cp worker/.env.example worker/.env
nano worker/.env   # fill in real values
```

### Step 3: Start

```bash
# Load env file and start worker
pm2 start worker/index.ts \
  --name coinbot-worker \
  --interpreter tsx \
  --env-file worker/.env \
  --restart-delay 5000 \
  --max-restarts 10
```

### Step 4: Save and enable on boot

```bash
pm2 save
pm2 startup   # follow the printed command to enable boot start
```

### Common PM2 commands

```bash
pm2 status
pm2 logs coinbot-worker
pm2 logs coinbot-worker --lines 100
pm2 restart coinbot-worker
pm2 stop coinbot-worker
pm2 delete coinbot-worker
```

---

## Option C — systemd (VPS, runs as service)

### Step 1: Create user and install

```bash
sudo useradd -r -s /bin/false coinbot
sudo mkdir -p /opt/coinbot
sudo chown coinbot:coinbot /opt/coinbot

# Clone repo or copy files into /opt/coinbot
cd /opt/coinbot
npm install
npm install -g tsx
```

### Step 2: Create env file

```bash
sudo cp worker/.env.example /opt/coinbot/worker.env
sudo chown coinbot:coinbot /opt/coinbot/worker.env
sudo chmod 600 /opt/coinbot/worker.env
sudo nano /opt/coinbot/worker.env   # fill in real values
```

### Step 3: Create service file

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

### Step 4: Enable and start

```bash
sudo systemctl daemon-reload
sudo systemctl enable coinbot-worker
sudo systemctl start coinbot-worker
```

### Check status and logs

```bash
sudo systemctl status coinbot-worker
sudo journalctl -u coinbot-worker -f
sudo journalctl -u coinbot-worker --since "1 hour ago"
```

---

## Verifying the worker is running

After startup, open the dashboard. Within 30 seconds:

- **Worker Online** indicator turns green
- **Last Heartbeat** shows a recent timestamp (< 60s ago)
- **Bot Status** shows `running_paper` after clicking Paper Start

If the worker is offline:
1. Check `docker logs coinbot-worker` or `pm2 logs coinbot-worker`
2. Verify `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are correct
3. Check Supabase project is active and migrations 0003-0005 are applied

---

## Live trading triple gate

The worker only submits real Binance orders when **all three** are simultaneously true:

1. `HARD_LIVE_TRADING_ALLOWED=true` (env — requires worker restart to change)
2. `bot_settings.trading_mode='live'` (DB — set via dashboard)
3. `bot_settings.enable_live_trading=true` (DB — set via dashboard)

If any one is false, the worker runs in paper mode regardless of the others.

**Keep `HARD_LIVE_TRADING_ALLOWED=false` until 100 paper trades are completed and live readiness checks pass.**

---

## Mode switching without restart

The worker reads `bot_settings` on every tick. To switch paper ↔ live:

1. Open the dashboard.
2. Click **Paper Start** or **Live Start**.
3. The DB row updates; the next tick picks up the new mode automatically.

You do NOT need to restart the worker.

---

## Heartbeat

Every `HEARTBEAT_INTERVAL_SEC` seconds (default 15), the worker writes to the `worker_heartbeat` table. The dashboard reads this to show online/offline status. If the heartbeat is older than 60 seconds, the worker is considered offline.

---

## Graceful shutdown

`SIGTERM` and `SIGINT` are caught. The worker writes a final heartbeat with `status='stopped'` before exiting. Docker `stop` and PM2 `stop` both send SIGTERM.
