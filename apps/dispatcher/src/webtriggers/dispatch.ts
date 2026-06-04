import { randomUUID } from "node:crypto";
import {
  getAuthForEvent,
  type WebtriggerEvent,
  type WebtriggerResponse,
} from "forge-ahead";
import { createTaskProjection, TASK_EVENT_TYPES } from "../domain/task-state";
import { dispatchReportTask } from "../infrastructure/jec/jec-channel-adapter";
import { createSimulatorDispatchEvent } from "../infrastructure/jec/simulator-adapter";
import { getChannelSetup } from "../infrastructure/storage/channel-store";
import {
  appendTaskEvent,
  saveNewTask,
} from "../infrastructure/storage/task-store";

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
 * It always returns HTTP 200 with a JSON body:
 *   { "ok": true,  "task": { ...projection } }
 *   { "ok": false, "error": "message" }
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

  try {
    const authResult = getAuthForEvent(request);
    if (authResult.isErr()) {
      return jsonBody({ ok: false, error: authResult.error.detail });
    }

    const setup = await getChannelSetup();

    if (!setup) {
      return jsonBody({
        ok: false,
        error:
          "The dispatcher is not configured. Ask an admin to provision a channel from Configure App before dispatching work.",
      });
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

    return jsonBody({ ok: true, task: projection });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[dispatchViaWebtrigger] unexpected error", { message });
    return jsonBody({ ok: false, error: message });
  }
}
