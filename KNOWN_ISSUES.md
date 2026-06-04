# Known Issues

This file tracks known discrepancies between Atlassian developer documentation,
generated API types, and the actual runtime behaviour of the APIs used in this project.

---

## JEC Channel API — Atlassian Dev Docs Discrepancies

**Affected file:** `apps/dispatcher/src/infrastructure/jec/jec-channel-adapter.ts`
**Discovered:** 2026-06-03

### 1. `requestJira` route path — confusing public docs vs. actual Forge behaviour

The public Atlassian developer docs for the JSM Ops REST API show the base URL as:

```
https://api.atlassian.com/jsm/ops/api/{cloudId}/v1/...
```

This makes it look like the `cloudId` belongs inside the path. **This URL format
is for direct OAuth 2.0 (3LO) calls, not for Forge.** For Forge apps using
`requestJira()`, the Stargate route is different:

```
https://api.atlassian.com/ex/jira/{cloudId}/jsm/ops/api/v1/...
```

`requestJira()` automatically prepends `https://api.atlassian.com/ex/jira/{cloudId}`,
so the correct route to pass is:

```typescript
requestJira(route`/jsm/ops/api/v1/jec/channels`)
```

**Do not** embed the `cloudId` in the path when using `requestJira()` — that will
send the request to the wrong endpoint (missing the `/ex/jira/` prefix) and
produce a `401 Unauthorized; scope does not match`.

Confirmed via internal Slack thread (C04K8M9BZ7G/p1780314520798149, 2026-05-28)
by the JSM Ops team, citing the Stargate route configuration PR
(bitbucket.org/atlassian/stargate-route-configurations/pull-requests/4780) and
the internal LDR doc (hello.atlassian.net/wiki/spaces/ITSOL/pages/3476371925).

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

### 4. JEC endpoints return 403 when called with `asApp()` — misleading error message

**Affected file:** `apps/dispatcher/src/infrastructure/jec/jec-channel-adapter.ts`
**Discovered:** 2026-06-04
**Confirmed:** 2026-06-04 (via webtrigger experiment)

Both the channel provisioning (`POST /jsm/ops/api/v1/jec/channels`) and action
dispatch (`POST /jsm/ops/api/v1/jec/action`) endpoints return 403 when called
with `api.asApp()`:

```json
{"code":40301,"message":"Account does not have access to Opsgenie.","took":0.062}
```

**This error message is misleading.** The site does have an active Opsgenie /
JSM Ops entitlement — proven by the same request succeeding with `api.asUser()`.
The real cause is that the `asApp()` identity (the Forge app itself) does not
carry the Opsgenie subscription context that the JEC API enforces. The JEC API
appears to check entitlement against the calling *account*, and the app's service
account identity does not have that entitlement even when the site does.

**Confirmed by experiment:** A webtrigger (which has no user context and therefore
uses `asApp()`) was invoked against a provisioned JEC channel on a site with an
active JSM Ops subscription. The response was `"status": "dispatch_failed"` with
the 403 body above. The same dispatch call via the UI resolver (using `asUser()`)
succeeds on the same site.

**Implication for webtriggers:** Any webtrigger handler that needs to call JEC
endpoints will receive a 403. Webtriggers have no user context, so there is no
direct equivalent to `asUser()`. Possible mitigations (none yet implemented):

- Store a user account ID at setup time and use `asUser(accountId)` in the webtrigger
- Use a Forge Remote + OAuth 2.0 (3LO) token stored in KVS

**Needs investigation:** It is unclear whether this is intended API behaviour or
a bug in the JEC entitlement check. This should be reported to both the Forge
platform team and the JSM Ops/JEC team for clarification.

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
