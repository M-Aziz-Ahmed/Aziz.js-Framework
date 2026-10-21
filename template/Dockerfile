# syntax=docker/dockerfile:1
#
# Production image for an Aziz.js app.
#
#   docker build -t my-app .
#   docker run -p 3000:3000 my-app
#
# Three stages:
#   deps   — production dependencies only (no devDependencies)
#   build  — compiles the app: precompiled modules + prerendered pages
#   runtime — the server, a non-root user and nothing else
#
# The runtime image does NOT contain @babel/standalone: the build stage
# already compiled everything, so the server never needs a compiler.

# ── Production dependencies ───────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund \
    || npm install --omit=dev --no-audit --no-fund

# ── Build ─────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund \
    || npm install --no-audit --no-fund
COPY . .
# Precompile the modules, prerender the static pages, then drop the
# dev dependencies so they cannot leak into the runtime image.
RUN npm run build && rm -rf node_modules

# ── Runtime ───────────────────────────────────────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    AZIZ_CACHE_DIR=/data/aziz
WORKDIR /app

RUN addgroup -S aziz && adduser -S -G aziz aziz

COPY --from=build --chown=aziz:aziz /app/ ./
COPY --from=deps --chown=aziz:aziz /app/node_modules ./node_modules

# The ISR cache lives on a volume: mount the same volume on every
# replica to share it, or leave it local for a single instance.
RUN mkdir -p /data/aziz && chown -R aziz:aziz /data
VOLUME ["/data"]

USER aziz
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/_aziz/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "scripts/dev-server.js", "--production"]
