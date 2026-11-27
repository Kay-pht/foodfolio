FROM node:24.18.0-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS yt-dlp
ARG TARGETARCH
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/* \
    && architecture="${TARGETARCH:-$(dpkg --print-architecture)}" \
    && case "${architecture}" in \
      amd64) asset="yt-dlp_linux"; checksum="32e72032766bef9199d99d15beb69fd52e46df8f8b06f0d8745db59e04d339e9" ;; \
      arm64) asset="yt-dlp_linux_aarch64"; checksum="4e27ad43f3a34bacffd078694eb3edbb4e3b378e7da44edab2be02e98555516e" ;; \
      *) echo "Unsupported architecture: ${architecture}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL -o /tmp/yt-dlp.zip "https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/${asset}.zip" \
    && echo "${checksum}  /tmp/yt-dlp.zip" | sha256sum -c - \
    && unzip -q /tmp/yt-dlp.zip -d /opt/yt-dlp \
    && mv "/opt/yt-dlp/${asset}" /opt/yt-dlp/yt-dlp

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
COPY --from=yt-dlp /opt/yt-dlp /opt/yt-dlp
RUN ln -s /opt/yt-dlp/yt-dlp /usr/local/bin/yt-dlp
USER node
CMD ["node", "dist/src/entrypoints/api.js"]
