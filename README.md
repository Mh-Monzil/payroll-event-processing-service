# Payroll Event Processing Service

A backend service that accepts employee payroll events over HTTP and processes
them asynchronously — reliably, exactly once, and in order per employee — even
when the external payroll system is slow or unavailable, when clients retry, and
when workers crash or run in parallel.

> **Status:** in progress. This README grows with the implementation; the full
> architecture write-up lands in the final step. Planning and design rationale
> live in [`docs/`](docs/).

## Stack

Node.js · TypeScript · NestJS · PostgreSQL (TypeORM) · Redis · BullMQ · Docker

## Quick start

```bash
docker compose up
```

That starts Postgres, Redis, runs migrations and seeds, then boots the API and a
worker.

| What | Where |
|---|---|
| API | http://localhost:3000 |
| Swagger / OpenAPI | http://localhost:3000/api |
| Liveness | `GET /health` |
| Readiness (checks Postgres + Redis) | `GET /health/ready` |

Run more workers to demonstrate multi-worker correctness:

```bash
docker compose up --scale worker=3
```

## Local development (without Docker for the app)

```bash
cp .env.example .env
docker compose up -d postgres redis    # infrastructure only
npm install
npm run migration:run
npm run seed
npm run start:api                      # terminal 1
npm run start:worker                   # terminal 2
```

## Scripts

| Command | Does |
|---|---|
| `npm run build` | Compile the backend |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | All tests |
| `npm run migration:generate -- src/database/migrations/<Name>` | Generate a migration from entity changes |
| `npm run migration:run` | Apply pending migrations |
| `npm run migration:revert` | Roll back the last migration |
| `npm run seed` | Seed reference employees |

## Repository layout

```
apps/backend      NestJS API + worker (one codebase, two entrypoints)
apps/frontend     minimal React demo UI
docker/           Dockerfiles
docs/             plan, design decisions, architecture
```

## Documentation

| Document | What it covers |
|---|---|
| [docs/00-PLAN.md](docs/00-PLAN.md) | Build plan, phase by phase |
| [docs/01-DESIGN-DECISIONS.md](docs/01-DESIGN-DECISIONS.md) | Every requirement mapped to what was built and why |
| [docs/02-INTERVIEW-PREP.md](docs/02-INTERVIEW-PREP.md) | Walkthroughs of the important flows |
| [docs/architecture.md](docs/architecture.md) | Diagrams and the event state machine |
