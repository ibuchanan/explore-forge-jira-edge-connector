import { kvs } from "@forge/kvs";
import {
  projectTask,
  type TaskEvent,
  type TaskProjection,
} from "../../domain/task-state";
import { MAX_RECENT_TASKS, STORE_KEYS } from "../../shared/constants";

async function readTaskIndex(): Promise<string[]> {
  return ((await kvs.get(STORE_KEYS.taskIndex)) as string[] | undefined) || [];
}

async function writeTaskIndex(taskIds: string[]): Promise<void> {
  await kvs.set(STORE_KEYS.taskIndex, taskIds.slice(0, MAX_RECENT_TASKS));
}

export async function saveNewTask(
  projection: TaskProjection,
  event: TaskEvent,
): Promise<TaskProjection> {
  await kvs.set(STORE_KEYS.taskProjection(projection.id), projection);
  await kvs.set(STORE_KEYS.taskEvents(projection.id), [event]);

  const index = await readTaskIndex();
  await writeTaskIndex([
    projection.id,
    ...index.filter((id) => id !== projection.id),
  ]);

  return projection;
}

export async function listTasks(): Promise<TaskProjection[]> {
  const index = await readTaskIndex();
  const tasks = await Promise.all(
    index.map((taskId) => kvs.get(STORE_KEYS.taskProjection(taskId))),
  );

  return tasks.filter(Boolean) as TaskProjection[];
}

export async function getTask(taskId: string): Promise<TaskProjection | null> {
  return (
    ((await kvs.get(STORE_KEYS.taskProjection(taskId))) as
      | TaskProjection
      | undefined) || null
  );
}

export async function getTaskEvents(taskId: string): Promise<TaskEvent[]> {
  return (
    ((await kvs.get(STORE_KEYS.taskEvents(taskId))) as
      | TaskEvent[]
      | undefined) || []
  );
}

export async function appendTaskEvent(
  taskId: string,
  event: TaskEvent,
): Promise<TaskProjection> {
  const current = await getTask(taskId);

  if (!current) {
    throw new Error(`Task ${taskId} was not found.`);
  }

  const events = await getTaskEvents(taskId);
  const nextEvents = [...events, event];
  const nextProjection = projectTask(current, [event]);

  await kvs.set(STORE_KEYS.taskEvents(taskId), nextEvents);
  await kvs.set(STORE_KEYS.taskProjection(taskId), nextProjection);

  return nextProjection;
}

export async function getTaskDetail(
  taskId: string,
): Promise<{ task: TaskProjection; events: TaskEvent[] } | null> {
  const task = await getTask(taskId);

  if (!task) {
    return null;
  }

  return {
    task,
    events: await getTaskEvents(taskId),
  };
}
