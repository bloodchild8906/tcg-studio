# TCGStudio

> **Build the game. Publish the world. Own the brand.**

A multi-tenant, white-label, plugin-first SaaS platform for designing, managing,
validating, playtesting, publishing, and exporting custom trading card games.

This repository tracks the implementation. The full product specification lives at
[`docs/spec.md`](./docs/spec.md).

---

## Status

**Current beachhead:** the Card Type Designer (spec section 19). A frontend-first
prototype that exercises the layer / zone / variant model on a live canvas. Backend
services come after.

| Area | State |
| --- | --- |
| Card Type Designer (Vite + React + TS, Konva canvas) | In progress |
| Backend (Node/TS + Prisma + Postgres) | Not started |
| CMS / public sites | Not started |
| Plugins / marketplace | Not started |

## Stack

- **Frontend:** Vite, React 18, TypeScript (strict), Tailwind CSS, Zustand,
  react-konva.
- **Backend (planned):** Node/TypeScript (NestJS or Fastify), Prisma, PostgreSQL,
  Redis, MinIO (S3-compatible storage).
- **Infra:** Docker Compose for local dev. Production target deferred.

## Repository layout

```
TcgStudio/
├── apps/
│   └── designer/         # Card Type Designer (Vite + React + TS)
├── packages/             # (placeholder) shared TypeScript types
├── docs/
│   └── spec.md           # Full product specification
├── docker-compose.yml    # designer + postgres + redis + minio
├── .editorconfig
├── .gitignore
├── .env.example
└── package.json          # workspaces root
```

## Getting started

### Prerequisites

- Docker Desktop (Windows / macOS / Linux).

### Run

```powershell
# from the repo root
docker compose up --build
```

When the build finishes:

- Designer: <http://localhost:5173>
- Postgres: `localhost:5432` (user `tcg`, password `tcg`, db `tcgstudio`)
- Redis: `localhost:6379`
- MinIO console: <http://localhost:9001> (user `tcg`, password `tcgtcgtcg`)

The Postgres / Redis / MinIO services are wired in now so the backend has a
home when it lands. They're harmless to leave running.

### First-time git setup

This scaffold is filesystem-only. There's a stub `.git/` directory left over
from an aborted init — remove it first, then init cleanly:

```powershell
cd E:\Tcg\TcgStudio
Remove-Item -Recurse -Force .git
Remove-Item .\apps\designer\.write-test.txt.delete-me -ErrorAction SilentlyContinue
git init -b main
git add .
git commit -m "chore: initial scaffold"
```

## Roadmap (short)

The full roadmap is in spec section 53. The next milestones for this repo:

1. Card Type Designer v0 — canvas, layers, properties inspector, save/load JSON,
   PNG export. (in progress)
2. Card data editor — schema-driven form, live preview against the type designer.
3. Asset library — upload, tag, swap.
4. Variant rules — visible-when conditions wired to layers.
5. Validation engine — overflow / missing asset / schema checks.
6. Backend bootstrap — Postgres, Prisma, GraphQL gateway, tenant context.

## License

Not yet selected.
