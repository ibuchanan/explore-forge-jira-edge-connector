export const TASK_STATUSES = {
  pending: "pending",
  running: "running",
  complete: "complete",
  failed: "failed",
  expired: "expired",
} as const;

export const TASK_EVENT_TYPES = {
  taskCreated: "TASK_CREATED",
  jecChannelProvisioned: "JEC_CHANNEL_PROVISIONED",
  jecDispatchRequested: "JEC_DISPATCH_REQUESTED",
  callbackAccepted: "CALLBACK_ACCEPTED",
  taskRunningReported: "TASK_RUNNING_REPORTED",
  taskCompletedReported: "TASK_COMPLETED_REPORTED",
  taskFailedReported: "TASK_FAILED_REPORTED",
  taskExpired: "TASK_EXPIRED",
} as const;

export type TaskStatus = (typeof TASK_STATUSES)[keyof typeof TASK_STATUSES];
export type TaskEventType =
  (typeof TASK_EVENT_TYPES)[keyof typeof TASK_EVENT_TYPES];
export type TaskMode = "jec" | "simulator";

export interface TaskEvent {
  id: string;
  taskId: string;
  type: TaskEventType;
  createdAt: string;
  status?: TaskStatus;
  message?: string;
  channelId?: string;
  mode?: TaskMode;
  metadata?: Record<string, string>;
}

export interface TaskProjection {
  id: string;
  name: string;
  context: string;
  mode: TaskMode;
  channelId: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  lastEventType: TaskEventType;
  lastMessage: string;
}

const terminalStatuses = new Set<TaskStatus>([
  TASK_STATUSES.complete,
  TASK_STATUSES.failed,
  TASK_STATUSES.expired,
]);

export function isTerminalStatus(status: TaskStatus): boolean {
  return terminalStatuses.has(status);
}

export function statusFromEvent(
  event: TaskEvent,
  currentStatus: TaskStatus,
): TaskStatus {
  if (isTerminalStatus(currentStatus)) {
    return currentStatus;
  }

  if (event.status) {
    return event.status;
  }

  switch (event.type) {
    case TASK_EVENT_TYPES.taskRunningReported:
      return TASK_STATUSES.running;
    case TASK_EVENT_TYPES.taskCompletedReported:
      return TASK_STATUSES.complete;
    case TASK_EVENT_TYPES.taskFailedReported:
      return TASK_STATUSES.failed;
    case TASK_EVENT_TYPES.taskExpired:
      return TASK_STATUSES.expired;
    default:
      return currentStatus;
  }
}

export function projectTask(
  initial: TaskProjection,
  events: TaskEvent[],
): TaskProjection {
  const projection = { ...initial };

  for (const event of events) {
    projection.status = statusFromEvent(event, projection.status);
    projection.updatedAt = event.createdAt;
    projection.lastEventType = event.type;
    projection.lastMessage = event.message || projection.lastMessage;
  }

  return projection;
}

export function createTaskProjection(input: {
  id: string;
  name: string;
  context?: string;
  mode: TaskMode;
  channelId: string;
  now: string;
}): TaskProjection {
  return {
    id: input.id,
    name: input.name,
    context: input.context || "General report context",
    mode: input.mode,
    channelId: input.channelId,
    status: TASK_STATUSES.pending,
    createdAt: input.now,
    updatedAt: input.now,
    lastEventType: TASK_EVENT_TYPES.taskCreated,
    lastMessage: "Task was created.",
  };
}
