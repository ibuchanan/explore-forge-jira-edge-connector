import { describe, expect, it } from "vitest";
import {
  createTaskProjection,
  projectTask,
  TASK_EVENT_TYPES,
  TASK_STATUSES,
  type TaskEvent,
} from "../../src/domain/task-state";
import {
  assertFreshTimestamp,
  createCanonicalString,
  signCanonicalString,
  verifySignature,
} from "../../src/domain/signatures";

describe("JEC sample app domain", () => {
  it("should derive task state from an event log", () => {
    const task = createTaskProjection({
      id: "task-1",
      name: "Report",
      mode: "simulator",
      channelId: "channel-1",
      now: "2026-05-21T00:00:00.000Z",
    });

    const events: TaskEvent[] = [
      {
        id: "event-1",
        taskId: "task-1",
        type: TASK_EVENT_TYPES.taskRunningReported,
        status: TASK_STATUSES.running,
        channelId: "channel-1",
        createdAt: "2026-05-21T00:01:00.000Z",
        message: "Running",
      },
      {
        id: "event-2",
        taskId: "task-1",
        type: TASK_EVENT_TYPES.taskCompletedReported,
        status: TASK_STATUSES.complete,
        channelId: "channel-1",
        createdAt: "2026-05-21T00:02:00.000Z",
        message: "Complete",
      },
    ];

    const projection = projectTask(task, events);

    expect(projection.status).toBe(TASK_STATUSES.complete);
    expect(projection.lastEventType).toBe(
      TASK_EVENT_TYPES.taskCompletedReported,
    );
    expect(projection.lastMessage).toBe("Complete");
  });

  it("should keep terminal states immutable", () => {
    const task = {
      ...createTaskProjection({
        id: "task-1",
        name: "Report",
        mode: "simulator" as const,
        channelId: "channel-1",
        now: "2026-05-21T00:00:00.000Z",
      }),
      status: TASK_STATUSES.complete,
    };

    const projection = projectTask(task, [
      {
        id: "event-3",
        taskId: "task-1",
        type: TASK_EVENT_TYPES.taskFailedReported,
        status: TASK_STATUSES.failed,
        channelId: "channel-1",
        createdAt: "2026-05-21T00:03:00.000Z",
        message: "Late failure should not reopen terminal status",
      },
    ]);

    expect(projection.status).toBe(TASK_STATUSES.complete);
  });

  it("should verify HMAC signatures over the canonical callback string", () => {
    const input = {
      method: "POST",
      path: "/callback",
      body: JSON.stringify({
        taskId: "task-1",
        channelId: "channel-1",
        status: "complete",
      }),
      timestamp: "2026-05-21T00:00:00.000Z",
      nonce: "nonce-1",
      taskId: "task-1",
      channelId: "channel-1",
    };
    const signature = signCanonicalString(
      createCanonicalString(input),
      "secret",
    );

    expect(verifySignature(input, signature, "secret")).toBe(true);
    expect(
      verifySignature(
        { ...input, channelId: "other-channel" },
        signature,
        "secret",
      ),
    ).toBe(false);
  });

  it("should reject stale callback timestamps", () => {
    expect(() =>
      assertFreshTimestamp(
        "2026-05-21T00:00:00.000Z",
        Date.parse("2026-05-21T00:10:01.000Z"),
      ),
    ).toThrow("freshness window");
  });
});
