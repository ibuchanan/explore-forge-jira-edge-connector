# Sample app architecture exemplar plan

## Purpose

Build a Forge sample app that demonstrates how Jira Edge Connector can act as an on-premise event bridge for Forge. The sample should be an architecture exemplar: it should prioritize clear boundaries, asynchronous dispatch modeling, storage patterns, and testability over visual polish.

## Goals

- Demonstrate a Jira-centric asynchronous dispatch pattern where on-premise work is initiated through JEC via the JSM Ops REST API.
- Use a Jira global page as the user-facing surface.
- Provision JEC channels from the Forge app.
- Support real JEC integration while retaining a fallback/simulator path for local development and CI.
- Store task state as dispatch-only: `pending → dispatched / dispatch_failed`.
- Keep all JEC-specific API details behind a narrow adapter boundary.

## Non-goals

- Implement a Forge web trigger callback for JEC completion events (not part of the standard JEC model).
- Store large or sensitive report artifacts in Forge storage.
- Build a Custom UI app — UI Kit only.
- Replace customer-specific JEC/on-premise setup documentation.
- Build a production-ready customer deployment with full operational hardening.

## Resolved decisions

| Area | Decision |
| --- | --- |
| Primary goal | Architecture exemplar |
| UI surface | `jira:globalPage` |
| JEC fidelity | Real JEC hooks plus fallback/simulator path |
| JEC setup | App provisions channels via JSM Ops API |
| Secret model | Forge KVS for channel metadata and task records |
| State model | Dispatch-only: `pending → dispatched / dispatch_failed` |
| Callback auth | Removed — not part of the standard JEC model |
| Script language | Python (stdlib-only) |
| Repo structure | `apps/dispatcher/` (Forge app), `apps/receiver/` (on-premise assets) |
| First milestone | Full exemplar |

## High-level architecture

```text
Jira global page
  └─ invokes resolver actions
       ├─ setup/provision JEC channel  → POST /v1/jec/channels
       ├─ create and dispatch task     → POST /v1/jec/action?channelId=...
       ├─ list tasks
       └─ trigger fallback simulator path

JEC binary (on-premise, customer-managed)
  └─ polls JSM Ops queue
       └─ invokes receiver.py with CLI flags
            ├─ --payload   (JSON: task details from SendJecActionDto.details)
            ├─ --apiKey    (JEC API key)
            ├─ --jsmUrl    (https://api.atlassian.com)
            ├─ --logLevel
            └─ --jecNamedPipe (optional: named pipe for result callback)

apps/receiver/receiver.py
  ├─ parses CLI flags
  ├─ validates payload fields (taskId, taskType, etc.)
  ├─ appends event to local log file   ← stand-in for customer's Kafka queue
  └─ writes success JSON to --jecNamedPipe (if present)

Scheduled trigger (Forge)
  └─ expires tasks stuck in `pending` beyond TTL
```

## Repo structure

```text
apps/
  dispatcher/          ← Forge app (was: apps/jec-dispatcher/)
    manifest.yml
    package.json
    src/
      index.ts
      domain/
        task-state.ts      ← dispatch-only: pending/dispatched/dispatch_failed
        signatures.ts      ← REMOVED (no HMAC callback)
        callback-events.ts ← REMOVED (no callback)
      infrastructure/
        jec/
          jec-channel-adapter.ts   ← real JSM Ops API calls
          simulator-adapter.ts     ← short-circuits real dispatch for dev/CI
        storage/
          channel-store.ts
          task-store.ts
          nonce-store.ts  ← REMOVED (no replay protection without callback)
      resolvers/
        index.ts
      scheduled/
        cleanup.ts
      shared/
        constants.ts
        errors.ts
    test/
      ...

  receiver/            ← on-premise JEC assets (new)
    package.json       ← workspace package for tooling (lint, test)
    jec-config.json    ← JEC binary configuration (actionMappings → receiver.py)
    receiver.py        ← Python action script invoked by JEC
    README.md          ← setup instructions for customers

packages/
  forge-ahead/         ← shared Forge library (unchanged)
```

## JEC channel API (confirmed from generated types)

All endpoints are under `https://api.atlassian.com/jsm/ops/api/{cloudId}/v1/jec/`.

### Channel provisioning

```
POST /v1/jec/channels
Body: CreateJecChannelDto { name, ownerId, ownerDomain }
Response: JecChannelWithApiKey { id, name, ownerId, ownerDomain, authorAccountId, apiKey }
```

The `apiKey` in the response is the value the customer puts in their `jec-config.json`. Store `id` and `apiKey` in Forge KVS after provisioning.

### Task dispatch

```
POST /v1/jec/action?channelId={channelId}
Body: SendJecActionDto {
  action: string,         // maps to actionMappings key in jec-config.json
  actionType: 'custom',
  details?: Record<string, unknown>  // free-form data map — becomes --payload in the script
}
Response: 202 Accepted (no body)
```

The `details` map is what JEC serialises and passes to the receiver script as `--payload`. This is where the Forge app puts `taskId`, task type, and any other receiver-relevant data.

> **Note:** The generated type says `Record<string, never>` for `details` — this is a codegen artefact. Cast as `Record<string, unknown>` at the call site.

### Required scopes

```yaml
permissions:
  scopes:
    - storage:app
    - read:ops-config:jira-service-management
    - write:ops-config:jira-service-management
    - delete:ops-config:jira-service-management
```

## Receiver script contract (`apps/receiver/receiver.py`)

The Python script is invoked by JEC as an OS process with the following CLI flags:

| Flag | Required | Description |
|---|---|---|
| `--payload` | Yes | JSON string — deserialised `SendJecActionDto.details` |
| `--apiKey` | Yes | JEC API key (handle with care) |
| `--jsmUrl` | Yes | JSM base URL |
| `--logLevel` | Yes | Log level string |
| `--jecNamedPipe` | No | Path to named pipe for writing result back to JEC |

The script:
1. Parses CLI flags with `argparse`
2. Deserialises `--payload` as JSON
3. Validates required fields (e.g. `taskId`, `taskType`)
4. Appends a structured event to a local log file (stand-in for Kafka)
5. If `--jecNamedPipe` is present, writes `{"result": "success", "taskId": "..."}` to the pipe

The log file is the point where a real customer implementation would call `publish_to_kafka()` or equivalent. The sample makes this explicit with a comment.

### JEC config (`apps/receiver/jec-config.json`)

```json
{
  "apiKey": "<replace-with-api-key-from-channel-provisioning>",
  "baseUrl": "https://api.atlassian.com",
  "logLevel": "INFO",
  "actionMappings": {
    "dispatchTask": {
      "sourceType": "local",
      "filepath": "/path/to/apps/receiver/receiver.py",
      "env": [],
      "stdout": "/var/log/jec/receiver.out.txt",
      "stderr": "/var/log/jec/receiver.err.txt"
    }
  },
  "pollerConf": {
    "pollingWaitIntervalInMillis": 100,
    "visibilityTimeoutInSeconds": 30,
    "maxNumberOfMessages": 10
  },
  "poolConf": {
    "maxNumberOfWorker": 4,
    "minNumberOfWorker": 2,
    "queueSize": 0,
    "keepAliveTimeInMillis": 6000,
    "monitoringPeriodInMillis": 15000
  }
}
```

The action name `dispatchTask` must match what the Forge app sends as `SendJecActionDto.action`.

## Task state model (`apps/dispatcher/src/domain/task-state.ts`)

Simplified to dispatch-only:

```typescript
type TaskState = 'pending' | 'dispatched' | 'dispatch_failed'
```

- `pending` — created, not yet dispatched
- `dispatched` — JSM Ops API returned 202
- `dispatch_failed` — JSM Ops API returned an error

The scheduled cleanup expires tasks stuck in `pending` beyond a TTL (e.g. tasks created before the dispatcher was configured).

## Fallback/simulator path

The simulator adapter short-circuits the real JSM Ops API call and directly records a `dispatched` state. It does **not** simulate a completion callback (there is none in the dispatch-only model).

- Production path: `jec-channel-adapter.ts` calls the real JSM Ops endpoints
- Dev/CI path: `simulator-adapter.ts` skips the HTTP call, returns a mock 202

Both adapters implement the same `JecChannelAdapter` interface.

## Manifest changes

Remove `webtrigger` module. Keep:

```yaml
modules:
  jira:globalPage: ...
  trigger:scheduled: ...   ← cleanup
  function: ...            ← resolver + cleanup handler
```

## Removed from original plan

| Removed | Reason |
|---|---|
| `webtrigger` module | Not part of JEC standard model |
| `src/webtriggers/callback.ts` | No Forge web trigger callback |
| `src/domain/callback-events.ts` | No callback events |
| `src/domain/signatures.ts` | No HMAC verification needed |
| `src/infrastructure/storage/nonce-store.ts` | No replay protection without callback |
| `TaskState.complete / failed` | Forge never receives completion signal |

## Testing plan

Add or update tests for:

1. **Manifest wiring**
   - `jira:globalPage` exists and points to resolver
   - `trigger:scheduled` exists and points to cleanup handler
   - `storage:app` is declared when `@forge/kvs` is imported
   - No `webtrigger` module present

2. **Task state transitions**
   - `pending → dispatched` on 202 response
   - `pending → dispatch_failed` on error response
   - Terminal states are immutable

3. **JEC adapter boundary**
   - Resolver calls adapter interface, not raw endpoints
   - Simulator adapter follows the same contract
   - Channel adapter uses correct endpoints and scopes

4. **UI invoke wiring**
   - Frontend invokes only resolver names implemented and wired through manifest

5. **Receiver script (Python)**
   - Parses all required CLI flags
   - Deserialises payload JSON
   - Validates required payload fields
   - Appends structured event to log file
   - Writes named pipe result when `--jecNamedPipe` provided
   - Exits non-zero on validation failure

## Implementation order

1. Rename `apps/jec-dispatcher/` → `apps/dispatcher/`
2. Create `apps/receiver/` with `package.json`, `jec-config.json`, `receiver.py`, `README.md`
3. Strip Forge app: remove webtrigger, callback handler, callback-events, signatures, nonce store
4. Simplify `task-state.ts` to dispatch-only
5. Fill in real JEC channel + action endpoints in `jec-channel-adapter.ts`
6. Update manifest: remove `webtrigger`, keep `jira:globalPage` + `trigger:scheduled`
7. Update resolver actions to match simplified state model
8. Update simulator adapter (no longer simulates callback)
9. Build Jira global page UI
10. Add/update tests for all layers
11. Run package tests, lint, and `forge lint`

## Risks and remaining open questions

### Named pipe result format

The exact JSON schema JEC expects when a script writes to `--jecNamedPipe` is not formally documented. The sample will use `{"result": "success", "taskId": "..."}` and note this may need tuning.

### `details` codegen artefact

`SendJecActionDto.details` is typed as `Record<string, never>` in the generated types — this is a codegen error. The adapter must cast at the call site.

### Admin authorization

Channel provisioning should be admin-only. The sample will document this as a precondition but will not enforce a specific permission check in the exemplar.

### JEC Git sourcing

The sample documents that JEC can source `receiver.py` and `jec-config.json` from Git. The `apps/receiver/` workspace in this repo can serve as the Git source for JEC, making it usable as a real reference deployment.
