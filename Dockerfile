# ---- Stage 1: build the React client ----------------------------------
FROM node:20-bookworm-slim AS client-build
WORKDIR /app/client
COPY client/package.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# ---- Stage 2: server runtime -------------------------------------------
FROM node:20-bookworm-slim

# System Chromium is used for PDF export instead of Puppeteer's bundled
# download (faster, smaller, more reliable across architectures).
# python3/make/g++ are present so better-sqlite3 can build from source if a
# prebuilt binary isn't available for the target platform.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      ca-certificates \
      python3 \
      make \
      g++ \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/data

WORKDIR /app/server
COPY server/package.json ./
RUN npm install --omit=dev

COPY server/ ./
COPY --from=client-build /app/client/dist /app/client/dist

VOLUME ["/data"]
EXPOSE 4000

CMD ["node", "src/index.js"]
