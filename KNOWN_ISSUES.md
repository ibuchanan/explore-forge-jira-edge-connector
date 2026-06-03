# Known Issues

This file tracks known discrepancies between Atlassian developer documentation,
generated API types, and the actual runtime behaviour of the APIs used in this project.

---

## JEC Channel API — Atlassian Dev Docs Discrepancies

**Affected file:** `apps/dispatcher/src/infrastructure/jec/jec-channel-adapter.ts`
**Discovered:** 2026-06-03

### 1. `requestJira` route path

The Atlassian developer documentation for the JEC Channels API shows the full
OAuth URL as:

```
https://api.atlassian.com/ex/jira/{cloudId}/jsm/ops/api/v1/jec/channels
```

`requestJira()` automatically prepends `https://api.atlassian.com/ex/jira/{cloudId}`,
so the correct route to pass is:

```typescript
requestJira(route`/jsm/ops/api/v1/jec/channels`)
```

Earlier documentation (and an earlier comment in the codebase) incorrectly showed
the path as `/jsm/ops/api/{cloudId}/v1/jec/...` with the `cloudId` embedded inside
the path segment — that is **wrong**.

### 2. POST payload for creating a JEC channel

The correct payload for `POST /jsm/ops/api/v1/jec/channels` is:

```json
{
  "name": "forge-dispatcher-<ISO-8601-timestamp>",
  "ownerId": "<userIdentifier>",
  "ownerDomain": "public_<identifier>"
}
```

Two bugs existed in the original implementation:

| Field | Wrong value | Correct value |
|-------|-------------|---------------|
| `ownerId` | `cloudId` (the Jira cloud site ID) | `userIdentifier` (the Jira account ID / user identifier for the app) |
| `ownerDomain` | `false` (boolean) | `"public_<identifier>"` (a string beginning with `"public_"`) |
| `name` timestamp | `Date.now()` (unix ms integer) | ISO 8601 string (e.g. `new Date().toISOString()`) |

### 3. `CreateJecChannelDto` type — codegen error

**Affected file:** `packages/forge-ahead/src/apis/jira-service-desk-ops/types.ts`

The generated OpenAPI type for `CreateJecChannelDto` incorrectly declares
`ownerDomain` as `boolean`:

```typescript
// WRONG (generated)
ownerDomain: boolean;
```

The real API accepts a **string** (consistent with `JecChannel.ownerDomain?: string`
in the same spec). The type has been corrected to:

```typescript
// CORRECT (fixed)
ownerDomain: string;
```

This is a codegen artefact — the OpenAPI spec description says
_"Public Owner Domain starts with 'public_'"_ which implies a string, but the
schema type was emitted as `boolean`.

---

## How to update this file

Add new entries at the top of the relevant section, or create a new section,
whenever you discover a gap between documented API behaviour and the actual
runtime contract. Include:

- The affected file(s)
- The date of discovery
- The wrong value / assumption
- The correct value, with evidence (e.g. full OAuth URL, Postman collection, etc.)
