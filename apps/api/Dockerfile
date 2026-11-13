# Built from the repository root:  docker build -f apps/api/Dockerfile .
# Stages: base -> deps -> dev (development and Dev Container) | build -> prod (minimal final image)
#
# Everything runs as the "node" user (UID 1000), not root, so files created inside the container
# (migrations, generated code) are owned by your user on the host.
# If your UID is not 1000, the Dev Container adjusts it automatically (updateRemoteUserUID).

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    HUSKY=0
RUN corepack enable \
 && mkdir -p /app /pnpm /home/node/.claude \
 && chown node:node /app /pnpm /home/node/.claude
WORKDIR /app
USER node

# ---------- Dependencies (including dev dependencies) ----------
FROM base AS deps
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/api/package.json apps/api/
COPY --chown=node:node packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store,uid=1000,gid=1000 \
    pnpm install --frozen-lockfile

# ---------- Development: code is mounted as a volume by docker-compose ----------
FROM deps AS dev
COPY --chown=node:node . .
ENV NODE_ENV=development
EXPOSE 3000
CMD ["pnpm", "--filter", "@bella-vista/api", "dev"]

# ---------- Build ----------
FROM deps AS build
COPY --chown=node:node . .
RUN pnpm -r build \
 && pnpm --filter @bella-vista/api deploy --prod /app/out

# ---------- Production: only dist and production dependencies ----------
FROM node:${NODE_VERSION}-slim AS prod
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
