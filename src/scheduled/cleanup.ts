import { randomUUID } from "node:crypto";
import {
  isTerminalStatus,
  TASK_EVENT_TYPES,
  TASK_STATUSES,
} from "../domain/task-state";
import {
  appendTaskEvent,
  listTasks,
} from "../infrastructure/storage/task-store";
import { TASK_EXPIRY_MS } from "../shared/constants";

export async function cleanup(): Promise<void> {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const tasks = await listTasks();

  for (const task of tasks) {
    if (isTerminalStatus(task.status)) {
      continue;
    }

    const ageMs = nowMs - Date.parse(task.createdAt);

    if (ageMs > TASK_EXPIRY_MS) {
      await appendTaskEvent(task.id, {
        id: randomUUID(),
        taskId: task.id,
        type: TASK_EVENT_TYPES.taskExpired,
        status: TASK_STATUSES.expired,
        channelId: task.channelId,
        mode: task.mode,
        createdAt: now,
        message: "Scheduled cleanup expired this stale task.",
      });
    }
  }
}
