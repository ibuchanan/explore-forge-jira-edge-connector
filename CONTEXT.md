# Domain glossary

This file defines the canonical terms used in this codebase. It is a glossary only — not a spec, plan, or implementation guide.

---

## Dispatcher

The Forge app (`apps/dispatcher/`) that provisions JEC channels and dispatches tasks to them via the JSM Ops REST API. Runs inside the Atlassian cloud platform.

## Receiver

The on-premise Python script (`apps/receiver/receiver.py`) that JEC invokes when a task is dispatched. Runs on the customer's machine or cloud environment. Receives task data via CLI flags. Not a Forge module.

## JEC channel

A provisioned connection between the Forge dispatcher and a JEC binary instance. Created via `POST /v1/jec/channels`. Identified by a channel ID and secured by an API key. Stored in Forge KVS after provisioning.

## Task

A unit of work created by the dispatcher and sent to the receiver. Has a task ID and a type. Progresses through dispatch states: `pending → dispatched / dispatch_failed`. The Forge app tracks only dispatch state — completion state is owned by the receiver.

## Task state

The dispatch-only lifecycle of a task as tracked by the Forge app:
- `pending` — created, not yet dispatched
- `dispatched` — JSM Ops returned 202 Accepted
- `dispatch_failed` — JSM Ops returned an error

## JEC action

The message sent from the dispatcher to JEC via `POST /v1/jec/action`. Carries an action name (matching an `actionMappings` key in `jec-config.json`) and a `details` map (the task payload). JEC serialises `details` and passes it to the receiver script as `--payload`.

## Action mapping

A named entry in `jec-config.json` that maps an action name to a script filepath. When JEC receives an action with a matching name, it invokes the mapped script.

## JEC invocation contract

The CLI interface by which JEC launches the receiver script. JEC passes `--payload`, `--apiKey`, `--jsmUrl`, `--logLevel`, and optionally `--jecNamedPipe` as command-line flags. The script must parse these flags — there is no function-export or module-import contract.

## Named pipe callback

The mechanism by which the receiver script returns a result to JEC. JEC creates a named pipe at the path given in `--jecNamedPipe`. The script writes a JSON result to this pipe. On Enterprise JSM plans, the triggering flow can await this result for up to 15 minutes.

## Local task handling

The on-premise work performed by the receiver after parsing the task payload. In the sample, this is appending to a log file. In a real deployment, this is publishing to a message queue (e.g. Kafka) or invoking a local service.

## Simulator adapter

A development/CI substitute for the real JEC channel adapter. Implements the same `JecChannelAdapter` interface but skips the JSM Ops HTTP call and records a `dispatched` state directly. Used in tests and local development.

## Channel store

The Forge KVS store that persists channel metadata (channel ID, API key) after provisioning.

## Task store

The Forge KVS store that persists task records and their current dispatch state.

## forge-ahead

The shared TypeScript library (`packages/forge-ahead/`) providing typed wrappers for Forge APIs, JSM Ops types, and utility helpers. Used by the dispatcher. Not used by the receiver (which is Python).
