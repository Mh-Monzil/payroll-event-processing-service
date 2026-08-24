# Interview Prep — Payroll Event Processing Service

> Read `01-DESIGN-DECISIONS.md` first (the *why* behind each requirement).
> This doc is the *spoken* version: lifecycle walkthroughs, the questions they
> said they will ask, and answers you can say out loud in 60–90 seconds each.
>
> `BN:` lines are memory hooks, not things to say in the interview.

---

## Part 1 — The 90-second opener

If they say "walk me through what you built":

> It is a two-process NestJS service. The API validates a payroll event against a
> per-type schema, writes it to Postgres in a transaction, and returns 202 with a
> status URL — it never talks to the payroll provider. A separate worker process
> consumes a BullMQ job that carries only the event id. Before doing any work it
> takes a Postgres advisory lock on the employee and checks that no earlier event
> for that employee is still unfinished, which gives me per-employee FIFO ordering
> without serialising the whole system. Then it calls the simulated provider and
> commits the business change together with a row in an idempotency ledger, in one
> transaction. Transient errors are retried with exponential backoff; permanent
> ones stop immediately with a typed error code. A reconciliation cron re-queues
> anything that fell through the gap between the database and Redis. The frontend
> shows the queue in motion — status transitions, retry counts, failure details,
> and buttons to demonstrate duplicates and ordering.

Then stop and let them pick a thread.

---

## Part 2 — Lifecycle walkthrough (they *will* ask this)

### Happy path

```
1.  Client POST /events  { type: SALARY_CHANGE, employeeId: E1, effectiveDate, newSalary, currency }
2.  PayrollEventValidationPipe looks SALARY_CHANGE up in the registry and validates
    the body against that handler's DTO. Structural failure -> 400, nothing persisted.
3.  EventsService derives idempotencyKey = sha256(type|employeeId|effectiveDate|canonicalJson(payload))
    (or uses the Idempotency-Key header if present).
4.  TRANSACTION: INSERT PayrollEvent (status=PENDING, sequence=BIGSERIAL)
                 INSERT EventStatusHistory (null -> PENDING)
    COMMIT.
5.  queue.add('process-event', { eventId }, { jobId: eventId, attempts: 5, backoff: exponential })
    UPDATE status = QUEUED, queuedAt = now()
6.  HTTP 202 { id, status: QUEUED, statusUrl }.  Request is done. Total: milliseconds.

--- process boundary --------------------------------------------------------

7.  Worker picks the job. Loads the event.
    Already SUCCEEDED or FAILED? -> return immediately (idempotent no-op).
8.  ORDERING GATE (short tx):
      pg_try_advisory_xact_lock(hashtext(E1))            -> not acquired? defer
      any PayrollEvent for E1 with sequence < mine and status not terminal? -> defer
      (defer = job.moveToDelayed(+backoff) + throw DelayedError; deferCount != attemptCount)
9.  UPDATE status = PROCESSING, processingStartedAt = now(); history row.
10. handler.validate(payload)  -> employee exists? active? currency consistent?
                                  failure -> PermanentPayrollError
11. provider.submit(event, idempotencyKey = event.id)
       -> latency + seeded failure -> TransientProviderError
       -> success -> { externalRef: 'EXT-ab12cd' }
12. APPLY TRANSACTION:
       pg_advisory_xact_lock(hashtext(E1))                       (blocking)
       INSERT PayrollApplication(eventId) ON CONFLICT DO NOTHING
         -> 0 rows: already applied earlier; skip the mutation
         -> 1 row : upsert EmployeePayrollState (salaryAmount, salaryCurrency, ...)
       UPDATE PayrollEvent status=SUCCEEDED, result, completedAt
       INSERT EventStatusHistory (PROCESSING -> SUCCEEDED)
    COMMIT.
13. Publish to the Redis SSE channel -> the browser row turns green live.
```

### Transient failure path

```
11. provider throws TransientProviderError('PROVIDER_UNAVAILABLE')
    classify -> TRANSIENT
    attemptsMade + 1 < attempts?
      UPDATE status=AWAITING_RETRY, attemptCount++, lastErrorCode, nextRetryAt
      history row
      rethrow -> BullMQ schedules the retry (1s, 2s, 4s, 8s + jitter)
    else
      UPDATE status=FAILED, failureKind=RETRIES_EXHAUSTED
      rethrow -> job lands in BullMQ's failed set (kept, removeOnFail:false)
```

### Permanent failure path

```
10. handler.validate throws PermanentPayrollError('EMPLOYEE_NOT_FOUND')
    classify -> PERMANENT
    UPDATE status=FAILED, failureKind=PERMANENT, lastErrorCode='EMPLOYEE_NOT_FOUND'
    throw new UnrecoverableError(...)  -> BullMQ does NOT retry. One attempt total.
```

### Crash path

```
Worker dies between step 12's COMMIT and BullMQ acking the job.
  - The job lock is not renewed -> after lockDuration BullMQ marks it stalled
    -> another worker picks it up.
  - That worker loads the event: status is already SUCCEEDED -> returns at step 7.
  - Even if it did not, the ledger INSERT hits ON CONFLICT DO NOTHING -> 0 rows
    -> the business mutation is skipped.
  - If Redis lost the job entirely, the reconciliation cron notices a PROCESSING
    row older than the timeout with no job in Redis, resets it to PENDING and
    re-enqueues. Same two guards apply.
```

`BN:` চারটা path মুখস্থ রাখো — happy, transient, permanent, crash। প্রতিটার শেষে "তাই duplicate apply হয় না" বলতে পারা লাগবে।

---

## Part 3 — The questions they listed, with answers

### Q. Walk me through the lifecycle of an event.
Use Part 2. Start at the HTTP request, name the process boundary out loud, and
end at the ledger row. The two things they are listening for: *the API does no
work*, and *the apply is one transaction with a uniqueness guard*.

---

### Q. Explain the architecture and database design.

> Two processes over shared infrastructure. Postgres is the source of truth for
> both the event log and the business state; Redis is only a work-distribution
> mechanism and holds no payload — jobs carry just an event id. That matters
> because it means a Redis flush costs me throughput, not data.
>
> Six tables. `PayrollEvent` is the request log — what was asked, plus its
> workflow status and denormalised lifecycle timestamps. `EventStatusHistory` is
> append-only, one row per transition, for the audit trail. `PayrollApplication`
> is the idempotency ledger keyed on `eventId` — its unique constraint is what
> makes double-application structurally impossible, and it carries the provider
> reference and a snapshot of the prior state. `EmployeePayrollState` is the
> materialised current state with real typed columns. `Employee` is seed data so
> "unknown employee" can be a genuine permanent failure.
>
> The deliberate split: the *event log* stores its payload as `jsonb` because it
> is per-type and I want new types to need no migration, while the *state* is
> strongly typed because that is what gets queried and constrained.

**Follow-up they may ask — "why is `sequence` a BIGSERIAL and not `createdAt`?"**
Because two rows can share a timestamp, and clock skew across API replicas makes
timestamps unsafe for ordering. `BIGSERIAL` is assigned by one authority — the
database — and is strictly monotonic.

**"Why is `type` not a Postgres enum?"** Adding an event type would then require a
migration. `text` plus registry-based validation at the API boundary gives the
same safety with the authority in the layer that owns the handler.

`BN:` Postgres = সত্য, Redis = শুধু কাজ বিলানোর মাধ্যম। Event log JSON, state typed columns।

---

### Q. Why TypeORM? Why not Prisma or Drizzle?

> Three statements decide this, and they are the three the correctness of the
> whole system rests on: the advisory lock, the ledger insert with
> `ON CONFLICT DO NOTHING RETURNING`, and the ordering query. All three have to
> run as SQL, and the first two have to provably run on the same connection
> inside the same transaction.
>
> TypeORM's `QueryRunner` models exactly that — I take a connection, start a
> transaction, and every query on it is visibly on that connection. The mechanism
> is in the code rather than behind an abstraction, which matters when the thing
> being reviewed *is* the mechanism.
>
> Prisma I ruled out because all three would go through `$queryRaw` escape
> hatches. If the ORM steps aside for the most important statements in the
> system, it is carrying weight it does not earn here — and I would be giving up
> Prisma's real strength, which is its migration DX, in exchange for nothing.
>
> Drizzle is honestly the best technical fit — SQL-first, `onConflictDoNothing()`
> is first-class, plain-SQL migrations, tiny runtime. I did not pick it because
> the Nest integration is DIY and the migration workflow was unfamiliar to me,
> inside a two-to-three day timebox that ends with me modifying this code live.
> That is a risk decision, not a claim that TypeORM is better. With more runway I
> would build this on Drizzle.

**Follow-up — "what did you give up?"** Type safety, mainly — TypeORM's is the
weakest of the three. I compensated with repository interfaces so the service
layer is not coupled to TypeORM's API, migrations committed and drift-checked in
CI, and `synchronize: false` in every environment including development.

**Follow-up — "why `synchronize: false` even in dev?"** Because a reviewer runs
migrations from a clean clone. `synchronize: true` in development means schema
drift is invisible to me and breaks for everyone else. The CI drift check exists
for the same reason.

`BN:` তিনটা SQL statement-ই সিদ্ধান্তটা ঠিক করেছে। "Drizzle আসলে ভালো ফিট, কিন্তু timebox-এর ঝুঁকির কারণে নেইনি" — এই সৎ উত্তরটাই সবচেয়ে ভালো শোনায়।

---

### Q. Explain the asynchronous processing approach.

> One BullMQ queue, one job per event, `jobId` set to the event id. The worker is
> a Nest application context with no HTTP server — same codebase, different
> entrypoint, same Docker image.
>
> Setting `jobId = eventId` gives free deduplication: BullMQ will not add a second
> job with an existing id, so a retried enqueue from the API or from the
> reconciliation cron is a no-op.
>
> The job payload is deliberately just `{ eventId }`. The worker re-reads current
> state from Postgres, so it can never act on a stale copy of the payload, and
> Redis never holds business data.
>
> Concurrency is per-worker (`WORKER_CONCURRENCY`) and horizontal
> (`--scale worker=3`); correctness across both comes from the advisory lock, not
> from limiting concurrency to one.

**Follow-up — "why not process inline in the request?"** Because processing takes
seconds and depends on an unreliable external system. Holding the connection ties
up a socket, gives the client no retry story, and makes a provider outage into an
API outage.

`BN:` এক job = এক event, jobId = eventId. Job-এ শুধু id, payload না।

---

### Q. What happens during failure and recovery?

Three separate answers — do not blur them:

1. **Failure of the external call** -> classified transient -> exponential
   backoff, up to 5 attempts, status `AWAITING_RETRY` with `nextRetryAt` visible
   in the UI. If it never clears -> `FAILED / RETRIES_EXHAUSTED`.
2. **Failure of business validation** -> classified permanent -> `UnrecoverableError`
   -> BullMQ stops after one attempt -> `FAILED / PERMANENT` with a stable error
   code. Retrying could never help, so retrying would only waste time and hide
   the real problem.
3. **Failure of the worker itself** -> two nets. BullMQ's stalled detection
   returns the job to `waiting` once the lock stops being renewed. And a
   per-minute reconciliation cron treats Postgres as the source of truth and
   repairs three drifts: `PENDING` rows that were never enqueued, `PROCESSING`
   rows with no live job, and non-terminal rows with no job in Redis at all.

> The reason recovery is safe is that it is just reprocessing, and reprocessing is
> idempotent. I did not build a separate recovery path — I made the normal path
> safe to repeat.

**Follow-up — "why do you need the cron if BullMQ already detects stalls?"**
Because BullMQ can only recover a job Redis still knows about. It cannot help if
the API committed the row and then died before enqueueing, or if Redis restarted
without persistence. The database outlives Redis, so the database has to be the
authority for reconciliation.

`BN:` তিনটা failure আলাদা — provider, business rule, worker। Recovery মানে শুধু আবার process, আর সেটা safe কারণ idempotent।

---

### Q. How is duplicate processing prevented?

Answer at three layers, in this order:

1. **Duplicate HTTP request** -> unique `idempotencyKey` column. Derived from the
   business content by default, overridable by an `Idempotency-Key` header. Two
   concurrent identical POSTs both attempt the insert; one gets a `P2002` unique
   violation, catches it, loads the original, and returns 200 with
   `duplicate: true`.
2. **Duplicate job** -> `jobId = eventId`; BullMQ rejects the second add.
3. **Duplicate application** -> the `PayrollApplication` ledger. The insert is the
   first statement of the apply transaction, `ON CONFLICT (eventId) DO NOTHING`.
   Zero rows affected means a previous attempt already applied it, so the mutation
   is skipped entirely.

> Layers 1 and 2 are optimisations — they save work. Layer 3 is the correctness
> guarantee. If you took away 1 and 2, the system would still never apply a change
> twice.

**Follow-up — "why not check first and then insert?"** A read-then-write is racy;
two requests can both pass the read. Only the database constraint is atomic. This
is the single most likely follow-up on this topic — have it ready.

**Follow-up — "what if the provider succeeded but you crashed before committing?"**
Then the ledger row does not exist, so we call the provider again — which is why
the provider call carries `event.id` as an idempotency key. A real provider would
deduplicate it; my simulator does the same. That is the honest answer: without an
idempotency key on the external side, at-least-once delivery means the external
call may repeat, and no amount of local transaction discipline fixes that.

`BN:` তিন স্তর — API-তে unique key, queue-তে jobId, DB-তে ledger। প্রথম দুইটা optimization, তিন নম্বরটাই আসল guarantee।

---

### Q. Explain the testing strategy.

> Four layers, with an explicit definition for each, because the words get used
> loosely. Unit means no IO at all — schemas, the IBAN checksum, the failure
> classifier, backoff maths. Integration means our code against one real
> dependency — mostly Postgres, for the apply transaction, the advisory lock, and
> the ordering SQL, because those are behaviours of the database and mocking them
> would test nothing. Functional means the whole Nest app through HTTP with the
> queue spied, asserting response contracts. E2E means docker compose running for
> real, submitting over HTTP and polling until terminal.
>
> Two decisions I would defend. First, no test depends on the random failure rate
> — the provider takes a deterministic injection hook, and `PROVIDER_FAILURE_RATE`
> is zero in tests. Random failure is a demo feature, not a test mechanism, and it
> is the classic source of flaky suites. Second, the concurrency tests assert
> invariants, not timings: exactly one ledger row per event, and `appliedAt`
> increasing with `sequence` within an employee. Timing-based concurrency tests
> pass on your laptop and fail in CI.

**Follow-up — "which test would catch the most serious bug?"** The concurrency
integration test — 4 workers, 50 events, 5 employees. It is the only one that can
catch a broken lock, a broken ordering gate, or a double apply, and those are the
failures that would actually corrupt payroll data.

`BN:` চার স্তরের সংজ্ঞা মুখস্থ। "কোনো test random failure-এর উপর নির্ভর করে না" — এটা বলার মতো পয়েন্ট।

---

### Q. Explain the CI pipeline.

> Six jobs: lint and format and typecheck first because they are fast and catch
> the most; then unit tests; then integration and e2e against postgres and redis
> service containers with migrations applied; a migration-drift check using
> `typeorm migration:generate --check`; a docker build of both images; and a
> frontend typecheck and build.
>
> They are wired as required status checks under branch protection, which is what
> makes the pipeline actually *prevent* a merge rather than just report on one.
> Nothing in it is advisory — no `continue-on-error` — because a job that cannot
> fail is not a gate.
>
> The drift check is the one I would highlight. It catches someone editing an
> entity without generating a migration — which passes every test locally because
> their database is already migrated, and then breaks `docker compose up` for the
> next person who clones the repo.

`BN:` Fast check আগে, তারপর ভারী। Migration drift check-টা তুমি কেন রাখছো সেটা বলতে পারলে ভালো লাগবে।

---

### Q. Discuss the trade-offs.

Pick three; do not list ten. Suggested set:

1. **Ordering via a deferral gate instead of BullMQ Pro groups.** I get the
   guarantee with open-source components and keep ordering logic in the database
   where the ordering data lives. Cost: a deferred job polls rather than being
   pushed, so there is a bounded wait (max 5s per check) behind a slow
   predecessor. At high volume I would have the predecessor's completion promote
   its successor directly, or pay for groups.
2. **Reconciliation cron instead of a transactional outbox.** Same guarantee for
   the commit-then-enqueue gap, far less machinery, but recovery latency is up to
   a minute instead of near-instant. At higher volume, an outbox table plus a
   relay is the correct upgrade, and the cron stays as a backstop.
3. **Unknown errors treated as transient.** A bug in my code retries instead of
   permanently discarding a payroll change. Cost: a deterministic bug burns five
   attempts before surfacing. I chose it because losing a real payroll change is
   worse than a slow failure, but the reverse is defensible and it is one line to
   change.

Optional fourth if they push: **JSON payload vs per-type tables.** Flexible and
migration-free for new event types, at the cost of database-level constraints on
the payload — mitigated because the *state* tables are strongly typed and the API
rejects anything the schema does not accept.

`BN:` তিনটাই যথেষ্ট। প্রতিটার জন্য "খরচটা কী" আর "কখন অন্যটা নিতাম" বলা লাগবে।

---

### Q. Make or describe a small change.

They will likely ask for one of these. Have the answer ready:

| Request | Answer |
|---|---|
| **Add `BONUS_PAYMENT`** | New folder in `event-types/handlers/`: a class-validator DTO and a handler class with `validate` and `apply`. Register it in the `PAYROLL_EVENT_HANDLER` provider array. Add a column or table via one migration if it needs one. Nothing else changes — controller, validation pipe, queue, processor, ordering, retries, and the UI (which reads `GET /events/types`) all pick it up automatically. |
| **Add a manual retry endpoint** | `POST /events/:id/retry` — only allowed when status is `FAILED`; reset to `PENDING`, write a history row with the operator's reason, re-enqueue with a fresh job id (`eventId:retry:N`, since the original job id is consumed). The ledger still prevents a double apply if the original had in fact succeeded. |
| **Make a failed predecessor block its successors** | One line in the ordering gate: change `status NOT IN ('SUCCEEDED','FAILED')` to `status <> 'SUCCEEDED'`. Then successors wait until the failure is manually resolved. It is currently non-blocking on purpose — a failed address change should not hold up a salary change — but it is a business policy, not a technical constraint. |
| **Add priority events** | BullMQ supports job priority; add `priority` to the enqueue options. But note the interaction: priority is a *queue* concern and ordering is a *per-employee* concern, so a high-priority event still cannot overtake an earlier event for the same employee. That interaction is worth naming out loud. |
| **Change retry counts / backoff** | Environment variables — `JOB_ATTEMPTS`, `JOB_BACKOFF_MS`. Nothing is hard-coded. |
| **Support 100k events/day** | Nothing structural changes. Scale workers horizontally; add a partial index on `status` for the non-terminal rows the cron scans; move the reconciliation scan to a keyset-paginated batch; consider the outbox upgrade. The advisory lock does not become a bottleneck because it is keyed per employee. |

`BN:` "ছোট একটা change করো" — এটা প্রায় নিশ্চিত আসবে। উপরের টেবিলটা আগে থেকে ঠোঁটস্থ রাখো।

---

## Part 4 — Harder follow-ups you should not be ambushed by

**"Your advisory lock uses `hashtext(employeeId)` — what about hash collisions?"**
Two different employees can collide on a 32-bit hash. The consequence is a
harmless false conflict: one of them briefly waits for the other. It never causes
incorrect processing, because the lock is only ever an exclusion mechanism, never
an identity. If I wanted collisions gone entirely I would keep a small
`employee_lock_id BIGSERIAL` column and lock on that. *(Know this one — it is the
sharpest question available about this design.)*

**"What if the same employee has thousands of queued events?"**
They serialise by design, and the deferral gate means later jobs wake, check, and
re-defer. Bounded at a 5s backoff each, so the waste is small, but it is real. The
fix is push-based promotion on predecessor completion.

**"Two workers, both defer, nobody makes progress?"**
Not possible: the deferral condition is "an earlier non-terminal event exists" or
"someone else holds the lock". The event with the lowest sequence for that
employee never has an earlier sibling, so it always passes the gate. There is
always exactly one runnable head per employee.

**"Your reconciliation cron runs on every API replica — won't they fight?"**
It is guarded by a Redis `SET NX PX` lock, so one instance runs it per tick. And
even if two ran, every action it takes is idempotent — the enqueues are
deduplicated by `jobId`, and the status resets are conditional updates.

**"Why 202 and not 201?"**
201 would claim a resource was created and is complete. The event resource *is*
created, but the client's actual intent — the payroll change — is not applied yet.
202 Accepted plus a `statusUrl` is the honest description of that. Either is
defensible; the reasoning is what matters.

**"You return 200 for a duplicate instead of 409. Why?"**
Because from the retrying client's perspective, nothing went wrong — its request
was fulfilled, just earlier. A 409 would push a naive client into an error branch
for what is a successful outcome. The response carries `duplicate: true` so a
client that cares can tell the difference.

**"What if two events for the same employee have the same `effectiveDate`?"**
Processing order is acceptance order (`sequence`), not effective date. Last write
wins on the state table, and the full history is preserved in the event log and
ledger. If the business needed effective-date semantics — future-dated changes
applied on a schedule — that is a scheduling feature, not an ordering feature, and
I would model it separately.

**"Is your system exactly-once?"**
No — no distributed system is. Delivery is at-least-once; the *effect* is
exactly-once, because the consumer is idempotent. That distinction is the whole
design. Say it in those words.

**"What breaks first under load?"**
Postgres connections, probably — every worker slot holds a connection during the
provider call. The fix is to not hold a transaction open across the external call,
which is why the ordering gate and the apply are two short transactions with the
provider call *between* them rather than inside one.

`BN:` শেষের প্রশ্নটা সবচেয়ে ভালো — "provider call transaction-এর বাইরে রাখছি" এটা design-এর একটা সচেতন সিদ্ধান্ত, বলতে পারলে ভালো ইম্প্রেশন।

---

## Part 5 — Live demo script (5 minutes)

1. `docker compose up --scale worker=3` — point out the worker containers have no
   ports mapped.
2. Open the frontend. Submit a `SALARY_CHANGE`. Watch the row go
   `QUEUED -> PROCESSING -> SUCCEEDED` live.
3. Open the detail page. Show the timeline, the `externalRef`, and the
   `snapshotBefore` in the ledger.
4. Hit **Submit duplicate**. Show the 200 with `duplicate: true` and that the list
   did not grow.
5. Hit **Force transient failure**. Watch `AWAITING_RETRY` with `nextRetryAt` and
   a rising attempt count, then success on attempt 3.
6. Hit **Force permanent failure**. One attempt, `FAILED / PERMANENT`,
   `EMPLOYEE_NOT_FOUND` visible in the failure box.
7. Hit **Ordering demo** (3 events, one employee) and **Burst** (20 events, 5
   employees) together — the employee's three complete strictly in order while the
   other employees' events interleave.
8. `docker kill <one worker>` mid-burst. Show that nothing is lost, the stalled
   job is picked up elsewhere, and the final state has exactly one ledger row per
   event.
9. `GET /health/ready` and `/docs`.

If you only have two minutes: steps 2, 4, 5, 8.

`BN:` ৮ নম্বর step-টাই সবচেয়ে বেশি নম্বর আনবে — worker মেরে দিয়ে দেখানো যে কিছু হারায় না।

---

## Part 6 — Things to say that signal seniority

- "Delivery is at-least-once; the effect is exactly-once because the consumer is
  idempotent."
- "Redis holds no business data — jobs carry an id, not a payload. A Redis flush
  costs throughput, not correctness."
- "I made the normal path safe to repeat instead of writing a separate recovery
  path."
- "The ordering rule lives in the database because the ordering data lives there,
  so it survives losing Redis."
- "That is a business policy, not a technical constraint — here is the one line
  that changes it."
- "I tested invariants, not timings, because timing-based concurrency tests pass
  locally and fail in CI."
- "I know the limitation here, and here is the upgrade path and when I would take
  it."

And the one to avoid: never say "it can't happen". Say what happens if it does.
