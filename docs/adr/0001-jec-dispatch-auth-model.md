# ADR 0001: Use a stored actAs account for all JEC API calls

**Status:** Accepted
**Date:** 2026-06-29

## Context

JEC endpoints (`POST /jsm/ops/api/v1/jec/channels`, `POST /jsm/ops/api/v1/jec/action`)
only accept `asUser()` auth. `asApp()` returns 403 with a misleading body:
`{"code":40301,"message":"Account does not have access to Opsgenie."}`.
The site has the entitlement; the Forge app service-account identity does not carry it.

Three auth approaches were considered for resolvers and webtriggers:

1. **`asUser()` (current user)** — uses the identity of whoever is logged in. Works for
   UI-triggered resolver calls, but not for webtriggers (no user context). Also requires
   every user who dispatches a task to have JSM Ops access, which is not realistic in
   enterprise deployments.

2. **`asApp()`** — rejected. JEC rejects it with 403 regardless of site entitlement.

3. **`asUser(storedAccountId)`** — impersonates a stored Atlassian account ID. Works for
   both resolvers and webtriggers. Requires only one account to have JSM Ops access.
   The stored identity can be rotated independently of the JEC channel.

## Decision

All JEC API calls use `asUser(actAsAccountId)` where `actAsAccountId` is a stored Atlassian
account ID managed via a dedicated KVS store (`act-as-store.ts`), independent of `ChannelSetup`.

The actAs account is:
- Auto-populated at provisioning time with the provisioner's `accountId`
- Changeable via the Configure App page (UserPicker) without re-provisioning the JEC channel
- Validated on every dispatch: missing `actAsAccountId` returns 503 with an actionable message

## Consequences

**Good:**
- Webtrigger dispatch becomes viable (no longer falls through to `asApp()`)
- Only one account needs JSM Ops entitlement — not every dispatching user
- Admin turnover is handled by rotating the actAs account, not reinstalling the app

**Neutral:**
- The actAs account must be kept active and maintain JSM Ops entitlement
- Re-provisioning the channel overwrites the actAs account (new provisioner takes ownership)

**Bad:**
- The app acts as a stored user rather than the logged-in user — this is impersonation,
  not delegation. The actAs account's audit trail in JSM Ops will show the stored identity,
  not the actual requesting user.
