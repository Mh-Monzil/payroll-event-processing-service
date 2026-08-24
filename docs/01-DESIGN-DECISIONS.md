# Requirements → Solution Map

> For every line in the assignment: **what they asked**, **what I built**,
> **why I chose that**, and **what I gave up**.
> Each entry ends with a short Banglish note (`BN:`) so you can recall the idea fast.

---

## Legend

| Marker | Meaning |
|---|---|
| **ASKED** | Verbatim-ish requirement from the PDF |
| **BUILT** | The concrete thing in this repo |
| **WHY** | The reasoning you must be able to defend |
| **TRADE-OFF** | What the alternative was and why it lost |
| **PROOF** | The test / endpoint / file that demonstrates it |

---

## R1 — Event Submission

**ASKED:** `POST /events`. Validate, persist, accept for processing, return a
useful response. The HTTP request must not stay open while processing runs.

**BUILT:**
- `POST /events` -> validate (per-type DTO resolved from the handler registry) ->
  `INSERT` inside a transaction ->
  `202 Accepted` with `{ id, status: 'QUEUED', statusUrl: '/events/<id>' }`.
- The BullMQ job is added **after** the DB transaction commits.
- The API process never touches the payroll provider.

**WHY:** `202` is the honest status code — the server has accepted the event for
later processing, not completed it. Returning a `statusUrl` makes the async
contract explicit to the client. Persisting *before* enqueueing means the DB is
the source of truth; Redis only holds a pointer (`{ eventId }`), never the
payload.

**TRADE-OFF:** enqueue-after-commit leaves a small window where the row is
committed but the job was never added (API crashes in between). I did **not**
solve that with a full transactional outbox — I solved it with the reconciliation
cron (see R7), which re-queues `PENDING` rows older than 30s. An outbox table +
relay would be the production answer at higher volume; for this scope the cron is
the same guarantee with a fraction of the machinery.

**PROOF:** `test/e2e/submit.e2e-spec.ts`, `events.service.ts`.

`BN:` API শুধু save করে আর queue-তে id ফেলে, সাথে সাথে 202 ফেরত দেয় — provider call API-তে হয় না।

---

## R2 — Event Status

**ASKED:** `GET /events/:id` showing what was submitted, current state, success
or failure, and result/failure info.

**BUILT:** one response object containing the submitted payload, `status`,
`attemptCount`, `failureKind`, `lastErrorCode` / `lastErrorMessage` /
`lastErrorDetail`, `result` (with `externalRef`), all lifecycle timestamps, and
the full `history[]` array.

**State machine (chosen deliberately — 6 states, 2 terminal):**

```
                    ┌──────────────► SUCCEEDED  (terminal)
                    │
PENDING ─► QUEUED ─► PROCESSING ─┬─► FAILED (PERMANENT)          (terminal)
   ▲                   │         └─► FAILED (RETRIES_EXHAUSTED)  (terminal)
   │                   │
   │                   └─► AWAITING_RETRY ─┐
   │                            ▲          │
   └──── reconciliation ────────┴──────────┘
         (stale PROCESSING / orphaned PENDING)
```

- `PENDING` — committed to Postgres, not yet on the queue.
- `QUEUED` — job accepted by BullMQ.
- `PROCESSING` — a worker holds the lock and is working.
- `AWAITING_RETRY` — transient failure; `nextRetryAt` is populated.
- `SUCCEEDED` — the business change is applied; ledger row exists.
- `FAILED` — terminal, with `failureKind` distinguishing *never-going-to-work*
  from *we-tried-N-times*.

**WHY split `FAILED` into a `failureKind` instead of two statuses:** the UI and
the API only ever need "is it terminal and did it work" plus a reason. One status
column keeps queries and indexes simple; the *reason* is a separate dimension.

**PROOF:** `GET /events/:id` in Swagger; `EventStatusHistory` rows give the
transition log.

`BN:` ৬টা state, দুইটা terminal। FAILED-এর কারণ আলাদা কলামে — permanent নাকি retry শেষ।

---

## R3 — Asynchronous Processing

**ASKED:** Redis + BullMQ. A simulated payroll operation that validates, talks to
a fake external system, stores a result, and sometimes fails.

**BUILT:**
- One queue, `payroll-events`; **one job per event**, with `jobId = event.id`.
- Worker is a separate process (`worker.main.ts`) using
  `NestFactory.createApplicationContext` — a Nest DI container with **no HTTP
  server at all**.
- `SimulatedPayrollProviderService`: configurable latency, a **seeded**
  pseudo-random failure (so a given event+attempt always fails the same way),
  plus an explicit `__simulate` escape hatch for demos and tests.

**WHY `jobId = event.id`:** BullMQ refuses to add a second job with an existing
job id. So a duplicate enqueue — from a retried HTTP request, from the
reconciliation cron, from anywhere — is a no-op at the queue level too. Cheap,
free deduplication on top of the DB-level one.

**WHY seeded randomness:** a truly random `Math.random()` failure rate makes
tests flaky and demos unrepeatable. Seeding on `hash(eventId + attempt)` keeps
the behaviour "unreliable" while remaining reproducible.

**TRADE-OFF:** one job per event (rather than a per-employee "tick" job that
drains a queue) means ordering needs an explicit gate (R9). In exchange, every
job maps 1:1 to a database row, which makes retry counts, the UI, and debugging
dramatically simpler.

**PROOF:** `payroll.processor.ts`, `simulated-payroll-provider.service.ts`.

`BN:` প্রতি event-এ একটা job, jobId = event id — তাই queue নিজেই duplicate আটকায়। Worker আলাদা process, HTTP নাই।

---

## R4 — Temporary and Permanent Failures

**ASKED:** a temporary failure must not immediately become permanent; some errors
will never succeed. An engineer must be able to understand what happened.

**BUILT:** every thrown error passes through `failure-classifier.ts`:

| Error | Class | Queue behaviour | Final status |
|---|---|---|---|
| `TransientProviderError` (503, timeout, `ECONNRESET`) | TRANSIENT | exponential backoff, up to `JOB_ATTEMPTS` (default 5) | `SUCCEEDED` if it clears, else `FAILED / RETRIES_EXHAUSTED` |
| `PermanentPayrollError` (unknown employee, inactive employee, invalid IBAN for the country, currency mismatch, effective date out of policy) | PERMANENT | `throw new UnrecoverableError()` — **BullMQ stops immediately** | `FAILED / PERMANENT` after 1 attempt |
| Anything unrecognised | TRANSIENT (deliberate) | retried | `FAILED / RETRIES_EXHAUSTED` |

Backoff: exponential, base `JOB_BACKOFF_MS` (1000ms), so ~1s, 2s, 4s, 8s, 16s,
plus jitter to avoid a thundering herd when the provider comes back.

For the investigating engineer, every failed event carries: `attemptCount`,
`failureKind`, `lastErrorCode` (a stable machine-readable string like
`PROVIDER_UNAVAILABLE` or `EMPLOYEE_NOT_FOUND`), `lastErrorMessage`,
`lastErrorDetail` (JSON: provider response, stack tail, attempt number), plus one
`EventStatusHistory` row per attempt.

**WHY classify by error type, not by HTTP status or string matching:** the domain
decides retryability, not the transport. A typed error hierarchy means adding a
new permanent rule is one `throw new PermanentPayrollError('X_NOT_ALLOWED')`, with
no classifier change.

**WHY unknown errors are treated as transient:** a bug in our code that throws a
`TypeError` should not permanently discard a real payroll change. Retrying is the
safer default; the event still lands in `RETRIES_EXHAUSTED` where a human can see
it. Say this explicitly — it is a judgement call, and the reverse choice
(fail-fast on unknowns) is also defensible.

**PROOF:** `failure-classifier.spec.ts` (unit), `retry.integration-spec.ts`
(transient clears at attempt 3), `permanent-failure.integration-spec.ts`
(one attempt, no retry).

`BN:` Error টাইপ দেখে ঠিক করি retry হবে কিনা। Permanent হলে সাথে সাথে থামে (UnrecoverableError), transient হলে exponential backoff-এ ৫ বার। অচেনা error = transient ধরি, কারণ payroll change হারানো যাবে না।

---

## R5 — Duplicate Requests

**ASKED:** a client may retry the same HTTP request. The same payroll change must
not be applied twice.

**BUILT — two independent layers:**

1. **Idempotency key on the API.** The client may send an `Idempotency-Key`
   header. If it does not, the server **derives** one:
   `sha256(type | employeeId | effectiveDate | canonicalJson(payload))`.
   The column has a `UNIQUE` constraint. On insert, a `P2002` unique violation is
   caught, the original row is loaded, and the API returns **200** with
   `duplicate: true` and the original event id — not a 409, because from the
   client's perspective the request succeeded; it just succeeded earlier.
2. **`jobId = event.id`** at the queue level, so even a duplicated enqueue cannot
   create a second job.

And behind both, the `PayrollApplication` ledger (R8) makes double-*application*
impossible even if two jobs somehow existed.

**WHY derive a key instead of requiring the header:** a naive retrying client
(curl in a loop, a flaky mobile network, a load balancer retry) will not send the
header. Deriving from the business content means the *same business request* is
deduplicated regardless of client discipline. An explicit header still wins when
provided, because two genuinely-different changes might otherwise hash the same
(e.g. "set salary to 5000" submitted twice on purpose).

**WHY catch the unique violation instead of `SELECT` then `INSERT`:** two
concurrent identical requests would both pass a `SELECT` check and both insert.
The database constraint is the only race-free arbiter. Say this — it is the most
common follow-up question on this requirement.

**TRADE-OFF:** the derived key means a legitimate repeat submission (same
employee, same date, same value, intentionally twice) is swallowed. Mitigation:
the client sends its own `Idempotency-Key`. Documented in the README.

**PROOF:** `duplicate-submission.e2e-spec.ts` — POST the same body 5 times
concurrently, assert exactly one row, one job, one `PayrollApplication`.

`BN:` Header না দিলে payload hash করে key বানাই, DB-তে UNIQUE। দুইটা request একসাথে এলে unique violation ধরে ফেলি — আগে SELECT করে চেক করলে race হতো।

---

## R6 — Multiple Workers and Concurrency

**ASKED:** multiple worker processes must not apply an event twice and must stay
correct.

**BUILT — three layers, each sufficient on its own for a different failure mode:**

1. **BullMQ job locks.** Exactly one worker can hold a job at a time
   (`lockDuration = 30s`, renewed while active). This handles the normal case.
2. **Postgres advisory lock per employee.** `pg_advisory_xact_lock(hashtext(employeeId))`
   serialises everything for one employee, across processes *and across machines*,
   without serialising the whole system. Different employees never contend.
3. **The `PayrollApplication` unique constraint.** Even if layers 1 and 2 were
   somehow both defeated (a network partition splitting Redis, say), the second
   apply inserts nothing and mutates nothing.

**WHY an advisory lock rather than `SELECT ... FOR UPDATE` on the employee row:**
the employee may not have a state row yet (first ever event), and I want to lock
a *logical key*, not a physical row. Advisory locks are keyed on an arbitrary
bigint, are automatically released at transaction end (no leak on crash), and cost
nothing when uncontended.

**WHY not a Redis lock (Redlock):** the correctness boundary here is the database
transaction. A lock held in a different system than the data can expire mid-write.
An `xact` advisory lock is released exactly when the transaction ends — the lock
and the write share a lifetime. Redis is used for queueing, not for correctness.

**Scale it:** `docker compose up --scale worker=3` and the tests still pass. That
is the demo.

**PROOF:** `concurrency.integration-spec.ts` — 4 workers, 50 events, 5 employees;
asserts one application row per event and strict per-employee ordering.

`BN:` তিন স্তর — BullMQ job lock, Postgres advisory lock (employee-ভিত্তিক), আর ledger-এর unique constraint। Redis lock ব্যবহার করিনি কারণ lock আর data একই transaction-এ থাকা দরকার।

---

## R7 — Worker Failure and Recovery

**ASKED:** a worker can die mid-processing. The event must not stay stuck.

**BUILT — two mechanisms, because they cover different holes:**

1. **BullMQ stalled-job detection.** A dead worker stops renewing its job lock.
   After `lockDuration`, the `stalledInterval` checker moves the job back to
   `waiting`; another worker picks it up. After `maxStalledCount` (2) stalls, the
   job is failed rather than looping forever. Every stall is logged at WARN.
2. **`ReconciliationService` (`@Cron` every minute, Redis-guarded so it runs on
   exactly one instance).** It repairs three concrete drifts:
   - `PENDING` older than 30s -> the DB committed but the enqueue never happened
     -> enqueue it;
   - `PROCESSING` older than `STUCK_EVENT_TIMEOUT_MS` **with no corresponding
     BullMQ job in any state** -> the worker died and Redis lost the job too ->
     reset to `PENDING` + history entry `recovered-from-stale-processing` -> re-enqueue;
   - any non-terminal status with no job in Redis at all (e.g. Redis was flushed)
     -> re-enqueue.

Plus **graceful shutdown**: on `SIGTERM` the worker calls `worker.close()`, which
stops taking new jobs and lets the in-flight one finish, then Nest shutdown hooks
destroy the TypeORM `DataSource`. `stop_grace_period: 30s` in compose. A *planned* restart
never produces a stalled job at all.

**WHY both:** BullMQ's stalled detection only helps while Redis still knows about
the job. It cannot help if the job was lost, if Redis was restarted without
persistence, or if the row was committed before the enqueue. The database is
therefore the recovery source of truth, and the cron reconciles Redis to it.

**Why this is safe to re-run:** recovery re-processes the event, and re-processing
is a no-op if the change was already applied (R8). Recovery correctness is
*derived from* idempotency, not added on top of it.

**PROOF:** `recovery.integration-spec.ts` — (a) an event forced to `PROCESSING`
with an old timestamp and no job is recovered and completes; (b) a `PENDING` event
that was never enqueued is picked up; (c) killing a worker container mid-job in
the e2e run still ends with exactly one application.

`BN:` দুইটা জিনিস — BullMQ stalled detection (Redis জানলে) আর প্রতি মিনিটের cron (DB-ই আসল সত্য)। আবার process হলেও সমস্যা নাই, কারণ apply idempotent।

---

## R8 — Processing Consistency (the crash-after-write scenario)

**ASKED:** worker succeeds, writes the DB, crashes before finishing, event is
processed again — must not corrupt data or apply twice.

**BUILT:** the entire apply step is **one Postgres transaction**, and the first
statement inside it is a ledger insert with a unique key:

```sql
BEGIN;
  SELECT pg_advisory_xact_lock(hashtext($employeeId));

  INSERT INTO payroll_applications ("eventId", "employeeId", "externalRef", "snapshotBefore")
  VALUES ($1, $2, $3, $4)
  ON CONFLICT ("eventId") DO NOTHING
  RETURNING "eventId";
  -- 0 rows returned  =>  a previous attempt already applied this event

  -- only when 1 row was returned:
  --   upsert employee_payroll_states  (the actual business change)

  UPDATE payroll_events SET status = 'SUCCEEDED', result = $5, "completedAt" = now() WHERE id = $1;
  INSERT INTO event_status_history (...) VALUES (..., 'SUCCEEDED');
COMMIT;
```

Two possible crash points, both safe:

| Crash point | What is in the DB | What happens on reprocessing |
|---|---|---|
| Before `COMMIT` | nothing — the transaction rolls back | full retry, applies once |
| After `COMMIT`, before BullMQ acks the job | ledger row + state change + `SUCCEEDED` | job retried; the processor sees `status = SUCCEEDED` and returns early. Even if it did not, the `ON CONFLICT DO NOTHING` returns 0 rows and the business change is skipped |

The provider call is also short-circuited: if the ledger row exists, we do not
call the external system again. And the provider is called with `event.id` as its
idempotency key, so a duplicate call would be a no-op on their side too.

**WHY a separate ledger table instead of just checking `status = 'SUCCEEDED'`:**
the status column is *our workflow state*; the ledger is a *fact that the business
change happened*. They are written in the same transaction, so they can never
disagree — but the ledger also gives an audit record (`appliedAt`, `externalRef`,
`snapshotBefore`) that a status enum cannot, and it is the single row that makes
double-application structurally impossible rather than merely unlikely.

**WHY not two-phase commit between Redis and Postgres:** you cannot get atomic
commit across a queue and a database without distributed transactions, which are
not worth it here. The standard answer is *at-least-once delivery + idempotent
consumer*, and this is exactly that: BullMQ may deliver a job more than once; the
consumer makes the second delivery harmless.

**PROOF:** `idempotent-apply.integration-spec.ts` — run the apply function twice
for one event and assert one ledger row, one state mutation, and a
`idempotent-replay` log line.

`BN:` পুরো apply একটাই transaction, ভেতরে `PayrollApplication`-এ unique eventId insert। আগেই apply হয়ে থাকলে conflict-এ কিছুই হয় না। Queue at-least-once, consumer idempotent — এটাই আসল উত্তর।

---

## R9 — Event Ordering

**ASKED:** events for the same employee must process in acceptance order; events
for different employees must still run concurrently.

**BUILT:**
- `PayrollEvent.sequence` is a `BIGSERIAL` — a database-generated, monotonic
  acceptance order. **Not `createdAt`**, because two rows can share a timestamp.
- Before doing any work, the processor runs the **ordering gate** in a short
  transaction:
  1. `pg_try_advisory_xact_lock(hashtext(employeeId))` — if not acquired,
     someone else has this employee, defer;
  2. `SELECT 1 FROM "PayrollEvent" WHERE "employeeId" = $1 AND "sequence" < $2 AND "status" NOT IN ('SUCCEEDED','FAILED') LIMIT 1`
     — if a row comes back, an earlier sibling is unfinished, defer.
- **Defer** = `job.moveToDelayed(now + backoff)` + `throw new DelayedError()`.
  The deferral counter lives in `job.data.deferCount` and is **separate from the
  failure attempt counter**, so queueing behind a predecessor never consumes a
  retry. Backoff is `min(250ms * 2^deferCount, 5s)` with jitter.

**Note the terminal-state condition:** a predecessor stuck in `FAILED` does not
block its successors forever. That is a **policy decision** and you should state
it: *a failed address change should not permanently block a salary change*. If the
business wanted strict blocking ("halt the employee's pipeline on any failure"),
it is a one-line change to the gate query — and the README says so.

**WHY not BullMQ groups / a FIFO queue per employee:**
- BullMQ **Groups** (ordered per group key) is a **BullMQ Pro** paid feature.
- One queue per employee does not scale — unbounded queue count in Redis, and
  workers would have to discover queue names dynamically.
- A single per-employee "tick" job that drains the employee's backlog works, but
  couples retry/backoff of *one* event to the whole employee's pipeline and
  breaks the 1 job : 1 event mapping that makes the UI and debugging simple.
- The advisory-lock gate keeps the ordering rule **in the database, where the
  ordering data lives**, which also means it survives a Redis flush.

**TRADE-OFF:** deferral is a bounded poll, not a push. Under a deep per-employee
backlog, a job may wake and re-defer a few times. Bounded at 5s per check and
scoped to one employee, this is negligible here; at high volume the upgrade path
is to have the predecessor's completion hook promote the delayed successor
immediately (or move to BullMQ Pro groups). Say this — knowing the limitation is
worth more than pretending there is none.

**PROOF:** `ordering.integration-spec.ts` — 3 events for one employee submitted
back-to-back with a slow provider and 4 workers running; asserts `appliedAt`
strictly increases with `sequence`, and that a fourth employee's event completes
*before* the second event of the first employee (proving concurrency was not lost).

`BN:` Order-এর সত্য উৎস DB-র `sequence` কলাম। কাজ শুরুর আগে চেক করি আগের কোনো event বাকি আছে কিনা — থাকলে job-টা delay করে দেই (retry count খরচ হয় না)। অন্য employee-র কাজ পুরো parallel চলে।

---

## R10 — Extensibility

**ASKED:** adding `EMPLOYEE_TERMINATION`, `TAX_CLASS_CHANGE`, etc. must not
require rewriting the processing system.

**BUILT:** a handler registry. Each event type is one folder implementing one
interface:

```ts
interface IPayrollEventHandler<TDto extends BasePayrollEventDto> {
  readonly type: string;
  readonly dto: new () => TDto;                                    // class-validator DTO + Swagger
  validate(manager: EntityManager, payload: TDto): Promise<void>;  // business rules
  apply(manager: EntityManager, event: PayrollEvent, payload: TDto): Promise<void>;
}
```

Handlers are registered as a NestJS **multi-provider** under a
`PAYROLL_EVENT_HANDLER` token; `EventTypeRegistry` receives the array and indexes
it by `type`. A `PayrollEventValidationPipe` resolves the handler from the
incoming `type`, runs `plainToInstance` + `validate` against **that handler's
DTO**, and hands the typed payload to the controller. So per-type validation is a
registry lookup, not a union type and not a `switch`.

**Adding `BONUS_PAYMENT` is exactly:**
1. create `event-types/handlers/bonus-payment/` with a DTO + handler class,
2. add it to the `PAYROLL_EVENT_HANDLER` provider array,
3. (only if it needs new columns) one TypeORM migration.

**No change to:** the controller, the DTO, the queue, the processor, the ordering
gate, the retry logic, the reconciliation cron, or the frontend list/detail views.

**WHY `type` is a `text` column, not a Postgres enum:** a DB enum would force a
migration for every new event type. `text` + registry validation puts the
authority in the application layer, where the handler already lives. Unknown types
are rejected at the API boundary with 400, so bad data still cannot enter.

**WHY `payload` is `jsonb`, not per-type tables:** the event log is intentionally
schemaless-per-type — it stores *what was requested*. The **materialised state**
(`EmployeePayrollState`) is strongly typed with real columns, because that is what
gets queried and constrained. This split (typed state, JSON event log) is the
standard event-processing shape, and `jsonb` still supports indexing and querying
if needed.

**PROOF:** `event-type.registry.spec.ts`, and the fact that all three handlers are
~40 lines each with no shared branching.

`BN:` নতুন event type = নতুন একটা folder + interface implement + registry-তে যোগ। Controller/worker/queue কিছুই ছুঁতে হয় না। `type` কলাম text রাখছি যাতে migration না লাগে।

---

## R11 — Validation

**ASKED:** per-type required fields; invalid input returns an appropriate
response.

**BUILT — validation happens at two levels, on purpose:**

| Level | Where | Examples | Result |
|---|---|---|---|
| **Structural** | API, `PayrollEventValidationPipe` + the handler's class-validator DTO | missing `iban`, `newSalary <= 0`, bad `currency`, malformed `effectiveDate`, IBAN mod-97 checksum failure, unknown `type` | **400** with `{ code: 'VALIDATION_ERROR', fieldErrors: [{ path, message }] }` — never enters the system |
| **Business** | Worker, `handler.validate()` | employee does not exist, employee inactive, salary currency differs from the employee's current currency, effective date outside policy | `PermanentPayrollError` -> event `FAILED / PERMANENT` with a readable `lastErrorCode` |

**WHY split them:** structural validity is knowable from the request alone, so
rejecting synchronously is correct and gives the client an immediate, actionable
400. Business validity needs database state (does this employee exist? what is
their current currency?) — doing that in the request path would put a database
read and a policy decision on the latency-critical hot path, and would still be
racy (state can change between accept and apply). So it belongs where the change
is actually applied.

**Error envelope** is uniform across the API via `AllExceptionsFilter`:
```json
{ "code": "VALIDATION_ERROR", "message": "...", "fieldErrors": [...], "requestId": "..." }
```
Covered: 400 invalid input, 400 unknown event type, 404 unknown event id,
500 unexpected (message scrubbed, `requestId` retained for log correlation).

**PROOF:** `validation.spec.ts` (unit, per-field), `api-errors.e2e-spec.ts`
(response shapes).

`BN:` দুই ধাপ — structure API-তে (400 সাথে সাথে), business rule worker-এ (permanent failure)। কারণ business check-এর জন্য DB লাগে, আর সেটা request path-এ রাখলে slow + racy।

---

## R12 — Event History and Audit Information

**ASKED:** enough information to understand the lifecycle — submitted, started,
succeeded, failed, failure info.

**BUILT:**
- **Denormalised timestamps** on `PayrollEvent` (`createdAt`, `queuedAt`,
  `processingStartedAt`, `completedAt`, `nextRetryAt`) for cheap list queries and
  filtering.
- **`EventStatusHistory`** — an append-only row for *every* transition, with
  `fromStatus`, `toStatus`, `attempt`, `message`, and `metadata` JSON. Never
  updated, never deleted. This is what the frontend timeline renders.
- **`PayrollApplication`** — the immutable audit fact: this event changed this
  employee at this time, provider ref `EXT-...`, with `snapshotBefore` holding the
  previous state so a change is fully reconstructable.
- **Structured logs** (pino JSON) on every transition, carrying `eventId`,
  `employeeId`, `type`, `attempt`, `status`, and the `requestId` from submission —
  so an operator can trace one business request from HTTP through to the applied
  change with a single grep.

**WHY both a history table and status columns:** the columns answer "what is it
now" fast (indexed, no join); the history answers "how did it get here"
completely. Denormalising the common timestamps avoids a join on the list
endpoint, which is the hottest query.

**PROOF:** `GET /events/:id` returns `history[]`; the frontend detail page renders
it as a timeline.

`BN:` তিন স্তরের audit — event row-এ timestamps, history table-এ প্রতিটা transition, ledger-এ আসল business fact + আগের অবস্থার snapshot।

---

## Stack choice — why TypeORM (and not Prisma or Drizzle)

**ASKED:** "You may choose Prisma, Drizzle, TypeORM, or another suitable
PostgreSQL data-access library."

**BUILT:** TypeORM 0.3 with explicit `QueryRunner`-scoped transactions and
CLI-generated migrations committed to the repo.

**WHY:** the requirements that decide this are not "which has nicer types" — they
are the three statements this system's correctness rests on:

| Operation | Why it constrains the ORM |
|---|---|
| `pg_advisory_xact_lock(hashtext($1))` | The lock is **connection-scoped and transaction-scoped**. The lock and the writes it protects must provably run on the *same* connection inside the *same* transaction. |
| `INSERT … ON CONFLICT DO NOTHING RETURNING` | I need an unambiguous "was a row actually inserted" signal — that boolean *is* the exactly-once guarantee. |
| `SELECT 1 … WHERE sequence < $2 AND status NOT IN (…)` | Ordering must be evaluated in SQL, under the lock, not in application memory. |

TypeORM's `QueryRunner` models exactly that: you take a connection, you start a
transaction, and every `qr.query(...)` demonstrably runs on it. That is why the
ordering gate and the apply transaction read the way they do — the mechanism is
visible in the code rather than hidden behind an abstraction.

**Prisma — rejected.** All three statements above would go through `$queryRaw` /
`$executeRaw` escape hatches. An ORM that steps aside for the most important
statements in the system is carrying weight it does not earn here. Prisma's
migration DX is the best of the three, and that is a real loss.

**Drizzle — rejected on timebox, not on merit.** Technically it is the *best* fit:
SQL-first so the locks read naturally, `onConflictDoNothing()` is first-class,
`db.execute(sql\`…\`)` inside `db.transaction()` is clean, migrations are plain
reviewable SQL, and the runtime is tiny. It loses only on risk: DIY NestJS
integration and an unfamiliar migration workflow inside a 2–3 day assignment that
ends in a live "now modify your implementation" review. **Say this in the
interview** — naming the tool you would pick with more runway, and why you did
not pick it here, is a stronger answer than defending TypeORM as objectively best.

**TRADE-OFF accepted:** TypeORM's type-safety is weaker than either alternative,
its generated migrations need review before committing, and `synchronize` is a
footgun. Mitigations: `synchronize: false` in **every** environment (not just
production — see below), migrations committed and drift-checked in CI, and
repository interfaces (`IEventsRepository`) so the service layer is not coupled to
TypeORM's API.

**One deliberate departure from the codebase this borrows conventions from:**
`caregiver-platform` sets `synchronize: NODE_ENV === 'development'`. This project
sets it to `false` unconditionally. A reviewer runs `migration:run` from a clean
clone; `synchronize: true` in development hides schema drift until it breaks for
somebody else, and the CI drift check exists precisely to catch that.

`BN:` তিনটা SQL statement-ই ORM choice ঠিক করেছে — advisory lock, ON CONFLICT RETURNING, ordering query। TypeORM-এর QueryRunner-এ "কোন statement কোন connection-এ" ব্যাপারটা স্পষ্ট। Prisma-তে এই তিনটাই raw escape hatch, তাই বাদ। Drizzle আসলে সবচেয়ে ভালো ফিট, কিন্তু ৩ দিনের timebox-এ নতুন tool-এর ঝুঁকি — এটা interview-এ সৎভাবে বলাই ভালো উত্তর।

---

## Project structure

**BUILT:** the backend mirrors `caregiver-platform/apps/backend` — `src/modules/*`
(feature-scoped: controller, service, repository, module, `dtos/`, `entities/`,
`enums/`, `interfaces/`, `swagger/`), `src/common/*` (filters, interceptors,
decorators, error classes), `src/shared/*` (redis, logger, utils),
`src/config/*`, `src/database/{database.module.ts,migrations,seeds}`, Dockerfiles
under `docker/`, apps under `apps/`.

Also inherited: the global `ApiResponse<T>` envelope
(`success / message / data / timestamp / path / statusCode`) via
`ResponseFormatInterceptor` + `AllExceptionsFilter`, the `@ResponseMessage()`
decorator, `CustomLogger` with logging-tag enums, and the
`...WithQueryRunner(queryRunner, …)` repository method convention for
transactional work.

**WHY:** a consistent, already-proven layout means less time inventing structure
and a repo that reads like a codebase rather than a tutorial. The repository
pattern in particular pays off here — passing a `QueryRunner` into repository
methods is precisely what the advisory-lock transactions need.

**Deliberately NOT inherited: Nx.** It earns its keep across many apps with a
shared library graph. Here it is two apps and no shared libs, and the assignment
explicitly says not to add unnecessary scope. Plain npm workspaces instead.

`BN:` Folder structure caregiver-এর মতোই — modules/common/shared/config/database। QueryRunner repository pattern-টা এখানে বাড়তি কাজে আসে। Nx নেই, কারণ দুইটা app-এ Nx অতিরিক্ত।

---

## Testing strategy

**ASKED:** choose a strategy; be ready to explain what is unit vs integration vs
functional vs e2e.

**BUILT:**

| Type | Definition I am using | Examples here | Runs with |
|---|---|---|---|
| **Unit** | one module, all collaborators are fakes, zero IO | DTO validation rules, IBAN mod-97, idempotency-key derivation, failure classifier, backoff maths, registry lookup | nothing — runs on any machine in seconds |
| **Integration** | our code + one real infrastructure dependency | apply-transaction idempotency, advisory-lock serialization, ordering gate SQL, reconciliation queries | real Postgres (Testcontainers), real Redis |
| **Functional (API)** | the whole Nest app through its public HTTP surface, but external boundaries stubbed | 202 on submit, 200 + `duplicate:true`, 400 field errors, 404 shape | real DB, queue spied |
| **E2E** | everything really running, exactly as in production | `docker compose up`, POST, poll until terminal, assert `EmployeePayrollState` | full compose stack, real worker |

**Explicit choices to defend:**
- **No test depends on the random failure rate.** `PROVIDER_FAILURE_RATE=0` in
  tests; failures are injected deterministically via `__simulate`. Random failure
  is a *demo* feature, not a *test* mechanism.
- **Concurrency is tested, not reasoned about.** 4 workers, 50 events, 5
  employees, asserting invariants (one ledger row per event; `appliedAt`
  increases with `sequence` per employee) rather than timings.
- **Recovery is tested by forcing the bad state** (row set to `PROCESSING` with an
  old timestamp, no job in Redis), which is faster and more reliable than
  `SIGKILL`-ing a container — though the e2e suite does that too, once.
- **Coverage is not a goal.** The listed scenarios in the assignment each have a
  named test. That mapping is in the README.

`BN:` Unit = কোনো IO নাই। Integration = আসল Postgres/Redis। Functional = HTTP দিয়ে পুরো app কিন্তু বাইরের boundary stub. E2E = পুরা docker compose. Failure গুলা random না, deterministic ভাবে inject করা।

---

## Docker & local development

- **One backend image, two commands.** `api` runs `node dist/main`, `worker` runs
  `node dist/worker.main`. Same build, same layers, no drift between them.
- **Multi-stage build** (`deps -> build -> runtime`), production-only deps in the
  final stage, non-root user, proper `SIGTERM` handling for graceful shutdown.
- **Healthchecks + `depends_on: condition: service_healthy`** so the API never
  starts against a database that is not accepting connections.
- **A one-shot `migrate` service** runs `typeorm migration:run` and exits; `api`
  and `worker` depend on it completing. Migrations are never run implicitly by
  application boot — that would race when you scale to multiple replicas.
- `docker compose up` is genuinely the only command needed; `--scale worker=3` is
  the concurrency demo.

`BN:` এক image, দুই command। Migration আলাদা one-shot service — app boot-এ migration চালালে multiple replica-তে race লাগে।

---

## CI pipeline

Jobs: `quality` (eslint + prettier + `tsc --noEmit`) -> `unit` -> `integration`
(with postgres + redis service containers, running migrations first) ->
`migrations` (`typeorm migration:generate --check`, catching entity/migration drift)
-> `build` (docker build both images) -> `frontend` (typecheck + build).

**WHY these specific checks:** they map to the ways this repo can actually break —
type errors, a broken invariant, a schema edited without a migration, a Dockerfile
that no longer builds. The `migrations` drift check in particular is the one
people forget, and it is the one that breaks `docker compose up` for a reviewer.

**How it "prevents merges":** these are the required status checks in branch
protection; PRs cannot merge red. The repo's history shows feature branches merged
through PRs with checks, not direct pushes to `main`.

`BN:` চেকগুলা এই repo-র আসল ভাঙার রাস্তা ধরে বানানো। Migration drift check-টা গুরুত্বপূর্ণ — schema বদলে migration না দিলে reviewer-এর compose ভাঙবে।

---

## Deliberate non-goals

Listed here so nobody thinks they were forgotten:

- **No auth** — explicitly out of scope.
- **No transactional outbox** — the reconciliation cron covers the same window
  with far less machinery at this scale. Upgrade path documented.
- **No dead-letter queue as a separate BullMQ queue** — `FAILED / RETRIES_EXHAUSTED`
  in Postgres *is* the DLQ, and it is queryable, indexed, and visible in the UI.
  A `POST /events/:id/retry` endpoint would be the natural next step.
- **No BullMQ Pro (groups)** — paid; the advisory-lock gate achieves the same
  ordering guarantee with open-source components.
- **No horizontal scaling story beyond `--scale worker=N`** — Kubernetes was
  explicitly excluded.
- **No optimistic-locking `version` column on `PayrollEvent`** — the advisory lock
  already serialises writers per employee, so it would be redundant.

`BN:` যেগুলা ইচ্ছা করে করি নাই আর কেন — এই লিস্টটা interview-এ কাজে দিবে, কারণ "এটা কেন নাই" প্রশ্ন আসবেই।
