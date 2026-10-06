# syntax=docker/dockerfile:1

FROM node:25-bookworm-slim AS build

RUN npm install --global pnpm@10.15.0
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/slack/package.json ./apps/slack/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter slack...

COPY apps/slack ./apps/slack
COPY packages/shared ./packages/shared
RUN pnpm --filter slack build \
  && pnpm --filter slack --prod deploy --legacy /opt/lab-search-slack \
  && mkdir -p /opt/lab-search-slack/dist \
  && cp -R apps/slack/dist/. /opt/lab-search-slack/dist/

FROM node:25-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3001
WORKDIR /app

COPY --from=build --chown=node:node /opt/lab-search-slack ./

USER node
CMD ["node", "dist/src/index.js"]
