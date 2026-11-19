FROM node:22-bookworm-slim

# Native toolchain required if better-sqlite3 needs compilation on the target architecture
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json tsconfig.json vite.config.ts index.html ./
RUN npm install --no-audit --no-fund

COPY server.ts ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# Build static production web bundle into /app/dist
RUN npm run build

# Separate local fast POSIX working directory for SQLite from GCS FUSE snapshot mount
RUN mkdir -p /tmp/otlobha-local /mnt/gcs-data

ENV NODE_ENV=production \
    DISABLE_VITE=1 \
    PORT=8080 \
    OTLOBHA_DB_PATH=/tmp/otlobha-local/otlobha.db \
    OTLOBHA_GCS_PERSIST_DIR=/mnt/gcs-data \
    OTLOBHA_SQLITE_JOURNAL_MODE=WAL \
    OTLOBHA_SQLITE_SYNC_INTERVAL_MS=15000

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["./node_modules/.bin/tsx", "server.ts"]
