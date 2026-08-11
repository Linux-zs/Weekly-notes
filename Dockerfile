FROM node:24-bookworm-slim AS base
WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm install -g pnpm@11.16.0 --registry=${NPM_REGISTRY}

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --registry=${NPM_REGISTRY}
COPY . .
RUN pnpm build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/data/holidays ./resources/holidays
EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]
