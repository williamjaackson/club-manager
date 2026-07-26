# syntax=docker/dockerfile:1

FROM node:24-alpine AS development
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
CMD ["pnpm", "run", "dev"]

FROM development AS build
RUN pnpm run build
RUN pnpm prune --prod

FROM node:24-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
RUN chown node:node /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
