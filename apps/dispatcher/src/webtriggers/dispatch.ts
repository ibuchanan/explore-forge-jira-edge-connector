import { randomUUID } from "node:crypto";
import {
  getAuthForEvent,
  type ProblemDetails,
  type WebtriggerEvent,
  type WebtriggerResponse,
} from "forge-ahead";
import {
  createTaskProjection,
  TASK_EVENT_TYPES,
  TASK_STATUSES,
} from "../domain/task-state";
import { dispatchReportTask } from "../infrastructure/jec/jec-channel-adapter";
import { createSimulatorDispatchEvent } from "../infrastructure/jec/simulator-adapter";
import { getChannelSetup } from "../infrastructure/storage/channel-store";
import {
  appendTaskEvent,
  saveNewTask,
} from "../infrastructure/storage/task-store";
import { toProblemDetails } from "../shared/errors";

/**
 * Webtrigger handler that dispatches a JEC event.
 *
 * Auth is resolved via `getAuthForEvent` — since webtriggers have no user
 * context (`context.userAccess.enabled` is false), it naturally falls through
 * to `asApp()`. This keeps the code path identical to the resolver-based
 * `createTask`, which uses `asUser()` when a user context is present.
 *
 * The webtrigger accepts an optional JSON body:
 *   { "name": "task name", "context": "optional context string" }
 *
 * Success returns HTTP 200 with a JSON body:
 *   { "ok": true, "task": { ...projection } }
 *
 * Errors return an RFC 9457 Problem Details body with the appropriate status:
 *   - 401 if app authentication fails
 *   - 503 if the app is not yet configured
 *   - 500 for unexpected errors
 */
export async function dispatchViaWebtrigger(
  request: WebtriggerEvent,
): Promise<WebtriggerResponse> {
  const now = new Date().toISOString();

  const jsonBody = (body: unknown): WebtriggerResponse => ({
    body: JSON.stringify(body),
    headers: { "Content-Type": ["application/json"] },
    statusCode: 200,
    statusText: "OK",
  });

  const problemBody = (problem: ProblemDetails): WebtriggerResponse => ({
    body: JSON.stringify(problem),
    headers: { "Content-Type": ["application/problem+json"] },
    statusCode: problem.status,
    statusText: problem.title,
  });

  try {
    const authResult = getAuthForEvent(request);
    if (authResult.isErr()) {
      return problemBody(authResult.error);
    }

    const setup = await getChannelSetup();

    if (!setup) {
      return problemBody(
        toProblemDetails(
          "The dispatcher is not configured. Ask an admin to provision a channel from Configure App before dispatching work.",
          503,
        ),
      );
    }

    // Parse optional request body for name/context overrides.
    let name = "Webtrigger task";
    let context: string | undefined;
    if (request.body) {
      try {
        const parsed = JSON.parse(request.body) as Record<string, unknown>;
        if (typeof parsed.name === "string" && parsed.name.trim()) {
          name = parsed.name.trim();
        }
        if (typeof parsed.context === "string") {
          context = parsed.context;
        }
      } catch {
        // Non-JSON body is fine — we use defaults.
      }
    }

    const task = createTaskProjection({
      id: randomUUID(),
      name,
      context,
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
      message: "Task was created by the webtrigger.",
    });

    // Auth resolved above: asApp() for webtriggers (no user context),
    // asUser() for resolver context — same dispatchReportTask, different auth.
    const dispatchEvent =
      setup.mode === "jec"
        ? await dispatchReportTask(task, "", now, authResult.value)
        : createSimulatorDispatchEvent(task, now);

    const projection = await appendTaskEvent(task.id, dispatchEvent);

    console.log("[dispatchViaWebtrigger] task dispatched", {
      taskId: projection.id,
      mode: projection.mode,
      status: projection.status,
      message: dispatchEvent.message,
    });

    if (projection.status === TASK_STATUSES.dispatch_failed) {
      return problemBody(toProblemDetails(projection.lastMessage, 502));
    }

    return jsonBody({ ok: true, task: projection });
  } catch (error) {
    const problem = toProblemDetails(error, 500);
    console.error("[dispatchViaWebtrigger] unexpected error", {
      detail: problem.detail,
    });
    return problemBody(problem);
  }
}
