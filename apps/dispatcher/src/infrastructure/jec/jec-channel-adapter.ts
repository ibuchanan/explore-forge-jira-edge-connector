import { randomUUID } from "node:crypto";
import api, { route } from "@forge/api";
import type { AuthForEvent } from "forge-ahead";
import type { components as OpsComponents } from "forge-ahead/apis/jira-service-desk-ops";

type AuthClient = Pick<AuthForEvent, "auth">;
import {
  TASK_EVENT_TYPES,
  TASK_STATUSES,
  type TaskEvent,
  type TaskProjection,
} from "../../domain/task-state";

type JecChannelWithApiKey = OpsComponents["schemas"]["JecChannelWithApiKey"];

// All JEC endpoints live under:
//   https://api.atlassian.com/ex/jira/{cloudId}/jsm/ops/api/v1/jec/
// requestJira() prepends https://api.atlassian.com/ex/jira/{cloudId}, so routes
// start at /jsm/ops/api/v1/jec/...
// Confirmed via internal Slack thread (2026-05-28): the Stargate route for Forge
// is /ex/jira/{cloudId}/jsm/ops/api/v1/... so requestJira with the path
// /jsm/ops/api/v1/jec/channels is correct. See KNOWN_ISSUES.md §1.

export interface ProvisionedJecChannel {
  channelId: string;
  apiKey: string;
  provisionedAt: string;
  note: string;
}

/**
 * Provisions a real JEC channel via POST /v1/jec/channels.
 *
 * The returned `apiKey` is the value the customer puts in their jec-config.json.
 * Store both `channelId` and `apiKey` in Forge KVS after provisioning.
 *
 * Required scope: write:ops-config:jira-service-management
 */
export async function provisionJecChannel(
  userIdentifier: string,
  ownerDomain: string,
  now: string,
): Promise<ProvisionedJecChannel> {
  const response = await api
    .asUser()
    .requestJira(route`/jsm/ops/api/v1/jec/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `forge-dispatcher-${now}`,
        ownerId: userIdentifier,
        ownerDomain,
      }),
    });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `JEC channel provisioning failed (${response.status}): ${text}`,
    );
  }

  const channel = (await response.json()) as JecChannelWithApiKey;

  if (!channel.id || !channel.apiKey) {
    throw new Error(
      `JEC channel provisioning returned incomplete data: ${JSON.stringify(channel)}`,
    );
  }

  return {
    channelId: channel.id,
    apiKey: channel.apiKey,
    provisionedAt: now,
    note: "Real JEC channel provisioned via JSM Ops API.",
  };
}

/**
 * Dispatches a task to JEC via POST /v1/jec/action?channelId={channelId}.
 *
 * The `action` name must match an `actionMappings` key in the customer's
 * jec-config.json. The `details` map is serialised by JEC and passed to
 * receiver.py as --payload.
 *
 * A 202 Accepted response means the action was queued. JEC will invoke the
 * receiver script asynchronously — there is no synchronous completion signal.
 *
 * The auth client is resolved by the caller via `getAuthForEvent` — this keeps
 * the adapter free of any opinion on auth strategy. In a resolver context,
 * `getAuthForEvent` returns `asUser()`; in a webtrigger context (no user
 * context), it falls through to `asApp()`. Both paths use the same function.
 *
 * Note: SendJecActionDto.details is typed as Record<string, never> in the
 * generated types — this is a codegen artefact. We cast to Record<string, unknown>.
 *
 * Required scope: write:ops-config:jira-service-management
 */
export async function dispatchReportTask(
  task: TaskProjection,
  _cloudId: string,
  now: string,
  { auth }: AuthClient,
): Promise<TaskEvent> {
  // The channelId query param is required by the JEC action endpoint.
  // We construct the URL manually since route`` does not support query strings.
  const channelId = task.channelId;
  const response = await auth.requestJira(
    route`/jsm/ops/api/v1/jec/action?channelId=${channelId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "dispatchTask",
        actionType: "custom",
        // Cast: generated type says Record<string, never> but this is a codegen artefact.
        details: {
          taskId: task.id,
          taskType: task.name,
          context: task.context,
          channelId: task.channelId,
          dispatchedAt: now,
        } as Record<string, unknown>,
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    const message = `JEC dispatch failed (${response.status}): ${text}`;
    console.error("[jec-channel-adapter] dispatchReportTask failed", {
      taskId: task.id,
      channelId,
      status: response.status,
      body: text,
    });
    return {
      id: randomUUID(),
      taskId: task.id,
      type: TASK_EVENT_TYPES.jecDispatchRequested,
      status: TASK_STATUSES.dispatch_failed,
      channelId: task.channelId,
      mode: "jec",
      createdAt: now,
      message,
      metadata: { adapter: "jec-channel-adapter" },
    };
  }

  // 202 Accepted — JEC has queued the action for the receiver script.
  console.log("[jec-channel-adapter] dispatchReportTask succeeded", {
    taskId: task.id,
    channelId,
    status: response.status,
  });
  return {
    id: randomUUID(),
    taskId: task.id,
    type: TASK_EVENT_TYPES.jecDispatchRequested,
    status: TASK_STATUSES.dispatched,
    channelId: task.channelId,
    mode: "jec",
    createdAt: now,
    message: "Task dispatched to JEC via JSM Ops API (202 Accepted).",
    metadata: { adapter: "jec-channel-adapter" },
  };
}
