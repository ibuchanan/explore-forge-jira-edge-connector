import { randomUUID } from "node:crypto";
import api from "@forge/api";
import Resolver from "@forge/resolver";
import type { JSONValue } from "forge-ahead";
import { logContext } from "forge-ahead";
import {
  createTaskProjection,
  TASK_EVENT_TYPES,
  TASK_STATUSES,
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
  deleteActAsAccountId,
  getActAsAccountId,
  saveActAsAccountId,
} from "../infrastructure/storage/act-as-store";
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

type PublicChannelSetup = ChannelSetup;

function toPublicSetup(setup: ChannelSetup | null): PublicChannelSetup | null {
  return setup;
}

async function getReceiverStatus(
  setup: ChannelSetup | null,
): Promise<{ ok: boolean; detail: string }> {
  if (!setup) {
    return { ok: false, detail: "No channel has been provisioned yet." };
  }

  if (setup.mode === "simulator") {
    return {
      ok: true,
      detail: "Simulator mode is ready; no on-premise receiver is required.",
    };
  }

  // For JEC mode, surface the most recent JEC task result rather than a
  // binary "has anything ever succeeded" — this makes the status useful for
  // diagnosing configuration changes (e.g. a new actAs account that isn't working).
  const tasks = await listTasks();
  const jecTasks = tasks
    .filter((t) => t.mode === "jec")
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

  const mostRecent = jecTasks[0];

  if (!mostRecent) {
    return {
      ok: false,
      detail:
        "No JEC tasks dispatched yet. Copy the API key from the Configure page into jec-config.json and send a test task.",
    };
  }

  const ts = new Date(mostRecent.updatedAt).toLocaleString();

  if (mostRecent.status === TASK_STATUSES.dispatched) {
    return {
      ok: true,
      detail: `Last dispatch succeeded at ${ts}: ${mostRecent.lastMessage}`,
    };
  }

  return {
    ok: false,
    detail: `Last dispatch failed at ${ts}: ${mostRecent.lastMessage}`,
  };
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
      receiver: await getReceiverStatus(setup),
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
    await deleteActAsAccountId();
    return success({ isConfigured: false, setup: null });
  } catch (error) {
    return failure(error);
  }
});

resolver.define(
  "provisionChannel",
  async (
    request: ResolverRequest<{ mode?: TaskMode; ownerDomain?: string }>,
  ) => {
    try {
      const mode = request.payload?.mode || "simulator";
      const userIdentifier = request.context?.accountId || "";
      const ownerDomain = request.payload?.ownerDomain || "";
      const now = nowIso();

      const setup =
        mode === "jec"
          ? {
              ...(await provisionJecChannel(userIdentifier, ownerDomain, now)),
              mode,
            }
          : createSimulatorChannel(now);

      const savedSetup = await saveChannelSetup(setup);
      // Auto-populate actAs with the provisioner's identity. This is the default
      // that admins can later change via updateActAsUser without re-provisioning.
      await saveActAsAccountId(userIdentifier);

      return success({ setup: savedSetup });
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

      const actAsAccountId =
        setup.mode === "jec" ? await getActAsAccountId() : null;

      if (setup.mode === "jec" && !actAsAccountId) {
        throw new Error(
          "JEC dispatch account is not configured. Set an actAs user from the Configure App page.",
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
        setup.mode === "jec" && actAsAccountId
          ? await dispatchReportTask(task, cloudId, nowIso(), {
              auth: api.asUser(actAsAccountId),
            })
          : createSimulatorDispatchEvent(task, nowIso());

      const projection = await appendTaskEvent(task.id, dispatchEvent);

      console.log("[createTask] task dispatched", {
        taskId: projection.id,
        mode: projection.mode,
        status: projection.status,
        message: dispatchEvent.message,
      });

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

resolver.define("getActAsConfig", async (request: ResolverRequest) => {
  logContext(request.context as JSONValue, "getActAsConfig");
  try {
    const accountId = await getActAsAccountId();
    return success({ accountId });
  } catch (error) {
    return failure(error);
  }
});

resolver.define(
  "updateActAsUser",
  async (request: ResolverRequest<{ accountId?: string }>) => {
    logContext(request.context as JSONValue, "updateActAsUser");
    try {
      const accountId = request.payload?.accountId?.trim() || "";
      if (!accountId) {
        throw new Error("accountId is required.");
      }
      await saveActAsAccountId(accountId);
      return success({ accountId });
    } catch (error) {
      return failure(error);
    }
  },
);

export const handler = resolver.getDefinitions();
