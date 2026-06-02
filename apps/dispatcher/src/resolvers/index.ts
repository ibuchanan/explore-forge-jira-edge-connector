import { randomUUID } from "node:crypto";
import Resolver from "@forge/resolver";
import type { JSONValue } from "forge-ahead";
import { logContext } from "forge-ahead";
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
  createSimulatorDispatchEvent,
} from "../infrastructure/jec/simulator-adapter";
import {
  type ChannelSetup,
  deleteChannelSetup,
  getChannelSetup,
  saveChannelSetup,
} from "../infrastructure/storage/channel-store";
import {
  appendTaskEvent,
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

interface CreateTaskPayload {
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

type PublicChannelSetup = Omit<ChannelSetup, "apiKey">;

function toPublicSetup(setup: ChannelSetup | null): PublicChannelSetup | null {
  if (!setup) {
    return null;
  }

  return {
    channelId: setup.channelId,
    mode: setup.mode,
    provisionedAt: setup.provisionedAt,
    note: setup.note,
  };
}

function getReceiverSetupDetail(setup: ChannelSetup | null): string {
  if (!setup) {
    return "No channel has been provisioned yet.";
  }

  if (setup.mode === "simulator") {
    return "Simulator mode is ready; no on-premise receiver is required.";
  }

  return "Copy the channel API key from the JEC Event Bridge page into jec-config.json and start the receiver.";
}

resolver.define("getSetupStatus", async (request: ResolverRequest) => {
  logContext(request.context as JSONValue, "getSetupStatus");
  try {
    return success({ setup: await getChannelSetup() });
  } catch (error) {
    return failure(error);
  }
});

resolver.define("getConnectionStatus", async (request: ResolverRequest) => {
  logContext(request.context as JSONValue, "getConnectionStatus");
  try {
    const setup = await getChannelSetup();
    return success({
      isConfigured: !!setup,
      setup: toPublicSetup(setup),
    });
  } catch (error) {
    return failure(error);
  }
});

resolver.define("getConnectionHealth", async (request: ResolverRequest) => {
  logContext(request.context as JSONValue, "getConnectionHealth");
  try {
    const setup = await getChannelSetup();
    const isConfigured = !!setup;

    return success({
      configured: {
        ok: isConfigured,
        detail: setup
          ? `${setup.mode === "jec" ? "JEC" : "Simulator"} channel ${setup.channelId} provisioned.`
          : "Provision a simulator or JEC channel from Configure App.",
      },
      receiver: {
        ok: setup?.mode === "simulator" || setup?.mode === "jec",
        detail: getReceiverSetupDetail(setup),
      },
      usage: {
        ok: isConfigured,
        detail: isConfigured
          ? "The JEC Event Bridge page is unblocked for dispatching work."
          : "The usage page shows a configuration block until setup is complete.",
      },
      setup: toPublicSetup(setup),
    });
  } catch (error) {
    return failure(error);
  }
});

resolver.define("resetConnection", async (request: ResolverRequest) => {
  logContext(request.context as JSONValue, "resetConnection");
  try {
    await deleteChannelSetup();
    return success({ isConfigured: false, setup: null });
  } catch (error) {
    return failure(error);
  }
});

resolver.define(
  "provisionChannel",
  async (request: ResolverRequest<{ mode?: TaskMode }>) => {
    try {
      const mode = request.payload?.mode || "simulator";
      const cloudId = request.context?.cloudId || "";
      const now = nowIso();

      const setup =
        mode === "jec"
          ? { ...(await provisionJecChannel(cloudId, now)), mode }
          : createSimulatorChannel(now);

      return success({ setup: await saveChannelSetup(setup) });
    } catch (error) {
      return failure(error);
    }
  },
);

resolver.define(
  "createTask",
  async (request: ResolverRequest<CreateTaskPayload>) => {
    try {
      const name = request.payload?.name?.trim() || "On-premise task";
      const cloudId = request.context?.cloudId || "";
      const setup = await getChannelSetup();
      const now = nowIso();

      if (!setup) {
        throw new Error(
          "The dispatcher is not configured. Ask an admin to provision a channel from Configure App before dispatching work.",
        );
      }

      const task = createTaskProjection({
        id: randomUUID(),
        name,
        context: request.payload?.context,
        mode: setup.mode,
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
        setup.mode === "jec"
          ? await dispatchReportTask(task, cloudId, nowIso())
          : createSimulatorDispatchEvent(task, nowIso());

      const projection = await appendTaskEvent(task.id, dispatchEvent);

      return success({ task: projection });
    } catch (error) {
      return failure(error);
    }
  },
);

resolver.define("listTasks", async (request: ResolverRequest) => {
  logContext(request.context as JSONValue, "listTasks");
  try {
    return success({ tasks: await listTasks() });
  } catch (error) {
    return failure(error);
  }
});

resolver.define("getTask", async (request: ResolverRequest<TaskIdPayload>) => {
  logContext(request.context as JSONValue, "getTask");
  try {
    const taskId = request.payload?.taskId;

    if (!taskId) {
      throw new Error("taskId is required.");
    }

    return success({ detail: await getTaskDetail(taskId) });
  } catch (error) {
    return failure(error);
  }
});

export const handler = resolver.getDefinitions();
