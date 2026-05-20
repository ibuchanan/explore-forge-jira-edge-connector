# Sample app architecture exemplar plan

## Purpose

Build a Forge sample app that demonstrates how Jira Edge Connector can act as an on-premise event bridge for Forge. The sample should be an architecture exemplar: it should prioritize clear boundaries, secure callback handling, task state modeling, storage patterns, and testability over visual polish.

## Goals

- Demonstrate a Jira-centric asynchronous integration pattern where on-premise work is initiated through Jira Edge Connector and reports progress back to Forge.
- Use a Jira global page as the user-facing surface.
- Provision Jira Edge Connector channels from the app.
- Support real JEC integration while retaining a fallback/simulator path for local development and CI.
- Store task history as an event log and derive current task state from that log.
- Authenticate public Forge web trigger callbacks with signed HMAC requests, timestamp validation, nonce/event replay protection, task binding, and channel binding.
- Keep all JEC-specific API details behind a narrow adapter boundary.

## Non-goals

- Build a production-ready customer deployment with full operational hardening.
- Replace customer-specific JEC/on-premise setup documentation.
- Store large or sensitive report artifacts in Forge storage.
- Build a Custom UI app. The sample should use UI Kit only.

## Resolved decisions

| Area | Decision |
| --- | --- |
| Primary goal | Architecture exemplar |
| UI surface | `jira:globalPage` |
| JEC fidelity | Real JEC hooks plus fallback/simulator path |
| JEC setup | App provisions channels |
| Secret model | Forge encrypted variables for deployment/root secret material; Forge KVS for channel metadata, task records, nonces, and event logs |
| State model | Event-log-first with derived task projection |
| Callback auth | Signed HMAC callback requests |
| First milestone | Full exemplar |

## High-level architecture

```text
Jira global page
  └─ invokes resolver actions
       ├─ setup/provision JEC channel
       ├─ create report task
       ├─ list tasks
       ├─ read task detail/event log
       └─ trigger fallback simulator path

JEC / fallback simulator
  └─ sends signed callback to Forge web trigger

Forge web trigger
  ├─ validates HMAC signature
  ├─ checks timestamp window
  ├─ rejects replayed nonce/event IDs
  ├─ validates task + channel binding
  ├─ appends callback event
  └─ projects task current state

Scheduled trigger
  └─ expires stale tasks and prunes old nonces/events
```

## Manifest changes

Replace the existing JSM queue page with a Jira global page and add backend surfaces for callbacks and cleanup.

Expected modules:

- `jira:globalPage`
- `webtrigger`
- `scheduledTrigger`
- `function`

Expected functions:

- UI resolver function
- callback web trigger handler
- scheduled cleanup handler

Expected scopes:

```yaml
permissions:
  scopes:
    - storage:app
    - read:ops-config:jira-service-management
    - write:ops-config:jira-service-management
    - delete:ops-config:jira-service-management
```

Scope notes:

- `storage:app` is required for `@forge/kvs`.
- JEC/JSM Ops scopes must be validated against the exact channel provisioning and dispatch APIs used.
- JEC APIs appear experimental, so raw API usage must stay isolated in the JEC adapter.

## Proposed source structure

```text
src/
  index.js
  frontend/
    index.jsx
  resolvers/
    index.js
  webtriggers/
    callback.js
  scheduled/
    cleanup.js
  domain/
    task-state.js
    callback-events.js
    signatures.js
  infrastructure/
    storage/
      task-store.js
      nonce-store.js
      channel-store.js
    jec/
      jec-channel-adapter.js
      simulator-adapter.js
  shared/
    constants.js
    errors.js
```

## Domain model

Core concepts:

- `ReportTask`: asynchronous report request created by Forge.
- `TaskEvent`: immutable event in the task history.
- `TaskProjection`: current state derived from events.
- `JecChannel`: channel metadata used to dispatch work through JEC.
- `CallbackNonce`: replay-protection record.
- `CallbackSignature`: parsed and verified callback authentication data.

Task states:

- `pending`
- `running`
- `complete`
- `failed`
- `expired`

Event types:

- `TASK_CREATED`
- `JEC_CHANNEL_PROVISIONED`
- `JEC_DISPATCH_REQUESTED`
- `CALLBACK_ACCEPTED`
- `TASK_RUNNING_REPORTED`
- `TASK_COMPLETED_REPORTED`
- `TASK_FAILED_REPORTED`
- `TASK_EXPIRED`

## UI plan

Use UI Kit components from `@forge/react` only. Do not use standard HTML components or third-party React components.

The Jira global page should include:

1. Setup status
   - Show whether a JEC channel is provisioned.
   - Provide a “Provision channel” action.
   - Show whether fallback/simulator mode is available.

2. Create report task
   - Simple form for report name and optional context.
   - Let the user choose real JEC or fallback/simulator mode.

3. Task list
   - Use `DynamicTable`.
   - Include task ID, status, created time, last event, and mode.
   - Use `Lozenge` for task status.

4. Task detail
   - Show event log entries.
   - Show safe callback verification metadata.
   - Never display raw secrets.

The UI should not render the app title itself, because the Forge product chrome renders the module title.

## Resolver actions

Resolver functions:

- `getSetupStatus`
- `provisionJecChannel`
- `createReportTask`
- `listReportTasks`
- `getReportTask`
- `runFallbackSimulation`
- `rotateCallbackKey` — optional if key rotation hooks are included in the first pass

Resolver responsibilities:

- Validate input payloads.
- Enforce admin authorization for setup/provisioning actions.
- Coordinate domain services.
- Avoid embedding raw JEC API details.

## JEC adapter boundary

Keep raw JEC API calls behind an adapter interface.

Conceptual interface:

```js
provisionChannel()
dispatchReportTask(task)
getChannelStatus()
deleteChannel()
```

The rest of the app should not know the raw JEC endpoint paths or response shapes.

A simulator adapter should implement the same conceptual contract for local development and CI.

## Web trigger callback flow

The web trigger handler should:

1. Parse the request.
2. Extract key ID/channel ID, task ID, timestamp, nonce or event ID, and signature.
3. Rebuild the canonical request string.
4. Verify the HMAC signature.
5. Enforce a short timestamp validity window.
6. Reject reused nonce/event IDs.
7. Load the task.
8. Confirm task and channel binding.
9. Append a callback event.
10. Update the task projection.
11. Return a stable JSON response.

The web trigger URL itself is not authentication. Every request must be treated as untrusted until the callback verifier accepts it.

## Callback signature design

Use HMAC over a canonical string that includes at least:

- HTTP method
- request path or callback route identity
- body hash
- timestamp
- nonce/event ID
- task ID
- channel ID or key ID
- installation or tenant identifier where available

Recommended headers:

```http
Authorization: Signature keyId="...", algorithm="hmac-sha256", signature="..."
X-Forge-Task-Id: ...
X-Request-Timestamp: ...
X-Request-Nonce: ...
X-JEC-Channel-Id: ...
```

## Storage plan

Use `@forge/kvs`.

Stores:

- Channel metadata store
- Task projection store
- Task event log store
- Nonce/event replay store
- Optional setup/config store

Sensitive per-install values that must be stored in KVS should use encrypted KVS methods where possible. Deployment-level root secret material should use Forge encrypted variables.

## Cleanup plan

Add a scheduled trigger that:

- Expires tasks older than a configured threshold.
- Appends `TASK_EXPIRED` events where appropriate.
- Prunes old nonce/event replay records.
- Optionally prunes old event logs according to retention policy.

## Fallback/simulator plan

The fallback path should not pretend to be real JEC. It should be explicitly labeled as simulator mode.

Recommended approach:

- Runtime simulator adapter for local/manual demo paths.
- Tests call callback/domain handlers directly.
- Optional manual helper can generate signed callback payloads for web trigger testing.

## Testing plan

Add or update tests for:

1. Manifest wiring
   - `jira:globalPage` exists and points to resolver.
   - `webtrigger` exists and points to callback handler.
   - `scheduledTrigger` exists and points to cleanup handler.
   - `storage:app` is declared when `@forge/kvs` is imported.

2. Callback authentication
   - Accepts valid HMAC.
   - Rejects invalid signature.
   - Rejects stale timestamp.
   - Rejects reused nonce/event ID.
   - Rejects task/channel mismatch.

3. Event projection
   - Derives current state from event log.
   - Treats terminal states as immutable.
   - Handles retries and out-of-order events deterministically.

4. JEC adapter boundary
   - Resolver calls adapter interface rather than raw endpoints directly.
   - Fallback adapter follows the same contract.

5. UI invoke wiring
   - Frontend invokes only resolver names implemented by the resolver and wired through the manifest.

## Implementation order

1. Convert manifest from JSM queue page to Jira global page.
2. Add web trigger and scheduled trigger wiring.
3. Add `@forge/kvs` dependency and `storage:app` scope.
4. Build task event, state projection, and HMAC verifier domain modules.
5. Build KVS-backed storage adapters.
6. Build callback web trigger handler.
7. Build resolver actions.
8. Build JEC adapter and fallback simulator adapter.
9. Build Jira global page UI.
10. Add and update tests.
11. Run package tests, lint, and `forge lint`.

## Risks and open dependencies

### Exact JEC API contract

Need to confirm the exact endpoints, request payloads, response payloads, and scopes for:

- Create channel
- List/get channel
- Delete channel
- Send action or dispatch task into channel

### Admin authorization

Channel provisioning must be admin-only. Need to choose the authorization check:

- Jira global admin permission
- JSM admin/project permission
- Documented sample assumption

### Forge encrypted variables

Need final variable names and setup instructions, for example:

- `CALLBACK_HMAC_SECRET`
- `CALLBACK_HMAC_KEY_ID`
- `JEC_API_MODE`

### Real JEC dispatch payload

Need to align the task dispatch payload with real JEC semantics. Candidate payload:

```json
{
  "taskId": "...",
  "callbackUrl": "...",
  "callbackKeyId": "...",
  "requestedBy": "...",
  "reportType": "...",
  "createdAt": "..."
}
```

## Recommended implementation posture

Proceed with the full exemplar, but keep JEC behind a narrow adapter. The architecture should remain stable even if the experimental JEC API changes.
