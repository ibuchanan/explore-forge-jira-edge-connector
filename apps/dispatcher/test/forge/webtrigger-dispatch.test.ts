import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok, type ProblemDetails } from "forge-ahead";
import {
  TASK_STATUSES,
  type TaskProjection,
} from "../../src/domain/task-state";

// ---------------------------------------------------------------------------
// Module mocks.
// forge-ahead is mocked with importOriginal so that StandardError and its
// registered types (400, 401, 500, 502, 503, …) remain intact — only
// getAuthForEvent is replaced with a controllable spy.
// ---------------------------------------------------------------------------

vi.mock("forge-ahead", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal();
  return { ...(actual as object), getAuthForEvent: vi.fn() };
});

vi.mock("../../src/infrastructure/storage/channel-store", () => ({
  getChannelSetup: vi.fn(),
}));

vi.mock("../../src/infrastructure/storage/task-store", () => ({
  saveNewTask: vi.fn(),
  appendTaskEvent: vi.fn(),
}));

vi.mock("../../src/infrastructure/jec/jec-channel-adapter", () => ({
  dispatchReportTask: vi.fn(),
}));

vi.mock("../../src/infrastructure/jec/simulator-adapter", () => ({
  createSimulatorDispatchEvent: vi.fn(),
}));

// Imports must come after vi.mock declarations (vitest hoists vi.mock calls).
import { getAuthForEvent } from "forge-ahead";
import { getChannelSetup } from "../../src/infrastructure/storage/channel-store";
import {
  appendTaskEvent,
  saveNewTask,
} from "../../src/infrastructure/storage/task-store";
import { dispatchReportTask } from "../../src/infrastructure/jec/jec-channel-adapter";
import { createSimulatorDispatchEvent } from "../../src/infrastructure/jec/simulator-adapter";
import { dispatchViaWebtrigger } from "../../src/webtriggers/dispatch";

// ---------------------------------------------------------------------------
// Typed mock references
// ---------------------------------------------------------------------------

const mockGetAuthForEvent = vi.mocked(getAuthForEvent);
const mockGetChannelSetup = vi.mocked(getChannelSetup);
const mockSaveNewTask = vi.mocked(saveNewTask);
const mockAppendTaskEvent = vi.mocked(appendTaskEvent);
const mockDispatchReportTask = vi.mocked(dispatchReportTask);
const mockCreateSimulatorDispatchEvent = vi.mocked(
  createSimulatorDispatchEvent,
);

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeWebtriggerEvent(body?: object) {
  return {
    body: body ? JSON.stringify(body) : undefined,
    headers: {},
    queryParameters: {},
  };
}

const STUB_AUTH = { auth: { requestJira: vi.fn() } };

const STUB_SETUP = {
  channelId: "channel-abc",
  apiKey: "key-xyz",
  mode: "jec" as const,
  provisionedAt: "2026-06-01T00:00:00.000Z",
  note: "test",
};

function makeProjection(status: keyof typeof TASK_STATUSES): TaskProjection {
  return {
    id: "task-1",
    name: "Test task",
    context: "smoke test",
    mode: "jec",
    channelId: "channel-abc",
    status: TASK_STATUSES[status],
    createdAt: "2026-06-04T20:00:00.000Z",
    updatedAt: "2026-06-04T20:00:01.000Z",
    lastEventType: "JEC_DISPATCH_REQUESTED",
    lastMessage: "some message",
  };
}

function makeDispatchEvent(status: keyof typeof TASK_STATUSES, message = "ok") {
  return {
    id: "event-1",
    taskId: "task-1",
    type: "JEC_DISPATCH_REQUESTED" as const,
    status: TASK_STATUSES[status],
    channelId: "channel-abc",
    mode: "jec" as const,
    createdAt: "2026-06-04T20:00:01.000Z",
    message,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dispatchViaWebtrigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveNewTask.mockResolvedValue(makeProjection("pending"));
  });

  describe("auth failure", () => {
    it("should return 401 Problem Details when auth fails", async () => {
      const authError: ProblemDetails = {
        type: "https://httpstatuses.io/401",
        title: "Unauthorized",
        status: 401,
        detail: "No valid authentication context found.",
        timestamp: "2026-06-04T20:00:00.000Z",
      };
      mockGetAuthForEvent.mockReturnValue(err(authError));

      const response = await dispatchViaWebtrigger(makeWebtriggerEvent());

      expect(response.statusCode).toBe(401);
      expect(response.headers?.["Content-Type"]).toEqual([
        "application/problem+json",
      ]);
      const body = JSON.parse(response.body ?? "{}") as ProblemDetails;
      expect(body.status).toBe(401);
      expect(body.title).toBe("Unauthorized");
      expect(body.detail).toBe("No valid authentication context found.");
    });
  });

  describe("app not configured", () => {
    it("should return 503 Problem Details when channel setup is missing", async () => {
      mockGetAuthForEvent.mockReturnValue(ok(STUB_AUTH));
      mockGetChannelSetup.mockResolvedValue(null);

      const response = await dispatchViaWebtrigger(makeWebtriggerEvent());

      expect(response.statusCode).toBe(503);
      expect(response.headers?.["Content-Type"]).toEqual([
        "application/problem+json",
      ]);
      const body = JSON.parse(response.body ?? "{}") as ProblemDetails;
      expect(body.status).toBe(503);
      expect(body.title).toBe("Service Unavailable");
      expect(body.detail).toContain("not configured");
    });
  });

  describe("dispatch failure (JEC upstream error)", () => {
    it("should return 502 Problem Details when JEC returns an error", async () => {
      const jecMessage =
        'JEC dispatch failed (403): {"code":40301,"message":"Account does not have access to Opsgenie."}';
      mockGetAuthForEvent.mockReturnValue(ok(STUB_AUTH));
      mockGetChannelSetup.mockResolvedValue(STUB_SETUP);
      mockDispatchReportTask.mockResolvedValue(
        makeDispatchEvent("dispatch_failed", jecMessage),
      );
      const failedProjection: TaskProjection = {
        ...makeProjection("dispatch_failed"),
        lastMessage: jecMessage,
      };
      mockAppendTaskEvent.mockResolvedValue(failedProjection);

      const response = await dispatchViaWebtrigger(
        makeWebtriggerEvent({ name: "Test from xh", context: "smoke test" }),
      );

      expect(response.statusCode).toBe(502);
      expect(response.headers?.["Content-Type"]).toEqual([
        "application/problem+json",
      ]);
      const body = JSON.parse(response.body ?? "{}") as ProblemDetails;
      expect(body.status).toBe(502);
      expect(body.title).toBe("Bad Gateway");
      expect(body.detail).toBe(jecMessage);
    });

    it("should surface the JEC error message verbatim in the problem detail", async () => {
      const jecMessage = "JEC dispatch failed (500): internal server error";
      mockGetAuthForEvent.mockReturnValue(ok(STUB_AUTH));
      mockGetChannelSetup.mockResolvedValue(STUB_SETUP);
      mockDispatchReportTask.mockResolvedValue(
        makeDispatchEvent("dispatch_failed", jecMessage),
      );
      const failedProjection: TaskProjection = {
        ...makeProjection("dispatch_failed"),
        lastMessage: jecMessage,
      };
      mockAppendTaskEvent.mockResolvedValue(failedProjection);

      const response = await dispatchViaWebtrigger(makeWebtriggerEvent());

      const body = JSON.parse(response.body ?? "{}") as ProblemDetails;
      expect(body.detail).toBe(jecMessage);
    });
  });

  describe("successful dispatch", () => {
    it("should return 200 with task projection on success", async () => {
      mockGetAuthForEvent.mockReturnValue(ok(STUB_AUTH));
      mockGetChannelSetup.mockResolvedValue(STUB_SETUP);
      mockDispatchReportTask.mockResolvedValue(
        makeDispatchEvent(
          "dispatched",
          "Task dispatched to JEC via JSM Ops API (202 Accepted).",
        ),
      );
      mockAppendTaskEvent.mockResolvedValue(makeProjection("dispatched"));

      const response = await dispatchViaWebtrigger(
        makeWebtriggerEvent({ name: "My task", context: "ctx" }),
      );

      expect(response.statusCode).toBe(200);
      expect(response.headers?.["Content-Type"]).toEqual(["application/json"]);
      const body = JSON.parse(response.body ?? "{}") as {
        ok: boolean;
        task: TaskProjection;
      };
      expect(body.ok).toBe(true);
      expect(body.task.status).toBe(TASK_STATUSES.dispatched);
    });

    it("should trim name and pass context from request body", async () => {
      mockGetAuthForEvent.mockReturnValue(ok(STUB_AUTH));
      mockGetChannelSetup.mockResolvedValue(STUB_SETUP);
      mockDispatchReportTask.mockResolvedValue(makeDispatchEvent("dispatched"));
      mockAppendTaskEvent.mockResolvedValue(makeProjection("dispatched"));

      await dispatchViaWebtrigger(
        makeWebtriggerEvent({ name: "  Named task  ", context: "my context" }),
      );

      const savedProjection = mockSaveNewTask.mock
        .calls[0]?.[0] as TaskProjection;
      expect(savedProjection.name).toBe("Named task");
      expect(savedProjection.context).toBe("my context");
    });

    it("should use simulator path when mode is simulator", async () => {
      mockGetAuthForEvent.mockReturnValue(ok(STUB_AUTH));
      mockGetChannelSetup.mockResolvedValue({
        ...STUB_SETUP,
        mode: "simulator",
      });
      const simEvent = makeDispatchEvent("dispatched", "Simulated dispatch.");
      mockCreateSimulatorDispatchEvent.mockReturnValue(simEvent);
      mockAppendTaskEvent.mockResolvedValue({
        ...makeProjection("dispatched"),
        mode: "simulator",
      });

      const response = await dispatchViaWebtrigger(makeWebtriggerEvent());

      expect(mockDispatchReportTask).not.toHaveBeenCalled();
      expect(mockCreateSimulatorDispatchEvent).toHaveBeenCalledOnce();
      expect(response.statusCode).toBe(200);
    });
  });

  describe("unexpected error", () => {
    it("should return 500 Problem Details on unhandled exception", async () => {
      mockGetAuthForEvent.mockReturnValue(ok(STUB_AUTH));
      mockGetChannelSetup.mockRejectedValue(
        new Error("KVS connection timeout"),
      );

      const response = await dispatchViaWebtrigger(makeWebtriggerEvent());

      expect(response.statusCode).toBe(500);
      expect(response.headers?.["Content-Type"]).toEqual([
        "application/problem+json",
      ]);
      const body = JSON.parse(response.body ?? "{}") as ProblemDetails;
      expect(body.status).toBe(500);
      expect(body.title).toBe("Internal Server Error");
      expect(body.detail).toBe("KVS connection timeout");
    });
  });
});
