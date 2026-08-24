# Architecture

## Component & data flow

```mermaid
flowchart LR
    subgraph client [Browser]
        FE["React frontend<br/>submit · list · detail · demo panel"]
    end

    subgraph api ["API process (NestJS, HTTP)"]
        C["EventsController<br/>POST /events · GET /events/:id · SSE"]
        V["PayrollEventValidationPipe<br/>per-type DTO from the handler registry"]
        S["EventsService<br/>idempotency key · persist · enqueue"]
        H["/health · /health/ready/"]
    end

    subgraph worker ["Worker process (NestJS context, NO http)"]
        P["PayrollProcessor<br/>BullMQ WorkerHost"]
        O["OrderingService<br/>advisory lock + predecessor gate"]
        A["ApplyService<br/>one transaction + ledger"]
        R["ReconciliationService<br/>@Cron every minute"]
        X["SimulatedPayrollProvider<br/>latency · seeded failures"]
    end

    DB[("PostgreSQL<br/>payroll_events · event_status_history<br/>payroll_applications · employee_payroll_states · employees")]
    RQ[("Redis<br/>BullMQ queue: payroll-events<br/>jobId = eventId · SSE pub/sub")]

    FE -->|"HTTP"| C
    C --> V --> S
    S -->|"1. INSERT event + history (tx)"| DB
    S -->|"2. add job { eventId }"| RQ
    C -->|"202 Accepted + statusUrl"| FE

    RQ -->|"consume"| P
    P --> O
    O -->|"lock + order check"| DB
    P --> X
    P --> A
    A -->|"ledger + state + status (one tx)"| DB
    P -->|"publish status change"| RQ
    RQ -->|"SSE"| FE

    R -->|"find orphaned / stale"| DB
    R -->|"re-enqueue"| RQ
    H --> DB
    H --> RQ
```

## ASCII version (for terminals / plain README fallback)

```
   ┌──────────────┐
   │   Browser    │  React: submit · list · detail · demo panel
   └──────┬───────┘
          │ HTTP + SSE
          ▼
   ┌─────────────────────────────────────────┐
   │  API process (NestJS)                   │
   │   validate (per-type DTO via registry)  │
   │   derive idempotency key                │      202 Accepted
   │   INSERT event + history   ── tx ──►    │──────────────────►
   │   queue.add({eventId}, jobId=eventId)   │
   └───────┬────────────────────────┬────────┘
           │                        │
   ┌───────▼────────┐      ┌────────▼────────┐
   │  PostgreSQL    │      │     Redis       │
   │  source of     │      │  BullMQ queue   │
   │  truth         │      │  (ids only)     │
   └───────▲────────┘      └────────┬────────┘
           │                        │ consume
           │               ┌────────▼─────────────────────────┐
           │               │  Worker process (no HTTP)        │
           │               │   1. ordering gate               │
           ├───────────────┤      advisory lock(employeeId)   │
           │  lock + read  │      + predecessor check         │
           │               │   2. handler.validate()          │
           │               │   3. simulated provider call     │
           │  one tx:      │   4. APPLY (single transaction): │
           ├───────────────┤      ledger INSERT ON CONFLICT   │
           │  ledger +     │      + state upsert              │
           │  state +      │      + status SUCCEEDED          │
           │  status       │                                  │
           │               │   ReconciliationService @Cron    │
           └───────────────┤      stale PROCESSING            │
                           │      orphaned PENDING            │
                           └──────────────────────────────────┘

   Scale: docker compose up --scale worker=3
   Correctness across workers = advisory lock (per employee) + ledger unique key
```

## Event state machine

```mermaid
stateDiagram-v2
    [*] --> PENDING: POST /events (committed)
    PENDING --> QUEUED: job added to BullMQ
    QUEUED --> PROCESSING: worker acquires job + passes ordering gate
    PROCESSING --> SUCCEEDED: apply transaction commits
    PROCESSING --> AWAITING_RETRY: transient failure, attempts remain
    AWAITING_RETRY --> PROCESSING: BullMQ backoff elapses
    PROCESSING --> FAILED: permanent error (1 attempt) or retries exhausted
    PROCESSING --> PENDING: reconciliation — stale, no live job
    PENDING --> QUEUED: reconciliation — orphaned, never enqueued
    SUCCEEDED --> [*]
    FAILED --> [*]
```

`SUCCEEDED` and `FAILED` are terminal. `FAILED` carries `failureKind`:
`PERMANENT` (retrying can never help) or `RETRIES_EXHAUSTED` (transient errors
that never cleared).

## Where each reliability guarantee lives

| Guarantee | Mechanism | Location |
|---|---|---|
| Request never blocks on processing | 202 + queue | `events.service.ts` |
| Duplicate HTTP request | `UNIQUE(idempotencyKey)` | Postgres constraint |
| Duplicate job | `jobId = eventId` | BullMQ |
| Duplicate application | `UNIQUE(eventId)` on the ledger, inside the apply tx | Postgres constraint |
| Two workers, one employee | `pg_advisory_xact_lock(hashtext(employeeId))` | Postgres |
| Per-employee FIFO | `sequence BIGSERIAL` + predecessor gate + `moveToDelayed` | Postgres + BullMQ |
| Transient vs permanent | typed error hierarchy + `UnrecoverableError` | `failure-classifier.ts` |
| Worker crash | BullMQ stalled detection **and** reconciliation cron | Redis + Postgres |
| Crash after DB write | ledger insert is the first statement of the apply tx | Postgres |
| Audit trail | `event_status_history` (append-only) + `payroll_applications.snapshotBefore` | Postgres |
