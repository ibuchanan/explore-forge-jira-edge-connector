import { createHash, randomUUID } from "node:crypto";
import {
  TASK_EVENT_TYPES,
  TASK_STATUSES,
  type TaskEvent,
  type TaskEventType,
  type TaskStatus,
} from "./task-state";

const callbackStatusToEvent: Record<
  string,
  { type: TaskEventType; status: TaskStatus }
> = {
  running: {
    type: TASK_EVENT_TYPES.taskRunningReported,
    status: TASK_STATUSES.running,
  },
  complete: {
    type: TASK_EVENT_TYPES.taskCompletedReported,
    status: TASK_STATUSES.complete,
  },
  failed: {
    type: TASK_EVENT_TYPES.taskFailedReported,
    status: TASK_STATUSES.failed,
  },
};

export interface CallbackPayload {
  taskId: string;
  channelId: string;
  status: "running" | "complete" | "failed";
  message?: string;
  eventId?: string;
}

export function parseCallbackPayload(body: string): CallbackPayload {
  const parsed = JSON.parse(body || "{}") as Partial<CallbackPayload>;

  if (!parsed.taskId || !parsed.channelId || !parsed.status) {
    throw new Error(
      "Callback payload must include taskId, channelId, and status.",
    );
  }

  if (!callbackStatusToEvent[parsed.status]) {
    throw new Error(`Unsupported callback status: ${parsed.status}`);
  }

  return {
    taskId: parsed.taskId,
    channelId: parsed.channelId,
    status: parsed.status,
    message: parsed.message,
    eventId: parsed.eventId,
  };
}

export function createCallbackTaskEvent(
  payload: CallbackPayload,
  now: string,
): TaskEvent {
  const mapped = callbackStatusToEvent[payload.status];

  if (!mapped) {
    throw new Error(`Unsupported callback status: ${payload.status}`);
  }

  return {
    id: payload.eventId || randomUUID(),
    taskId: payload.taskId,
    type: mapped.type,
    status: mapped.status,
    channelId: payload.channelId,
    createdAt: now,
    message: payload.message || `On-premise worker reported ${payload.status}.`,
  };
}

export function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}
