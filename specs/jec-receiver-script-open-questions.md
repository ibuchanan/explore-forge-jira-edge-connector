# JEC receiver script open questions

## Purpose

Capture the current understanding and unresolved questions for a Jira Edge Connector (JEC) receiver script. This is intentionally not a final design. It records the direction explored so far so that the JEC runtime and configuration details can be confirmed before the sample app architecture is updated.

## Current correction to the earlier architecture

The earlier sample-app architecture assumed an on-premise service would send signed HTTPS callbacks to a Forge web trigger. That is probably not the desired model for this spec.

The direction to explore instead is:

```text
JEC event/channel -> JEC JSON configuration -> TypeScript receiver script -> local/on-premise handling
```

In this model, the TypeScript script is run by JEC. The Forge app does not necessarily need a web trigger callback endpoint.

## Working terminology

### JEC configuration file

A JSON configuration file consumed by JEC. It should define enough information for JEC to know which TypeScript script to run, which event or channel the script handles, and what runtime configuration is available to the script.

Open questions:

- What is the exact JSON schema?
- How does the configuration reference the TypeScript script?
- Does the configuration define channels, event types, permissions, environment variables, secrets, or runtime options?
- Is the configuration installed or registered through Jira/JSM APIs, local JEC tooling, or both?
- Does the configuration support multiple handlers, or should the sample use one configuration per receiver script?

### JEC receiver script

A thin TypeScript script executed by JEC when a matching event is delivered.

Recommended role for the receiver script:

1. Receive the JEC-delivered event.
2. Validate the event shape.
3. Acknowledge or fail quickly according to JEC's execution contract.
4. Perform local work or delegate local work to another on-premise service/queue.
5. Avoid coupling the JEC event contract to one specific report implementation.

Open questions:

- What function shape does the script export?
- Is the script invoked once per event?
- Does JEC pass the event payload as a function argument, stdin, environment variable, file, or another mechanism?
- Can the script perform asynchronous work after acknowledging the event?
- How does the script signal success, failure, retryable failure, or permanent failure?
- What are the timeout, memory, filesystem, network, and dependency constraints?
- Does JEC compile TypeScript, run precompiled JavaScript, or require a bundling step?
- How are npm dependencies provided to the script?
- Where should the script log operational diagnostics?

### JEC event payload

The JSON input passed by JEC to the receiver script.

Likely fields to confirm:

- event ID or execution ID
- task ID or correlation ID
- channel ID or source ID
- event type or action name
- Jira cloud/site context
- Jira project, issue, alert, or service context, if applicable
- user or actor context, if applicable
- request parameters for the local/on-premise work
- timestamps
- retry attempt metadata

Open questions:

- What fields does JEC actually provide?
- Which fields are stable and safe for the receiver script to depend on?
- Does the payload include a correlation ID created by Forge, Jira, or JEC?
- Does the payload include enough tenant/site context to bind local work to the correct customer environment?
- Does the payload include authentication/provenance metadata, or does JEC authenticate before invoking the script?
- Should the receiver script validate signatures, or is invocation by JEC sufficient trust?

### Local task handling

The on-premise work performed after the receiver script accepts the event. The receiver may perform the work directly or hand it off to a local worker, queue, service, or script.

Open questions:

- Should the sample perform a tiny local action directly, or demonstrate delegation to a local worker?
- If work is delegated, what is the local interface: HTTP, queue, shell command, file drop, or library call?
- What idempotency key should local handling use?
- How should duplicate JEC deliveries be detected?
- How should retry behavior interact with local task state?
- Where should local results be stored?

## Forge app implications

The current sample app contains a Forge web trigger callback implementation. If the receiver-script architecture is confirmed, that callback path may be unnecessary.

Current callback-oriented files and wiring to revisit:

- `apps/jec-dispatcher/manifest.yml` currently declares `webtrigger: jec-callback`.
- `apps/jec-dispatcher/src/index.ts` currently exports `callback`.
- `apps/jec-dispatcher/src/webtriggers/callback.ts` implements signed callback acceptance.
- `apps/jec-dispatcher/src/domain/callback-events.ts` models callback payloads.
- Some tests may assert callback/webtrigger behavior.

Open questions:

- Should the web trigger be removed entirely from the sample app?
- Should callback handling be preserved only as an alternative architecture note?
- Should the Forge task model be simplified if Forge no longer receives completion callbacks?
- Is Forge still responsible for initiating a JEC event, or is the sample only about receiving Jira-originated JEC events?
- Should the Forge UI display task status, or only configuration/dispatch state?

## Status and result reporting options

Without a Forge web trigger callback, the return path for completion status is unresolved.

### Option A: dispatch-only Forge app

Forge records only that work was requested or dispatched. Completion is owned by JEC/local systems.

Possible Forge-visible states:

- `pending`
- `dispatched`
- `dispatch_failed`

Open questions:

- Is this enough for the sample's purpose?
- Should the UI explicitly say that completion is visible only in local/JEC logs?
- Does this make the sample too incomplete as an end-to-end workflow?

### Option B: receiver writes status to Jira/JSM product state

The receiver updates a Jira/JSM resource that Forge can later read through normal product APIs.

Possible targets to investigate:

- issue comment/update
- JSM Ops alert or event
- Assets object
- JEC-associated channel/execution resource
- another Jira/JSM resource appropriate to the use case

Open questions:

- Which Jira/JSM resource should own status?
- Does the JEC receiver script have credentials or context to write to that resource?
- Should Forge poll that resource, or should users view status directly in Jira/JSM?
- What permissions/scopes would the Forge app need if it reads the status later?

### Option C: native JEC execution status

JEC may provide a native execution status/result model that Forge or Jira can query.

Open questions:

- Does JEC expose execution result/status?
- Is the status durable?
- Can Forge query it through supported APIs?
- Can the TypeScript receiver script attach structured result data to the JEC execution?
- How are failed and retried executions represented?

## Security and trust questions

The callback-based model used HMAC signatures, timestamp checks, nonce checks, and task/channel binding. The receiver-script model has a different trust boundary.

Open questions:

- What does JEC guarantee before invoking the script?
- Does the script need to authenticate the event payload?
- How should the script validate tenant/site/channel binding?
- How are secrets provided to the script?
- Can the script call local services securely?
- Does the script need to protect against replayed or duplicated events?
- What audit logs are available for script execution?

## Sample structure to consider

Potential files if this direction is confirmed:

```text
apps/jec-dispatcher/
  jec/
    jec-config.json
    receiver.ts
    README-or-inline-comments TBD
```

Open questions:

- Should the JEC assets live inside `apps/jec-dispatcher/jec/`, another app-level directory, or a separate package?
- Should the receiver script import shared domain types from the Forge app, or should it be self-contained?
- If the receiver script runs outside Forge, can it safely import workspace packages?
- Should the sample include tests for the receiver script independent of Forge?

## Information needed before finalizing the spec

Before making implementation decisions, confirm:

1. Exact JEC JSON configuration schema.
2. Exact TypeScript script invocation contract.
3. Exact event payload shape.
4. Runtime limits and dependency packaging model.
5. Status/result reporting mechanism.
6. Whether Forge initiates JEC events or only demonstrates related app setup.
7. Whether the existing Forge web trigger callback path should be removed, retained as an alternative, or moved out of the main sample.

## Current recommendation to validate

Treat the JEC receiver script as a thin adapter at the customer-network edge. It should validate the event and delegate local work rather than implement a full report-generation domain. Keep the JEC event contract small and stable, and avoid adding a Forge web trigger unless a confirmed return path requires it.
