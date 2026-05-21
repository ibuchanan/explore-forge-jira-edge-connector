import type {
  JSONValue,
  ProblemDetails,
  Result,
  WebtriggerFunction,
} from "forge-ahead";
import {
  buildWebtriggerErrorResponse,
  buildWebtriggerSuccessResponse,
  logContext,
  logResult,
  ok,
} from "forge-ahead";
import {
  createCallbackTaskEvent,
  parseCallbackPayload,
} from "../domain/callback-events";
import {
  assertFreshTimestamp,
  extractSignatureHeaders,
  verifySignature,
} from "../domain/signatures";
import { assertNonceUnused } from "../infrastructure/storage/nonce-store";
import { appendTaskEvent, getTask } from "../infrastructure/storage/task-store";
import { CALLBACK_KEY_ID, CALLBACK_SECRET } from "../shared/constants";
import { problemResult } from "../shared/errors";

type CallbackAccepted = {
  accepted: true;
  taskId: string;
  status: string;
};

async function acceptCallback(
  request: Parameters<WebtriggerFunction>[0],
): Promise<Result<CallbackAccepted, ProblemDetails>> {
  const now = new Date().toISOString();
  const body = request.body || "";

  try {
    const payload = parseCallbackPayload(body);
    const signatureHeaders = extractSignatureHeaders(request.headers || {});

    if (signatureHeaders.keyId !== CALLBACK_KEY_ID) {
      throw new Error("Callback key ID is not recognized.");
    }

    assertFreshTimestamp(signatureHeaders.timestamp);
    await assertNonceUnused(signatureHeaders.nonce, now);

    const isAuthentic = verifySignature(
      {
        method: request.method || "POST",
        path: request.path || "/callback",
        body,
        timestamp: signatureHeaders.timestamp,
        nonce: signatureHeaders.nonce,
        taskId: payload.taskId,
        channelId: payload.channelId,
      },
      signatureHeaders.signature,
      CALLBACK_SECRET,
    );

    if (!isAuthentic) {
      throw new Error("Callback signature verification failed.");
    }

    const task = await getTask(payload.taskId);

    if (!task) {
      throw new Error(`Task ${payload.taskId} was not found.`);
    }

    if (task.channelId !== payload.channelId) {
      throw new Error(
        "Callback channel does not match the task channel binding.",
      );
    }

    const projection = await appendTaskEvent(
      payload.taskId,
      createCallbackTaskEvent(payload, now),
    );

    return ok({
      accepted: true,
      taskId: projection.id,
      status: projection.status,
    });
  } catch (error) {
    return problemResult(error, 401);
  }
}

export const callback: WebtriggerFunction = async (request, context) => {
  logContext(context as unknown as JSONValue, "JEC callback");

  const result = await acceptCallback(request);
  logResult(result, "JEC callback");

  return result.match(
    (accepted) => buildWebtriggerSuccessResponse(accepted, 202, "Accepted"),
    buildWebtriggerErrorResponse,
  );
};
