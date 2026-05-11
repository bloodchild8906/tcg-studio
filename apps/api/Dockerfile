# syntax=docker/dockerfile:1.7
#
# TCGStudio API image.
#
# Stages:
#   base   — node:20-alpine
#   deps   — installs workspace deps (cached on package.json hash)
#   dev    — runs tsx watch (used by docker-compose)
#   build  — compiles TS to dist/
#   prod   — slim runtime that runs node dist/server.js

FROM node:20-alpine AS base
WORKDIR /workspace
ENV CI=true \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NODE_ENV=development
RUN apk add --no-cache libc6-compat openssl

FROM base AS deps
COPY package.json ./
COPY apps/designer/package.json apps/designer/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm install --workspaces --include-workspace-root --no-audit --no-fund

FROM deps AS dev
COPY apps/api/prisma apps/api/prisma
RUN npx --workspace apps/api prisma generate
EXPOSE 4000
WORKDIR /workspace/apps/api
CMD ["npm", "run", "dev"]

# ---------- build ----------
# Compile TypeScript to JS for a smaller, faster prod image. The build
# script tolerates type-errors with `|| true` so a strict-mode warning
# doesn't fail the docker build — the emitted JS is still valid because
# tsc emits even when type-checks fail (unless noEmitOnError is set).
FROM deps AS build
COPY apps/api apps/api
ENV NODE_ENV=production
RUN npx --workspace apps/api prisma generate
RUN npm --workspace apps/api run build

# ---------- prod ----------
# Run from source via tsx instead of compiled dist/ — bypasses any
# missing-emit gotchas from the build step, and on a server that starts
# once the small per-import transpile cost is irrelevant. tsx is pulled
# in as a devDep so it's already in node_modules.
#
# The COPY destination must be relative to the workspace root so the
# npm workspace resolver still finds `apps/api/package.json` — we set
# WORKDIR to /workspace for the copy + prisma-generate, then switch to
# the api dir for CMD.
FROM deps AS prod
ENV NODE_ENV=production
RUN apk add --no-cache openssl
WORKDIR /workspace
COPY apps/api apps/api
RUN npx --workspace apps/api prisma generate
WORKDIR /workspace/apps/api
EXPOSE 4000
CMD ["npx", "tsx", "src/server.ts"]