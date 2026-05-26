import { randomUUID } from "node:crypto";
import {
  TASK_EVENT_TYPES,
  TASK_STATUSES,
  type TaskEvent,
  type TaskProjection,
} from "../../domain/task-state";

/**
 * Creates a simulator channel that exercises the Forge architecture without
 * requiring a live JEC site. The channel ID uses a sim- prefix to distinguish
 * it from real JEC channels.
 */
export function createSimulatorChannel(now: string) {
  return {
    channelId: `sim-${randomUUID()}`,
    apiKey: "simulator-api-key-not-real",
    mode: "simulator" as const,
    provisionedAt: now,
    note: "Simulator channel provisioned. This exercises the Forge architecture without requiring a live JEC site.",
  };
}

/**
 * Creates a simulated dispatch event that short-circuits the real JSM Ops API
 * call and directly records a dispatched state.
 *
 * The simulator does NOT simulate a completion callback — there is none in the
 * dispatch-only model. Once dispatched, on-premise work is handled by the
 * receiver script independently.
 */
export function createSimulatorDispatchEvent(
  task: TaskProjection,
  now: string,
): TaskEvent {
  return {
    id: randomUUID(),
    taskId: task.id,
    type: TASK_EVENT_TYPES.jecDispatchRequested,
    status: TASK_STATUSES.dispatched,
    channelId: task.channelId,
    mode: "simulator",
    createdAt: now,
    message:
      "Simulator: task dispatched (skipped real JSM Ops HTTP call). In production, JEC would invoke receiver.py with --payload.",
  };
}
