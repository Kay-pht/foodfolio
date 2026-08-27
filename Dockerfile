FROM node:24.18.0-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

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
USER node
CMD ["node", "dist/src/entrypoints/api.js"]
