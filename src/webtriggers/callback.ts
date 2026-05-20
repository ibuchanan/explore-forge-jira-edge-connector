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
import { toErrorMessage } from "../shared/errors";

interface WebTriggerRequest {
  method?: string;
  path?: string;
  body?: string;
  headers?: Record<string, string | string[] | undefined>;
}

function jsonResponse(statusCode: number, body: Record<string, unknown>) {
  return {
    statusCode,
    headers: {
      "Content-Type": ["application/json"],
    },
    body: JSON.stringify(body),
  };
}

export async function callback(request: WebTriggerRequest) {
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

    return jsonResponse(202, {
      accepted: true,
      taskId: projection.id,
      status: projection.status,
    });
  } catch (error) {
    return jsonResponse(401, {
      accepted: false,
      error: toErrorMessage(error),
    });
  }
}
