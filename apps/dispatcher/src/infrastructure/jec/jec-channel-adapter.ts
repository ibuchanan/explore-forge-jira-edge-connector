import { randomUUID } from "node:crypto";
import api, { route } from "@forge/api";
import type { components as OpsComponents } from "forge-ahead/apis/jira-service-desk-ops";
import {
  TASK_EVENT_TYPES,
  TASK_STATUSES,
  type TaskEvent,
  type TaskProjection,
} from "../../domain/task-state";

type CreateJecChannelDto = OpsComponents["schemas"]["CreateJecChannelDto"];
type JecChannelWithApiKey = OpsComponents["schemas"]["JecChannelWithApiKey"];

// All JEC endpoints live under:
//   https://api.atlassian.com/jsm/ops/api/{cloudId}/v1/jec/
// The cloudId comes from the resolver context at runtime.

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
  cloudId: string,
  now: string,
): Promise<ProvisionedJecChannel> {
  const response = await api
    .asApp()
    .requestJira(route`/jsm/ops/api/v1/jec/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `forge-dispatcher-${Date.now()}`,
        ownerId: cloudId,
        ownerDomain: false,
      } satisfies CreateJecChannelDto),
    });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `JEC channel provisioning failed (${response.status}): ${text}`,
    );
  }

  const channel = (await response.json()) as JecChannelWithApiKey;

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
 * Note: SendJecActionDto.details is typed as Record<string, never> in the
 * generated types — this is a codegen artefact. We cast to Record<string, unknown>.
 *
 * Required scope: write:ops-config:jira-service-management
 */
export async function dispatchReportTask(
  task: TaskProjection,
  cloudId: string,
  now: string,
): Promise<TaskEvent> {
  // The channelId query param is required by the JEC action endpoint.
  // We construct the URL manually since route`` does not support query strings.
  const channelId = task.channelId;
  const response = await api
    .asApp()
    .requestJira(route`/jsm/ops/api/v1/jec/action?channelId=${channelId}`, {
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
    });

  if (!response.ok) {
    const text = await response.text();
    return {
      id: randomUUID(),
      taskId: task.id,
      type: TASK_EVENT_TYPES.jecDispatchRequested,
      status: TASK_STATUSES.dispatch_failed,
      channelId: task.channelId,
      mode: "jec",
      createdAt: now,
      message: `JEC dispatch failed (${response.status}): ${text}`,
      metadata: { adapter: "jec-channel-adapter" },
    };
  }

  // 202 Accepted — JEC has queued the action for the receiver script.
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
