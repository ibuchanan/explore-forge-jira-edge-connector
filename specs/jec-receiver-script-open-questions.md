# JEC receiver script: findings and resolved questions

## Status

All major questions are now resolved. This document captures the confirmed findings. See `sample-app-architecture-exemplar-plan.md` for the implementation plan.

---

## What we know about JEC

### JEC is a Go binary, not a TypeScript runtime

JEC (`atlassian/jec`) is a standalone Go binary that runs on-premises or in the customer's cloud. It executes scripts as OS processes. The documented languages are Groovy, Python, Go, PowerShell, `.sh` shell scripts, and batch files. TypeScript is not a natively supported JEC script language.

**Decision:** The receiver script is Python (stdlib-only). No shell wrapper, no build step, no runtime dependency beyond Python 3.

### JEC is triggered via the JSM Ops REST API (not Jira Automation)

This Forge app triggers JEC via the JSM Ops REST API — specifically `POST /v1/jec/action`. This is distinct from the "Run script using Jira Edge Connector" Jira Automation action. The Forge resolver calls JSM Ops directly.

### JEC config format (confirmed)

```json
{
  "apiKey": "<from JecChannelWithApiKey.apiKey>",
  "baseUrl": "https://api.atlassian.com",
  "logLevel": "INFO",
  "actionMappings": {
    "dispatchTask": {
      "sourceType": "local",
      "filepath": "/path/to/receiver.py",
      "env": [],
      "stdout": "/var/log/jec/out.txt",
      "stderr": "/var/log/jec/err.txt"
    }
  },
  "pollerConf": { ... },
  "poolConf": { ... }
}
```

The `actionMappings` key (e.g. `dispatchTask`) must match `SendJecActionDto.action` sent by the Forge app.

### JEC script invocation contract (confirmed)

JEC invokes scripts as OS-level processes with these CLI flags:

| Flag | Required | Description |
|---|---|---|
| `--payload` | Yes | JSON string — the `details` map from `SendJecActionDto` |
| `--apiKey` | Yes | JEC API key in plaintext |
| `--jsmUrl` | Yes | `https://api.atlassian.com` |
| `--logLevel` | Yes | Log level string |
| `--jecNamedPipe` | No | Path to named pipe for writing result back to JEC |

Example Python argparse pattern:
```python
parser = argparse.ArgumentParser()
parser.add_argument('--payload', required=True)
parser.add_argument('--apiKey', required=True)
parser.add_argument('--jsmUrl', required=True)
parser.add_argument('--logLevel', required=True)
parser.add_argument('--jecNamedPipe', required=False)
args = vars(parser.parse_args())
payload = json.loads(args['payload'])
```

### The `--jecNamedPipe` callback mechanism (confirmed)

JEC creates a named pipe at the given path. If the script writes a JSON result to this pipe before exiting, JEC relays it back to the triggering flow. On Enterprise plans, the Jira Automation flow can wait up to 15 minutes for this response. This is the native JEC result mechanism — not a Forge web trigger.

**Decision:** The receiver script writes `{"result": "success", "taskId": "..."}` to the named pipe if present. The exact schema JEC expects is not formally documented — this may need tuning against a live JEC instance.

### Security model (confirmed)

JEC authenticates the event before invoking the script. Scripts do not need to independently verify the payload source. The trust boundary is at JEC invocation time. The `--apiKey` flag is available for any calls the script makes back to JSM.

**Implication:** The Forge web trigger callback with HMAC verification is not part of the standard JEC model and has been removed from the Forge app.

### JEC can source scripts from Git (confirmed)

JEC polls a Git repository every ~1 minute and can fetch both its config file and action scripts from Git. This means `apps/receiver/` in this repo can serve as the Git source for a real JEC deployment.

---

## JSM Ops API for JEC (confirmed from generated types)

All types are in `packages/forge-ahead/src/apis/jira-service-desk-ops/types.ts`.

### Channel provisioning

```
POST /api/{cloudId}/v1/jec/channels
Body: CreateJecChannelDto {
  name: string,
  ownerId: string,
  ownerDomain: boolean   // true if public owner domain (starts with 'public_')
}
Response: JecChannelWithApiKey {
  id?: string,
  name?: string,
  ownerId?: string,
  ownerDomain?: string,
  authorAccountId?: string,
  apiKey?: string        // ← put this in jec-config.json
}
```

### Task dispatch

```
POST /api/{cloudId}/v1/jec/action?channelId={channelId}
Body: SendJecActionDto {
  action: string,              // must match actionMappings key in jec-config.json
  actionType: string,          // use 'custom'
  details?: Record<string, unknown>  // becomes --payload in the script
}
Response: 202 Accepted (no body)
```

> **Codegen note:** `details` is typed as `Record<string, never>` in the generated types — this is a codegen artefact. Cast as `Record<string, unknown>` at the call site.

### Other channel operations

```
GET  /api/{cloudId}/v1/jec/channels              → JecChannelList
GET  /api/{cloudId}/v1/jec/channels/{id}         → JecChannelWithApiKey
DELETE /api/{cloudId}/v1/jec/channels/{id}       → 200 (no body)
```

### Required scopes

```yaml
- read:ops-config:jira-service-management
- write:ops-config:jira-service-management
- delete:ops-config:jira-service-management
- storage:app
```

---

## What the receiver script does

The receiver script (`apps/receiver/receiver.py`) is the on-premise action handler. In a real customer deployment, this is where work gets done — e.g. publishing an event to Kafka. In the sample, it writes to a local log file as a clear, self-contained stand-in:

```
parse CLI flags
  → validate payload fields (taskId, taskType, etc.)
  → append structured event to local log file   ← customer replaces with Kafka publish
  → write {"result": "success", "taskId": "..."} to --jecNamedPipe (if present)
  → exit 0
```

The log file is explicitly documented in the script as a substitute for a message queue. A real deployment replaces the `append_to_log()` call with `publish_to_kafka()` or equivalent.

---

## Dependency management for the receiver script

JEC invokes the script as a plain OS process against the system Python 3. There is no JEC-managed virtualenv or package manager. Options for dependencies:

| Approach | Trade-offs |
|---|---|
| **stdlib-only** ← chosen | Zero setup, maximum portability, no pip/uv required |
| uv PEP 723 inline script | Clean but requires `uv` installed on the customer machine |
| Shell wrapper + virtualenv | Works but adds setup complexity for a sample |

**Decision:** stdlib-only for the initial receiver script. All required functionality (argparse, json, os, datetime) is available in the Python 3 standard library. If third-party dependencies are needed in the future, a `uv`-backed shell wrapper is the recommended upgrade path.

---

## Remaining open questions

### Named pipe result schema

The exact JSON schema JEC expects when a script writes to `--jecNamedPipe` is not formally documented. The sample uses `{"result": "success", "taskId": "..."}` as a reasonable guess. This should be validated against a live JEC instance during integration testing.

### `ownerDomain` semantics

The `CreateJecChannelDto.ownerDomain` field is a boolean, but `JecChannel.ownerDomain` is a string (e.g. `"public_*"`). The exact behaviour when `ownerDomain: true` is not documented. Needs validation against a live JSM instance.

### Admin authorization for channel provisioning

The sample documents channel provisioning as an admin operation but does not enforce a specific Jira/JSM permission check. A production app should gate this behind a Jira admin check.

### JSM Ops execution status

It is not confirmed whether JSM Ops exposes a queryable per-execution result for dispatched JEC actions. If it does, this could enable Option B (receiver writes back to JSM) or Option C (Forge polls JSM for status) in a future iteration.
