# syntax=docker/dockerfile:1.7
#
# TCGStudio Designer image.
#
# Stages:
#   base   — node:20-alpine with pnpm/npm tooling baked in
#   deps   — installs the workspace dependencies (cached)
#   dev    — runs `vite dev` with hot reload (used by docker-compose)
#   build  — compiles the static SPA bundle
#   prod   — serves the bundle via nginx (for future deploys)
#
# NOTE: VITE_API_URL is set to a sentinel value "__TCG_API_URL__" at
# build time.  At runtime, nginx's sub_filter replaces every occurrence
# of that sentinel in the response with the real URL injected via the
# VITE_API_URL environment variable (set by Cloud Run).  This means the
# same image works regardless of the actual backend URL.

# ---------- base ----------
FROM node:20-alpine AS base
WORKDIR /workspace
ENV CI=true \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
RUN apk add --no-cache libc6-compat

# ---------- deps ----------
FROM base AS deps
COPY package.json ./
COPY apps/designer/package.json apps/designer/package.json
# Future workspaces declared in package.json should be added here as we go.
RUN npm install --workspaces --include-workspace-root --no-audit --no-fund

# ---------- dev ----------
# docker-compose bind-mounts the source over the top of /workspace/apps/designer,
# so we only need the installed node_modules layer here.
FROM deps AS dev
EXPOSE 5173
CMD ["npm", "run", "designer:dev"]

# ---------- build ----------
FROM deps AS build
COPY apps/designer apps/designer
# Sentinal value — replaced at runtime by nginx sub_filter.
ENV VITE_API_URL=__TCG_API_URL__
RUN npm --workspace apps/designer run build

# ---------- prod ----------
FROM nginx:1.27-alpine AS prod
# Use a template so envsubst (baked into the official nginx image) can inject
# the Cloud Run $PORT and $VITE_API_URL.
COPY apps/designer/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /workspace/apps/designer/dist /usr/share/nginx/html
ENV PORT=80
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]