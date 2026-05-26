import { describe, expect, it } from "vitest";
import {
  createTaskProjection,
  isTerminalStatus,
  projectTask,
  TASK_EVENT_TYPES,
  TASK_STATUSES,
  type TaskEvent,
} from "../../src/domain/task-state";

describe("JEC sample app domain — dispatch-only task state", () => {
  it("should create a task in pending state", () => {
    const task = createTaskProjection({
      id: "task-1",
      name: "Report",
      mode: "simulator",
      channelId: "channel-1",
      now: "2026-05-21T00:00:00.000Z",
    });

    expect(task.status).toBe(TASK_STATUSES.pending);
    expect(task.lastEventType).toBe(TASK_EVENT_TYPES.taskCreated);
  });

  it("should transition pending → dispatched on a dispatched event", () => {
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
        type: TASK_EVENT_TYPES.jecDispatchRequested,
        status: TASK_STATUSES.dispatched,
        channelId: "channel-1",
        createdAt: "2026-05-21T00:01:00.000Z",
        message: "Dispatched",
      },
    ];

    const projection = projectTask(task, events);

    expect(projection.status).toBe(TASK_STATUSES.dispatched);
    expect(projection.lastEventType).toBe(
      TASK_EVENT_TYPES.jecDispatchRequested,
    );
    expect(projection.lastMessage).toBe("Dispatched");
  });

  it("should transition pending → dispatch_failed on a failed dispatch event", () => {
    const task = createTaskProjection({
      id: "task-1",
      name: "Report",
      mode: "jec",
      channelId: "channel-1",
      now: "2026-05-21T00:00:00.000Z",
    });

    const events: TaskEvent[] = [
      {
        id: "event-1",
        taskId: "task-1",
        type: TASK_EVENT_TYPES.jecDispatchRequested,
        status: TASK_STATUSES.dispatch_failed,
        channelId: "channel-1",
        createdAt: "2026-05-21T00:01:00.000Z",
        message: "JEC dispatch failed (503): service unavailable",
      },
    ];

    const projection = projectTask(task, events);

    expect(projection.status).toBe(TASK_STATUSES.dispatch_failed);
  });

  it("should keep terminal states immutable (dispatched cannot be overwritten)", () => {
    const task = {
      ...createTaskProjection({
        id: "task-1",
        name: "Report",
        mode: "simulator" as const,
        channelId: "channel-1",
        now: "2026-05-21T00:00:00.000Z",
      }),
      status: TASK_STATUSES.dispatched,
    };

    const projection = projectTask(task, [
      {
        id: "event-2",
        taskId: "task-1",
        type: TASK_EVENT_TYPES.taskExpired,
        status: TASK_STATUSES.expired,
        channelId: "channel-1",
        createdAt: "2026-05-21T00:02:00.000Z",
        message: "Should not overwrite dispatched",
      },
    ]);

    expect(projection.status).toBe(TASK_STATUSES.dispatched);
  });

  it("should identify terminal statuses correctly", () => {
    expect(isTerminalStatus(TASK_STATUSES.dispatched)).toBe(true);
    expect(isTerminalStatus(TASK_STATUSES.dispatch_failed)).toBe(true);
    expect(isTerminalStatus(TASK_STATUSES.expired)).toBe(true);
    expect(isTerminalStatus(TASK_STATUSES.pending)).toBe(false);
  });

  it("should expire a stale pending task", () => {
    const task = createTaskProjection({
      id: "task-1",
      name: "Report",
      mode: "simulator",
      channelId: "channel-1",
      now: "2026-05-21T00:00:00.000Z",
    });

    const projection = projectTask(task, [
      {
        id: "event-1",
        taskId: "task-1",
        type: TASK_EVENT_TYPES.taskExpired,
        status: TASK_STATUSES.expired,
        channelId: "channel-1",
        createdAt: "2026-05-22T00:00:00.000Z",
        message: "Scheduled cleanup expired this stale task.",
      },
    ]);

    expect(projection.status).toBe(TASK_STATUSES.expired);
  });
});
