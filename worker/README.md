# Trading Bot Worker

Long-lived Node.js process that runs the trading bot's tick loop.

**This is intentionally NOT designed for Vercel serverless.** Vercel hosts only the dashboard + REST API. The worker must run somewhere that supports persistent processes:

- Railway / Fly.io
- DigitalOcean / Hetzner / AWS EC2
- Docker container on a VPS
- Self-hosted Kubernetes

## Why separate?

- Vercel serverless functions have a max execution time (~10-60s) and don't support WebSocket connections that need to stay alive.
- The bot must keep running 24/7 even if the dashboard isn't being viewed.
- The bot must keep running even if your laptop is closed.

## Running locally for development

```bash
npm install
npm install -g tsx   # or use npx tsx
WORKER_ID=local-dev tsx worker/index.ts
```

## Production: Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build
ENV NODE_ENV=production
CMD ["node", "--loader", "tsx/esm", "worker/index.ts"]
```

Build & run:

```bash
docker build -t coinbot-worker .
docker run -d --restart=unless-stopped \
  -e SUPABASE_URL=... \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  -e WORKER_ID=prod-vps-1 \
  -e TICK_INTERVAL_SEC=30 \
  -e HEARTBEAT_INTERVAL_SEC=15 \
  -e HARD_LIVE_TRADING_ALLOWED=false \
  --name coinbot-worker \
  coinbot-worker
```

## Production: systemd (VPS)

`/etc/systemd/system/coinbot-worker.service`:

```ini
[Unit]
Description=Coinbot trading worker
After=network.target

[Service]
Type=simple
User=coinbot
WorkingDirectory=/opt/coinbot
EnvironmentFile=/opt/coinbot/.env
ExecStart=/usr/bin/node --loader tsx/esm worker/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable coinbot-worker
sudo systemctl start coinbot-worker
sudo journalctl -u coinbot-worker -f
```

## Required env vars

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (bypasses RLS) |
| `WORKER_ID` | Unique ID per worker process |
| `TICK_INTERVAL_SEC` | Default 30 |
| `HEARTBEAT_INTERVAL_SEC` | Default 15 |
| `HARD_LIVE_TRADING_ALLOWED` | `true` only when ready for real money |
| `BINANCE_API_KEY` / `BINANCE_API_SECRET` | Required for live trading |
| `LLM_ENABLED` / `LLM_API_KEY` | Optional, for AI analysis |

## Mode switching without restart

The worker reads `bot_settings.trading_mode` and `bot_settings.enable_live_trading` on **every tick**. To switch modes:

1. Open the dashboard.
2. Click "Start Paper Bot" or "Start Live Bot".
3. The DB row updates; the next tick picks up the new mode.

You do NOT need to restart the worker.

## Live trading triple gate

The worker will only submit real Binance orders when ALL THREE are true:

1. `env.HARD_LIVE_TRADING_ALLOWED=true` (env-level, requires worker restart to flip)
2. `bot_settings.trading_mode='live'` (DB-level)
3. `bot_settings.enable_live_trading=true` (DB-level explicit opt-in)

If any one is false, the worker runs in paper mode regardless.

## Heartbeat

Every `HEARTBEAT_INTERVAL_SEC`, the worker writes to `worker_heartbeat` table. Dashboard reads this to show online/offline status. If the heartbeat is older than 60 seconds, the worker is considered offline and the dashboard will show a warning.

## Graceful shutdown

`SIGTERM` and `SIGINT` are handled. The worker writes a final heartbeat with `status='stopped'` before exiting.
