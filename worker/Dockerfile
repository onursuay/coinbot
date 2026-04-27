FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Install tsx for ESM TypeScript execution
RUN npm install -g tsx

# Copy source
COPY . .

ENV NODE_ENV=production

# Health check — verify worker process is alive
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD pgrep -f "worker/index.ts" || exit 1

CMD ["tsx", "worker/index.ts"]
