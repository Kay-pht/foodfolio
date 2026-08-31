FROM node:24.18.0-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS yt-dlp
ARG TARGETARCH
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && architecture="${TARGETARCH:-$(dpkg --print-architecture)}" \
    && case "${architecture}" in \
      amd64) asset="yt-dlp_linux"; checksum="58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a" ;; \
      arm64) asset="yt-dlp_linux_aarch64"; checksum="b16e4dab368a816cd05d477d698a605a6ae87ccee1c8ffd38fa21d7254141fcc" ;; \
      *) echo "Unsupported architecture: ${architecture}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL -o /usr/local/bin/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/${asset}" \
    && echo "${checksum}  /usr/local/bin/yt-dlp" | sha256sum -c - \
    && chmod 0755 /usr/local/bin/yt-dlp

FROM base AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json eslint.config.js prisma.config.ts ./
COPY prisma ./prisma
RUN npm run prisma:generate
COPY schemas ./schemas
COPY src ./src
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=peer
COPY --from=build /app/dist ./dist
COPY --from=build /app/schemas ./schemas
COPY --from=yt-dlp /usr/local/bin/yt-dlp /usr/local/bin/yt-dlp
USER node
CMD ["node", "dist/src/entrypoints/api.js"]
