ARG VERSION=dev
ARG BUILD_DATE
ARG VCS_REF

FROM node:24-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
WORKDIR /app

COPY tsconfig.json ./
COPY src ./src
COPY frontend ./frontend

RUN npm run build

FROM node:24-alpine AS runner

ARG VERSION
ARG BUILD_DATE
ARG VCS_REF

LABEL org.opencontainers.image.title="Solopilot" \
    org.opencontainers.image.description="Solopilot — back-office autonome de l'auto-entrepreneur (veille, CRM, facturation, compta, agenda)" \
    org.opencontainers.image.version="${VERSION}" \
    org.opencontainers.image.created="${BUILD_DATE}" \
    org.opencontainers.image.revision="${VCS_REF}" \
    org.opencontainers.image.source="https://github.com/wifsimster/solopilot" \
    org.opencontainers.image.vendor="wifsimster" \
    maintainer="wifsimster"

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 bot

COPY package.json package-lock.json ./

RUN apk add --no-cache python3 make g++ && \
    npm ci --omit=dev && \
    apk del python3 make g++

RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates \
    ttf-freefont font-noto font-noto-emoji
ENV CHROMIUM_PATH=/usr/bin/chromium-browser
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY --from=builder /app/dist ./dist

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

RUN mkdir -p /app/data

RUN chown -R bot:nodejs /app

USER bot

ENV NODE_ENV=production
ENV APP_VERSION=${VERSION}
ENV APP_BUILD_DATE=${BUILD_DATE}

EXPOSE 3000

VOLUME ["/app/data"]

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q --spider http://localhost:3000/healthz || exit 1

CMD ["/docker-entrypoint.sh"]
