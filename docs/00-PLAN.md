# Build Plan — Payroll Event Processing Service

> Execution plan. Follow it top to bottom. Every phase ends with a Definition of
> Done and a commit. Nothing in a later phase depends on unwritten earlier code.
>
> Companion docs:
> - `01-DESIGN-DECISIONS.md` — *what the assignment asked* vs *what I built and why*
> - `02-INTERVIEW-PREP.md` — walkthroughs + likely questions with answers
> - `architecture.md` — diagrams
>
> **Conventions are inherited from `caregiver-platform/apps/backend`** — same
> module layout, same repository pattern, same response envelope, same logger,
> same TypeORM/migration setup. Familiar structure means faster building and a
> repo that reads like a real codebase.

---

## 0. The one-paragraph summary of the system

An HTTP API accepts a payroll event, validates it against a **per-type DTO
resolved from a handler registry**, persists it to Postgres in a transaction, and
enqueues **one BullMQ job per event** — then returns `202 Accepted`. A separate
worker process consumes the job, enforces **per-employee FIFO ordering** and
**mutual exclusion** with a Postgres advisory lock taken on a TypeORM
`QueryRunner`, calls a **simulated external payroll provider**, and commits the
business change together with an **idempotency ledger row** in a single
transaction. Transient failures retry with exponential backoff; permanent
failures stop immediately. A reconciliation cron re-queues anything dropped
between Postgres and Redis. A small React frontend makes all of it visible.

---

## 1. Repository layout

Mirrors `caregiver-platform/apps/backend` deliberately: `modules/` + `common/` +
`shared/` + `config/` + `database/`, Dockerfiles under `docker/`, apps under
`apps/`. **No Nx** — plain npm workspaces. Nx earns its keep at 3+ apps with a
shared lib graph; here it is scope the assignment explicitly told you not to add.

```
payroll-event-processing-service/
├── package.json                       # npm workspaces: apps/*
├── tsconfig.base.json
├── docker-compose.yml                 # root, so `docker compose up` just works
├── docker-compose.test.yml            # postgres+redis only, for local integration tests
├── .env.example
├── .github/workflows/ci.yml
├── README.md
├── docs/                              # these four docs
├── docker/
│   ├── backend/Dockerfile             # multi-stage; ONE image, TWO commands
│   └── frontend/Dockerfile
└── apps/
    ├── backend/
    │   ├── package.json               # scripts mirror caregiver: migration:generate/run/revert
    │   ├── nest-cli.json  .prettierrc  eslint.config.mjs
    │   ├── src/
    │   │   ├── main.ts                # API bootstrap    (NestFactory.create)
    │   │   ├── worker.main.ts         # worker bootstrap (createApplicationContext)
    │   │   ├── app.module.ts
    │   │   ├── worker.module.ts
    │   │   ├── config/
    │   │   │   ├── database.config.ts     # createDataSource(configService)
    │   │   │   ├── typeorm.config.ts      # standalone DataSource for the CLI
    │   │   │   ├── redis.config.ts
    │   │   │   ├── queue.config.ts        # queue name, job options, backoff
    │   │   │   └── env.validation.ts      # fail-fast env check at boot
    │   │   ├── database/
    │   │   │   ├── database.module.ts     # @Global, provides DataSource
    │   │   │   ├── migrations/            # committed, generated via CLI
    │   │   │   └── seeds/seed-employees.ts
    │   │   ├── common/
    │   │   │   ├── decorators/response-message.decorator.ts
    │   │   │   ├── enums/logging-tag.enum.ts
    │   │   │   ├── errors/                # PermanentPayrollError, TransientProviderError
    │   │   │   ├── filters/all-exceptions.filter.ts
    │   │   │   ├── interceptors/response-format.interceptor.ts
    │   │   │   └── interfaces/api-response.interface.ts
    │   │   ├── shared/
    │   │   │   ├── redis/                 # redis.module.ts, redis.service.ts, redis.constants.ts
    │   │   │   ├── services/custom-logger.service.ts
    │   │   │   └── utils/                 # iban.util, idempotency-key.util, seeded-random.util
    │   │   └── modules/
    │   │       ├── health/
    │   │       ├── events/                # the API surface
    │   │       │   ├── events.controller.ts
    │   │       │   ├── events.service.ts
    │   │       │   ├── events.repository.ts
    │   │       │   ├── events.module.ts
    │   │       │   ├── dtos/              # CreateEventDto, EventResponseDto, ListEventsQueryDto
    │   │       │   ├── entities/          # payroll-event.entity.ts, event-status-history.entity.ts
    │   │       │   ├── enums/             # event-status.enum.ts, failure-kind.enum.ts
    │   │       │   ├── interfaces/        # IEventsRepository
    │   │       │   └── swagger/event-decorators.ts
    │   │       ├── event-types/           # <-- EXTENSIBILITY LIVES HERE
    │   │       │   ├── event-types.module.ts
    │   │       │   ├── event-type.registry.ts
    │   │       │   ├── interfaces/payroll-event-handler.interface.ts
    │   │       │   ├── pipes/payroll-event-validation.pipe.ts
    │   │       │   └── handlers/
    │   │       │       ├── bank-account-change/   # dto + handler
    │   │       │       ├── address-change/
    │   │       │       └── salary-change/
    │   │       ├── processing/            # the worker side
    │   │       │   ├── processing.module.ts
    │   │       │   ├── payroll.processor.ts       # BullMQ WorkerHost
    │   │       │   ├── processing.service.ts      # orchestration
    │   │       │   ├── ordering.service.ts        # advisory lock + predecessor gate
    │   │       │   ├── apply.service.ts           # the single apply transaction
    │   │       │   ├── failure-classifier.ts
    │   │       │   ├── reconciliation.service.ts  # @Cron sweeper
    │   │       │   └── entities/payroll-application.entity.ts
    │   │       ├── payroll-state/
    │   │       │   ├── entities/           # employee-payroll-state.entity.ts, employee.entity.ts
    │   │       │   └── payroll-state.repository.ts
    │   │       └── provider/
    │   │           ├── provider.module.ts
    │   │           ├── simulated-payroll-provider.service.ts
    │   │           └── interfaces/payroll-provider.interface.ts
    │   └── test/
    │       ├── unit/  integration/  e2e/
    │       └── jest-e2e.json
    └── frontend/                       # Vite + React + TS
        └── src/{pages,components,api}
```

**Why one backend package with two entrypoints:** the assignment allows shared
code. One `package.json`, one image, two commands (`node dist/main` /
`node dist/worker.main`). Zero duplication, and the worker is still a genuinely
separate OS process with no HTTP server.

---

## 2. Tech choices (locked in)

| Concern | Choice | Reason |
|---|---|---|
| Framework | NestJS 11 | required |
| ORM / migrations | **TypeORM 0.3** | `QueryRunner` gives explicit connection-scoped transactions — exactly what `pg_advisory_xact_lock` needs. Migrations are reviewable TS files. Matches the caregiver-platform codebase. |
| Validation | **class-validator + class-transformer**, resolved through the handler registry | Nest-idiomatic, first-class Swagger via `@ApiProperty`, and matches the existing codebase. Per-type validation comes from the registry, not from a union type. |
| Queue | BullMQ + `@nestjs/bullmq` | required |
| Redis client | ioredis (via `shared/redis`) | same as caregiver-platform |
| Logging | `CustomLogger` + logging-tag enums | same as caregiver-platform; structured, taggable |
| Health | `@nestjs/terminus` | shallow liveness + deep readiness |
| API docs | `@nestjs/swagger` at `/api` | required-ish, and free |
| Tests | Jest + Supertest + Testcontainers | unit fast, integration real |
| Frontend | Vite + React + TS, plain CSS | minimal |
| Scheduling | `@nestjs/schedule` | reconciliation cron |

**Rejected, with reasons you must be able to give:**
- **Prisma** — the three statements this system's correctness depends on
  (`pg_advisory_xact_lock`, `INSERT … ON CONFLICT DO NOTHING RETURNING`, and the
  ordering query) would all go through `$queryRaw` escape hatches. An ORM that
  steps aside for the most important statements is carrying weight it does not
  earn here — and you give up Prisma's real strength, its migration DX, for
  nothing in return.
- **Drizzle** — technically the best fit (SQL-first, `onConflictDoNothing()`
  first-class, plain-SQL migrations, near-zero runtime). Rejected only on
  timebox risk: DIY Nest integration and an unfamiliar migration story inside a
  2–3 day assignment that ends in a live "modify your code" review. Name it as
  the choice you would make with more runway.
- **Nx** — earns its keep across many apps with a shared lib graph; here it is
  unnecessary scope.

---

## 3. Data model

Six entities. `@Entity('snake_plural')` table names with camelCase columns —
same convention as caregiver-platform, so quoted identifiers throughout.

```ts
// modules/events/enums/event-status.enum.ts
export enum EventStatus {
  PENDING = 'PENDING',                 // persisted, not yet on the queue
  QUEUED = 'QUEUED',                   // job added to BullMQ
  PROCESSING = 'PROCESSING',           // a worker holds it
  AWAITING_RETRY = 'AWAITING_RETRY',   // transient failure, backoff scheduled
  SUCCEEDED = 'SUCCEEDED',             // terminal
  FAILED = 'FAILED',                   // terminal (see failureKind)
}
export enum FailureKind {
  PERMANENT = 'PERMANENT',                   // retrying can never help
  RETRIES_EXHAUSTED = 'RETRIES_EXHAUSTED',   // transient errors that never cleared
}
```

```ts
@Entity('payroll_events')
@Index(['employeeId', 'sequence'])
@Index(['status'])
export class PayrollEvent {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'varchar', length: 128, unique: true })
  idempotencyKey: string;                       // the dedupe boundary

  @Column({ type: 'bigint' })
  @Generated('increment')
  sequence: string;                             // acceptance order. NOTE: pg bigint -> JS string

  @Column({ type: 'varchar', length: 64 }) employeeId: string;
  @Column({ type: 'varchar', length: 64 }) type: string;   // varchar, NOT a pg enum — see R10
  @Column({ type: 'date' })                 effectiveDate: string;
  @Column({ type: 'jsonb' })                payload: Record<string, unknown>;

  @Column({ type: 'enum', enum: EventStatus, default: EventStatus.PENDING })
  status: EventStatus;

  @Column({ type: 'int', default: 0 })            attemptCount: number;
  @Column({ type: 'enum', enum: FailureKind, nullable: true }) failureKind: FailureKind | null;
  @Column({ type: 'varchar', length: 64, nullable: true })     lastErrorCode: string | null;
  @Column({ type: 'text', nullable: true })                    lastErrorMessage: string | null;
  @Column({ type: 'jsonb', nullable: true })                   lastErrorDetail: unknown;
  @Column({ type: 'jsonb', nullable: true })                   result: unknown;

  @CreateDateColumn() createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) queuedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) processingStartedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) completedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) nextRetryAt: Date | null;

  @OneToMany(() => EventStatusHistory, (h) => h.event) history: EventStatusHistory[];
  @OneToOne(() => PayrollApplication, (a) => a.event)  application: PayrollApplication | null;
}
```

```ts
@Entity('event_status_history')            // append-only audit trail
@Index(['eventId', 'createdAt'])
export class EventStatusHistory {
  @PrimaryGeneratedColumn('increment') id: string;
  @Column({ type: 'uuid' }) eventId: string;
  @Column({ type: 'enum', enum: EventStatus, nullable: true }) fromStatus: EventStatus | null;
  @Column({ type: 'enum', enum: EventStatus }) toStatus: EventStatus;
  @Column({ type: 'int', default: 0 }) attempt: number;
  @Column({ type: 'text', nullable: true }) message: string | null;
  @Column({ type: 'jsonb', nullable: true }) metadata: unknown;
  @CreateDateColumn() createdAt: Date;
  @ManyToOne(() => PayrollEvent, (e) => e.history) @JoinColumn({ name: 'eventId' }) event: PayrollEvent;
}
```

```ts
@Entity('payroll_applications')            // THE exactly-once ledger
export class PayrollApplication {
  @PrimaryColumn({ type: 'uuid' }) eventId: string;   // PK == unique constraint == the guarantee
  @Column({ type: 'varchar', length: 64 }) employeeId: string;
  @Column({ type: 'varchar', length: 64, nullable: true }) externalRef: string | null;
  @CreateDateColumn() appliedAt: Date;
  @Column({ type: 'jsonb', nullable: true }) snapshotBefore: unknown;
  @OneToOne(() => PayrollEvent, (e) => e.application) @JoinColumn({ name: 'eventId' }) event: PayrollEvent;
}
```

```ts
@Entity('employee_payroll_states')         // current materialised state
export class EmployeePayrollState {
  @PrimaryColumn({ type: 'varchar', length: 64 }) employeeId: string;
  @Column({ type: 'varchar', length: 34, nullable: true }) iban: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) street: string | null;
  @Column({ type: 'varchar', length: 128, nullable: true }) city: string | null;
  @Column({ type: 'varchar', length: 16,  nullable: true }) postalCode: string | null;
  @Column({ type: 'char',    length: 2,   nullable: true }) country: string | null;
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true }) salaryAmount: string | null;
  @Column({ type: 'char', length: 3, nullable: true }) salaryCurrency: string | null;
  @Column({ type: 'uuid', nullable: true }) lastAppliedEventId: string | null;
  @Column({ type: 'date', nullable: true }) lastEffectiveDate: string | null;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('employees')                       // seed data, so "unknown employee" is a real failure
export class Employee {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id: string;
  @Column({ type: 'varchar', length: 128 }) fullName: string;
  @Column({ type: 'boolean', default: true }) active: boolean;
  @CreateDateColumn() createdAt: Date;
}
```

**Three TypeORM gotchas to handle deliberately** (each is an interview talking point):
1. **`bigint` comes back as a string** from node-postgres. Never compare
   `sequence` in JS — do the comparison in SQL, inside the ordering gate query.
2. **`numeric` also comes back as a string.** Good — money should never touch a
   JS `number`. Keep it a string end to end, or use a `decimal.js` transformer.
3. **`synchronize` is `false` in every environment, always.** Caregiver-platform
   allows it in development; this project does not. A reviewer runs
   `migration:run`, and `synchronize: true` hides schema drift until it breaks
   for someone else. Say this out loud — it is a small, concrete judgement call.

---

## 4. Phases

### Phase 1 — Skeleton & infrastructure (~3h)

1. Root `package.json` with npm workspaces (`apps/*`), then `nest new apps/backend`.
   Deps: `typeorm pg @nestjs/typeorm`, `bullmq @nestjs/bullmq`, `ioredis`,
   `class-validator class-transformer`, `@nestjs/swagger`, `@nestjs/terminus`,
   `@nestjs/schedule`, `@nestjs/config`.
2. Copy the conventions across from caregiver-platform (adapt, don't blind-copy):
   `common/interfaces/api-response.interface.ts`,
   `common/interceptors/response-format.interceptor.ts`,
   `common/filters/all-exceptions.filter.ts`,
   `common/decorators/response-message.decorator.ts`,
   `common/enums/logging-tag.enum.ts`,
   `shared/services/custom-logger.service.ts`,
   `shared/redis/*`,
   `config/database.config.ts` + `config/typeorm.config.ts`,
   `database/database.module.ts`.
   **Change from the original:** `synchronize: false` unconditionally.
3. `config/env.validation.ts` — validate at boot, fail fast:
   `DATABASE_URL, REDIS_HOST, REDIS_PORT, PORT, NODE_ENV, LOG_LEVEL,
   PROVIDER_FAILURE_RATE, PROVIDER_LATENCY_MS, JOB_ATTEMPTS, JOB_BACKOFF_MS,
   WORKER_CONCURRENCY, STUCK_EVENT_TIMEOUT_MS`.
4. Entities + first migration:
   `npm run migration:generate --name=InitialSchema` then `migration:run`.
   Commit the migration file.
5. `database/seeds/seed-employees.ts` — 5 employees, one of them `active: false`
   so the inactive-employee permanent failure is demonstrable.
6. `modules/health` with terminus: `GET /health` (process) and
   `GET /health/ready` (`TypeOrmHealthIndicator` + a Redis ping + queue reachable).
7. `docker-compose.yml`: postgres:16 + redis:7 **with healthchecks**, a one-shot
   `migrate` service running `migration:run:prod` and exiting, then `api`,
   `worker`, `frontend`. The `worker` service maps **no ports** — that alone
   demonstrates background processing is not tied to HTTP.
8. `docker/backend/Dockerfile` — multi-stage (`builder` → `production`),
   non-root user, workspace-aware `npm ci`, matching the caregiver Dockerfile
   shape. Two compose services, one image, different `command:`.

**DoD:** `docker compose up` → all healthy; `curl :3000/health/ready` → 200 with
db and redis up. Commit.

---

### Phase 2 — Event type registry + validation (~3h)

Build this **before** the controller so the controller can never grow a `switch`.

1. The handler contract:
   ```ts
   // modules/event-types/interfaces/payroll-event-handler.interface.ts
   export interface IPayrollEventHandler<TDto extends BasePayrollEventDto = BasePayrollEventDto> {
     readonly type: string;
     /** class-validator DTO for this type. Used by the pipe AND by Swagger. */
     readonly dto: new () => TDto;
     /** Business rules needing DB access. Throw PermanentPayrollError. */
     validate(manager: EntityManager, payload: TDto): Promise<void>;
     /** Mutate business state. Runs INSIDE the apply transaction. */
     apply(manager: EntityManager, event: PayrollEvent, payload: TDto): Promise<void>;
   }
   export const PAYROLL_EVENT_HANDLER = Symbol('PAYROLL_EVENT_HANDLER');
   ```
2. `EventTypeRegistry` injects `@Inject(PAYROLL_EVENT_HANDLER) handlers: IPayrollEventHandler[]`
   (a NestJS **multi-provider** array), indexes by `type`, and throws
   `UnknownEventTypeError` on a miss. Exposes `types()` for Swagger and the frontend.
3. DTOs — a shared base plus one per type:
   ```ts
   export abstract class BasePayrollEventDto {
     @ApiProperty({ example: 'EMP-001' }) @IsString() @IsNotEmpty()  employeeId: string;
     @ApiProperty({ example: '2026-09-01' }) @IsDateString()          effectiveDate: string;
   }
   export class SalaryChangeDto extends BasePayrollEventDto {
     @ApiProperty({ example: 5200.5 }) @IsNumber() @IsPositive()      newSalary: number;
     @ApiProperty({ example: 'EUR' })  @IsIn(SUPPORTED_CURRENCIES)    currency: string;
   }
   ```
   Bank account: `@IsIBAN()` (class-validator has it built in) plus a mod-97
   check in a `shared/utils/iban.util.ts` so the rule is unit-testable on its own.
   Address: `street`, `city`, `postalCode`, `@IsISO31661Alpha2() country`.
4. `PayrollEventValidationPipe` — the piece that makes extensibility real:
   ```ts
   async transform(body: any) {
     const handler = this.registry.get(body.type);            // unknown -> 400
     const dto = plainToInstance(handler.dto, body, { excludeExtraneousValues: false });
     const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
     if (errors.length) throw new BadRequestException(toFieldErrors(errors));
     return { type: handler.type, dto };
   }
   ```
   **Request body stays flat** (`{ type, employeeId, effectiveDate, ...typeSpecific }`)
   to match the assignment's examples. The three common fields become real
   columns; the rest is stored in `payload` jsonb.
5. Swagger for a polymorphic body: `@ApiExtraModels(...dtos)` +
   `@ApiBody({ schema: { oneOf: refs(...dtos) } })` with one example per type.
6. Global `AllExceptionsFilter` + `ResponseFormatInterceptor` wired in `main.ts`
   (same envelope as caregiver-platform: `success / message / data / timestamp /
   path / statusCode`).

**DoD:** unit tests — each DTO accepts a valid payload and rejects each
missing/invalid field; the registry throws on an unknown type; the pipe returns a
field-level error list. Commit.

---

### Phase 3 — Submission API + idempotency (~3h)

1. `POST /events`
   - read the optional `Idempotency-Key` header;
   - if absent, **derive** one:
     `sha256(type | employeeId | effectiveDate | canonicalJson(payload))` →
     `shared/utils/idempotency-key.util.ts`;
   - inside `dataSource.transaction()` (or a QueryRunner, matching the caregiver
     repository style): insert `PayrollEvent` + first `EventStatusHistory(→ PENDING)`;
   - catch the Postgres unique violation (`error.code === '23505'`) → load the
     existing row → return **200** with `duplicate: true` and the original event;
   - **after commit**, `queue.add('process-event', { eventId }, { jobId: eventId, attempts: JOB_ATTEMPTS, backoff: { type: 'exponential', delay: JOB_BACKOFF_MS }, removeOnComplete: { age: 3600 }, removeOnFail: false })`,
     then update `status = QUEUED, queuedAt = now()`;
   - respond `202 Accepted` with `{ id, status, type, employeeId, submittedAt, statusUrl }`.
2. `GET /events/:id` → full detail with `history[]`, `attemptCount`,
   `failureKind`, `lastError*`, `result`. 404 through the standard envelope.
3. `GET /events?status=&type=&employeeId=&page=&limit=` → paginated list
   (reuse the `PaginatedData<T>` shape from caregiver-platform).
4. `GET /events/stream` → `@Sse` fed by a Redis pub/sub channel the worker
   publishes to. Frontend falls back to 2s polling if SSE drops.
5. Swagger at `/api`; `docs/api-examples.http` with curl equivalents.
6. Repository pattern: `events.repository.ts` implementing `IEventsRepository`,
   with `...WithQueryRunner(queryRunner, …)` methods for the transactional ones —
   same shape as `booking-caregiver.repository.ts`.

**DoD:** functional tests (Supertest, real DB, queue spied): valid → 202 and a
PENDING/QUEUED row; the same body twice → one row, second response 200
`duplicate: true`; invalid → 400 with field errors; unknown type → 400; missing
id → 404. Commit.

---

### Phase 4 — Worker, provider simulation, failure classification (~4h)

1. `worker.main.ts`:
   ```ts
   const app = await NestFactory.createApplicationContext(WorkerModule);
   app.enableShutdownHooks();
   ```
   `WorkerModule` imports `DatabaseModule`, `RedisModule`, `EventTypesModule`,
   `ProcessingModule`, `ProviderModule` — everything except the controllers.
2. `SimulatedPayrollProviderService implements IPayrollProvider`:
   - sleeps `PROVIDER_LATENCY_MS` with jitter;
   - **deterministic** failure injection — a seeded PRNG over
     `hash(eventId + attempt)` compared against `PROVIDER_FAILURE_RATE`, throwing
     `TransientProviderError('PROVIDER_UNAVAILABLE')`;
   - honours a demo/test escape hatch in the payload:
     `__simulate: { fail: 'transient' | 'permanent', untilAttempt: n }`;
   - returns `{ externalRef: 'EXT-' + shortHash(eventId), acceptedAt }`;
   - **takes `event.id` as its own idempotency key** — mirrors a real provider
     API, and makes a replayed call a no-op on their side too.
3. `failure-classifier.ts` → `{ kind: 'TRANSIENT' | 'PERMANENT', code, message }`:
   - `PermanentPayrollError` subclasses → PERMANENT (unknown employee, inactive
     employee, currency mismatch with existing state, effective date out of
     policy, unsupported IBAN country);
   - `TransientProviderError`, timeouts, `ECONNRESET`, simulated 5xx → TRANSIENT;
   - anything unrecognised → TRANSIENT, deliberately. Retrying an unknown error
     is safer than permanently discarding a real payroll change. Document the bias.
4. `PayrollProcessor extends WorkerHost`:
   ```
   process(job):
     event = repo.findById(job.data.eventId)
     if status is SUCCEEDED or FAILED -> return early (idempotent no-op)
     mark PROCESSING (+history, attempt = job.attemptsMade + 1)
     [ordering gate — Phase 5]
     handler = registry.get(event.type)
     await handler.validate(manager, payload)      // permanent errors surface here
     result  = await provider.submit(event)        // transient errors surface here
     await applyService.apply(event, handler, result)   // Phase 6
     publish SSE
   catch e:
     c = classify(e)
     if c.kind === PERMANENT:
        mark FAILED + failureKind=PERMANENT (+history, error fields)
        throw new UnrecoverableError(c.message)    // BullMQ stops retrying
     if job.attemptsMade + 1 >= job.opts.attempts:
        mark FAILED + failureKind=RETRIES_EXHAUSTED (+history); throw e
     mark AWAITING_RETRY + nextRetryAt (+history); throw e   // BullMQ backs off
   ```
   Invariant to state in the review: **the DB row is written before the throw**,
   so the persisted status never disagrees with the queue's decision.
5. Worker options: `concurrency: WORKER_CONCURRENCY`, `lockDuration: 30_000`,
   `stalledInterval: 15_000`, `maxStalledCount: 2`.
6. `QueueEvents` listeners log `completed`, `failed`, `stalled` through
   `CustomLogger` with a `ProcessingTag` logging enum — `stalled` at WARN with
   the event id is the "important recovery behavior" log the assignment asks for.

**DoD:** integration tests — `__simulate: { fail: 'transient', untilAttempt: 3 }`
ends SUCCEEDED with `attemptCount = 3`; `fail: 'permanent'` ends FAILED/PERMANENT
after exactly one attempt. Commit.

---

### Phase 5 — Ordering + concurrency (~3h)

Two separate problems. Do not conflate them.

**(a) Mutual exclusion** — two workers must never process one employee at once.
**(b) FIFO ordering** — an event must not overtake an earlier-accepted sibling.

Both are checked in one short `QueryRunner` transaction — and this is exactly why
TypeORM was chosen, because the lock and the check demonstrably share a connection:

```ts
// modules/processing/ordering.service.ts
const qr = this.dataSource.createQueryRunner();
await qr.connect();
await qr.startTransaction();
try {
  const [{ acquired }] = await qr.query(
    'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired', [employeeId],
  );
  if (!acquired) return { proceed: false, reason: 'employee-busy' };

  const blocked = await qr.query(
    `SELECT 1 FROM payroll_events
      WHERE "employeeId" = $1 AND "sequence" < $2
        AND status NOT IN ('SUCCEEDED', 'FAILED')
      LIMIT 1`,
    [employeeId, sequence],
  );
  if (blocked.length) return { proceed: false, reason: 'predecessor-pending' };

  await qr.commitTransaction();      // lock released here — it is xact-scoped
  return { proceed: true };
} finally { await qr.release(); }
```

**Defer** when `proceed === false`:
```ts
await job.moveToDelayed(Date.now() + backoff, token);
throw new DelayedError();
```
with `backoff = min(250ms * 2^deferCount, 5s) + jitter`. The deferral counter
lives in `job.data.deferCount`, **separate from the failure attempt counter**, so
waiting in line never burns a retry.

Cross-employee concurrency is untouched: the lock key is the employee id.

**Note the terminal-state condition:** a predecessor stuck in `FAILED` does not
block its successors forever. That is a **policy decision** — a failed address
change should not permanently block a salary change — and it is one line to
reverse. Put it in the README.

**DoD:** integration test — submit A(address) then B(salary) for employee E with a
slow provider and 4 concurrent workers; assert
`application.appliedAt(A) < application.appliedAt(B)` and that a different
employee's events overlap in time with E's. Commit.

---

### Phase 6 — Exactly-once apply + recovery (~3h)

1. `apply.service.ts` — the whole apply is **one** transaction:
   ```ts
   await this.dataSource.transaction(async (manager) => {
     await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [event.employeeId]);

     const inserted = await manager.query(
       `INSERT INTO payroll_applications ("eventId", "employeeId", "externalRef", "snapshotBefore")
        VALUES ($1, $2, $3, $4)
        ON CONFLICT ("eventId") DO NOTHING
        RETURNING "eventId"`,
       [event.id, event.employeeId, result.externalRef, snapshotBefore],
     );

     if (inserted.length === 0) {
       // A previous attempt already applied this event. Skip the mutation.
       this.logger.warn(ProcessingTag.IDEMPOTENT_REPLAY, 'apply skipped', { eventId: event.id });
     } else {
       await handler.apply(manager, event, payload);          // upsert employee_payroll_states
     }

     await manager.update(PayrollEvent, event.id, {
       status: EventStatus.SUCCEEDED, result, completedAt: new Date(),
     });
     await manager.insert(EventStatusHistory, { /* -> SUCCEEDED */ });
   });
   ```
   **Raw SQL for the ledger insert on purpose:** `ON CONFLICT DO NOTHING` +
   `RETURNING` gives an unambiguous "was it inserted" signal. TypeORM's
   `.orIgnore()` query-builder form works too, but `InsertResult.raw` semantics
   are easy to get subtly wrong — and this one statement *is* the correctness
   guarantee, so it should be unmistakable in review.

   Crash before commit → nothing happened, clean retry. Crash after commit but
   before BullMQ acks → job retried, the ledger insert returns 0 rows, no double
   apply. **Requirement 8, solved by one primary key.**
2. Short-circuit the provider too: if a `PayrollApplication` row already exists,
   skip the external call entirely on replay.
3. `reconciliation.service.ts` — `@Cron(CronExpression.EVERY_MINUTE)`, guarded by
   a Redis `SET NX PX` lock so exactly one instance runs it:
   - **orphaned PENDING**: `status = PENDING AND createdAt < now() - 30s` →
     enqueue (covers "DB committed but the enqueue never happened");
   - **stuck PROCESSING**: `status = PROCESSING AND processingStartedAt < now() - STUCK_TIMEOUT`
     **and** no BullMQ job with that id in any state → reset to `PENDING`, write
     history `recovered-from-stale-processing`, re-enqueue;
   - **queue drift**: any non-terminal status with no job in Redis → re-enqueue.
   Every action logs at WARN with a count; surface the counters on `/health/ready`.
4. Graceful shutdown: `SIGTERM` → `worker.close()` (finishes the in-flight job) →
   Nest shutdown hooks → `dataSource.destroy()`. `stop_grace_period: 30s` in compose.

**DoD:** integration tests — (i) run apply twice for one event → one
`payroll_applications` row, salary applied once; (ii) force an event to
PROCESSING with an old timestamp and no job → the cron recovers it to SUCCEEDED;
(iii) insert a PENDING event without enqueueing → the cron picks it up. Commit.

---

### Phase 7 — Frontend (~4h)

Vite + React + TS. Three screens plus a demo strip.

1. **Submit** — the type dropdown drives the field set (fetched from
   `GET /events/types`, which the registry exposes — so a new backend event type
   appears in the UI with no frontend change). Shows the exact request body and
   the raw response.
2. **Events list** — short id, type, employeeId, status badge, attempts, created,
   updated. Live via SSE; the badge flashes on change so transitions are
   *visibly* observable (an explicit requirement).
3. **Event detail** — payload JSON, a **status timeline** from `history[]` with
   timestamps and attempt numbers, a failure box (code + message + detail) on
   failure, a result box with `externalRef` on success.
4. **Demo panel** — one strip on the list page. This is what sells the backend:
   - `Submit duplicate` → shows 200 `duplicate: true` and no new row;
   - `Ordering demo` → 3 events for one employee, completing strictly in order;
   - `Force transient failure` / `Force permanent failure` → sets `__simulate`;
   - `Burst: 20 events / 5 employees` → cross-employee parallelism.

**DoD:** `docker compose up` → the frontend talks to the API; all four flows
demonstrable. Commit.

---

### Phase 8 — Tests to completion (~4h)

| Layer | Covers | Runs with |
|---|---|---|
| **Unit** | DTO validation rules, IBAN mod-97, idempotency-key derivation, failure classifier, backoff maths, registry lookup | nothing — pure functions |
| **Integration** | apply-transaction idempotency, advisory-lock serialization, ordering-gate SQL, reconciliation queries | real Postgres (Testcontainers) + Redis |
| **Functional (API)** | Supertest through the Nest app with a spied queue: 202 / 200-duplicate / 400 / 404 envelopes | real DB |
| **E2E** | `docker compose up`, POST over HTTP, poll until terminal, assert `employee_payroll_states` changed exactly once | full compose stack |
| **Concurrency** | 4 in-process workers, 50 events, 5 employees → per-employee ordering holds, one ledger row each | Testcontainers |

Determinism rule: **no test depends on the random failure rate.**
`PROVIDER_FAILURE_RATE=0` in tests; failures come from `__simulate`. Random
failure is a demo feature, not a test mechanism.

**DoD:** `npm run test:unit`, `test:integration`, `test:e2e` green locally.

---

### Phase 9 — CI (~2h)

`.github/workflows/ci.yml`, on `push` and `pull_request`, with
`concurrency: cancel-in-progress` (same pattern as the caregiver workflow, but
**without `continue-on-error` on lint** — the pipeline is supposed to block a
merge, so no job may be advisory):

```
jobs:
  quality:      eslint + prettier --check + tsc --noEmit
  unit:         npm run test:unit -- --coverage           (needs: quality)
  integration:  services: postgres:16, redis:7 (healthchecked)
                migration:run -> test:integration -> test:e2e
  migrations:   typeorm migration:generate --check        (entity/migration drift)
  build:        docker build backend + frontend
  frontend:     npm ci && tsc --noEmit && npm run build
```

- The **drift check** is the one people forget: it catches an entity edited
  without a generated migration, which passes every test locally (your DB is
  already migrated) and then breaks `docker compose up` for the reviewer.
  Verify the exact flag against your installed TypeORM 0.3.x; `migration:show`
  plus a non-empty-diff assertion is the fallback.
- README states these are the required status checks under branch protection —
  that is *how* the pipeline prevents a merge.

**DoD:** a green run on GitHub, linked from the README, on a real PR.

---

### Phase 10 — Documentation & polish (~3h)

1. `README.md`: What it is → Quick start (`docker compose up`) → Architecture +
   diagram → Event lifecycle → Data model → Background processing design →
   Reliability guarantees (one subsection per requirement 4–9) → API docs → Env
   var table → Running tests → Migrations → CI → Trade-offs and next steps.
2. Diagram — Mermaid in the README (renders on GitHub), ASCII in `docs/architecture.md`.
3. Final pass: no stray `console.log`, every catch handled or logged,
   `.env.example` complete, and `docker compose down -v && docker compose up`
   works from a clean clone.

---

## 5. Suggested schedule

| Day | Phases | Outcome |
|---|---|---|
| **Day 1** | 1, 2, 3 | API accepts, validates, persists, dedupes, documents. Testable with no worker. |
| **Day 2** | 4, 5, 6 | The real engineering: async processing, retries, ordering, exactly-once, recovery. |
| **Day 3** | 7, 8, 9, 10 | Frontend, tests, CI green, README. |

Short on time: **cut frontend polish and SSE (poll instead)**. Never cut Phase 6
or the Phase 8 tests — those are exactly what is being graded.

---

## 6. Commit discipline

One commit per phase minimum, conventional-commit style, on `feat/*` branches
merged via PR so the pipeline is visibly gating a merge.

```
chore: scaffold nest backend with typeorm, redis and docker compose
feat(events): accept payroll events with registry-driven validation
feat(worker): process events via bullmq with typed failure classification
feat(processing): enforce per-employee ordering with advisory locks
feat(processing): exactly-once apply via payroll_applications ledger
feat(recovery): reconcile orphaned and stale events
test(integration): concurrency and idempotency coverage
ci: lint, typecheck, unit, integration, migration drift, docker build
docs: architecture, decisions, api examples
```
