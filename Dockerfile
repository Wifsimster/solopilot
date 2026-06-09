# Build arguments
ARG VERSION=dev
ARG BUILD_DATE
ARG VCS_REF

# Stage 1: Install dependencies
FROM node:24-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build TypeScript backend + React frontend
FROM deps AS builder
WORKDIR /app

COPY tsconfig.json ./
COPY src ./src
COPY frontend ./frontend

RUN npm run build

# Stage 3: Production runtime
FROM node:24-alpine AS runner

# Build arguments for labels
ARG VERSION
ARG BUILD_DATE
ARG VCS_REF

# Image metadata
LABEL org.opencontainers.image.title="Solopilot" \
    org.opencontainers.image.description="Solopilot — back-office autonome de l'auto-entrepreneur (veille, CRM, facturation, compta, agenda)" \
    org.opencontainers.image.version="${VERSION}" \
    org.opencontainers.image.created="${BUILD_DATE}" \
    org.opencontainers.image.revision="${VCS_REF}" \
    org.opencontainers.image.source="https://github.com/wifsimster/solopilot" \
    org.opencontainers.image.vendor="wifsimster" \
    maintainer="wifsimster"

WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 bot

# Copy package files for production install
COPY package.json package-lock.json ./

# Install production dependencies only (better-sqlite3 needs build tools)
RUN apk add --no-cache python3 make g++ && \
    npm ci --omit=dev && \
    apk del python3 make g++

# Install Chromium for browser-driven auto-publish (content studio → "Publier").
# The app drives this system binary via playwright-core; CHROMIUM_PATH points at
# it so Playwright never downloads its own (glibc) browser on Alpine.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates \
    ttf-freefont font-noto font-noto-emoji
ENV CHROMIUM_PATH=/usr/bin/chromium-browser
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Copy built artifacts (backend + frontend)
COPY --from=builder /app/dist ./dist

# Copy startup script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create data directory for SQLite
RUN mkdir -p /app/data

# Set ownership
RUN chown -R bot:nodejs /app

# Switch to non-root user
USER bot

ENV NODE_ENV=production
ENV APP_VERSION=${VERSION}
ENV APP_BUILD_DATE=${BUILD_DATE}

EXPOSE 3000

VOLUME ["/app/data"]

# Health check via HTTP
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q --spider http://localhost:3000/healthz || exit 1

CMD ["/docker-entrypoint.sh"]
