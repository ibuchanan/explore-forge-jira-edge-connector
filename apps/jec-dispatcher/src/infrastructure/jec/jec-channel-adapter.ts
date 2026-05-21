import { randomUUID } from "node:crypto";
import api, { route } from "@forge/api";
import {
  TASK_EVENT_TYPES,
  TASK_STATUSES,
  type TaskEvent,
  type TaskProjection,
} from "../../domain/task-state";

export interface ProvisionedJecChannel {
  channelId: string;
  dispatchUrl?: string;
  provisionedAt: string;
  note: string;
}

export async function provisionJecChannel(
  now: string,
): Promise<ProvisionedJecChannel> {
  // The JSM Ops/JEC APIs are intentionally isolated in this adapter because the
  // public contract is experimental. The sample records the seam and performs a
  // harmless authenticated Jira request so missing scopes/auth are discovered
  // early without coupling the rest of the architecture to unstable endpoints.
  await api.asUser().requestJira(route`/rest/api/3/myself`);

  return {
    channelId: `jec-${randomUUID()}`,
    provisionedAt: now,
    note: "Real JEC adapter seam initialized. Replace this adapter body with the confirmed JEC channel create/send-action calls for your site.",
  };
}

export async function dispatchReportTask(
  task: TaskProjection,
  now: string,
): Promise<TaskEvent> {
  // Keep raw JEC dispatch details behind this boundary. The rest of the app only
  // needs to know that a dispatch was requested and that the eventual callback
  // must reference the task and channel IDs.
  return {
    id: randomUUID(),
    taskId: task.id,
    type: TASK_EVENT_TYPES.jecDispatchRequested,
    status: TASK_STATUSES.running,
    channelId: task.channelId,
    mode: "jec",
    createdAt: now,
    message: "Dispatch requested through the JEC adapter seam.",
    metadata: {
      adapter: "jec-channel-adapter",
    },
  };
}
