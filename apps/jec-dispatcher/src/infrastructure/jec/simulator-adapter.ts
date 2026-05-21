import { randomUUID } from "node:crypto";
import {
  TASK_EVENT_TYPES,
  TASK_STATUSES,
  type TaskEvent,
  type TaskProjection,
} from "../../domain/task-state";

export function createSimulatorChannel(now: string) {
  return {
    channelId: `sim-${randomUUID()}`,
    mode: "simulator" as const,
    provisionedAt: now,
    note: "Simulator channel provisioned. This exercises the Forge architecture without requiring a live JEC site.",
  };
}

export function createSimulatorDispatchEvent(
  task: TaskProjection,
  now: string,
): TaskEvent {
  return {
    id: randomUUID(),
    taskId: task.id,
    type: TASK_EVENT_TYPES.jecDispatchRequested,
    status: TASK_STATUSES.running,
    channelId: task.channelId,
    mode: "simulator",
    createdAt: now,
    message:
      "Simulator dispatch started. Use signed callback tests or simulator completion to advance the task.",
  };
}

export function createSimulatorCompletionEvent(
  task: TaskProjection,
  now: string,
): TaskEvent {
  return {
    id: randomUUID(),
    taskId: task.id,
    type: TASK_EVENT_TYPES.taskCompletedReported,
    status: TASK_STATUSES.complete,
    channelId: task.channelId,
    mode: "simulator",
    createdAt: now,
    message: "Simulator completed the report task.",
  };
}
