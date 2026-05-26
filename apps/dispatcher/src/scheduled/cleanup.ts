import { randomUUID } from "node:crypto";
import type {
  JSONValue,
  ProblemDetails,
  Result,
  ScheduledFunction,
} from "forge-ahead";
import { logContext, logResult, ok } from "forge-ahead";
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
import { problemResult } from "../shared/errors";

type CleanupSummary = {
  expiredTasks: number;
};

async function expireStaleTasks(): Promise<
  Result<CleanupSummary, ProblemDetails>
> {
  try {
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const tasks = await listTasks();
    let expiredTasks = 0;

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
        expiredTasks += 1;
      }
    }

    return ok({ expiredTasks });
  } catch (error) {
    return problemResult(error);
  }
}

export const cleanup: ScheduledFunction = async (_event, context) => {
  logContext(context as unknown as JSONValue, "JEC cleanup");
  logResult(await expireStaleTasks(), "JEC cleanup");
};
