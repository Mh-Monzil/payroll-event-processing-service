# Docs index

| Doc | Read it when |
|---|---|
| [00-PLAN.md](00-PLAN.md) | You are building. Phases 1–10, definition of done per phase, schedule, commit plan. |
| [01-DESIGN-DECISIONS.md](01-DESIGN-DECISIONS.md) | You need *why*. Every assignment requirement R1–R12 mapped to what was built, the reasoning, and the trade-off — plus the stack choice (TypeORM over Prisma/Drizzle) and the project-structure rationale. Source material for the README. |
| [02-INTERVIEW-PREP.md](02-INTERVIEW-PREP.md) | Before the technical review. Lifecycle walkthroughs, their listed questions with spoken answers, hard follow-ups, and a 5-minute demo script. |
| [architecture.md](architecture.md) | Diagrams: component flow, state machine, and where each reliability guarantee lives. Inline the Mermaid into the root README. |

## Submission checklist tracker

Tick these off as you go. They come straight from the assignment.

- [ ] GitHub repository link
- [ ] Minimal frontend demonstration (submit · list · detail · visible state changes)
- [ ] README with setup instructions (install, env vars, Docker, migrations, API, worker, tests)
- [ ] Working Docker setup (`docker compose up` from a clean clone)
- [ ] Database schema and migrations (committed, drift-checked in CI)
- [ ] Automated tests (unit · integration · functional · e2e)
- [ ] GitHub Actions workflow (green run, used as required checks)
- [ ] API documentation (Swagger at `/docs` + curl examples)
- [ ] Short architecture/design explanation (diagram + decisions)

## Requirement coverage tracker

All paths are relative to `apps/backend/src/`.

| # | Requirement | Where it is implemented | Test |
|---|---|---|---|
| 1 | Event submission | `modules/events/events.{controller,service}.ts` | `e2e/submit.e2e-spec.ts` |
| 2 | Event status | `GET /events/:id` + `modules/events/entities/event-status-history.entity.ts` | `e2e/api-errors.e2e-spec.ts` |
| 3 | Async processing | `modules/processing/payroll.processor.ts`, `modules/provider/simulated-payroll-provider.service.ts` | `integration/processing.integration-spec.ts` |
| 4 | Temporary vs permanent failure | `modules/processing/failure-classifier.ts`, `common/errors/` | `integration/retry.integration-spec.ts`, `integration/permanent-failure.integration-spec.ts` |
| 5 | Duplicate requests | `UNIQUE(idempotencyKey)` + `jobId = eventId`; `shared/utils/idempotency-key.util.ts` | `e2e/duplicate-submission.e2e-spec.ts` |
| 6 | Multiple workers | `modules/processing/ordering.service.ts` (advisory lock) + ledger PK | `integration/concurrency.integration-spec.ts` |
| 7 | Worker failure & recovery | BullMQ stalled detection + `modules/processing/reconciliation.service.ts` | `integration/recovery.integration-spec.ts` |
| 8 | Processing consistency | `modules/processing/apply.service.ts` + `payroll_applications` PK | `integration/idempotent-apply.integration-spec.ts` |
| 9 | Event ordering | `sequence` column + `modules/processing/ordering.service.ts` | `integration/ordering.integration-spec.ts` |
| 10 | Extensibility | `modules/event-types/` + `event-type.registry.ts` | `unit/event-type.registry.spec.ts` |
| 11 | Validation | `modules/event-types/pipes/payroll-event-validation.pipe.ts` (API) + `handler.validate()` (worker) | `unit/validation.spec.ts` |
| 12 | History & audit | `event_status_history`, `payroll_applications`, `shared/services/custom-logger.service.ts` | `integration/audit.integration-spec.ts` |
