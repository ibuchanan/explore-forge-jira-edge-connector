# JEC Dispatch Auth Model

## Problem

JEC endpoints (`POST /jsm/ops/api/v1/jec/channels`, `POST /jsm/ops/api/v1/jec/action`)
only accept `asUser()` auth. Calling them with `asApp()` returns a misleading 403:

```json
{"code":40301,"message":"Account does not have access to Opsgenie.","took":0.062}
```

The site has the entitlement. The Forge app service-account identity does not carry
the Opsgenie subscription context that the JEC API enforces. Confirmed via live
webtrigger experiment and internal Slack thread (C04K8M9BZ7G/p1780606530182799).

Webtriggers always fall through to `asApp()` because they have no user context
(`context.userAccess.enabled` is false). Using the current user's identity
(`asUser()` without an account ID) for resolver-based dispatch ties the integration
to whoever happens to be logged in — not every user has JSM Ops access, and
the integration cannot survive admin turnover.

## Auth model

All JEC API calls — channel provisioning and task dispatch, from both resolvers
and the webtrigger — use `asUser(actAsAccountId)` where `actAsAccountId` is a
stored Atlassian account ID managed separately from the JEC channel configuration.

### actAs account

The **actAs account** is the Atlassian user identity the app impersonates for every
JEC API call. It must have JSM Ops (Opsgenie) entitlement on the target site. It is
stored as a standalone KVS entry and has an independent lifecycle from the JEC channel.

### Storage

`actAsAccountId` is stored in its own KVS key (via `act-as-store.ts`), separate from
`ChannelSetup`. The two concerns have different lifecycles:

| Concern | When it changes |
|---|---|
| JEC channel (`ChannelSetup`) | Only when an admin re-provisions a new channel |
| actAs account | Whenever an admin updates it — independent of channel state |

### Initial value

Provisioning a channel (simulator or JEC mode) automatically writes the provisioner's
`accountId` as the initial `actAsAccountId`. Re-provisioning overwrites it with the
new provisioner's identity — the person performing the re-provision takes ownership.

### Changing the actAs account

An admin changes the actAs account via `UserPicker` on the Configure App page without
re-provisioning the JEC channel. This is the recovery path when the original provisioner
leaves the organisation and their account is deprovisioned.

## Error handling

Both `createTask` (resolver) and `dispatchViaWebtrigger` (webtrigger) check in order:

1. Channel setup exists → 503 if missing: "The dispatcher is not configured."
2. `actAsAccountId` exists → 503 if missing: "JEC dispatch account is not configured. Set an actAs user from the Configure App page."
3. Proceed with `asUser(actAsAccountId)`

Missing `actAsAccountId` never falls back to `asUser()` (current user) or `asApp()`.
The failure is always surfaced as a configuration problem, not a permissions error.

## Connection status

The admin status page derives JEC connection health from the most recent JEC task
at query time, not from "has any JEC task ever succeeded." The resolver:

1. Loads all tasks, filters to `mode === "jec"`, sorts by `updatedAt` descending.
2. If no JEC tasks exist: `ok: false`, detail: "No JEC tasks dispatched yet."
3. Otherwise: `ok: mostRecent.status === "dispatched"`, detail includes `lastMessage`
   and timestamp.

This makes the health check useful for diagnosing configuration changes — a 403 after
rotating the actAs account shows up immediately rather than being masked by historical
successes.

## Diagnostic mode

The admin status page has a single "Send test task" button that dispatches a task
using the stored actAs account via the normal `createTask` resolver. This verifies
whether the currently configured actAs account has JSM Ops access.

The workflow for rotating the actAs account:
1. Open Configure App, select new account via `UserPicker`, save.
2. Open Admin Status, click "Send test task."
3. If it succeeds, the new account is confirmed working.
4. If it fails (dispatch_failed, 403 message), pick a different account.

## Webtrigger

The webtrigger (`dispatchViaWebtrigger`) is retained as a debugging aid during the
auth model switchover. It follows the same auth guard sequence as the resolver. It
will be removed before the app is considered finished — external dispatch via
webtrigger is not part of the JEC standard model.

## Affected files

| File | Role |
|---|---|
| `apps/dispatcher/src/infrastructure/storage/act-as-store.ts` | KVS read/write for `actAsAccountId` |
| `apps/dispatcher/src/resolvers/index.ts` | `provisionChannel`, `createTask`, new `getActAsConfig` + `updateActAsUser` |
| `apps/dispatcher/src/webtriggers/dispatch.ts` | Replaces `getAuthForEvent` with actAs guard |
| `apps/dispatcher/src/frontend/admin-configure.tsx` | `UserPicker` to display/change actAs account |
| `apps/dispatcher/src/frontend/admin-page.tsx` | Most-recent-task connection status |
