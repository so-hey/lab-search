# syntax=docker/dockerfile:1

FROM node:25-bookworm-slim AS build

RUN npm install --global pnpm@10.15.0
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter backend...

COPY apps/backend ./apps/backend
COPY packages/shared ./packages/shared
RUN pnpm --filter backend build \
  && pnpm --filter backend --prod deploy --legacy /opt/lab-search-backend \
  && mkdir -p /opt/lab-search-backend/dist \
  && cp -R apps/backend/dist/. /opt/lab-search-backend/dist/

FROM node:25-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8787
WORKDIR /app

COPY --from=build --chown=node:node /opt/lab-search-backend ./

USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? '8787'}/health`).then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]
CMD ["node", "dist/src/index.js"]
