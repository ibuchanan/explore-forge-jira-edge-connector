# JEC Event Bridge — Forge sample app

A Forge app that bridges Atlassian Jira Service Management (JSM) to on-premise infrastructure via the [Jira Edge Connector (JEC)](https://support.atlassian.com/jira-service-management-cloud/docs/install-jira-edge-connector/). The dispatcher Forge app runs in the Atlassian cloud; the receiver Python script runs on the customer's machine and is invoked by JEC as an OS process.

**Use this as a starting point**, not a production system. The receiver logs events to a local JSONL file as a stand-in for a real message queue (Kafka, SQS, etc.).

## How it works

```text
Forge dispatcher  →  JSM Ops API  →  JEC binary  →  receiver.py
(Atlassian cloud)    (POST /jec/action)  (on-premise)  (on-premise)
```

1. An admin provisions a JEC channel from the Forge app's **Configure** page.
2. The Forge app dispatches tasks by calling `POST /jsm/ops/api/v1/jec/action`.
3. JEC polls the queue, receives the action, and invokes `receiver.py` as a subprocess.
4. The receiver appends a structured event to a local JSONL log and (optionally) writes a result back to JEC via a named pipe.

## Repository structure

| Path | What it is |
| ---- | ---------- |
| `apps/dispatcher/` | Forge app — TypeScript, UI Kit, scheduled cleanup, webtrigger |
| `apps/receiver/` | On-premise Python script and JEC config template |
| `packages/forge-ahead/` | Shared TypeScript library: typed Forge/JSM API wrappers |

## Prerequisites

- [Forge CLI](https://developer.atlassian.com/platform/forge/set-up-forge/) — `npm install -g @forge/cli`
- A JSM Cloud site
- For the receiver: Python 3.9+ and [Jira Edge Connector](https://support.atlassian.com/jira-service-management-cloud/docs/install-jira-edge-connector/)

## Quick start: Dispatcher

```bash
# 1. Copy and fill in environment variables
cp apps/dispatcher/.env.example apps/dispatcher/.env

# 2. Forge register to make the app yours
npm run forge:register

# 3. Deploy the Forge app
npm run forge:deploy

# 4. Install on your JSM site (once)
npm run forge:install
```

Then open the **Configure App** page on your JSM site to provision a JEC channel.
The page displays the API key needed for `jec-config.json`.

## Quick start: Receiver

See [`apps/receiver/README.md`](apps/receiver/README.md) for full setup,
including JEC installation, config, and verification steps.

Quick smoke-test (no JEC needed):

```bash
cd apps/receiver
python3 receiver.py \
  --payload '{"taskId":"test-1","taskType":"demo","context":"test","channelId":"sim-abc"}' \
  --apiKey "test-key" \
  --jsmUrl "https://api.atlassian.com" \
  --logLevel INFO
```

## Development

```bash
# Run all tests
npm test

# Lint and format
npm run lint
npm run format

# Type-check
npm run typecheck

# Full check (test + lint + format + typecheck)
npm run check

# Watch tests for the dispatcher
cd apps/dispatcher && npm run test:watch

# Deploy to development environment
cd apps/dispatcher && npm run forge:deploy
```

### Simulator mode

The dispatcher supports a `simulator` mode that skips the real JSM Ops HTTP call and records a `dispatched` state directly. Useful in local development and CI without a live JSM site.

### Admin status page

The **JEC Event Bridge Status** global page shows channel setup details
(including the API key for copy-paste into `jec-config.json`)
and a receiver status check.
The status check inspects task history
to confirm at least one JEC task has been successfully dispatched.

## Known issues and API gotchas

See [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) for documented discrepancies between Atlassian developer docs
and actual runtime behaviour, including:

- The correct Stargate route for `requestJira()` vs. direct OAuth 2.0 calls
- JEC endpoints require `asUser()` — `asApp()` returns 403
- `CreateJecChannelDto` codegen error (`ownerDomain` typed as `boolean`, correct type is `string`)

## Packages

### `forge-ahead`

Shared TypeScript library at `packages/forge-ahead/` providing:

- Typed wrappers for Forge APIs (webtriggers, scheduled triggers, product triggers)
- JSM Ops generated API types (from OpenAPI spec)
- Utility helpers for JSON-RPC, HTTP errors, and JWT

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache 2.0 — see [LICENSE](LICENSE).
