import { randomUUID } from "node:crypto";
import Resolver from "@forge/resolver";
import {
  createTaskProjection,
  TASK_EVENT_TYPES,
  type TaskMode,
} from "../domain/task-state";
import {
  dispatchReportTask,
  provisionJecChannel,
} from "../infrastructure/jec/jec-channel-adapter";
import {
  createSimulatorChannel,
  createSimulatorCompletionEvent,
  createSimulatorDispatchEvent,
} from "../infrastructure/jec/simulator-adapter";
import {
  getChannelSetup,
  saveChannelSetup,
} from "../infrastructure/storage/channel-store";
import {
  appendTaskEvent,
  getTask,
  getTaskDetail,
  listTasks,
  saveNewTask,
} from "../infrastructure/storage/task-store";
import { toErrorMessage } from "../shared/errors";

interface ResolverRequest<TPayload = Record<string, unknown>> {
  payload?: TPayload;
  context?: {
    accountId?: string;
    cloudId?: string;
  };
}

interface CreateReportTaskPayload {
  name?: string;
  context?: string;
  mode?: TaskMode;
}

interface TaskIdPayload {
  taskId?: string;
}

const resolver = new Resolver();

function nowIso(): string {
  return new Date().toISOString();
}

function success<T>(data: T) {
  return { ok: true, data };
}

function failure(error: unknown) {
  return { ok: false, error: toErrorMessage(error) };
}

resolver.define("getSetupStatus", async () => {
  try {
    return success({ setup: await getChannelSetup() });
  } catch (error) {
    return failure(error);
  }
});

resolver.define(
  "provisionJecChannel",
  async (request: ResolverRequest<{ mode?: TaskMode }>) => {
    try {
      const mode = request.payload?.mode || "simulator";
      const now = nowIso();
      const setup =
        mode === "jec"
          ? { ...(await provisionJecChannel(now)), mode }
          : createSimulatorChannel(now);

      return success({ setup: await saveChannelSetup(setup) });
    } catch (error) {
      return failure(error);
    }
  },
);

resolver.define(
  "createReportTask",
  async (request: ResolverRequest<CreateReportTaskPayload>) => {
    try {
      const name = request.payload?.name?.trim() || "On-premise report";
      const mode = request.payload?.mode || "simulator";
      const existingSetup = await getChannelSetup();
      const now = nowIso();
      const setup =
        existingSetup ||
        (mode === "jec"
          ? { ...(await provisionJecChannel(now)), mode }
          : createSimulatorChannel(now));

      if (!existingSetup) {
        await saveChannelSetup(setup);
      }

      const task = createTaskProjection({
        id: randomUUID(),
        name,
        context: request.payload?.context,
        mode,
        channelId: setup.channelId,
        now,
      });

      await saveNewTask(task, {
        id: randomUUID(),
        taskId: task.id,
        type: TASK_EVENT_TYPES.taskCreated,
        status: task.status,
        channelId: task.channelId,
        mode: task.mode,
        createdAt: now,
        message: "Task was created by the Jira global page.",
      });

      const dispatchEvent =
        mode === "jec"
          ? await dispatchReportTask(task, nowIso())
          : createSimulatorDispatchEvent(task, nowIso());
      const projection = await appendTaskEvent(task.id, dispatchEvent);

      return success({ task: projection });
    } catch (error) {
      return failure(error);
    }
  },
);

resolver.define("listReportTasks", async () => {
  try {
    return success({ tasks: await listTasks() });
  } catch (error) {
    return failure(error);
  }
});

resolver.define(
  "getReportTask",
  async (request: ResolverRequest<TaskIdPayload>) => {
    try {
      const taskId = request.payload?.taskId;

      if (!taskId) {
        throw new Error("taskId is required.");
      }

      return success({ detail: await getTaskDetail(taskId) });
    } catch (error) {
      return failure(error);
    }
  },
);

resolver.define(
  "runFallbackSimulation",
  async (request: ResolverRequest<TaskIdPayload>) => {
    try {
      const taskId = request.payload?.taskId;

      if (!taskId) {
        throw new Error("taskId is required.");
      }

      const task = await getTask(taskId);

      if (!task) {
        throw new Error(`Task ${taskId} was not found.`);
      }

      const projection = await appendTaskEvent(
        taskId,
        createSimulatorCompletionEvent(task, nowIso()),
      );
      return success({ task: projection });
    } catch (error) {
      return failure(error);
    }
  },
);

export const handler = resolver.getDefinitions();
